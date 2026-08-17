/* ===== 加班记 工时与薪资计算引擎 ===== */
(function () {
  'use strict';

  /* 工时取整：分钟 -> 小时 */
  function roundHours(minutes, mode) {
    let m = Math.max(0, minutes);
    if (mode === 'quarter') m = Math.floor(m / 15) * 15;
    else if (mode === 'half') m = Math.floor(m / 30) * 30;
    return Math.round((m / 60) * 100) / 100;
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

  /* 单日拆分为: normal / weekdayOt / weekend / holiday 分钟数 */
  function daySplit(rec, settings) {
    const { work, ot } = dayMinutes(rec);
    const type = resolveDayType(rec);
    const standard = settings.workHoursPerDay * 60;
    const out = { normal: 0, weekdayOt: 0, weekend: 0, holiday: 0 };
    if (type === 'weekday') {
      out.normal = Math.min(work, standard);
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
      totalHours: 0,
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
        s.normalHours += roundHours(Math.min(mins.work, settings.workHoursPerDay * 60), settings.roundMode);
        s.weekdayOtHours += roundHours(split.weekdayOt, settings.roundMode);
        s.weekendHours += roundHours(split.weekend, settings.roundMode);
        s.holidayHours += roundHours(split.holiday, settings.roundMode);
      }
      if (rec && rec.shift === 'leave') {
        s.leaveHoursSum += Math.max(0, Number(rec.leaveHours) || 0);
      }
      if (!isWeekend(ds)) s.weekdaysInMonth += 1;
    });
    s.totalHours = roundMoney(s.normalHours + s.weekdayOtHours + s.weekendHours + s.holidayHours);
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
      subTotal,
      total: roundMoney(subTotal)
    };
  }

  /* 导出 CSV 文本（当月明细） */
  function monthCsv(year, month, recs, settings) {
    const days = Store.daysOfMonth(year, month);
    const lines = [];
    lines.push('日期,星期,类型,班次,正常工时(时),加班工时(时),请假(时),备注');
    days.forEach((ds) => {
      const rec = recs[ds];
      if (!rec) return;
      const isNoWork = rec.shift === 'rest' || rec.shift === 'leave';
      if (!hasAnyTime(rec) && !isNoWork) return;
      const type = resolveDayType(Object.assign({ date: ds }, rec));
      const typeName = { weekday: '平时', weekend: '周末', holiday: '节假日' }[type] || type;
      const mins = dayMinutes(rec);
      lines.push([
        ds,
        weekdayName(ds),
        typeName,
        { day: '白班', night: '夜班', rest: '休息', leave: '请假' }[rec.shift] || '白班',
        roundHours(mins.work, settings.roundMode),
        roundHours(mins.ot, settings.roundMode),
        Math.max(0, Number(rec.leaveHours) || 0),
        (rec.note || '').replace(/,/g, '，')
      ].join(','));
    });
    return lines.join('\n');
  }

  window.Calc = {
    roundHours,
    roundMoney,
    fmtMoney,
    resolveDayType,
    isWeekend,
    weekdayName,
    dayMinutes,
    daySplit,
    hasAnyTime,
    monthSummary,
    monthSalary,
    monthCsv
  };
})();
