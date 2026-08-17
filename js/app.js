/* ===== 加班记 主应用逻辑 ===== */
(function () {
  'use strict';

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  const state = {
    tab: 'records',
    recMonth: Store.toMonthStr(new Date()),
    salMonth: Store.toMonthStr(new Date()),
    selectedDay: ''   // 顶部卡片展示的日期，空 = 今天；点选日历某天后跟随该天
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
  const FEST_FIX = { '元旦节': '元旦', '国庆节': '国庆' };   // 公历节日去掉“节”字，与旧版一致
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
        '<div class="grp-label">请假</div>' +
        '<div>' + hourField('leaveHours', '请假小时', rec.leaveHours) + '</div>' +
      '</div>' +

      '<div id="hourGrid"' + (isNoWork ? ' class="hidden"' : '') + ' style="margin-top:14px;">' +
        '<div>' + hourField('otHours', '加班（小时）', rec.otHours) + '</div>' +
        '<div class="form-tip">' + (type === 'weekday'
          ? '未填加班 = 正常出勤 ' + Math.max(0, st.workHoursPerDay) + ' 小时'
          : '上班即全天加班，请填加班小时；不填 = 当天未加班') + '</div>' +
      '</div>' +

      '<div id="restTip" class="rest-tip' + (isNoWork ? '' : ' hidden') + '">' +
        (shift === 'leave' ? '今日请假，不计算工时与出勤；请假按小时扣款，满 ' + Math.max(0, st.workHoursPerDay) + ' 小时算一天，零头按小时扣' : '今日休息，不计算工时与出勤') +
      '</div>' +

      '<div class="field-row" style="margin-top:12px;">' +
        '<label>备注</label>' +
        '<input class="field-input" id="dayNote" type="text" placeholder="如：赶货、设备调试…" value="' + esc(rec.note || '') + '" />' +
      '</div>'
    );
  }

  /* 半小时步进器：- / + 每点一次增减 0.5 小时，中间可手动输入 */
  function hourField(key, label, val) {
    return '<div class="field-row" style="margin-bottom:0;">' +
      '<label>' + label + '</label>' +
      '<div class="stepper">' +
        '<button type="button" class="step-btn" data-step="' + key + '" data-delta="-0.5" aria-label="减少半小时">−</button>' +
        '<input class="field-input step-input" type="number" inputmode="decimal" step="0.5" min="0" data-field="' + key + '" placeholder="0" value="' + esc(val || '') + '" />' +
        '<button type="button" class="step-btn" data-step="' + key + '" data-delta="0.5" aria-label="增加半小时">+</button>' +
      '</div>' +
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
    // 填了请假小时即视为请假（无需点击请假按钮）
    if ((Number(rec.leaveHours) || 0) > 0) rec.shift = 'leave';
    const note = $('#dayNote', elRoot);
    rec.note = note ? note.value.trim() : '';
    return rec;
  }

  function saveDay(dateStr, elRoot, silent) {
    const fromModal = elRoot.classList.contains('modal');
    const rec = readForm(elRoot, Store.getDay(dateStr));
    const isNoWork = rec.shift === 'rest' || rec.shift === 'leave';
    if (!isNoWork) {
      const type = Calc.resolveDayType(Object.assign({ date: dateStr }, rec));
      if (type === 'weekday') {
        // 工作日：未填正常班工时 → 默认按每日标准工时出勤
        if ((Number(rec.workHours) || 0) <= 0) {
          const def = Store.getSettings().workHoursPerDay;
          rec.workHours = String((def > 0) ? def : 8);
        }
      } else if (!Calc.hasAnyTime(rec)) {
        // 周末/节假日：上班即全天加班，未填任何工时 = 当天未加班
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
      const has = !!(rec && (Calc.hasAnyTime(rec) || isNoWork));
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
          const type = Calc.resolveDayType(Object.assign({ date: ds }, rec));
          info =
            (rec.shift === 'night' ? '<span class="ot-night">夜</span>' : '') +
            '<span class="ot-' + type + '">' + (otH > 0 ? '+' + otH : '0') + 'h</span>';
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
          '<button type="button" class="btn-today" data-go-today>今天</button>' +
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

  function openMonthPicker() {
    pickerYear = parseInt(currentMonthStr().split('-')[0], 10);
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

  function renderMonthPicker() {
    const curYear = parseInt(currentMonthStr().split('-')[0], 10);
    const curMon = parseInt(currentMonthStr().split('-')[1], 10);
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
        '<button type="button" class="mp-back" data-month-today>回到今天</button>';
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

    const extra = total - settings.baseSalary;
    let breakdown = '<span>底薪 ¥' + Calc.fmtMoney(settings.baseSalary) + '</span>';
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
          '<button type="button" class="btn-today" data-go-today>今天</button>' +
        '</div>' +

        '<div class="salary-hero">' +
          '<div class="cap">本月预估工资（税前）</div>' +
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
            '<b>时薪</b> = 底薪 ÷ ' + settings.calcDays + ' 天 ÷ ' + settings.workHoursPerDay + ' 小时 = <b>¥' + Calc.fmtMoney(sal.hourlyRate) + '</b>/时<br/>' +
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

        '<div class="btn-row" style="margin-bottom:6px;">' +
          '<button class="btn btn-ghost" data-export-csv>导出明细</button>' +
          '<button class="btn btn-ghost-2" data-copy-summary>复制工资单</button>' +
        '</div>' +
      '</div>';
  }

  /* ================= 设置页 ================= */
  function renderSettings() {
    const s = Store.getSettings();
    $('#headerTitle').textContent = '设置';
    $('#headerSub').textContent = '工资参数与数据管理';

    const num = (key, label, hint, step) =>
      '<div class="field-row"><label>' + label + '</label>' +
      '<input class="field-input set-input" type="number" inputmode="decimal" step="' + (step || '0.01') + '" data-set="' + key + '" value="' + s[key] + '" placeholder="' + (hint || '') + '" /></div>';

    const UNIT_LABEL = {
      day: '按出勤天数',
      night: '按夜班天数',
      bonus: '全勤达标发放',
      month: '每月固定',
      once: '仅当月'
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

    $('#appMain').innerHTML =
      '<div class="tab-panel">' +

        '<div class="card">' +
          '<div class="card-title">工资设置</div>' +
          '<div class="time-grid-3">' +
            '<div>' + num('baseSalary', '底薪（元/月）', '不含加班费') + '</div>' +
            '<div>' + num('calcDays', '月计薪天数', '标准 21.75') + '</div>' +
            '<div>' + num('workHoursPerDay', '每日标准工时', '标准 8') + '</div>' +
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
            '把本页添加到手机桌面，即可像 App 一样使用。<br/>' +
            '工时与工资为估算，具体以工厂结算为准。' +
          '</div>' +
        '</div>' +
      '</div>';
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
  /* 扣款计算方式：每月固定（每月都扣）| 仅当月（只在所选月份扣一次，如迟到罚款） */
  const DEDUCT_UNIT_OPTIONS = [
    { id: 'month', name: '每月固定' },
    { id: 'once', name: '仅当月' }
  ];
  function openCaModal(index, kind) {
    caEditingIndex = (typeof index === 'number' && index >= 0) ? index : -1;
    caEditingKind = kind === 'deduction' ? 'deduction' : 'allowance';
    const isD = caEditingKind === 'deduction';
    const list = Store.getSettings()[isD ? 'deductions' : 'allowances'] || [];
    const ca = caEditingIndex >= 0 && caEditingIndex < list.length ? list[caEditingIndex] : null;
    let u0 = (ca && ca.unit) || 'month';
    if (isD && u0 !== 'once') u0 = 'month';   // 扣款只允许 每月固定 / 仅当月
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
        '<label>' + (isD ? '扣款金额（元）' : '补贴金额（元）') + '</label>' +
        '<input class="field-input" type="number" inputmode="decimal" step="0.01" min="0" data-field="caAmount" value="' + ((ca && Number(ca.amount)) || '') + '" placeholder="0 = 无" />' +
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
          '<div class="ca-hint">每月固定：每月都扣（如社保/公积金/个税）；仅当月：只在所选月份扣一次（如迟到罚款）。</div>'
        : '') +
      '<div class="m-foot">' +
        '<button class="btn btn-ghost-2" data-close>取消</button>' +
        '<button class="btn btn-primary" data-ca-save>保存</button>' +
      '</div>',
      true
    );
  }

  /* 各数值字段的最小值，防止 0/负数导致时薪为 0 或 Infinity */
  const SETTING_MIN = { baseSalary: 0.01, calcDays: 1, workHoursPerDay: 1, otRateWeekday: 1, otRateWeekend: 1, otRateHoliday: 1 };
  function saveSettingsFromForm() {
    const s = {};
    $$('#appMain [data-set]').forEach((inp) => {
      let v = parseFloat(inp.value);
      if (isNaN(v)) v = 0;
      const min = SETTING_MIN[inp.dataset.set];
      if (min !== undefined && v < min) v = min;
      s[inp.dataset.set] = v;
    });
    Store.setSettings(s);
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
      rows.push([d, TYPE[r.dayType] || r.dayType || '', SHIFT[r.shift] || r.shift || '',
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
    else renderSettings();
  }

  const TAB_ORDER = ['records', 'salary', 'settings'];

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

    $('#modalMask').addEventListener('click', (e) => {
      if (e.target.id === 'modalMask') closeModal();
    });

    $('#appMain').addEventListener('click', (e) => {
      // 日历左右滑动切月后短暂抑制本次滑动触发的 click，避免误点日历格
      if (Date.now() < (window.__suppressClickUntil || 0)) return;
      const el = e.target.closest('[data-open-day],[data-month-nav],[data-month-pick-open],[data-sal-nav],[data-go-today],[data-export-csv],[data-copy-summary],[data-export-all],[data-import-all],[data-clear-all],[data-ca-add],[data-ca-edit],[data-ca-del],[data-dc-add],[data-dc-edit],[data-dc-del]');
      if (!el) return;
      handleClick(el, e);
    });

    $('#appMain').addEventListener('input', (e) => {
      if (e.target.matches('[data-set]')) {
        const keys = ['baseSalary', 'calcDays', 'workHoursPerDay', 'otRateWeekday', 'otRateWeekend', 'otRateHoliday'];
        if (keys.indexOf(e.target.dataset.set) !== -1) {
          clearTimeout(window.__setDebounce);
          window.__setDebounce = setTimeout(saveSettingsFromForm, 500);
        }
      }
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
      if (e.target.closest('[data-month-today]')) { closeModal(); goToday(); return; }
      const monthPick = e.target.closest('[data-month-pick]');
      if (monthPick) {
        if (state.tab === 'salary') state.salMonth = pickerYear + '-' + String(Number(monthPick.dataset.monthPick)).padStart(2, '0');
        else { state.recMonth = pickerYear + '-' + String(Number(monthPick.dataset.monthPick)).padStart(2, '0'); state.selectedDay = ''; }
        closeModal();
        render();
        return;
      }
      const step = e.target.closest('[data-step]');
      if (step) {
        const root = step.closest('.modal') || document;
        const input = $('[data-field="' + step.dataset.step + '"]', root);
        if (input) {
          const cur = Number(input.value) || 0;
          const next = cur + Number(step.dataset.delta);
          input.value = next > 0 ? String(Math.round(next * 10) / 10) : '';
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
      const el = e.target.closest('[data-shift],[data-daytype],[data-save],[data-del-day]');
      if (!el) return;
      handleClick(el, e);
    });
    $('#modalBox').addEventListener('input', (e) => {
      if (e.target.matches('[data-field="leaveHours"]')) {
        syncLeaveState(e.target.closest('.modal') || document);
      }
    });
  }

  /* 请假小时 > 0 即视为请假：隐藏工时输入、切换提示文案 */
  function syncLeaveState(root) {
    const shiftBtn = $('[data-shift].active', root);
    const shift = shiftBtn ? shiftBtn.dataset.shift : 'day';
    const lh = Number($('[data-field="leaveHours"]', root).value) || 0;
    const isLeave = lh > 0;
    const noWork = shift === 'rest' || isLeave;
    const grid = $('#hourGrid', root);
    if (grid) grid.classList.toggle('hidden', noWork);
    const tip = $('#restTip', root);
    if (tip) {
      tip.classList.toggle('hidden', !noWork);
      if (noWork) {
        const w = Math.max(0, Store.getSettings().workHoursPerDay);
        tip.textContent = isLeave
          ? '今日请假，不计算工时与出勤；请假按小时扣款，满 ' + w + ' 小时算一天，零头按小时扣'
          : '今日休息，不计算工时与出勤';
      }
    }
  }

  function handleClick(el, e) {
    e.stopPropagation();
    const root = el.closest('.tab-panel') || el.closest('.modal') || document;

    if (el.dataset.shift) {
      $$('[data-shift]', root).forEach((b) => b.classList.remove('active'));
      el.classList.add('active');
      // 请假与上班/休息互斥：切到其他班次时清空请假小时，避免残留值遮挡工时输入
      if (el.dataset.shift !== 'leave') {
        const lh = $('[data-field="leaveHours"]', root);
        if (lh) lh.value = '';
      }
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
