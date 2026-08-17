/* ===== 加班记 主应用逻辑 ===== */
(function () {
  'use strict';

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  const state = {
    tab: 'records',
    recMonth: Store.toMonthStr(new Date()),
    salMonth: Store.toMonthStr(new Date()),
    selectedDay: '',  // 顶部卡片展示的日期，空 = 今天；点选日历某天后跟随该天
    statsRange: '6'   // 统计页范围：近 6 / 近 12 个月 / 全部
  };

  /* ================= 通用工具 ================= */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function fmtHour(h) {
    const v = Math.round(h * 100) / 100;
    return (v === Math.floor(v) ? String(v) : v.toFixed(2)) + ' 时';
  }

  /* 日历格农历行：节日 > 节气 > 初一月份 > 日期（官方 lunar-javascript 库） */
  /* ponytail: 仅修正农历库返回的公历节日名（去掉“节”字保持与旧版一致），不是法定节假日表；
     节假日判定本身来自 lunar-javascript 内置节日表 + 手动点选，无需逐年维护 */
  const FEST_FIX = { '元旦节': '元旦', '国庆节': '国庆' };
  function lunarText(ds) {
    const p = ds.split('-').map(Number);
    const solar = Solar.fromYmd(p[0], p[1], p[2]);
    const lunar = solar.getLunar();
    const lf = lunar.getFestivals();
    if (lf && lf.length) return lf[0];
    const sf = solar.getFestivals();
    if (sf && sf.length) return FEST_FIX[sf[0]] || sf[0];
    const jq = lunar.getJieQi();
    if (jq) return jq;
    return lunar.getDay() === 1 ? lunar.getMonthInChinese() + '月' : lunar.getDayInChinese();
  }

  function shiftMonth(monthStr, delta) {
    const p = monthStr.split('-');
    const y = parseInt(p[0], 10);
    const m = parseInt(p[1], 10) - 1 + delta;
    const d = new Date(y, m, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  /* ================= 弹窗 ================= */
  // center=true 时弹窗在屏幕中央显示（如年月选择器），默认底部抽屉
  function openModal(html, center) {
    $('#modalBox').innerHTML = html;
    $('#modalMask').classList.toggle('mask-center', !!center);
    $('#modalMask').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    $('#modalMask').classList.remove('mask-center');
    $('#modalMask').hidden = true;
    $('#modalBox').innerHTML = '';
    document.body.style.overflow = '';
  }

  function confirmModal(msg, okLabel, onOk, danger) {
    openModal(
      '<div class="m-title">提示<button class="m-close" data-close>✕</button></div>' +
      '<div style="font-size:15px;color:var(--text);line-height:1.7;">' + esc(msg) + '</div>' +
      '<div class="m-foot">' +
      '  <button class="btn btn-ghost-2" data-close>取消</button>' +
      '  <button class="btn ' + (danger ? 'btn-danger-ghost' : 'btn-primary') + '" data-confirm>' + esc(okLabel) + '</button>' +
      '</div>'
    );
    const mask = $('#modalMask');
    mask.querySelector('[data-confirm]').onclick = () => { closeModal(); onOk && onOk(); };
  }

  /* ================= 单日表单 ================= */
  function dayFormHtml(dateStr, rec) {
    rec = rec || Store.normalizeRecord(null);
    const st = Store.getSettings();
    // 未手动指定类型时，按日期自动判定：周六日=周末，其余=平时；法定节假日需手动点选
    const type = rec.dayType === 'auto' ? (Calc.isWeekend(dateStr) ? 'weekend' : 'weekday') : rec.dayType;
    const shift = rec.shift || 'day';
    const chip = (id, label, sub, active) =>
      '<button class="chip' + (active ? ' active' : '') + '" data-daytype="' + id + '">' + label +
      (sub ? '<span class="sub">' + sub + '</span>' : '') + '</button>';
    const shiftChip = (id, label, sub, active) =>
      '<button class="chip chip-sm' + (active ? ' active' : '') + '" data-shift="' + id + '">' + label +
      (sub ? '<span class="sub">' + sub + '</span>' : '') + '</button>';
    const isNoWork = shift === 'rest' || shift === 'leave';
    const otV = Number(rec.otHours) || 0;
    const lv = Number(rec.leaveHours) || 0;
    const w = Math.max(0, st.workHoursPerDay);
    // 请假满每日标准工时 = 全天请假，不再计算工时与加班
    const fullLeave = w > 0 && lv >= w;
    // 初始 Tab：全天请假或「只填了请假」落在请假；否则（含加班+请假并存）默认加班
    const initTab = (fullLeave || shift === 'leave' || (lv > 0 && otV <= 0)) ? 'leave' : 'ot';
    const fmtRate = (v) => {
      const n = Math.round(Number(v) * 100) / 100;
      return (Number.isInteger(n) ? String(n) : n.toFixed(2)) + '倍';
    };

    return (
      '<div class="day-type-bar">' +
        chip('weekday', '平时', fmtRate(st.otRateWeekday), type === 'weekday') +
        chip('weekend', '周末', fmtRate(st.otRateWeekend), type === 'weekend') +
        chip('holiday', '节假日', fmtRate(st.otRateHoliday), type === 'holiday') +
      '</div>' +

      '<div style="margin-top:14px;">' +
        '<div class="grp-label">班次</div>' +
        '<div class="day-type-bar">' +
          shiftChip('day', '白班', '', shift === 'day') +
          shiftChip('night', '夜班', '补贴', shift === 'night') +
          shiftChip('rest', '休息', '', shift === 'rest') +
        '</div>' +
      '</div>' +

      '<div style="margin-top:14px;">' +
        '<div class="grp-label">工时记录</div>' +
        '<div id="workTabs" class="work-tabs' + (isNoWork || fullLeave ? ' hidden' : '') + '">' +
          '<button type="button" class="wt-btn' + (initTab === 'ot' ? ' active' : '') + '" data-work-tab="ot">加班' + (otV > 0 ? '<i class="wt-v">' + otV + 'h</i>' : '') + '</button>' +
          '<button type="button" class="wt-btn' + (initTab === 'leave' ? ' active' : '') + '" data-work-tab="leave">请假' + (lv > 0 ? '<i class="wt-v">' + lv + 'h</i>' : '') + '</button>' +
        '</div>' +

        '<div id="otArea" class="ot-area' + (isNoWork || fullLeave || shift === 'leave' || initTab === 'leave' ? ' hidden' : '') + '">' +
          '<div>' + hourField('otHours', '加班（小时）', rec.otHours) + '</div>' +
          '<div class="form-tip">' + (type === 'weekday'
            ? '未填加班 = 正常出勤 ' + Math.max(0, st.workHoursPerDay) + ' 小时'
            : '上班即全天加班，请填加班小时；不填 = 当天未加班') + '</div>' +
        '</div>' +

        '<div id="leaveArea" class="ot-area' + (shift === 'rest' || initTab === 'ot' ? ' hidden' : '') + '">' +
          '<div>' + hourField('leaveHours', '请假（小时）', rec.leaveHours) + '</div>' +
          '<div class="form-tip">请假按小时扣减当日出勤：正常出勤 = ' + w + ' − 请假小时（最小 0）；加班只算超出 ' + w + ' 小时的部分</div>' +
        '</div>' +

        '<div id="restTip" class="rest-tip' + (isNoWork || fullLeave ? '' : ' hidden') + '">' +
          (shift === 'leave' || fullLeave
            ? '已请假满 ' + w + ' 小时（全天请假），不计算工时与加班；请假扣款满 ' + w + ' 小时按一天计'
            : '今日休息，不计算工时与出勤') +
        '</div>' +
      '</div>' +

      '<div class="field-row" style="margin-top:12px;">' +
        '<label>备注</label>' +
        '<input class="field-input" id="dayNote" type="text" placeholder="如：赶货、设备调试…" value="' + esc(rec.note || '') + '" />' +
      '</div>'
    );
  }

  /* 小时选择器：0~12 半小时步进，整点/半点分行错位排列，纯点选无键盘 */
  const HOUR_ROWS = (function () {
    const ints = [], halves = [];
    for (let h = 0; h <= 12; h += 0.5) {
      (Number.isInteger(h) ? ints : halves).push(h);
    }
    const chunk = (arr) => {
      const out = [];
      for (let i = 0; i < arr.length; i += 6) out.push(arr.slice(i, i + 6));
      return out;
    };
    const ic = chunk(ints), hc = chunk(halves);
    const rows = [];
    for (let i = 0; i < Math.max(ic.length, hc.length); i++) {
      if (ic[i]) rows.push({ half: false, vals: ic[i] });
      if (hc[i]) rows.push({ half: true, vals: hc[i] });
    }
    return rows; // 行序：0~5 / 0.5~5.5 / 6~11 / 6.5~11.5 / 12
  })();
  function hourField(key, label, val) {
    const v = Number(val) || 0;
    return '<div class="field-row hsel" style="margin-bottom:0;">' +
      '<label>' + label + '</label>' +
      '<div class="hsel-val"><b data-hsel-val="' + key + '">' + (v > 0 ? v : '0') + '</b><span>小时</span></div>' +
      '<div class="hsel-grid">' +
        HOUR_ROWS.map(function (row) {
          return '<div class="hsel-row">' +
            row.vals.map(function (h) {
              return '<button type="button" class="hchip' + (Math.abs(h - v) < 0.001 ? ' active' : '') + '" data-set-hour="' + key + '" data-h="' + h + '">' + h + '</button>';
            }).join('') +
          '</div>';
        }).join('') +
      '</div>' +
      '<input type="hidden" data-field="' + key + '" value="' + (v > 0 ? v : '') + '" />' +
    '</div>';
  }

  function readForm(elRoot, prev) {
    const rec = Store.blankDay();
    const present = [];
    $$('[data-field]', elRoot).forEach((inp) => { rec[inp.dataset.field] = inp.value; present.push(inp.dataset.field); });
    // 表单里没有的字段保留原记录值（如不再显示的正常班工时）
    if (prev) {
      Object.keys(prev).forEach((k) => { if (present.indexOf(k) === -1) rec[k] = prev[k]; });
    }
    $$('[data-daytype]', elRoot).forEach((b) => { if (b.classList.contains('active')) rec.dayType = b.dataset.daytype; });
    const shiftBtn = $('[data-shift].active', elRoot);
    rec.shift = shiftBtn ? shiftBtn.dataset.shift : 'day';
    // 加班与请假可同时存在：
    // - 选「请假」班次 = 全天请假（不计算出勤）
    // - 白班/夜班 + 请假小时 = 当日部分请假（正常出勤，加班照算，请假按小时扣款）
    const note = $('#dayNote', elRoot);
    rec.note = note ? note.value.trim() : '';
    return rec;
  }

  function saveDay(dateStr, elRoot, silent) {
    const fromModal = elRoot.classList.contains('modal');
    const rec = readForm(elRoot, Store.getDay(dateStr));
    // 请假满每日标准工时 = 全天请假：清空加班与正常工时，不计算出勤（防旧数据/绕过 UI）
    const w = Math.max(0, Store.getSettings().workHoursPerDay);
    if (rec.shift !== 'rest' && w > 0 && (Number(rec.leaveHours) || 0) >= w) {
      rec.otHours = '';
      rec.workHours = '';
      rec.shift = 'leave';
    }
    const isNoWork = rec.shift === 'rest' || rec.shift === 'leave';
    if (!isNoWork) {
      const type = Calc.resolveDayType(Object.assign({ date: dateStr }, rec));
      if (type === 'weekday') {
        // 工作日：正常出勤 = 每日标准工时 − 请假小时（请假扣减当日出勤），最少 0
        const def = Store.getSettings().workHoursPerDay;
        const std = (def > 0) ? def : 8;
        rec.workHours = String(Math.max(0, std - (Number(rec.leaveHours) || 0)));
      } else if (!Calc.hasAnyTime(rec) && (Number(rec.leaveHours) || 0) <= 0) {
        // 周末/节假日：上班即全天加班，未填任何工时且未请假 = 当天未加班
        Store.removeDay(dateStr);
        if (!silent) toast('当天无加班，未保存');
        if (fromModal) closeModal();
        rerender();
        return;
      }
    }
    Store.saveDay(dateStr, rec);
    if (!silent) toast('已保存');
    if (fromModal) closeModal();
    rerender();
  }

  function rerender() { render(); }

  /* 顶部卡片 HTML：卡片日期 + 本月汇总 + 该日加班薪资 */
  function todayCardHtml(cardDay, year, mon, recs, settings, sum, salary, today) {
    let todayOtPay = 0;
    const trec = recs[cardDay];
    if (trec && Calc.hasAnyTime(trec)) {
      const split = Calc.daySplit(Object.assign({ date: cardDay }, trec), settings);
      const h = Calc.roundHours;
      todayOtPay = salary.hourlyRate * (
        settings.otRateWeekday * h(split.weekdayOt) +
        settings.otRateWeekend * h(split.weekend) +
        settings.otRateHoliday * h(split.holiday)
      );
    }
    const td = cardDay.split('-');
    const todayLine = parseInt(td[1], 10) + '月' + parseInt(td[2], 10) + '日 ' + Calc.weekdayName(cardDay);
    const otPayLabel = cardDay === today ? '今日加班薪资' : '当日加班薪资';
    const otTotal = sum.weekdayOtHours + sum.weekendHours + sum.holidayHours;
    return '<div class="tl-date">' + todayLine + '</div>' +
      '<div class="tl-sub">' + year + '年' + (mon + 1) + '月 · 出勤 <b>' + sum.workDays + '</b> 天 · 加班 <b>' + fmtHour(otTotal) + '</b> · 工资 <b>¥' + Calc.fmtMoney(salary.total) + '</b><br/>' + otPayLabel + ' <b>¥' + Calc.fmtMoney(todayOtPay) + '</b></div>';
  }

  /* ================= 记录页（日历视图） ================= */
  function renderRecords() {
    const month = state.recMonth;
    const p = month.split('-');
    const year = parseInt(p[0], 10);
    const mon = parseInt(p[1], 10) - 1;
    const recs = Store.getRecords();
    const settings = Store.getSettings();
    const days = Store.daysOfMonth(year, mon);
    const today = Store.todayStr();

    $('#headerTitle').textContent = '加班记';
    $('#headerSub').textContent = '记录每一天';

    const sum = Calc.monthSummary(year, mon, recs, settings);
    const salary = Calc.monthSalary(year, mon, recs, settings);

    // 顶部卡片展示的日期：默认今天；点选日历某天后跟随该天
    const cardDay = state.selectedDay || today;
    const todayCard = todayCardHtml(cardDay, year, mon, recs, settings, sum, salary, today);

    // 日历网格（周一起始）
    const head = ['一', '二', '三', '四', '五', '六', '日']
      .map((w) => '<div class="cal-head-cell">' + w + '</div>').join('');
    let cells = '';
    const lead = (new Date(year, mon, 1).getDay() + 6) % 7;
    for (let i = 0; i < lead; i++) cells += '<div class="cal-cell blank"></div>';
    days.forEach((ds) => {
      const rec = recs[ds];
      const isNoWork = rec && (rec.shift === 'rest' || rec.shift === 'leave');
      const lh = rec ? (Number(rec.leaveHours) || 0) : 0;
      const has = !!(rec && (Calc.hasAnyTime(rec) || isNoWork || lh > 0));
      let info = '';
      if (has) {
        if (isNoWork && Calc.dayMinutes(rec).total === 0) {
          const lh = Number(rec.leaveHours) || 0;
          if (rec.shift === 'leave') {
            info = '<span class="ot-leave">' + (lh > 0 ? '假' + lh : '假') + '</span>';
          } else {
            info = '<span class="ot-rest">休</span>';
          }
        } else {
          const mins = Calc.dayMinutes(rec);
          const otH = Calc.roundHours(mins.ot);
          const workH = Calc.roundHours(mins.work);
          const type = Calc.resolveDayType(Object.assign({ date: ds }, rec));
          // 加班与请假分两行显示，不再挤在同一行
          info =
            '<span class="ot-line">' +
              (rec.shift === 'night' ? '<span class="ot-night">夜</span>' : '') +
              '<span class="ot-' + type + '">' + (otH > 0 ? '+' + otH : (workH > 0 ? '班' + workH : '0')) + 'h</span>' +
            '</span>' +
            (lh > 0 ? '<span class="ot-line">假' + lh + '</span>' : '');
        }
      }
      cells +=
        '<button class="cal-cell' + (ds === today ? ' today' : '') + (ds === state.selectedDay ? ' selected' : '') + '" data-open-day="' + ds + '">' +
          '<span class="cd' + (Calc.isWeekend(ds) ? ' weekend' : '') + '">' + parseInt(ds.split('-')[2], 10) + '</span>' +
          '<span class="cl">' + lunarText(ds) + '</span>' +
          '<span class="cs' + (has ? ' has' : '') + '">' + info + '</span>' +
        '</button>';
    });

    $('#appMain').innerHTML =
      '<div class="tab-panel fill">' +
        '<div class="today-card">' + todayCard + '</div>' +

        '<div class="month-nav">' +
          '<button class="nav" data-month-nav="-1">‹</button>' +
          '<button type="button" class="mt" data-month-pick-open>' + year + '年' + (mon + 1) + '月</button>' +
          '<button class="nav" data-month-nav="1">›</button>' +
        '</div>' +

        '<div class="card cal-card">' +
          '<div class="cal-head">' + head + '</div>' +
          '<div class="cal-grid">' + cells + '</div>' +
        '</div>' +
      '</div>';
  }

  /* ================= 年月选择器 ================= */
  let pickerYear = null;     // 选择器中当前浏览的年份
  let pickerMode = 'month';  // 'month' 选月份；'year' 选年份
  let pickerBase = null;     // 选择器高亮月份 YYYY-MM（设置页传入），null 时按当前页推断
  let pickerOnPick = null;   // 选中月份回调（设置页用），null 时按当前页跳转

  function openMonthPicker(initMonth, onPick) {
    pickerBase = initMonth || null;
    pickerOnPick = onPick || null;
    pickerYear = parseInt((initMonth || currentMonthStr()).split('-')[0], 10);
    pickerMode = 'month';
    renderMonthPicker();
  }

  function currentMonthStr() {
    return state.tab === 'salary' ? state.salMonth : state.recMonth;
  }

  /* 回到今天所在的月份 */
  function goToday() {
    const m = Store.toMonthStr(new Date());
    if (state.tab === 'salary') state.salMonth = m;
    else { state.recMonth = m; state.selectedDay = ''; }   // 顶部卡片恢复显示今天
    render();
  }

  /* 悬浮"今天"按钮：记录 / 工资页显示，统计 / 设置页隐藏 */
  function updateFab() {
    const fab = $('#fabToday');
    if (fab) fab.hidden = state.tab === 'settings' || state.tab === 'stats';
  }

  function renderMonthPicker() {
    const base = pickerBase || currentMonthStr();
    const curYear = parseInt(base.split('-')[0], 10);
    const curMon = parseInt(base.split('-')[1], 10);
    let body;
    if (pickerMode === 'year') {
      // 年份模式：以 12 年为一页的网格，点击年份选中后回到月份模式
      const start = 1900 + Math.floor((pickerYear - 1900) / 12) * 12;
      const end = Math.min(2100, start + 11);
      let years = '';
      for (let y = start; y <= end; y++) {
        const active = (y === pickerYear) ? ' active' : '';
        years += '<button type="button" class="mp-m' + active + '" data-year-pick-item="' + y + '">' + y + '</button>';
      }
      body =
        '<div class="mp-year">' +
          '<button type="button" class="nav" data-year-nav="-12"' + (start <= 1900 ? ' disabled' : '') + '>‹</button>' +
          '<span class="mp-y">' + start + ' - ' + end + '年</span>' +
          '<button type="button" class="nav" data-year-nav="12"' + (end >= 2100 ? ' disabled' : '') + '>›</button>' +
        '</div>' +
        '<div class="mp-grid">' + years + '</div>' +
        '<button type="button" class="mp-back" data-year-back>返回选月份</button>';
    } else {
      // 月份模式：点击年份文本可切换到年份选择
      let months = '';
      for (let m = 1; m <= 12; m++) {
        const active = (pickerYear === curYear && m === curMon) ? ' active' : '';
        months += '<button type="button" class="mp-m' + active + '" data-month-pick="' + m + '">' + m + '月</button>';
      }
      body =
        '<div class="mp-year">' +
          '<button type="button" class="nav" data-year-nav="-1"' + (pickerYear <= 1900 ? ' disabled' : '') + '>‹</button>' +
          '<button type="button" class="mp-y" data-year-pick>' + pickerYear + '年</button>' +
          '<button type="button" class="nav" data-year-nav="1"' + (pickerYear >= 2100 ? ' disabled' : '') + '>›</button>' +
        '</div>' +
        '<div class="mp-grid">' + months + '</div>' +
        (pickerOnPick ? '' : '<button type="button" class="mp-back" data-month-today>回到今天</button>');
    }
    openModal(
      '<div class="m-title">' + (pickerMode === 'year' ? '选择年份' : '选择年月') + '<button class="m-close" data-close>✕</button></div>' +
      body,
      true   // 居中显示
    );
  }

  function statItem(n, c) {
    return '<div class="stat-item"><div class="n">' + n + '</div><div class="c">' + c + '</div></div>';
  }

  /* 打开单日编辑弹窗 */
  function openDayModal(dateStr) {
    const rec = Store.getDay(dateStr);
    openModal(
      '<div class="m-title">' + parseInt(dateStr.split('-')[1], 10) + '月' + parseInt(dateStr.split('-')[2], 10) + '日 · ' +
        Calc.weekdayName(dateStr) + '<button class="m-close" data-close>✕</button></div>' +
      dayFormHtml(dateStr, rec) +
      '<div class="m-foot">' +
        '<button class="btn btn-danger-ghost" data-del-day="' + dateStr + '">删除</button>' +
        '<button class="btn btn-ghost-2" data-close>取消</button>' +
        '<button class="btn btn-primary" data-save="' + dateStr + '">保存</button>' +
      '</div>'
    );
    // 打开时同步一次状态，保证加班/请假区域的显示与记录一致
    syncLeaveState($('#modalBox'));
    updateHsel($('#modalBox'));
  }

  /* ================= 工资页 ================= */
  function renderSalary() {
    const month = state.salMonth;
    const p = month.split('-');
    const year = parseInt(p[0], 10);
    const mon = parseInt(p[1], 10) - 1;
    const recs = Store.getRecords();
    const settings = Store.getSettings();
    const sal = Calc.monthSalary(year, mon, recs, settings);
    const sum = sal.sum;

    const total = sal.total;

    $('#headerTitle').textContent = '工资计算';
    $('#headerSub').textContent = year + '年' + (mon + 1) + '月';

    const extra = total - sal.baseSalary;
    const customBase = sal.baseSalary !== settings.baseSalary;
    let breakdown = '<span>底薪 ¥' + Calc.fmtMoney(sal.baseSalary) + (customBase ? '<i class="c-tag">该月指定</i>' : '') + '</span>';
    if (extra >= 0) breakdown += '<span>含加班补贴 ¥' + Calc.fmtMoney(extra) + '</span>';

    const feeRows = sal.items.map((it) =>
      '<div class="fee-row">' +
        '<div class="name">' + esc(it.name) + '<span class="d">' + esc(it.detail) + '</span></div>' +
        '<div class="val">¥' + Calc.fmtMoney(it.value) + '</div>' +
      '</div>'
    ).join('');

    $('#appMain').innerHTML =
      '<div class="tab-panel">' +
        '<div class="month-nav">' +
          '<button class="nav" data-sal-nav="-1">‹</button>' +
          '<button type="button" class="mt" data-month-pick-open>' + year + '年' + (mon + 1) + '月</button>' +
          '<button class="nav" data-sal-nav="1">›</button>' +
        '</div>' +

        '<div class="salary-hero">' +
          '<div class="cap">本月预估工资（税后）</div>' +
          '<div class="amount">¥' + Calc.fmtMoney(total) + '</div>' +
          '<div class="breakdown">' + breakdown + '</div>' +
        '</div>' +

        '<div class="stat-grid">' +
          statItem(sum.workDays, '出勤(天)') +
          statItem(fmtHour(sum.normalHours), '正常工时') +
          statItem(fmtHour(sum.weekdayOtHours), '平时加班') +
          statItem(fmtHour(sum.weekendHours), '周末加班') +
          statItem(fmtHour(sum.holidayHours), '节假日加班') +
          statItem(sum.nightDays, '夜班(天)') +
        '</div>' +

        '<div class="card">' +
          '<div class="card-title">薪资明细</div>' +
          feeRows +
          '<div class="fee-total"><span class="name">应发合计</span><span class="val">¥' + Calc.fmtMoney(total) + '</span></div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-title">计算规则</div>' +
          '<div class="rule-box">' +
            '<b>时薪</b> = 底薪 ¥' + Calc.fmtMoney(sal.baseSalary) + (customBase ? '（该月指定）' : '') + ' ÷ ' + settings.calcDays + ' 天 ÷ ' + settings.workHoursPerDay + ' 小时 = <b>¥' + Calc.fmtMoney(sal.hourlyRate) + '</b>/时<br/>' +
            '<b>平时加班</b>（工作日）按 ' + Calc.fmtMoney(settings.otRateWeekday) + ' 倍计，<br/>' +
            '<b>周末加班</b>按 ' + Calc.fmtMoney(settings.otRateWeekend) + ' 倍计，<br/>' +
            '<b>节假日加班</b>按 ' + Calc.fmtMoney(settings.otRateHoliday) + ' 倍计。<br/>' +
            '正常班工时超出每天 ' + settings.workHoursPerDay + ' 小时的部分并入平时加班。<br/>' +
            '请假按小时扣款：时薪 × 请假小时，满 ' + settings.workHoursPerDay + ' 小时按一天扣（相当于日薪），未满部分按小时扣。<br/>' +
            '扣款分两种：「每月固定」每月都扣，「仅当月」只在所选月份扣一次（如迟到罚款）。' +
            ((settings.allowances || []).some((a) => a && a.unit === 'bonus' && (Number(a.amount) || 0) > 0) && sum.fullAttendance ? '<br/>本月已达全勤，全勤奖已计入。' : '') +
            '<br/>工时为估算，实际以工厂结算为准。' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ================= 统计页 ================= */
  function renderStats() {
    const settings = Store.getSettings();
    const recs = Store.getRecords();
    $('#headerTitle').textContent = '统计';
    $('#headerSub').textContent = '工时与工资概览';

    // 按月聚合有记录的日期
    const byMonth = {};
    Object.keys(recs).forEach((ds) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return;
      const m = ds.slice(0, 7);
      if (!byMonth[m]) byMonth[m] = [];
      byMonth[m].push(ds);
    });
    const months = Object.keys(byMonth).sort();
    const range = state.statsRange;
    const shown = range === 'all' ? months : months.slice(-parseInt(range, 10));

    // 逐月计算工资
    const rows = shown.map((m) => {
      const p = m.split('-');
      const y = parseInt(p[0], 10), mo = parseInt(p[1], 10) - 1;
      return { m, sal: Calc.monthSalary(y, mo, recs, settings) };
    });

    if (!rows.length) {
      $('#appMain').innerHTML =
        '<div class="tab-panel">' +
          '<div class="empty-tip">暂无记录，去「记录」页添加工时后即可查看统计。</div>' +
        '</div>';
      return;
    }

    const totalMoney = rows.reduce((a, r) => a + r.sal.total, 0);
    const totalHours = rows.reduce((a, r) => a + (r.sal.sum.normalHours + r.sal.sum.weekdayOtHours + r.sal.sum.weekendHours + r.sal.sum.holidayHours), 0);
    const totalDays = rows.reduce((a, r) => a + r.sal.sum.workDays, 0);
    const maxMoney = Math.max(1, ...rows.map((r) => r.sal.total));

    const rangeLabel = range === 'all' ? '全部记录' : '近 ' + range + ' 个月';
    const caps = [
      { id: '6', n: '近 6 个月' },
      { id: '12', n: '近 12 个月' },
      { id: 'all', n: '全部' }
    ];
    const chips = caps.map((c) =>
      '<button type="button" class="chip chip-sm' + (state.statsRange === c.id ? ' active' : '') + '" data-stats-range="' + c.id + '">' + c.n + '</button>'
    ).join('');

    const bars = rows.map((r) => {
      const h = Math.max(3, Math.round((r.sal.total / maxMoney) * 100));
      return '<div class="st-bar" title="' + r.m + ' ¥' + Calc.fmtMoney(r.sal.total) + '">' +
        '<div class="st-fill" style="height:' + h + '%"></div>' +
        '<span class="st-lb">' + parseInt(r.m.slice(5), 10) + '月</span>' +
      '</div>';
    }).join('');

    const list = rows.slice().reverse().map((r) => {
      const hours = r.sal.sum.normalHours + r.sal.sum.weekdayOtHours + r.sal.sum.weekendHours + r.sal.sum.holidayHours;
      return '<div class="fee-row">' +
        '<div class="name">' + r.m + '<span class="d">出勤 ' + r.sal.sum.workDays + ' 天 · 工时 ' + fmtHour(hours) + ' · 底薪 ¥' + Calc.fmtMoney(r.sal.baseSalary) + '</span></div>' +
        '<div class="val">¥' + Calc.fmtMoney(r.sal.total) + '</div>' +
      '</div>';
    }).join('');

    $('#appMain').innerHTML =
      '<div class="tab-panel">' +
        '<div class="salary-hero">' +
          '<div class="cap">累计工资估算（' + rangeLabel + '）</div>' +
          '<div class="amount">¥' + Calc.fmtMoney(totalMoney) + '</div>' +
          '<div class="breakdown"><span>累计工时 ' + fmtHour(totalHours) + '</span><span>出勤 ' + totalDays + ' 天</span><span>' + rows.length + ' 个月</span></div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-title">统计范围</div>' +
          '<div class="day-type-bar">' + chips + '</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-title">每月工资</div>' +
          '<div class="st-bars">' + bars + '</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-title">月度明细</div>' +
          list +
        '</div>' +
      '</div>';
  }

  /* ================= 设置页 ================= */
  function renderSettings() {
    const s = Store.getSettings();
    $('#headerTitle').textContent = '设置';
    $('#headerSub').textContent = '工资参数与数据管理';
    /* 回显：生效月份与底薪输入框默认取当前月份，底薪显示当前月份实际生效的值；
       若未改底薪直接保存，因新值与当前月底薪相同不会误建调整记录 */
    const effMonth = Store.toMonthStr(new Date());
    const effBase = Calc.baseSalaryFor(effMonth, s);

    const num = (key, label, hint, step) => {
      const val = key === 'baseSalary' ? effBase : s[key];
      return '<div class="field-row"><label>' + label + '</label>' +
        '<input class="field-input set-input" type="number" inputmode="decimal" step="' + (step || '0.01') + '" data-set="' + key + '" value="' + val + '" placeholder="' + (hint || '') + '" /></div>';
    };

    const UNIT_LABEL = {
      day: '按出勤天数',
      night: '按夜班天数',
      bonus: '全勤达标发放',
      month: '每月固定',
      once: '仅当月',
      percent: '按底薪比例'
    };
    /* 补贴 / 扣款列表渲染（kind: allowance | deduction） */
    const renderList = (list, kind) => {
      const isD = kind === 'deduction';
      const html = (list || []).map((al, i) => {
        const n = ((al && al.name) || '').trim() || (isD ? '扣款' : '补贴');
        const amt = Number(al && al.amount) || 0;
        const u0 = (al && al.unit) || 'month';
        let u = UNIT_LABEL[u0] || '每月固定';
        if (isD && u0 === 'once') u += '（' + ((al && al.appliedMonth) || '未设月份') + '）';
        else if (isD && u0 === 'percent') u = '底薪的 ' + amt + '%';
        const pref = isD ? '-' : '';
        return '<div class="allow-item' + (isD ? ' deduct' : '') + '">' +
          '<div class="ai-info">' +
            '<div class="ai-name">' + esc(n) + '</div>' +
            '<div class="ai-amt">' + pref + '¥' + amt + ' · ' + esc(u) + '</div>' +
          '</div>' +
          '<div class="ai-ops">' +
            (isD
              ? '<button class="allow-op" data-dc-edit="' + i + '">编辑</button>' +
                '<button class="allow-op del" data-dc-del="' + i + '">删除</button>'
              : '<button class="allow-op" data-ca-edit="' + i + '">编辑</button>' +
                '<button class="allow-op del" data-ca-del="' + i + '">删除</button>') +
          '</div>' +
        '</div>';
      }).join('');
      return html || '<div class="empty-tip">' + (isD ? '暂无扣款项，如社保代扣、公积金' : '暂无补贴') + '</div>';
    };

    /* 底薪调整记录列表渲染；记录可附带社保/公积金/个税覆盖（h.s/h.g/h.t） */
    const renderLog = (log, def) => {
      const arr = log || [];
      return arr.map((h, i) => {
        const ov = [];
        if (Number(h.s) > 0) ov.push('社保¥' + Number(h.s));
        if (Number(h.g) > 0) ov.push('公积金¥' + Number(h.g));
        if (Number(h.t) > 0) ov.push('个税¥' + Number(h.t));
        return '<div class="allow-item">' +
          '<div class="ai-info">' +
            '<div class="ai-name">' + esc(h.m) + ' 起</div>' +
            '<div class="ai-amt">¥' + (Number(h.v) || 0) + '</div>' +
            (ov.length ? '<div class="ai-ov">' + ov.join(' · ') + '</div>' : '') +
          '</div>' +
          '<div class="ai-ops">' +
            '<button class="allow-op" data-bs-edit="' + i + '">编辑</button>' +
            '<button class="allow-op del" data-bs-del="' + i + '">删除</button>' +
          '</div>' +
        '</div>';
      }).join('') || '<div class="empty-tip">暂无调整记录，所有月份按默认底薪 ¥' + (Number(def) || 0) + '</div>';
    };

    $('#appMain').innerHTML =
      '<div class="tab-panel">' +

        '<div class="card">' +
          '<div class="card-title">工资设置</div>' +
          '<div class="time-grid-3">' +
            '<div>' + num('baseSalary', '底薪（元/月）', '不含加班费') + '</div>' +
            '<div>' + num('calcDays', '月计薪天数', '标准 21.75') + '</div>' +
            '<div>' + num('workHoursPerDay', '每日标准工时', '标准 8') + '</div>' +
          '</div>' +
          '<div class="base-effect">' +
            '<span class="effect-date-label">新底薪生效月份（每月 1 号生效）</span>' +
            '<button type="button" class="effect-date" id="baseEffectDate" data-effect-date data-value="' + effMonth + '">' + parseInt(effMonth.slice(0, 4), 10) + '年' + parseInt(effMonth.slice(5, 7), 10) + '月 ▾</button>' +
            '<p class="effect-hint" id="effectHint"></p>' +
            '<div class="bs-log-title">底薪调整记录</div>' +
            '<div class="allow-list">' + renderLog(s.baseSalaryLog, s.baseSalary) + '</div>' +
            '<button type="button" class="btn btn-primary save-settings-btn" data-save-settings>保存设置</button>' +
          '</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-title">加班倍率</div>' +
          '<div class="time-grid-3">' +
            '<div>' + num('otRateWeekday', '平时（工作日）', '1.5 倍') + '</div>' +
            '<div>' + num('otRateWeekend', '周末', '2 倍') + '</div>' +
            '<div>' + num('otRateHoliday', '法定节假日', '3 倍') + '</div>' +
          '</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-title">补贴</div>' +
          '<div class="allow-list">' + renderList(s.allowances, 'allowance') + '</div>' +
          '<button class="allowance-add-btn" data-ca-add>＋ 添加补贴</button>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-title">扣款项</div>' +
          '<div class="allow-list">' + renderList(s.deductions, 'deduction') + '</div>' +
          '<button class="allowance-add-btn" data-dc-add>＋ 添加扣款</button>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-title">数据管理</div>' +
          '<div class="btn-row" style="margin-bottom:10px;">' +
            '<button class="btn btn-ghost" data-export-all>备份数据</button>' +
            '<button class="btn btn-ghost-2" data-import-all>导入备份</button>' +
          '</div>' +
          '<button class="btn btn-danger-ghost" data-clear-all>清空所有数据</button>' +
          '<p style="font-size:12px;color:var(--text-3);margin-top:10px;">所有数据仅保存在本机浏览器中，不会上传到任何服务器，请放心使用。</p>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-title">关于<span class="tag">v1.0</span></div>' +
          '<div class="rule-box">' +
            '加班记 · 免费 · 无广告 · 无需联网<br/>' +
            '专为工厂上班族设计：记录每日工时与加班，自动计算月薪。<br/>' +
            '工时与工资为估算，具体以工厂结算为准。' +
          '</div>' +
        '</div>' +
      '</div>';
    updateEffectHint();
  }

  /* 更新底薪生效提示 */
  function updateEffectHint() {
    const hint = $('#effectHint');
    if (!hint) return;
    const inp = $('[data-set="baseSalary"]');
    const newVal = inp ? (parseFloat(inp.value) || 0) : 0;
    const settings = Store.getSettings();
    const effInput = $('#baseEffectDate');
    const effMonth = (effInput && effInput.dataset.value) || Store.toMonthStr(new Date());
    const y = parseInt(effMonth.slice(0, 4), 10);
    const mo = parseInt(effMonth.slice(5, 7), 10);
    const prevMonth = mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0');
    const oldBase = Calc.baseSalaryFor(prevMonth, settings);
    hint.textContent = '从 ' + effMonth + '-01 起按新底薪 ¥' + newVal + '；之前月份仍按 ¥' + oldBase + ' 计算。点击「保存设置」后生效。';
  }

  /* 打开补贴 / 扣款编辑弹窗（index 为 -1/undefined 时新增；kind: allowance | deduction） */
  let caEditingIndex = -1;
  let caEditingUnit = 'month';
  let caEditingKind = 'allowance';
  const UNIT_OPTIONS = [
    { id: 'day', name: '按出勤天数' },
    { id: 'night', name: '按夜班天数' },
    { id: 'bonus', name: '全勤达标' },
    { id: 'month', name: '每月固定' }
  ];
  /* 扣款计算方式：每月固定 | 按底薪比例 | 仅当月（只在所选月份扣一次，如迟到罚款） */
  const DEDUCT_UNIT_OPTIONS = [
    { id: 'month', name: '每月固定' },
    { id: 'percent', name: '按底薪比例' },
    { id: 'once', name: '仅当月' }
  ];
  function openCaModal(index, kind) {
    caEditingIndex = (typeof index === 'number' && index >= 0) ? index : -1;
    caEditingKind = kind === 'deduction' ? 'deduction' : 'allowance';
    const isD = caEditingKind === 'deduction';
    const list = Store.getSettings()[isD ? 'deductions' : 'allowances'] || [];
    const ca = caEditingIndex >= 0 && caEditingIndex < list.length ? list[caEditingIndex] : null;
    let u0 = (ca && ca.unit) || 'month';
    if (isD && u0 !== 'once' && u0 !== 'percent') u0 = 'month';   // 扣款支持 每月固定 / 按底薪比例 / 仅当月
    caEditingUnit = u0;
    const unitOptions = isD ? DEDUCT_UNIT_OPTIONS : UNIT_OPTIONS;
    const unitChips = unitOptions.map((u) =>
      '<button type="button" class="ca-unit-chip' + (u.id === caEditingUnit ? ' active' : '') + '" data-ca-unit="' + u.id + '">' + u.name + '</button>'
    ).join('');
    const appliedMonth = (ca && ca.appliedMonth) || Store.toMonthStr(new Date());
    const title = ca ? (isD ? '编辑扣款' : '编辑补贴') : (isD ? '添加扣款' : '添加补贴');
    openModal(
      '<div class="m-title">' + title + '<button class="m-close" data-close>✕</button></div>' +
      '<div class="field-row">' +
        '<label>' + (isD ? '扣款名称' : '补贴名称') + '</label>' +
        '<input class="field-input" type="text" data-field="caName" placeholder="' + (isD ? '如：社保代扣、公积金' : '如：餐补、住房补贴') + '" value="' + esc((ca && ca.name) || '') + '" />' +
      '</div>' +
      '<div class="field-row">' +
        '<label id="caAmountLabel">' + (isD && caEditingUnit === 'percent' ? '扣款比例（%）' : (isD ? '扣款金额（元）' : '补贴金额（元）')) + '</label>' +
        '<input class="field-input" type="number" inputmode="decimal" step="0.01" min="0" data-field="caAmount" value="' + ((ca && Number(ca.amount)) || '') + '" placeholder="' + (isD && caEditingUnit === 'percent' ? '如：10' : '0 = 无') + '" />' +
      '</div>' +
      '<div class="field-row" style="margin-bottom:0;">' +
        '<label>计算方式</label>' +
        '<div class="ca-unit-row">' + unitChips + '</div>' +
      '</div>' +
      (isD
        ? '<div class="field-row ca-once-row" id="caOnceRow"' + (caEditingUnit === 'once' ? '' : ' hidden') + ' style="margin-top:10px;">' +
            '<label>生效月份（仅当月）</label>' +
            '<input class="field-input" type="month" data-field="caAppliedMonth" value="' + appliedMonth + '" />' +
          '</div>' +
          '<div class="ca-hint">每月固定：每月都扣固定金额；按底薪比例：按当月底薪 × 比例扣（改底薪自动变化）；仅当月：只在所选月份扣一次（如迟到罚款）。</div>'
        : '') +
      '<div class="m-foot">' +
        '<button class="btn btn-ghost-2" data-close>取消</button>' +
        '<button class="btn btn-primary" data-ca-save>保存</button>' +
      '</div>',
      true
    );
  }

  /* 编辑底薪调整记录（可覆盖社保/公积金/个税金额，留空则沿用「扣款项」默认设置） */
  let bsEditingIndex = -1;
  function openBsEditModal(index) {
    bsEditingIndex = (typeof index === 'number' && index >= 0) ? index : -1;
    const settings = Store.getSettings();
    const log = settings.baseSalaryLog || [];
    const h = bsEditingIndex >= 0 && bsEditingIndex < log.length ? log[bsEditingIndex] : null;
    const m0 = (h && h.m) || Store.toMonthStr(new Date());
    const numField = (key, label) =>
      '<div class="field-row">' +
        '<label>' + label + '</label>' +
        '<input class="field-input" type="number" inputmode="decimal" step="0.01" min="0" data-field="' + key + '" value="' + ((h && h[key]) != null ? h[key] : '') + '" placeholder="留空沿用默认扣款" />' +
      '</div>';
    openModal(
      '<div class="m-title">编辑底薪调整<button class="m-close" data-close>✕</button></div>' +
      '<div class="field-row">' +
        '<label>生效月份（每月 1 号生效）</label>' +
        '<button type="button" class="effect-date" id="bsMonthBtn" data-bs-month-open data-value="' + m0 + '">' + parseInt(m0.slice(0, 4), 10) + '年' + parseInt(m0.slice(5, 7), 10) + '月 ▾</button>' +
        '<div class="bs-month-inline" id="bsMonthInline" hidden></div>' +
      '</div>' +
      '<div class="field-row">' +
        '<label>底薪（元/月）</label>' +
        '<input class="field-input" type="number" inputmode="decimal" step="0.01" min="0.01" data-field="bsV" value="' + ((h && h.v) != null ? h.v : '') + '" />' +
      '</div>' +
      numField('bsS', '社保（元）') +
      numField('bsG', '公积金（元）') +
      numField('bsT', '个人所得税（元）') +
      '<div class="ca-hint">社保/公积金/个税留空或填 0 表示沿用「扣款项」的默认设置，该底薪段内每月生效。</div>' +
      '<div class="m-foot">' +
        '<button class="btn btn-ghost-2" data-close>取消</button>' +
        '<button class="btn btn-primary" data-bs-save>保存</button>' +
      '</div>',
      true
    );
  }

  /* 各数值字段的最小值，防止 0/负数导致时薪为 0 或 Infinity */
  const SETTING_MIN = { baseSalary: 0.01, calcDays: 1, workHoursPerDay: 1, otRateWeekday: 1, otRateWeekend: 1, otRateHoliday: 1 };
  function saveSettingsFromForm() {
    const settings = Store.getSettings();
    const s = {};
    $$('#appMain [data-set]').forEach((inp) => {
      let v = parseFloat(inp.value);
      if (isNaN(v)) v = 0;
      const min = SETTING_MIN[inp.dataset.set];
      if (min !== undefined && v < min) v = min;
      s[inp.dataset.set] = v;
    });
    /* 记录当前生效月份（仅回显用） */
    const effInput = $('#baseEffectDate');
    const effMonth = (effInput && effInput.dataset.value) || Store.toMonthStr(new Date());
    s.baseSalaryEffectDate = effMonth;
    /* 底薪调整：把「新底薪 + 生效月份」写入调整记录；默认底薪 baseSalary 不被覆盖。
       同值重复保存时保持原记录不变，避免误删 */
    const newBase = s.baseSalary;
    delete s.baseSalary;
    if (newBase > 0 && newBase !== Calc.baseSalaryFor(effMonth, settings)) {
      const log = (settings.baseSalaryLog || []).filter((h) => h && h.m < effMonth);
      log.push({ m: effMonth, v: newBase });
      s.baseSalaryLog = log;
    }
    Store.setSettings(s);
    render();
    toast('设置已保存');
  }

  function exportAll() {
    const blob = new Blob([Store.exportAll()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '加班记_备份_' + Store.todayStr() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('备份已导出');
  }

  function importAll() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          Store.importAll(String(reader.result));
          toast('导入成功');
          rerender();
        } catch (e) {
          toast('导入失败：文件格式不正确');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  /* 导出当月工资明细 CSV */
  function exportCsv() {
    const month = state.salMonth;
    const recs = Store.getRecords();
    const days = Object.keys(recs).filter((d) => d.indexOf(month) === 0).sort();
    const TYPE = { weekday: '平时', weekend: '周末', holiday: '节假日', auto: '自动' };
    const SHIFT = { day: '白班', night: '夜班', rest: '休息', leave: '请假' };
    const rows = [['日期', '类型', '班次', '工时(时)', '加班(时)', '请假(时)', '备注']];
    days.forEach((d) => {
      const r = recs[d];
      const w = Number(r.workHours) || 0, o = Number(r.otHours) || 0, l = Number(r.leaveHours) || 0;
      let shiftLabel = SHIFT[r.shift] || r.shift || '';
      if (l > 0 && r.shift !== 'leave') shiftLabel += '+请假';
      rows.push([d, TYPE[r.dayType] || r.dayType || '', shiftLabel,
        w ? w : '', o ? o : '', l ? l : '', r.note || '']);
    });
    const csvEsc = (v) => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const blob = new Blob(['\uFEFF' + rows.map((r) => r.map(csvEsc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '加班明细_' + month + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('明细已导出');
  }

  /* 复制当月工资单文本到剪贴板 */
  function copySummary() {
    const month = state.salMonth;
    const p = month.split('-');
    const sal = Calc.monthSalary(parseInt(p[0], 10), parseInt(p[1], 10) - 1, Store.getRecords(), Store.getSettings());
    const total = sal.total;
    const lines = [
      '【' + parseInt(p[0], 10) + '年' + parseInt(p[1], 10) + '月工资单】',
      '应发合计：¥' + Calc.fmtMoney(total),
      '--明细--',
      ...sal.items.map((it) => it.name + '：¥' + Calc.fmtMoney(it.value) + '（' + it.detail + '）')
    ];
    const text = lines.join('\n');
    const done = () => toast('工资单已复制');
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请长按手动复制'); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else fallback();
  }

  /* ================= 渲染入口 ================= */
  function render() {
    if (state.tab === 'records') renderRecords();
    else if (state.tab === 'salary') renderSalary();
    else if (state.tab === 'stats') renderStats();
    else renderSettings();
    updateFab();
  }

  const TAB_ORDER = ['records', 'salary', 'stats', 'settings'];

  /* 切页动画：旧面板按方向滑出 → 渲染新面板 → 新面板从反方向滑入 */
  function switchTab(tab) {
    if (state.tab === tab) return;
    const dir = TAB_ORDER.indexOf(tab) > TAB_ORDER.indexOf(state.tab) ? 1 : -1;
    state.tab = tab;
    $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const panel = $('#appMain').firstElementChild;
    const finish = () => {
      $('#appMain').scrollTop = 0;   // 切页回到顶部，避免保留原滚动位置产生跳动
      render();
      const np = $('#appMain').firstElementChild;
      if (np && np.classList.contains('tab-panel')) {
        np.style.setProperty('--in-x', dir * 24 + 'px');
        np.classList.add('panel-enter');
      }
    };
    if (panel && panel.classList.contains('tab-panel') && !panel._switching) {
      panel._switching = true;
      panel.style.setProperty('--out-x', -dir * 24 + 'px');
      panel.classList.remove('panel-enter');   // 清掉残留类，确保动画每次都能重新触发
      void panel.offsetWidth;                 // 强制 reflow，让动画类生效
      panel.classList.add('panel-leave');
      setTimeout(() => {
        panel.classList.remove('panel-leave');
        panel._switching = false;
        finish();
      }, 130);   // 与 CSS 的 .panel-leave 动画时长一致
    } else {
      finish();
    }
  }

  /* ================= 事件绑定 ================= */
  function bindEvents() {
    $$('.tab-btn').forEach((b) => {
      b.addEventListener('click', () => switchTab(b.dataset.tab));
    });

    $('#fabToday').addEventListener('click', goToday);

    $('#modalMask').addEventListener('click', (e) => {
      if (e.target.id === 'modalMask') closeModal();
    });

    $('#appMain').addEventListener('click', (e) => {
      // 日历左右滑动切月后短暂抑制本次滑动触发的 click，避免误点日历格
      if (Date.now() < (window.__suppressClickUntil || 0)) return;
      const el = e.target.closest('[data-open-day],[data-month-nav],[data-month-pick-open],[data-sal-nav],[data-go-today],[data-export-csv],[data-copy-summary],[data-export-all],[data-import-all],[data-clear-all],[data-ca-add],[data-ca-edit],[data-ca-del],[data-dc-add],[data-dc-edit],[data-dc-del],[data-save-settings],[data-bs-del],[data-bs-edit],[data-effect-date],[data-stats-range]');
      if (!el) return;
      handleClick(el, e);
    });

    $('#appMain').addEventListener('input', (e) => {
      /* 设置页输入仅实时更新底薪生效提示，点击「保存设置」才落库 */
      if (e.target.matches('[data-set]') && e.target.dataset.set === 'baseSalary') updateEffectHint();
    });

    $('#modalBox').addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) { closeModal(); return; }
      const yearNav = e.target.closest('[data-year-nav]');
      if (yearNav) {
        if (!yearNav.disabled) {
          pickerYear = Math.max(1900, Math.min(2100, pickerYear + Number(yearNav.dataset.yearNav)));
          renderMonthPicker();
        }
        return;
      }
      if (e.target.closest('[data-year-pick]')) { pickerMode = 'year'; renderMonthPicker(); return; }
      const yearItem = e.target.closest('[data-year-pick-item]');
      if (yearItem) {
        pickerYear = Number(yearItem.dataset.yearPickItem);
        pickerMode = 'month';
        renderMonthPicker();
        return;
      }
      if (e.target.closest('[data-year-back]')) { pickerMode = 'month'; renderMonthPicker(); return; }
      if (e.target.closest('[data-month-today]')) {
        if (pickerOnPick) { pickerOnPick(Store.toMonthStr(new Date())); closeModal(); return; }
        closeModal(); goToday(); return;
      }
      const monthPick = e.target.closest('[data-month-pick]');
      if (monthPick) {
        const m = pickerYear + '-' + String(Number(monthPick.dataset.monthPick)).padStart(2, '0');
        if (pickerOnPick) { pickerOnPick(m); closeModal(); return; }
        if (state.tab === 'salary') state.salMonth = m;
        else { state.recMonth = m; state.selectedDay = ''; }
        closeModal();
        render();
        return;
      }
      const setHour = e.target.closest('[data-set-hour]');
      if (setHour) {
        const root = setHour.closest('.modal') || document;
        const input = $('[data-field="' + setHour.dataset.setHour + '"]', root);
        if (input) {
          input.value = setHour.dataset.h;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return;
      }
      const caUnit = e.target.closest('[data-ca-unit]');
      if (caUnit) {
        caEditingUnit = caUnit.dataset.caUnit;
        $$('[data-ca-unit]').forEach((b) => b.classList.toggle('active', b === caUnit));
        // 扣款选"仅当月"时显示生效月份，选"每月固定"时隐藏
        const onceRow = $('#caOnceRow', $('#modalBox'));
        if (onceRow) onceRow.hidden = caEditingUnit !== 'once';
        // 扣款选"按底薪比例"时金额字段变为百分比
        if (caEditingKind === 'deduction') {
          const lab = $('#caAmountLabel', $('#modalBox'));
          const inp = $('[data-field="caAmount"]', $('#modalBox'));
          if (lab) lab.textContent = caEditingUnit === 'percent' ? '扣款比例（%）' : '扣款金额（元）';
          if (inp) inp.placeholder = caEditingUnit === 'percent' ? '如：10（底薪的 10%）' : '0 = 无';
        }
        return;
      }
      /* 底薪调整记录：内联展开月份网格（复用 .mp-grid/.mp-m 样式） */
      const bsMonthOpen = e.target.closest('[data-bs-month-open]');
      if (bsMonthOpen) {
        const wrap = $('#bsMonthInline', $('#modalBox'));
        if (!wrap) return;
        if (!wrap.hidden) { wrap.hidden = true; return; }
        const m0 = bsMonthOpen.dataset.value || Store.toMonthStr(new Date());
        const cur = m0.slice(5, 7);
        let cells = '';
        for (let m = 1; m <= 12; m++) {
          const ms = String(m).padStart(2, '0');
          cells += '<button type="button" class="mp-m' + (ms === cur ? ' active' : '') + '" data-bs-month-pick="' + m + '">' + m + '月</button>';
        }
        wrap.hidden = false;
        wrap.innerHTML = '<div class="mp-grid">' + cells + '</div>';
        return;
      }
      const bsMonthPick = e.target.closest('[data-bs-month-pick]');
      if (bsMonthPick) {
        const mBox = $('#modalBox');
        const btn = $('#bsMonthBtn', mBox);
        if (btn && btn.dataset.value) {
          const m = btn.dataset.value.slice(0, 4) + '-' + String(Number(bsMonthPick.dataset.bsMonthPick)).padStart(2, '0');
          btn.dataset.value = m;
          btn.textContent = parseInt(m.slice(0, 4), 10) + '年' + parseInt(m.slice(5, 7), 10) + '月 ▾';
        }
        const wrap = $('#bsMonthInline', mBox);
        if (wrap) wrap.hidden = true;
        return;
      }

      const caSave = e.target.closest('[data-ca-save]');
      if (caSave) {
        const name = $('[data-field="caName"]', $('#modalBox')).value.trim();
        const amount = parseFloat($('[data-field="caAmount"]', $('#modalBox')).value);
        const isD = caEditingKind === 'deduction';
        const unit = caEditingUnit || 'month';
        const item = { name: name, amount: isNaN(amount) ? 0 : amount, unit: unit };
        if (unit === 'once') {
          item.appliedMonth = $('[data-field="caAppliedMonth"]', $('#modalBox')).value || Store.toMonthStr(new Date());
        }
        const list = (Store.getSettings()[isD ? 'deductions' : 'allowances'] || []).slice();
        if (caEditingIndex >= 0 && caEditingIndex < list.length) list[caEditingIndex] = item;
        else list.push(item);
        Store.setSettings(isD ? { deductions: list } : { allowances: list });
        caEditingIndex = -1;
        caEditingUnit = 'month';
        caEditingKind = 'allowance';
        closeModal();
        renderSettings();
        toast(isD ? '扣款已保存' : '补贴已保存');
        return;
      }
      const bsSave = e.target.closest('[data-bs-save]');
      if (bsSave) {
        const mBox = $('#modalBox');
        const mBtn = $('[data-bs-month-open]', mBox);
        const month = (mBtn && mBtn.dataset.value) || '';
        const v = parseFloat($('[data-field="bsV"]', mBox).value);
        if (!month || !(v > 0)) { toast('请填写生效月份与底薪'); return; }
        const read = (k) => { const x = parseFloat($('[data-field="bs' + k + '"]', mBox).value); return !isNaN(x) && x > 0 ? x : undefined; };
        const s = read('S'), g = read('G'), t = read('T');
        const log = (Store.getSettings().baseSalaryLog || []).slice();
        if (bsEditingIndex >= 0 && bsEditingIndex < log.length) {
          const nh = { m: month, v: v };
          if (s !== undefined) nh.s = s;
          if (g !== undefined) nh.g = g;
          if (t !== undefined) nh.t = t;
          log[bsEditingIndex] = nh;
          log.sort((a, b) => (a.m < b.m ? -1 : a.m > b.m ? 1 : 0));
          Store.setSettings({ baseSalaryLog: log });
          bsEditingIndex = -1;
          closeModal();
          renderSettings();
          toast('已更新底薪调整记录');
        }
        return;
      }
      const el = e.target.closest('[data-shift],[data-daytype],[data-work-tab],[data-save],[data-del-day],[data-effect-date]');
      if (!el) return;
      handleClick(el, e);
    });
    $('#modalBox').addEventListener('input', (e) => {
      if (e.target.matches('[data-field]')) {
        updateHsel(e.target.closest('.modal') || document);
        if (e.target.matches('[data-field="leaveHours"], [data-field="otHours"]')) {
          syncLeaveState(e.target.closest('.modal') || document);
        }
      }
    });
  }

  /* 小时选择器显示同步：大数字与快捷值高亮和隐藏输入框保持一致 */
  function updateHsel(root) {
    $$('.hsel', root).forEach((box) => {
      const input = $('[data-field]', box);
      if (!input) return;
      const v = Number(input.value) || 0;
      const b = box.querySelector('[data-hsel-val]');
      if (b) b.textContent = v > 0 ? String(Math.round(v * 10) / 10) : '0';
      $$('.hchip', box).forEach((c) => {
        c.classList.toggle('active', Math.abs((Number(c.dataset.h) || 0) - v) < 0.001);
      });
    });
  }

  /* 请假/加班 Tab 与提示同步：加班与请假可同时存在，Tab 切换只换视图、不清空数据 */
  function syncLeaveState(root) {
    const shiftBtn = $('[data-shift].active', root);
    const shift = shiftBtn ? shiftBtn.dataset.shift : 'day';
    const tabs = $('#workTabs', root);
    const otArea = $('#otArea', root);
    const leaveArea = $('#leaveArea', root);
    const tip = $('#restTip', root);
    const w = Math.max(0, Store.getSettings().workHoursPerDay);
    const leaveInput = $('[data-field="leaveHours"]', root);
    const lh = leaveInput ? (Number(leaveInput.value) || 0) : 0;
    // 请假满每日标准工时 = 全天请假，隐藏加班入口
    const fullLeave = w > 0 && lh >= w;

    // 休息：隐藏 Tab 与两个输入区，只显示休息提示
    if (shift === 'rest') {
      if (tabs) tabs.classList.add('hidden');
      if (otArea) otArea.classList.add('hidden');
      if (leaveArea) leaveArea.classList.add('hidden');
      if (tip) {
        tip.classList.remove('hidden');
        tip.textContent = '今日休息，不计算工时与出勤';
      }
      return;
    }

    // 全天请假（请假满每日标准工时）：隐藏加班 Tab 与加班区，只显示请假区与提示
    if (shift === 'leave' || fullLeave) {
      if (tabs) tabs.classList.add('hidden');
      if (otArea) otArea.classList.add('hidden');
      if (leaveArea) leaveArea.classList.remove('hidden');
      if (tip) {
        tip.classList.remove('hidden');
        tip.textContent = '已请假满 ' + w + ' 小时（全天请假），不计算工时与加班；请假扣款满 ' + w + ' 小时按一天计';
      }
      return;
    }

    // 白班/夜班：加班与请假可并存，按当前激活 Tab 显示对应输入区
    if (tabs) tabs.classList.remove('hidden');
    if (tip) tip.classList.add('hidden');
    const tabBtn = $('[data-work-tab].active', root);
    const tab = tabBtn ? tabBtn.dataset.workTab : 'ot';
    if (otArea) otArea.classList.toggle('hidden', tab !== 'ot');
    if (leaveArea) leaveArea.classList.toggle('hidden', tab !== 'leave');
  }

  function handleClick(el, e) {
    e.stopPropagation();
    const root = el.closest('.tab-panel') || el.closest('.modal') || document;

    /* 统计页范围切换 */
    if (el.hasAttribute('data-stats-range')) {
      state.statsRange = el.dataset.statsRange;
      renderStats();
      return;
    }

    if (el.dataset.shift) {
      $$('[data-shift]', root).forEach((b) => b.classList.remove('active'));
      el.classList.add('active');
      // 班次只切换状态，不清空已填的加班/请假小时（加班与请假可并存）
      syncLeaveState(root);
      return;
    }
    if (el.dataset.workTab) {
      // Tab 只切换视图、不清空另一侧数据：加班与请假可同时存在（如上午请假2h + 晚上加班2h）
      $$('[data-work-tab]', root).forEach((b) => b.classList.toggle('active', b.dataset.workTab === el.dataset.workTab));
      syncLeaveState(root);
      return;
    }
    if (el.dataset.daytype) {
      $$('[data-daytype]', root).forEach((b) => b.classList.remove('active'));
      el.classList.add('active');
      return;
    }
    if (el.dataset.save) { saveDay(el.dataset.save, root); return; }
    if (el.dataset.delDay) {
      const ds = el.dataset.delDay;
      confirmModal('确定删除 ' + ds + ' 的全部记录吗？', '删除', () => {
        Store.removeDay(ds);
        toast('已删除');
        rerender();
      }, true);
      return;
    }
    if (el.dataset.openDay) {
      const ds = el.dataset.openDay;
      state.selectedDay = ds;
      // 轻量更新：只切换选中高亮与顶部卡片，不整页重绘（避免闪烁）
      $$('.cal-cell', $('#appMain')).forEach((c) => c.classList.toggle('selected', c.dataset.openDay === ds));
      const card = $('#appMain .today-card');
      if (card) {
        const pm = state.recMonth.split('-');
        const py = parseInt(pm[0], 10), pmon = parseInt(pm[1], 10) - 1;
        const recs = Store.getRecords();
        const settings = Store.getSettings();
        const sum = Calc.monthSummary(py, pmon, recs, settings);
        const salary = Calc.monthSalary(py, pmon, recs, settings);
        card.innerHTML = todayCardHtml(ds, py, pmon, recs, settings, sum, salary, Store.todayStr());
      }
      openDayModal(ds);
      return;
    }

    if (el.hasAttribute('data-month-pick-open')) { openMonthPicker(); return; }

    if (el.dataset.monthNav) {
      state.recMonth = shiftMonth(state.recMonth, parseInt(el.dataset.monthNav, 10));
      state.selectedDay = '';   // 翻月后顶部卡片恢复显示今天
      renderRecords();
      return;
    }
    if (el.dataset.salNav) { state.salMonth = shiftMonth(state.salMonth, parseInt(el.dataset.salNav, 10)); renderSalary(); return; }

    if (el.hasAttribute('data-go-today')) { goToday(); return; }

    if (el.hasAttribute('data-save-settings')) { saveSettingsFromForm(); return; }

    if (el.hasAttribute('data-effect-date')) {
      const btn = el;
      openMonthPicker(btn.dataset.value || Store.toMonthStr(new Date()), (m) => {
        btn.dataset.value = m;
        btn.textContent = parseInt(m.slice(0, 4), 10) + '年' + parseInt(m.slice(5, 7), 10) + '月 ▾';
        if (btn.id === 'baseEffectDate') updateEffectHint();
      });
      return;
    }

    if (el.hasAttribute('data-bs-edit')) { openBsEditModal(parseInt(el.dataset.bsEdit, 10)); return; }

    if (el.hasAttribute('data-bs-del')) {
      const i = parseInt(el.dataset.bsDel, 10);
      const settings = Store.getSettings();
      const log = settings.baseSalaryLog || [];
      const h = log[i];
      if (h) {
        confirmModal('确定删除「' + h.m + ' 起 ¥' + (Number(h.v) || 0) + '」这条底薪调整记录吗？删除后该月及之后将按前一条记录（或默认底薪）计算，社保/公积金/个税覆盖值同步回退。', '删除', () => {
          const next = (Store.getSettings().baseSalaryLog || []).slice();
          if (i < next.length) {
            next.splice(i, 1);
            Store.setSettings({ baseSalaryLog: next });
            render();
            toast('已删除该底薪调整');
          }
        }, true);
      }
      return;
    }

    if (el.hasAttribute('data-export-csv')) { exportCsv(); return; }
    if (el.hasAttribute('data-copy-summary')) { copySummary(); return; }
    if (el.hasAttribute('data-export-all')) { exportAll(); return; }
    if (el.hasAttribute('data-import-all')) { importAll(); return; }
    if (el.hasAttribute('data-clear-all')) {
      confirmModal('将清空所有记录和设置，且无法恢复。确定继续吗？', '全部清空', () => {
        Store.clearAll();
        toast('已清空');
        rerender();
      }, true);
      return;
    }
    if (el.hasAttribute('data-ca-add')) { openCaModal(); return; }
    if (el.dataset.caEdit !== undefined) { openCaModal(Number(el.dataset.caEdit)); return; }
    if (el.dataset.caDel !== undefined) {
      const cas = (Store.getSettings().allowances || []).slice();
      cas.splice(Number(el.dataset.caDel), 1);
      Store.setSettings({ allowances: cas });
      renderSettings();
      toast('补贴已删除');
      return;
    }
    if (el.hasAttribute('data-dc-add')) { openCaModal(undefined, 'deduction'); return; }
    if (el.dataset.dcEdit !== undefined) { openCaModal(Number(el.dataset.dcEdit), 'deduction'); return; }
    if (el.dataset.dcDel !== undefined) {
      const dcs = (Store.getSettings().deductions || []).slice();
      dcs.splice(Number(el.dataset.dcDel), 1);
      Store.setSettings({ deductions: dcs });
      renderSettings();
      toast('扣款已删除');
      return;
    }
  }

  /* ================= 记录页日历左右滑动切月 ================= */
  // 用 Pointer Events 实现：触摸、鼠标拖拽均可触发；配合 CSS touch-action: pan-y 避免手势被 WebView 吞掉
  const swipe = { x: 0, y: 0, t: 0, dx: 0, dy: 0, on: false };

  function bindSwipe() {
    const main = $('#appMain');
    if (!main) return;

    main.addEventListener('pointerdown', (e) => {
      // 弹窗打开、非记录页、或翻页动画进行中时不响应
      if ($('#modalMask') && !$('#modalMask').hidden) { swipe.on = false; return; }
      const card = $('.cal-card');
      if (!card || card._locked) { swipe.on = false; return; }
      swipe.x = e.clientX; swipe.y = e.clientY; swipe.t = Date.now();
      swipe.dx = 0; swipe.dy = 0; swipe.on = true;
      swipe.w = card.offsetWidth || 320;   // 缓存卡片宽度，避免 move 中反复读 layout
    }, { passive: true });

    main.addEventListener('pointermove', (e) => {
      if (!swipe.on) return;
      swipe.dx = e.clientX - swipe.x;
      swipe.dy = e.clientY - swipe.y;
      // 水平位移占优时跟手拖动日历卡片
      if (Math.abs(swipe.dx) > 8 && Math.abs(swipe.dx) > Math.abs(swipe.dy)) {
        const card = $('.cal-card');
        if (card && !card._locked) {
          card.style.transition = 'none';
          const w = swipe.w;
          const off = Math.max(-w, Math.min(w, swipe.dx));
          card.style.transform = 'translateX(' + off + 'px)';
          card.style.opacity = String(1 - Math.min(1, Math.abs(off) / w * 0.4));
        }
      }
    }, { passive: true });

    const endSwipe = () => {
      if (!swipe.on) return;
      swipe.on = false;
      const card = $('.cal-card');
      if (!card || card._locked) return;
      const dx = swipe.dx, dy = swipe.dy;
      const dt = Date.now() - swipe.t;
      const isSwipe = Math.abs(dx) > 50 || (Math.abs(dx) > 30 && Math.abs(dx) / Math.max(1, dt) > 0.4);
      const horizontal = Math.abs(dx) >= Math.abs(dy) * 1.2;
      if (!isSwipe || !horizontal) {
        // 未达到翻页阈值：回弹复位
        card.style.transition = 'transform .22s ease, opacity .22s ease';
        card.style.transform = 'translateX(0)';
        card.style.opacity = '1';
        return;
      }
      // 左滑 → 下个月(+1)，右滑 → 上个月(-1)
      window.__suppressClickUntil = Date.now() + 400;   // 抑制滑动结束触发的 click（鼠标拖拽尤其需要）
      swipeFlip(card, dx < 0 ? 1 : -1, dx);
    };
    main.addEventListener('pointerup', endSwipe, { passive: true });
    main.addEventListener('pointercancel', endSwipe, { passive: true });
  }

  /* 滑动翻月动画：旧日历卡片滑出 → 重渲染 → 新日历卡片滑入 */
  function swipeFlip(card, dir, dx) {
    const w = swipe.w;
    const out = dx < 0 ? -w : w;      // 旧卡片滑出方向
    const inFrom = dx < 0 ? w : -w;   // 新卡片进入起点
    card._locked = true;
    card.style.transition = 'transform .18s ease, opacity .18s ease';
    card.style.transform = 'translateX(' + out + 'px)';
    card.style.opacity = '0';
    setTimeout(() => {
      state.recMonth = shiftMonth(state.recMonth, dir);
      state.selectedDay = '';         // 翻月后顶部卡片恢复显示今天
      renderRecords();
      const nc = $('.cal-card');
      nc._locked = true;              // 滑入动画期间仍锁定，防止再次滑动打断
      nc.style.transition = 'none';
      nc.style.transform = 'translateX(' + inFrom + 'px)';
      nc.style.opacity = '0';
      void nc.offsetWidth;            // 强制回流，确保滑入动画生效
      nc.style.transition = 'transform .2s ease, opacity .2s ease';
      nc.style.transform = 'translateX(0)';
      nc.style.opacity = '1';
      setTimeout(() => { nc._locked = false; }, 200);
    }, 180);
  }

  /* 滚动条自动隐藏：滚动/触摸/滚轮时显示，停止约 1.5 秒后隐藏 */
  function initScrollbarAutoHide() {
    const SB_DELAY = 1500;
    const main = $('#appMain');
    function show(host) {
      host.classList.add('sb-active');
      clearTimeout(host._sbT);
      host._sbT = setTimeout(() => host.classList.remove('sb-active'), SB_DELAY);
    }
    // 捕获阶段监听所有元素的 scroll（scroll 不冒泡）
    document.addEventListener('scroll', (e) => {
      const t = e.target;
      if (t === main || !t || t === document || t === document.documentElement || t === document.body) {
        show(main);
      } else if (t.classList && t.classList.contains('modal')) {
        show(t);
      }
    }, true);
    // touchmove / wheel 在滚动发生前触发，提前显示
    ['touchmove', 'wheel'].forEach((ev) => {
      document.addEventListener(ev, (e) => {
        const m = e.target && e.target.closest ? e.target.closest('.modal') : null;
        show(m || main);
      }, { passive: true });
    });
  }

  /* ================= 启动 ================= */
  function init() {
    // 恢复上次状态
    const s = Store.getSettings();
    if (s.lastSavedMonth) state.recMonth = s.lastSavedMonth;

    initScrollbarAutoHide();
    bindEvents();
    bindSwipe();
    render();

    // 保存状态（切走时）；仅月份变化时才写入，避免每 2 秒全量写 localStorage
    let lastSavedMonth = '';
    setInterval(() => {
      if (state.recMonth !== lastSavedMonth) {
        lastSavedMonth = state.recMonth;
        Store.setSettings({ lastSavedMonth: state.recMonth });
      }
    }, 2000);

    // 注册 Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
