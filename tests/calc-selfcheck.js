/* 自检：扣款「按底薪比例」计算 + 底薪调整记录覆盖社保/公积金/个税
 * 运行：node tests/calc-selfcheck.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

global.window = global;
global.Store = {
  daysOfMonth: (y, m) => {
    const n = new Date(y, m + 1, 0).getDate();
    return Array.from({ length: n }, (_, i) => y + '-' + String(m + 1).padStart(2, '0') + '-' + String(i + 1).padStart(2, '0'));
  }
};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'calculator.js'), 'utf8'));
const Calc = global.window.Calc;

const settings = {
  calcDays: 22, workHoursPerDay: 8,
  otRateWeekday: 1.5, otRateWeekend: 2, otRateHoliday: 3,
  baseSalary: 2000,
  baseSalaryLog: [
    { m: '2026-08', v: 2000 },
    { m: '2026-09', v: 3000, s: 350, g: 150, t: 30 }
  ],
  allowances: [],
  deductions: [
    { name: '社保', unit: 'month', amount: 300 },
    { name: '公积金', unit: 'percent', amount: 10 },   // 底薪的 10%
    { name: '个人所得税', unit: 'month', amount: 20 },
    { name: '迟到罚款', unit: 'once', appliedMonth: '2026-09', amount: 50 }
  ]
};
const recs = [];
const item = (r, i) => r.items.find((x) => x.key === 'deduct:' + i);

/* 2026-08：无调整覆盖 → 社保固定 300，公积金 = 2000 × 10% = 200，个税 20，无迟到罚款 */
let r = Calc.monthSalary(2026, 7, recs, settings);
assert.strictEqual(r.baseSalary, 2000);
assert.strictEqual(item(r, 0).value, -300);
assert.strictEqual(item(r, 1).value, -200, '公积金应按底薪比例计算');
assert.strictEqual(item(r, 2).value, -20);
assert.strictEqual(item(r, 3), undefined, '迟到罚款仅 2026-09 生效');

/* 2026-09：底薪 3000，记录覆盖 → 社保 350 / 公积金 150 / 个税 30，迟到罚款 50 */
r = Calc.monthSalary(2026, 8, recs, settings);
assert.strictEqual(r.baseSalary, 3000);
assert.strictEqual(item(r, 0).value, -350, '社保应被底薪调整记录覆盖');
assert.strictEqual(item(r, 1).value, -150, '公积金应被底薪调整记录覆盖');
assert.strictEqual(item(r, 2).value, -30, '个税应被底薪调整记录覆盖');
assert.strictEqual(item(r, 3).value, -50);

/* 2026-10：无新调整，覆盖值应继承 9 月段 */
r = Calc.monthSalary(2026, 9, recs, settings);
assert.strictEqual(item(r, 0).value, -350, '社保覆盖应继承到无覆盖的后续月份');
assert.strictEqual(item(r, 1).value, -150, '公积金覆盖应继承');
assert.strictEqual(item(r, 2).value, -30, '个税覆盖应继承');
assert.strictEqual(item(r, 3), undefined);

console.log('calc-selfcheck OK');
