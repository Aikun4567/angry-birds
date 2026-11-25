import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Phys = require('../src/physics.js');

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}
const f = (n, d = 2) => Number(n.toFixed(d));

function makeWorld(opts = {}) {
  return Phys.createWorld({ gravity: 1500, iterations: 10, substeps: 2, ...opts });
}

/* ---------- 1. 地面上的箱子应该静止 ---------- */
{
  const w = makeWorld();
  w.add(Phys.box({ x: 640, y: 700, w: 2000, h: 120, isStatic: true, friction: 0.9 }));
  const b = w.add(Phys.box({ x: 400, y: 500, w: 60, h: 60, mass: 2 }));
  for (let i = 0; i < 240; i++) w.step(1 / 60);
  check('单箱落地后静止', Math.abs(b.vy) < 2 && Math.abs(b.y - 610) < 2,
    `y=${f(b.y)} vy=${f(b.vy)}`);
}

/* ---------- 2. 三层塔应该稳定（贴地搭建 + 落定后测量） ---------- */
{
  const w = makeWorld();
  w.add(Phys.box({ x: 640, y: 700, w: 3000, h: 120, isStatic: true, friction: 0.9 }));
  const blocks = [];
  blocks.push(w.add(Phys.box({ x: 560, y: 580, w: 24, h: 120, mass: 2.4 })));
  blocks.push(w.add(Phys.box({ x: 720, y: 580, w: 24, h: 120, mass: 2.4 })));
  blocks.push(w.add(Phys.box({ x: 640, y: 510, w: 200, h: 20, mass: 3.2 })));
  blocks.push(w.add(Phys.box({ x: 590, y: 440, w: 20, h: 120, mass: 2.0 })));
  blocks.push(w.add(Phys.box({ x: 690, y: 440, w: 20, h: 120, mass: 2.0 })));
  blocks.push(w.add(Phys.box({ x: 640, y: 370, w: 160, h: 20, mass: 2.6 })));
  for (let i = 0; i < 60; i++) w.step(1 / 60);
  const start = blocks.map((b) => ({ x: b.x, y: b.y, a: b.angle }));
  let maxDrift = 0, maxAngle = 0;
  for (let i = 0; i < 600; i++) {
    w.step(1 / 60);
    blocks.forEach((b, k) => {
      maxDrift = Math.max(maxDrift, Math.hypot(b.x - start[k].x, b.y - start[k].y));
      maxAngle = Math.max(maxAngle, Math.abs(b.angle - start[k].a));
    });
  }
  const nan = blocks.some((b) => !Number.isFinite(b.x + b.y + b.angle));
  check('三层塔 10 秒稳定', !nan && maxDrift < 2 && maxAngle < 0.02,
    `maxDrift=${f(maxDrift)}px maxAngle=${f(maxAngle, 3)}rad`);
}

/* ---------- 3. 倾斜箱体可以稳定落地 ---------- */
{
  const w = makeWorld();
  w.add(Phys.box({ x: 640, y: 700, w: 3000, h: 120, isStatic: true, friction: 0.9 }));
  const b = w.add(Phys.box({ x: 640, y: 400, w: 120, h: 24, mass: 1.5, angle: 0.6 }));
  for (let i = 0; i < 400; i++) w.step(1 / 60);
  check('倾斜箱体落地后不抖动', Math.abs(b.vy) < 3 && Number.isFinite(b.angle),
    `y=${f(b.y)} angle=${f(b.angle, 3)} vy=${f(b.vy)}`);
}

/* ---------- 4. 圆球在斜面上滚动（圆-盒碰撞） ---------- */
{
  const w = makeWorld();
  w.add(Phys.box({ x: 640, y: 700, w: 3000, h: 120, isStatic: true, friction: 0.9 }));
  w.add(Phys.box({ x: 600, y: 560, w: 600, h: 20, isStatic: true, angle: -0.3, friction: 0.8 }));
  const ball = w.add(Phys.circle({ x: 720, y: 470, r: 20, mass: 1.2, restitution: 0.2 }));
  for (let i = 0; i < 300; i++) w.step(1 / 60);
  check('圆球从斜面滑落到地面', ball.x < 560 && ball.y > 560 && Number.isFinite(ball.x),
    `x=${f(ball.x)} y=${f(ball.y)}`);
}

/* ---------- 5. 撞击冲量与相对速度的量级（用于伤害调参） ---------- */
{
  const w = makeWorld();
  w.add(Phys.box({ x: 700, y: 700, w: 4000, h: 120, isStatic: true, friction: 0.8 }));
  const plank = w.add(Phys.box({ x: 900, y: 520, w: 24, h: 120, mass: 2.4, friction: 0.6 }));
  const bird = w.add(Phys.circle({ x: 300, y: 520, r: 18, mass: 1.6, restitution: 0.2 }));
  bird.vx = 1400;
  const events = [];
  w.onCollision = (a, b, c, jn, speed) => events.push({ jn, speed });
  for (let i = 0; i < 180; i++) w.step(1 / 60);
  const big = events.filter((e) => e.speed > 200).sort((p, q) => q.jn - p.jn);
  console.log('   最大撞击事件:', big.slice(0, 3).map((e) => `j=${f(e.jn, 0)} v=${f(e.speed, 0)}`).join(' | '));
  check('产生高速撞击', big.length > 0 && big[0].jn > 500, `count=${events.length}`);
}

/* ---------- 6. 多次重复命中后的稳定性（NaN / 穿透） ---------- */
{
  const w = makeWorld({ substeps: 2, iterations: 10 });
  w.add(Phys.box({ x: 640, y: 700, w: 4000, h: 120, isStatic: true, friction: 0.9 }));
  const bodies = [];
  for (let i = 0; i < 12; i++) {
    bodies.push(w.add(Phys.box({
      x: 700 + (i % 4) * 50, y: 560 - Math.floor(i / 4) * 48,
      w: 46, h: 46, mass: 1.8,
    })));
  }
  for (let i = 0; i < 900; i++) {
    w.step(1 / 60);
    if (i === 60) {
      const b = bodies[3];
      bodies[3] = null;
      w.remove(b);
    }
  }
  const alive = w.bodies.filter((b) => !b.isStatic);
  const bad = alive.some((b) => !Number.isFinite(b.x + b.y + b.angle) || b.y > 900);
  check('堆叠 15 秒无 NaN / 无穿地', !bad, `alive=${alive.length}`);
  const minY = Math.min(...alive.map((b) => b.y));
  console.log('   堆叠高度 y=', f(minY, 1), ' 最低', f(Math.max(...alive.map((b) => b.y)), 1));
}

/* ---------- 7. 循环耗时（性能） ---------- */
{
  const w = makeWorld();
  w.add(Phys.box({ x: 640, y: 700, w: 4000, h: 120, isStatic: true }));
  for (let i = 0; i < 40; i++) {
    w.add(Phys.box({ x: 600 + (i % 8) * 30, y: 560 - Math.floor(i / 8) * 30, w: 28, h: 28, mass: 0.8 }));
  }
  const t0 = performance.now();
  for (let i = 0; i < 300; i++) w.step(1 / 60);
  const ms = (performance.now() - t0) / 300;
  check('每帧物理耗时 < 2.5ms', ms < 2.5, `${ms.toFixed(3)}ms/frame`);
}

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
