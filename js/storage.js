/* ===== 加班记 数据存储层 ===== */
(function () {
  'use strict';

  const DB_KEY = 'jiayiban_db_v1';

  /* 默认补贴列表：餐补（按出勤天数）、夜班补贴（按夜班天数）、全勤奖（全勤达标发放）、绩效奖（每月固定）；金额 0 表示未设置，不参与计算 */
  function defaultAllowances() {
    return [
      { name: '餐补', amount: 0, unit: 'day' },
      { name: '夜班补贴', amount: 0, unit: 'night' },
      { name: '全勤奖', amount: 0, unit: 'bonus' },
      { name: '绩效奖', amount: 0, unit: 'month' }
    ];
  }

  /* 默认扣款项：社保、公积金、个人所得税（每月固定）；金额 0 表示未设置，不参与计算 */
  function defaultDeductions() {
    return [
      { name: '社保', amount: 0, unit: 'month' },
      { name: '公积金', amount: 0, unit: 'month' },
      { name: '个人所得税', amount: 0, unit: 'month' }
    ];
  }

  const DEFAULT_SETTINGS = {
    baseSalary: 2280,          // 底薪（元）
    calcDays: 21.75,           // 月计薪天数
    workHoursPerDay: 8,        // 每日标准工时
    otRateWeekday: 1.5,        // 平时加班倍率
    otRateWeekend: 2.0,        // 周末加班倍率
    otRateHoliday: 3.0,        // 节假日加班倍率
    allowances: defaultAllowances(),  // 补贴列表 [{ name, amount, unit }] unit: day|night|bonus|month
    allowancesDefaultsAdded: true,    // 默认补贴是否已就位；老数据首次迁移补默认后置 true，避免删除后又出现
    deductions: defaultDeductions(),  // 扣款项列表 [{ name, amount, unit, appliedMonth }] unit: month(每月固定) | once(仅当月)
    deductionsDefaultsAdded: true,    // 默认扣款项是否已就位；老数据首次迁移补默认后置 true，避免删除后又出现
    lastSavedMonth: '',        // 上次浏览的月份 YYYY-MM
  };

  let db = null;

  function blankDay() {
    return {
      workHours: '',          // 正常班工时（小时）
      otHours: '',            // 加班工时（小时）
      leaveHours: '',         // 请假小时数（用于请假扣款）
      dayType: 'auto',        // auto | weekday | weekend | holiday
      shift: 'day',           // 班次：day 白班 | night 夜班 | rest 休息 | leave 请假
      note: '',
      updatedAt: 0
    };
  }

  /* 旧版"时间点"记录迁移为"小时数"：如 workStart/workEnd 08:00-17:00 -> workHours 9 */
  function migrateOldTimes(out, rec) {
    if (rec.workHours != null && rec.workHours !== '') return;
    if (!(rec.workStart || rec.workEnd || rec.otStart || rec.otEnd)) return;
    const spanHours = (start, end) => {
      if (!start || !end || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return 0;
      let d = (parseInt(end.slice(0, 2), 10) - parseInt(start.slice(0, 2), 10)) * 60 +
              parseInt(end.slice(3, 5), 10) - parseInt(start.slice(3, 5), 10);
      if (d < 0) d += 24 * 60;
      return Math.max(0, d) / 60;
    };
    let work = spanHours(rec.workStart, rec.workEnd);
    if (rec.breakEnabled && rec.breakStart && rec.breakEnd) {
      work = Math.max(0, work - spanHours(rec.breakStart, rec.breakEnd));
    }
    const ot = spanHours(rec.otStart, rec.otEnd);
    if (work > 0) out.workHours = String(Math.round(work * 100) / 100);
    if (ot > 0) out.otHours = String(Math.round(ot * 100) / 100);
  }

  function normalizeRecord(rec) {
    const d = blankDay();
    if (!rec) return d;
    const out = Object.assign(d, rec, {
      shift: ['day', 'night', 'rest', 'leave'].includes(rec.shift) ? rec.shift : (rec.nightShift ? 'night' : 'day'),
      dayType: ['auto', 'weekday', 'weekend', 'holiday'].includes(rec.dayType) ? rec.dayType : 'auto',
      updatedAt: rec.updatedAt || Date.now()
    });
    migrateOldTimes(out, rec);
    return out;
  }

  /* 把缺失的默认补贴按名称去重追加到列表 */
  function fillDefaultAllowances(settings) {
    if (settings.allowancesDefaultsAdded === true) return;
    const names = (settings.allowances || []).map((a) => ((a && a.name) || '').trim());
    defaultAllowances().forEach((d) => {
      if (names.indexOf(d.name) === -1) settings.allowances.push(d);
    });
    settings.allowancesDefaultsAdded = true;
  }

  /* 迁移旧版补贴字段（餐补/夜班/全勤/自定义）为统一的 allowances 列表 */
  function migrateAllowances(settings) {
    // 清理已移除的字段
    delete settings.roundMode;
    // 确保扣款项字段存在（老数据备份没有该字段时补空数组）
    if (!Array.isArray(settings.deductions)) settings.deductions = [];
    // 老数据首次加载时补默认扣款项（社保/公积金/个人所得税，按名称去重）
    if (settings.deductionsDefaultsAdded !== true) {
      const dNames = settings.deductions.map((d) => ((d && d.name) || '').trim());
      defaultDeductions().forEach((d) => {
        if (dNames.indexOf(d.name) === -1) settings.deductions.push(d);
      });
      settings.deductionsDefaultsAdded = true;
    }
    if (Array.isArray(settings.allowances)) {
      // 已是新结构，仅清理可能残留的旧字段
      delete settings.mealAllowance;
      delete settings.nightAllowance;
      delete settings.fullAttendanceBonus;
      delete settings.customAllowances;
      delete settings.customAllowanceName;
      delete settings.customAllowance;
      // 老数据首次加载时补默认补贴（餐补/夜班补贴/全勤奖/绩效奖，按名称去重）
      fillDefaultAllowances(settings);
      return;
    }
    // 旧版单个自定义补贴（customAllowanceName/customAllowance）先并入 customAllowances
    let custom = settings.customAllowances;
    if (!Array.isArray(custom)) {
      custom = [];
      const oldName = settings.customAllowanceName || '';
      const oldAmount = Number(settings.customAllowance) || 0;
      if (oldName || oldAmount > 0) custom.push({ name: oldName, amount: oldAmount });
    }
    const list = [];
    const push = (name, amount, unit) => {
      const a = Number(amount) || 0;
      if (a > 0) list.push({ name: (name || '').trim() || '补贴', amount: a, unit: unit });
    };
    push('餐补', settings.mealAllowance, 'day');
    push('夜班补贴', settings.nightAllowance, 'night');
    push('全勤奖', settings.fullAttendanceBonus, 'bonus');
    (custom || []).forEach((c) => {
      push((c && c.name) || '自定义补贴', c && c.amount, 'month');
    });
    // 旧数据没有任何补贴时补默认补贴
    if (list.length === 0) list.push.apply(list, defaultAllowances());
    settings.allowances = list;
    // 首次迁移同样补缺失的默认补贴（按名称去重）
    fillDefaultAllowances(settings);
    delete settings.mealAllowance;
    delete settings.nightAllowance;
    delete settings.fullAttendanceBonus;
    delete settings.customAllowances;
    delete settings.customAllowanceName;
    delete settings.customAllowance;
  }

  function load() {
    if (db) return db;
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        db = {
          settings: Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {}),
          records: parsed.records || {}
        };
        // 老数据没有该标记时强制置 false，让迁移逻辑补默认补贴/扣款项
        if (parsed.settings && !('allowancesDefaultsAdded' in parsed.settings)) {
          db.settings.allowancesDefaultsAdded = false;
        }
        if (parsed.settings && !('deductionsDefaultsAdded' in parsed.settings)) {
          db.settings.deductionsDefaultsAdded = false;
        }
        // 规范化所有记录
        const recs = {};
        Object.keys(db.records).forEach((k) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(k)) recs[k] = normalizeRecord(db.records[k]);
        });
        db.records = recs;
        migrateAllowances(db.settings);
        migrateFinesToDeductions(db.settings, parsed.fines);   // 旧版"当月罚款"迁移为"仅当月"扣款
      } else {
        db = { settings: Object.assign({}, DEFAULT_SETTINGS), records: {} };
      }
    } catch (e) {
      console.error('读取数据失败', e);
      db = { settings: Object.assign({}, DEFAULT_SETTINGS), records: {} };
    }
    return db;
  }

  function save() {
    if (!db) return;
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
    } catch (e) {
      console.error('保存数据失败', e);
    }
  }

  function getSettings() {
    return load().settings;
  }

  function setSettings(partial) {
    const s = load().settings;
    Object.keys(partial).forEach((k) => {
      if (k in DEFAULT_SETTINGS) s[k] = partial[k];
    });
    save();
  }

  function getRecords() {
    return load().records;
  }

  function getDay(dateStr) {
    const recs = getRecords();
    return recs[dateStr] || null;
  }

  function saveDay(dateStr, data) {
    const recs = getRecords();
    const norm = normalizeRecord(data);
    norm.updatedAt = Date.now();
    recs[dateStr] = norm;
    save();
  }

  function removeDay(dateStr) {
    const recs = getRecords();
    if (recs[dateStr]) {
      delete recs[dateStr];
      save();
    }
  }

  function daysOfMonth(year, month) {
    const first = new Date(year, month, 1);
    const next = new Date(year, month + 1, 1);
    const out = [];
    for (let d = new Date(first); d < next; d.setDate(d.getDate() + 1)) {
      out.push(toDateStr(d));
    }
    return out;
  }

  function toDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function toMonthStr(d) {
    return toDateStr(d).slice(0, 7);
  }

  function todayStr() {
    return toDateStr(new Date());
  }

  function exportAll() {
    return JSON.stringify(load(), null, 2);
  }

  function importAll(jsonStr) {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object' || !parsed.records) {
      throw new Error('数据格式不正确');
    }
    db = {
      settings: Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {}),
      records: {}
    };
    // 导入的备份若缺少该标记，同样强制置 false 以补默认补贴/扣款项
    if (parsed.settings && !('allowancesDefaultsAdded' in parsed.settings)) {
      db.settings.allowancesDefaultsAdded = false;
    }
    if (parsed.settings && !('deductionsDefaultsAdded' in parsed.settings)) {
      db.settings.deductionsDefaultsAdded = false;
    }
    migrateAllowances(db.settings);
    migrateFinesToDeductions(db.settings, parsed.fines);   // 旧版"当月罚款"迁移为"仅当月"扣款
    Object.keys(parsed.records || {}).forEach((k) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k)) db.records[k] = normalizeRecord(parsed.records[k]);
    });
    save();
  }

  function clearAll() {
    db = { settings: Object.assign({}, DEFAULT_SETTINGS), records: {} };
    save();
  }

  /* 旧版"当月罚款"（fines）迁移为"仅当月"扣款（unit:'once' + appliedMonth），避免老数据丢失 */
  function migrateFinesToDeductions(settings, fines) {
    if (!fines || typeof fines !== 'object') return;
    Object.keys(fines).forEach((m) => {
      (fines[m] || []).forEach((f) => {
        const amount = Number(f && f.amount) || 0;
        if (amount <= 0) return;
        settings.deductions.push({
          name: ((f && f.name) || '').trim() || '罚款',
          amount: amount,
          unit: 'once',
          appliedMonth: m
        });
      });
    });
  }

  window.Store = {
    getSettings,
    setSettings,
    getRecords,
    getDay,
    saveDay,
    removeDay,
    daysOfMonth,
    toMonthStr,
    todayStr,
    exportAll,
    importAll,
    clearAll,
    blankDay,
    normalizeRecord
  };
})();
