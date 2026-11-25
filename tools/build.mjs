// 把 src/physics.js 与 src/game.js 内联进单文件 HTML
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const physics = readFileSync(join(root, 'src/physics.js'), 'utf8');
const game = readFileSync(join(root, 'src/game.js'), 'utf8');
const shell = readFileSync(join(root, 'src/index.html'), 'utf8');

let out = shell;
const parts = [
  ['/*__PHYSICS__*/', physics],
  ['/*__GAME__*/', game],
];
for (const [marker, code] of parts) {
  if (!out.includes(marker)) throw new Error('模板缺少占位符: ' + marker);
  out = out.replace(marker, () => code);
}

const target = join(root, '愤怒的小鸟.html');
writeFileSync(target, out, 'utf8');
const kb = (statSync(target).size / 1024).toFixed(1);
console.log(`已生成 ${target}  (${kb} KB)`);
