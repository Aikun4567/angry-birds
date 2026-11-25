// 平衡性测量：对每个关卡扫描发射角度，统计破坏与得分
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.Phys = require('../src/physics.js');

const noop = function () {};
const grad = { addColorStop: noop };
function makeContext() {
  const base = {
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    measureText: () => ({ width: 10 }),
    globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    font: '', textAlign: 'left', textBaseline: 'top',
  };
  return new Proxy(base, {
    get(t, k) { return k in t ? t[k] : noop; },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const ctx = makeContext();
const canvas = {
  width: 1280, height: 720, style: {}, getContext: () => ctx,
  addEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
};
globalThis.innerWidth = 1280; globalThis.innerHeight = 720;
globalThis.AudioContext = undefined;

const game = require('../src/game.js');
const G = game.Game;
game.init(canvas);
const S = game.slingPos;

function shot(level, dx, dy, watch = 420) {
  game.buildLevel(level);
  const pigs0 = G.pigs.length;
  const score0 = 0;
  const p = { x: S.x + dx, y: S.y + dy };
  game.onDown(p); game.onMove(p); game.onUp();
  for (let i = 0; i < watch; i++) game.tick(1 / 60);
  const left = G.pigs.length;
  return { killed: pigs0 - left, score: G.score - score0, blocks: G.blocks.length, pigs: left };
}

for (let lv = 0; lv < game.LEVELS.length; lv++) {
  console.log(`\n=== 关卡 ${lv + 1} ${game.LEVELS[lv].name}  小鸟 ${game.LEVELS[lv].birds.join(',')} ===`);
  let best = null;
  const rows = [];
  for (const dx of [-60, -80, -96, -110, -116]) {
    for (const dy of [6, 16, 26, 36, 48, 60]) {
      const r = shot(lv, dx, dy);
      rows.push({ dx, dy, ...r });
      if (!best || r.killed * 10000 + r.score > best.killed * 10000 + best.score) best = { dx, dy, ...r };
    }
  }
  const top = rows.slice().sort((a, b) => (b.killed - a.killed) || (b.score - a.score)).slice(0, 6);
  for (const r of top) {
    console.log(`  拉(${r.dx},${r.dy}) 杀猪 ${r.killed}  得分 ${r.score}  剩余方块 ${r.blocks}  剩余猪 ${r.pigs}`);
  }
  console.log(`  最佳: 拉(${best.dx},${best.dy}) 杀猪 ${best.killed}`);
}
