// 把 3D 猪绘制片段拼进 game.js（替换旧 drawPig）
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const path = 'src/game.js';
const t = readFileSync(path, 'utf8');

const startMark = '  function drawPig(ctx, p) {';
const start = t.indexOf(startMark);
if (start < 0) throw new Error('找不到 drawPig 起点');

const endMark = '  function drawBlock(ctx, b) {';
const endIdx = t.indexOf(endMark);
if (endIdx < 0) throw new Error('找不到 drawBlock 起点');

const frag = readFileSync('src/_pig3d.frag.js', 'utf8').replace(/\s+$/, '') + '\n\n';

const out = t.slice(0, start) + frag + t.slice(endIdx);
writeFileSync(path, out, 'utf8');
unlinkSync('src/_pig3d.frag.js');
console.log('ok, 行数', out.split('\n').length);
