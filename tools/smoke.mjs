// 无头冒烟测试：用桩 canvas 跑完整游戏逻辑（不依赖浏览器）
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

globalThis.Phys = require('../src/physics.js');

const noop = function () {};
const grad = { addColorStop: noop };

function makeContext() {
  const base = {
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => null,
    measureText: (t) => ({ width: String(t).length * 10 }),
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
  width: 1280, height: 720, style: {},
  getContext: () => ctx,
  addEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  setPointerCapture: noop,
};

globalThis.AudioContext = undefined;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;

const game = require('../src/game.js');
const G = game.Game;
const sling = game.slingPos;

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}
const f = (n, d = 1) => Number(Number(n).toFixed(d));

function advance(frames, dt = 1 / 60) {
  for (let i = 0; i < frames; i++) game.tick(dt);
}
function advanceUntil(pred, maxFrames) {
  let i = 0;
  while (!pred() && i < maxFrames) { game.tick(1 / 60); i++; }
  return i;
}
// 走真实的按下-拖动-松开流程
function aimAndFire(dx, dy) {
  const p = { x: sling.x + dx, y: sling.y + dy };
  game.onDown(p);
  game.onMove(p);
  game.onUp();
  return p;
}
function fireReadyBird(dx, dy) {
  if (G.phase !== 'ready' || !G.held) return false;
  aimAndFire(dx === undefined ? -92 : dx, dy === undefined ? 40 : dy);
  return G.phase === 'flying';
}
// 指定关卡 + 指定首发小鸟
function forceBird(type, level) {
  game.buildLevel(level);
  G.queue = [type];
  G.used = 0;
  G.held = null;
  game.spawnNextBird(true);
  return G.phase === 'ready' && G.held && G.held.btype === type;
}

check('init() 成功', game.init(canvas) === true);
check('初始在菜单', G.scene === 'menu');
game.render();

/* ---- 新流程：开始游戏 → 选关 → 关卡介绍 → 开战 ---- */
const menuBtns = G.buttons.filter((b) => b.style !== 'hit');
check('首页只有一个按钮', menuBtns.length === 1 && menuBtns[0].id === 'start',
  `buttons=${menuBtns.map((b) => b.id).join(',')}`);
game.onDown({ x: menuBtns[0].x + 20, y: menuBtns[0].y + 20 });
check('点开始游戏进入选关', G.scene === 'levels', `scene=${G.scene}`);

game.render();
const lvBtn = G.buttons.find((b) => b.id === 'level:0');
check('选关界面有关卡卡片', !!lvBtn);
game.onDown({ x: lvBtn.x + 20, y: lvBtn.y + 20 });
check('点关卡先进入介绍页', G.scene === 'intro' && !!G.held, `scene=${G.scene}`);
game.render();
const fightBtn = G.buttons.find((b) => b.id === 'fight');
check('介绍页有开始战斗按钮', !!fightBtn);
game.onDown({ x: fightBtn.x + 20, y: fightBtn.y + 20 });
check('点开始战斗进入关卡', G.scene === 'play' && G.phase === 'ready', `scene=${G.scene}`);

/* ================= 关卡 1 ================= */
game.buildLevel(0);
check('进入第 1 关', G.scene === 'play' && G.phase === 'ready');
check('关卡 1 有 5 个木块与 2 只猪', G.blocks.length === 5 && G.pigs.length === 2,
  `blocks=${G.blocks.length} pigs=${G.pigs.length}`);
check('弹弓上有一只红鸟', !!G.held && G.held.btype === 'red');

const snap = G.blocks.map((b) => ({ x: b.x, y: b.y }));
advance(120);
const drift = G.blocks.reduce((m, b, i) => Math.max(m,
  Math.hypot(b.x - snap[i].x, b.y - snap[i].y)), 0);
check('开场结构 2 秒内稳定', drift < 1.5, `drift=${f(drift, 2)}px`);

/* ---- 直接命中木屋：红鸟击穿左侧立柱 ---- */
const beam = G.blocks.find((b) => b.w > 150);
const post = G.blocks.find((b) => b.h > 100);
const postHp0 = post.hp;
const beamHp0 = beam.hp;
aimAndFire(-100, 26);
check('拖拽后进入飞行', G.phase === 'flying' && G.activeBirds.length === 1);
check('小鸟速度指向右上方', G.activeBirds[0].vx > 0 && G.activeBirds[0].vy < 0,
  `v=(${f(G.activeBirds[0].vx)}, ${f(G.activeBirds[0].vy)})`);
advance(240);
console.log(`   命中后 得分=${G.score} 方块=${G.blocks.length} 猪=${G.pigs.length}` +
  ` 立柱HP ${f(postHp0)}->${f(post.hp)} 横梁HP ${f(beamHp0)}->${f(beam.hp)}`);
check('撞击产生了伤害或破坏', G.score > 0 || post.hp < postHp0 || post.dead,
  `score=${G.score}`);
check('鸟没有穿地', G.world.bodies.filter((b) => b.kind === 'bird').every((b) => b.y < 900));

/* ---- 一直打到本关结束 ---- */
let guard = 0;
let shotIdx = 0;
const goodPulls = [[-100, 26], [-80, 36], [-110, 26]];
while (G.phase !== 'won' && G.phase !== 'lost' && guard < 9000) {
  if (G.phase === 'ready' && G.held) {
    const pl = goodPulls[shotIdx % goodPulls.length];
    fireReadyBird(pl[0], pl[1]);
    shotIdx++;
  }
  game.tick(1 / 60);
  guard++;
}
console.log(`   关卡 1 结束: phase=${G.phase} 帧=${guard} 得分=${G.score} 星=${G.stars}` +
  ` 三星线=${G.starTargets ? G.starTargets[2] : '-'}`);
check('关卡能正常结束', G.phase === 'won' || G.phase === 'lost', `phase=${G.phase}`);
check('好球能通关第 1 关', G.phase === 'won', `phase=${G.phase} score=${G.score}`);
game.render();

/* ---- 排队等待上弓 ---- */
game.buildLevel(0);
const q0 = G.queue.length - G.used;
advance(4);
fireReadyBird(-10, 110);   // 朝天上打，故意打不到东西
advanceUntil(() => G.phase === 'ready', 900);
check('发射后下一只自动上弓', G.phase === 'ready' && !!G.held, `phase=${G.phase}`);
check('队列整体向前递进', G.queueSlide > 0.2, `slide=${G.queueSlide.toFixed(2)}`);
check('待发小鸟数量递减', G.queue.length - G.used === q0 - 1, `left=${G.queue.length - G.used}`);
advance(60);
check('队列动画会归位', G.queueSlide === 0, `slide=${G.queueSlide}`);

/* ================= 黄鸟冲刺 ================= */
check('可指定首发黄鸟', forceBird('yellow', 1));
fireReadyBird(-100, 34);
advance(10);
const yBird = G.activeBirds.find((b) => b.btype === 'yellow');
const speed0 = yBird ? Math.hypot(yBird.vx, yBird.vy) : 0;
const didDash = game.useAbility();
const speed1 = yBird ? Math.hypot(yBird.vx, yBird.vy) : 0;
check('黄鸟冲刺提速', didDash && speed1 > speed0 * 1.5, `${f(speed0, 0)} -> ${f(speed1, 0)} px/s`);
advance(300);

/* ================= 蓝鸟分裂 ================= */
check('可指定首发蓝鸟', forceBird('blue', 1));
fireReadyBird(-96, 40);
advance(8);
const n0 = G.activeBirds.length;
game.useAbility();
const n1 = G.activeBirds.length;
check('蓝鸟一分为三', n1 === n0 + 2, `birds ${n0} -> ${n1}`);
advance(240);
const splitBirds = G.activeBirds.filter((b) => b.btype === 'blue').length;
check('分裂后三只都在场上或已落地', splitBirds <= 3);
advance(240);

/* ================= 炸弹黑 ================= */
check('可指定首发炸弹黑', forceBird('black', 2));
fireReadyBird(-96, 30);
advance(14);
const blackBird = G.activeBirds.find((x) => x.btype === 'black');
const boom = game.useAbility();
advance(4);
check('黑鸟引爆自己', boom && blackBird && blackBird.dead, `used=${boom}`);
advance(150);

/* ---- 爆炸杀伤（在新建关卡上测） ---- */
game.buildLevel(2);
const pigX = G.pigs[0].x, pigY = G.pigs[0].y;
const pigsBefore = G.pigs.length;
game._internals.explode(pigX, pigY, 190, 3200, 200);
advance(150);
check('爆炸波伤到附近目标', G.pigs.length < pigsBefore || G.score > 0,
  `pigs ${pigsBefore} -> ${G.pigs.length} score=${G.score}`);

/* ================= 白鸟投蛋 ================= */
check('可指定首发白鸟', forceBird('white', 3));
fireReadyBird(-96, 44);
advance(20);
const eggs0 = G.world.bodies.filter((b) => b.kind === 'egg').length;
game.useAbility();
const eggs1 = G.world.bodies.filter((b) => b.kind === 'egg').length;
check('白鸟投下蛋炸弹', eggs1 === eggs0 + 1, `eggs ${eggs0} -> ${eggs1}`);
advance(240);

/* ================= 新增：气球 / 冰霜 / 闪电 / 回旋 / 大块头 ================= */
check('可指定首发气球鸟', forceBird('balloon', 4));
fireReadyBird(-96, 34);
advance(6);
const ball = G.activeBirds.find((b) => b.btype === 'balloon');
const floatOk = game.useAbility();
advance(24);
check('气球鸟浮空上升', floatOk && ball && ball.floatT > 0 && ball.vy < 0,
  `floatT=${ball ? ball.floatT.toFixed(2) : '-'} vy=${ball ? ball.vy.toFixed(0) : '-'}`);
advance(240);

check('可指定首发冰霜鸟', forceBird('ice', 5));
fireReadyBird(-96, 36);
advance(6);
const iceOk = game.useAbility();
check('冰霜鸟释放寒冰冲击', iceOk && G.abilityFlash > 0);
advance(120);
game.buildLevel(6);
game._internals.freezeBlast(760, 540, 190);
advance(2);
check('寒冰冲击把方块冻脆', G.blocks.some((b) => b.frozen > 0),
  `frozen=${G.blocks.filter((b) => b.frozen > 0).length}`);
advance(120);

check('可指定首发闪电鸟', forceBird('bolt', 4));
fireReadyBird(-96, 30);
advance(6);
const boltOk = game.useAbility();
check('闪电鸟劈下落雷', boltOk && G.bolts.length > 0, `bolts=${G.bolts.length}`);
advance(60);
check('闪电特效会自行消失', G.bolts.length === 0);

game.buildLevel(5);
const hpBeforeKill = G.blocks.reduce((s, b) => s + b.hp, 0);
game._internals.lightningStrike(775, 300);
advance(2);
const hpAfterKill = G.blocks.reduce((s, b) => s + b.hp, 0) + (G.blocks.length < 0 ? 0 : 0);
check('落雷对下方结构造成伤害', hpAfterKill < hpBeforeKill,
  `${hpBeforeKill.toFixed(0)} -> ${hpAfterKill.toFixed(0)}`);

check('可指定首发回旋鸟', forceBird('boomerang', 8));
fireReadyBird(-96, 30);
advance(8);
const boomBird = G.activeBirds.find((b) => b.btype === 'boomerang');
const vxBefore = boomBird ? boomBird.vx : 0;
const retOk = game.useAbility();
advance(1);
check('回旋鸟掉头', retOk && boomBird && boomBird.vx < 0 && vxBefore > 0,
  `vx ${vxBefore.toFixed(0)} -> ${boomBird ? boomBird.vx.toFixed(0) : '-'}`);
advance(200);

check('可指定首发大块头', forceBird('big', 8));
fireReadyBird(-96, 26);
advance(4);
const bigBird = G.activeBirds.find((b) => b.btype === 'big');
check('大块头质量明显更大', bigBird && bigBird.mass > 6, `mass=${bigBird ? bigBird.mass : '-'}`);
advance(200);

/* ================= 稳定性 & 渲染 ================= */
let nan = false, sunk = false;
for (let i = 0; i < 900; i++) {
  game.tick(1 / 60);
  for (const b of G.world.bodies) {
    if (!b) continue;
    if (!Number.isFinite(b.x + b.y + b.angle)) nan = true;
    if (!b.isStatic && b.y > 900) sunk = true;
  }
}
check('长时间运行无 NaN', !nan);
check('没有物体穿地', !sunk);

try {
  G.scene = 'menu'; game.render();
  G.scene = 'levels'; game.render();
  game.buildLevel(0); game.render();
  G.phase = 'won'; G.stars = 3; game.render();
  G.phase = 'lost'; game.render();
  check('全部场景可渲染', true);
} catch (e) {
  check('全部场景可渲染', false, e.message);
}

let buildOk = true;
for (let i = 0; i < game.LEVELS.length; i++) {
  try {
    game.buildLevel(i);
    const pigs0 = G.pigs.length, blocks0 = G.blocks.length;
    advance(120);
    if (G.pigs.length === 0) { buildOk = false; console.log('   无猪', i); }
    if (G.pigs.length !== pigs0 || G.blocks.length !== blocks0) {
      // 开场就掉东西说明结构没搭稳（猪被压死 / 方块自毁）
      console.log(`   警告：第 ${i + 1} 关开场不稳定 猪 ${pigs0}->${G.pigs.length} 方块 ${blocks0}->${G.blocks.length}`);
      buildOk = false;
    }
    if (!G.held) { buildOk = false; console.log('   没有待发小鸟', i); }
  } catch (e) {
    buildOk = false;
    console.log('   构建失败', i, e.message);
  }
}
check(`${game.LEVELS.length} 个关卡全部可构建且开场稳定`, buildOk);

// 所有小鸟都要在关卡里出现过
const used = new Set();
game.LEVELS.forEach((lv) => lv.birds.forEach((b) => used.add(b)));
const missing = Object.keys(game.BIRDS).filter((k) => !used.has(k));
check('10 种小鸟都在关卡里登场', missing.length === 0, missing.join(','));

/* ================= 三星可达性粗测 ================= */
game.buildLevel(0);
for (let i = 0; i < 4 && G.phase !== 'won'; i++) {
  while (!(G.phase === 'ready' && G.held)) {
    game.tick(1 / 60);
    if (G.phase === 'won' || G.phase === 'lost') break;
  }
  if (G.phase !== 'ready') break;
  fireReadyBird(-98, 46);
  advanceUntil(() => G.phase !== 'flying', 900);
}
advance(120);
console.log(`   关卡 1 打完后: phase=${G.phase} 得分=${G.score} 三星线=${game.LEVELS[0].star[2]}`);

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
