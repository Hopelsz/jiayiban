/* ===== 加班记 工时与薪资计算引擎 ===== */
(function () {
  'use strict';

  /* 分钟 -> 小时（保留两位小数） */
  function roundHours(minutes) {
    return Math.round((Math.max(0, minutes) / 60) * 100) / 100;
  }

  function roundMoney(v) {
    return Math.round(v * 100) / 100;
  }

  function fmtMoney(v) {
    return roundMoney(v).toFixed(2);
  }

  function parseDate(dateStr) {
    const parts = dateStr.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  function weekdayName(dateStr) {
    const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return names[parseDate(dateStr).getDay()];
  }

  function isWeekend(dateStr) {
    const dow = parseDate(dateStr).getDay();
    return dow === 0 || dow === 6;
  }

  /* 某天类型：auto(按日期自动) / weekday / weekend / holiday */
  function resolveDayType(rec) {
    if (rec.dayType && rec.dayType !== 'auto') return rec.dayType;
    return isWeekend(rec.date) ? 'weekend' : 'weekday';
  }

  /* 单日工时统计（分钟）：直接按填写的小时数计算 */
  function dayMinutes(rec) {
    const work = Math.max(0, Number(rec.workHours) || 0) * 60;
    const ot = Math.max(0, Number(rec.otHours) || 0) * 60;
    return { work, ot, total: work + ot };
  }

  /* 单日拆分: weekdayOt / weekend / holiday 分钟数 */
  function daySplit(rec, settings) {
    const { work, ot } = dayMinutes(rec);
    const type = resolveDayType(rec);
    const standard = settings.workHoursPerDay * 60;
    const out = { weekdayOt: 0, weekend: 0, holiday: 0 };
    if (type === 'weekday') {
      out.weekdayOt = ot + Math.max(0, work - standard);
    } else if (type === 'weekend') {
      out.weekend = work + ot;
    } else {
      out.holiday = work + ot;
    }
    return out;
  }

  /* 某天是否有任何工时记录 */
  function hasAnyTime(rec) {
    return (Number(rec.workHours) || 0) > 0 || (Number(rec.otHours) || 0) > 0;
  }

  /* 月度汇总 */
  function monthSummary(year, month, recs, settings) {
    const days = Store.daysOfMonth(year, month);
    const s = {
      workDays: 0,
      nightDays: 0,
      normalHours: 0,
      weekdayOtHours: 0,
      weekendHours: 0,
      holidayHours: 0,
      leaveHoursSum: 0,
      weekdaysInMonth: 0
    };
    days.forEach((ds) => {
      const rec = recs[ds];
      if (rec && hasAnyTime(rec)) {
        const split = daySplit(Object.assign({ date: ds }, rec), settings);
        s.workDays += 1;
        if (rec.shift === 'night') s.nightDays += 1;
        // 正常工时 = 每天正常班（不超过每日标准工时）总和，不区分周几、不包含加班
        const mins = dayMinutes(rec);
        s.normalHours += roundHours(Math.min(mins.work, settings.workHoursPerDay * 60));
        s.weekdayOtHours += roundHours(split.weekdayOt);
        s.weekendHours += roundHours(split.weekend);
        s.holidayHours += roundHours(split.holiday);
      }
      if (rec && rec.shift === 'leave') {
        s.leaveHoursSum += Math.max(0, Number(rec.leaveHours) || 0);
      }
      if (!isWeekend(ds)) s.weekdaysInMonth += 1;
    });
    s.fullAttendance = s.workDays >= s.weekdaysInMonth && s.workDays > 0;
    return s;
  }

  /* 月度薪资明细 */
  function monthSalary(year, month, recs, settings) {
    const sum = monthSummary(year, month, recs, settings);
    const hourlyRate = settings.calcDays > 0 && settings.workHoursPerDay > 0
      ? settings.baseSalary / settings.calcDays / settings.workHoursPerDay
      : 0;

    const items = [
      { key: 'base', name: '底薪（正常班）', detail: '按 ' + settings.calcDays + ' 天计薪，时薪 ' + fmtMoney(hourlyRate) + ' 元',
        value: settings.baseSalary },
      { key: 'weekdayOt', name: '平时加班费', detail: fmtMoney(settings.otRateWeekday) + ' 倍 × ' + sum.weekdayOtHours + ' 小时',
        value: hourlyRate * settings.otRateWeekday * sum.weekdayOtHours },
      { key: 'weekendOt', name: '周末加班费', detail: fmtMoney(settings.otRateWeekend) + ' 倍 × ' + sum.weekendHours + ' 小时',
        value: hourlyRate * settings.otRateWeekend * sum.weekendHours },
      { key: 'holidayOt', name: '节假日加班费', detail: fmtMoney(settings.otRateHoliday) + ' 倍 × ' + sum.holidayHours + ' 小时',
        value: hourlyRate * settings.otRateHoliday * sum.holidayHours }
    ];

    // 补贴列表：day 按出勤天数、night 按夜班天数、bonus 全勤达标发放、month 每月固定
    (settings.allowances || []).forEach((al, i) => {
      const amount = Number(al && al.amount) || 0;
      if (amount <= 0) return;
      const unit = (al && al.unit) || 'month';
      const name = ((al && al.name) || '').trim() || '补贴';
      let value = 0;
      let detail = '';
      if (unit === 'day') {
        value = amount * sum.workDays;
        detail = amount + ' 元/天 × 出勤 ' + sum.workDays + ' 天';
      } else if (unit === 'night') {
        value = amount * sum.nightDays;
        detail = amount + ' 元/天 × 夜班 ' + sum.nightDays + ' 天';
      } else if (unit === 'bonus') {
        value = sum.fullAttendance ? amount : 0;
        detail = sum.fullAttendance
          ? '当月全部工作日出勤'
          : '未达全勤（出勤 ' + sum.workDays + ' / 工作日 ' + sum.weekdaysInMonth + '）';
      } else {
        value = amount;
        detail = '每月固定补贴';
      }
      items.push({ key: 'allowance:' + i, name: name, detail: detail, value: value });
    });

    // 扣款：month 每月固定（如社保/公积金/个税）；once 仅当月（如迟到罚款，只在所选月份扣一次）
    const monthStr = year + '-' + String(month + 1).padStart(2, '0');
    (settings.deductions || []).forEach((dl, i) => {
      const amount = Number(dl && dl.amount) || 0;
      if (amount <= 0) return;
      const unit = (dl && dl.unit) || 'month';
      const appliedMonth = (dl && dl.appliedMonth) || '';
      if (unit === 'once' && appliedMonth !== monthStr) return;
      const name = ((dl && dl.name) || '').trim() || '扣款';
      const detail = unit === 'once' ? '仅当月扣款（' + appliedMonth + '）' : '每月固定扣款';
      items.push({ key: 'deduct:' + i, name: name, detail: detail, value: -amount });
    });

    /* 请假扣款：整天按日薪扣（8小时为一天），零头按时薪扣；两者合计 = 时薪 × 请假总小时 */
    const leaveH = sum.leaveHoursSum;
    if (leaveH > 0) {
      const w = settings.workHoursPerDay > 0 ? settings.workHoursPerDay : 8;
      const wholeDays = Math.floor(leaveH / w);
      const restH = Math.round((leaveH - wholeDays * w) * 100) / 100;
      items.push({
        key: 'leaveDeduct',
        name: '请假扣款',
        detail: '事假 ' + (wholeDays > 0 ? wholeDays + ' 天 ' : '') + (restH > 0 ? restH + ' 小时' : '') +
          '，时薪 ¥' + fmtMoney(hourlyRate) + ' × ' + leaveH + ' 小时',
        value: -(hourlyRate * leaveH)
      });
    }

    const subTotal = items.reduce((acc, it) => acc + it.value, 0);

    return {
      sum,
      hourlyRate,
      items,
      total: roundMoney(subTotal)
    };
  }

  window.Calc = {
    roundHours,
    fmtMoney,
    resolveDayType,
    isWeekend,
    weekdayName,
    dayMinutes,
    daySplit,
    hasAnyTime,
    monthSummary,
    monthSalary
  };
})();
