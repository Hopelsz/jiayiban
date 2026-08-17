/* 自检：storage.js 旧数据迁移（时间点→小时数、罚款→仅当月扣款、baseSalaryByMonth→baseSalaryLog、旧补贴字段→allowances）
 * 运行：node tests/storage-selfcheck.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

/* 用内存对象模拟 localStorage */
global.window = global;
const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); }
};
const DB_KEY = 'jiayiban_db_v1';
const runStorage = () => vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'storage.js'), 'utf8'));

/* ---- 场景 A：老版本数据（无 allowances/deductions 列表、时间点工时、按月底薪、当月罚款）---- */
mem[DB_KEY] = JSON.stringify({
  settings: {
    baseSalary: 2500,
    baseSalaryByMonth: { '2026-05': 2000, '2026-06': 2500 },
    mealAllowance: 10, nightAllowance: 20, fullAttendanceBonus: 100,
    customAllowanceName: '住房补贴', customAllowance: 50
  },
  records: {
    '2026-08-03': { workStart: '08:00', workEnd: '17:00', otStart: '18:00', otEnd: '20:00' },
    '2026-08-04': { workHours: 8, otHours: 2, nightShift: true }
  },
  fines: { '2026-08': [{ name: '迟到罚款', amount: 30 }] }
});
runStorage();
let Store = global.window.Store;

/* 1) 时间点 → 小时数 */
const r1 = Store.getDay('2026-08-03');
assert.strictEqual(r1.workHours, '9', '08:00-17:00 应迁移为 9 小时');
assert.strictEqual(r1.otHours, '2', '18:00-20:00 应迁移为 2 小时加班');
assert.strictEqual(Store.getDay('2026-08-04').shift, 'night', 'nightShift 应迁移为夜班');

/* 2) baseSalaryByMonth → baseSalaryLog（末月之后补一条"下月起"回退全局底薪） */
const log = Store.getSettings().baseSalaryLog;
assert.deepStrictEqual(log, [
  { m: '2026-05', v: 2000 },
  { m: '2026-06', v: 2500 },
  { m: '2026-07', v: 2500 }
], 'baseSalaryByMonth 应迁移为生效点列表并补下月记录');

/* 3) 旧罚款 → "仅当月"扣款 */
const fine = Store.getSettings().deductions.find((x) => x.name === '迟到罚款');
assert.ok(fine, '旧罚款应迁移为扣款');
assert.strictEqual(fine.unit, 'once');
assert.strictEqual(fine.appliedMonth, '2026-08');
assert.strictEqual(fine.amount, 30);

/* 4) 旧补贴字段 → allowances 列表（金额不丢失，且补默认绩效奖） */
const al = Store.getSettings().allowances;
const byName = (n) => al.find((a) => a.name === n);
assert.ok(byName('餐补') && byName('餐补').amount === 10, '旧餐补金额应迁移');
assert.ok(byName('夜班补贴') && byName('夜班补贴').amount === 20, '旧夜班补贴金额应迁移');
assert.ok(byName('全勤奖') && byName('全勤奖').amount === 100, '旧全勤奖金额应迁移');
assert.ok(byName('住房补贴') && byName('住房补贴').amount === 50, '旧自定义补贴应迁移');
assert.ok(byName('绩效奖'), '默认绩效奖应补齐');

/* ---- 场景 B：已迁移数据再次加载，不应重复注入（幂等） ---- */
mem[DB_KEY] = JSON.stringify({
  settings: {
    baseSalary: 2500,
    baseSalaryLog: [{ m: '2026-05', v: 2000 }],
    allowancesDefaultsAdded: true,
    deductionsDefaultsAdded: true,
    allowances: [{ name: '餐补', amount: 10, unit: 'day' }],
    deductions: [{ name: '社保', amount: 300, unit: 'month' }, { name: '迟到罚款', amount: 30, unit: 'once', appliedMonth: '2026-08' }]
  },
  records: { '2026-08-03': { workHours: 8, otHours: 2 } }
});
runStorage();   // 模拟应用重启
Store = global.window.Store;

const s2 = Store.getSettings();
assert.strictEqual(s2.allowances.length, 1, '已迁移数据不应重复补默认补贴');
assert.strictEqual(s2.deductions.length, 2, '已迁移数据不应重复补默认扣款');
assert.strictEqual(Store.getDay('2026-08-03').workHours, 8, '新结构记录不应被迁移改写');

console.log('storage 迁移自检全部通过');
