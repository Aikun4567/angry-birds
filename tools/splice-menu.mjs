// 用新版首页 + 关卡介绍替换 drawMenu
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const path = 'src/game.js';
const t = readFileSync(path, 'utf8');

const startMark = '  function drawMenu(ctx) {';
const start = t.indexOf(startMark);
if (start < 0) throw new Error('找不到 drawMenu');

const endMark = '  function drawLevels(ctx) {';
const endIdx = t.indexOf(endMark);
if (endIdx < 0) throw new Error('找不到 drawLevels');

const frag = readFileSync('src/_menu.frag.js', 'utf8').replace(/\s+$/, '') + '\n\n';
const out = t.slice(0, start) + frag + t.slice(endIdx);
writeFileSync(path, out, 'utf8');
unlinkSync('src/_menu.frag.js');
console.log('ok 行数', out.split('\n').length);
