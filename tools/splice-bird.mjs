// 把 3D 小鸟绘制片段拼进 game.js（替换旧 drawBird）
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const path = 'src/game.js';
const t = readFileSync(path, 'utf8');

const startMark = '  function drawBird(ctx, type, x, y, r, angle, dim) {';
const start = t.indexOf(startMark);
if (start < 0) throw new Error('找不到 drawBird 起点');

const endMark = '颜色明暗';
const endIdx = t.indexOf(endMark);
if (endIdx < 0) throw new Error('找不到 颜色明暗 注释');
const lineStart = t.lastIndexOf('\n', endIdx) + 1;

const frag = readFileSync('src/_bird3d.frag.js', 'utf8').replace(/\s+$/, '') + '\n\n';

const out = t.slice(0, start) + frag + t.slice(lineStart);
writeFileSync(path, out, 'utf8');
unlinkSync('src/_bird3d.frag.js');
console.log('ok, 新文件长度', out.length, '行数', out.split('\n').length);
