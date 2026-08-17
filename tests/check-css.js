/* CSS 括号校验：抓出多余/缺失的大括号（曾导致 .stat-grid 样式静默失效）
 * 运行：node tests/check-css.js */
'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'css', 'style.css');
const css = fs.readFileSync(file, 'utf8');

// 去掉注释与字符串后再统计大括号，避免误判
const cleaned = css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/'(?:\\.|[^'\\])*'/g, "''")
  .replace(/"(?:\\.|[^"\\])*"/g, '""');
const open = (cleaned.match(/{/g) || []).length;
const close = (cleaned.match(/}/g) || []).length;

if (open !== close) {
  console.error('CSS 大括号不平衡：{ ' + open + ' 个，} ' + close + ' 个 → ' + file);
  process.exit(1);
}
console.log('CSS braces OK ({ ' + open + ' / } ' + close + ')');
