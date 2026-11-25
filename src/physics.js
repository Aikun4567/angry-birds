/*!
 * Phys2D —— 轻量 2D 刚体物理引擎（矩形 + 圆形），《愤怒的小鸟》专用
 * 冲量法 + 顺序冲量求解 + SAT/裁剪接触点；无依赖，可在浏览器和 Node 中运行。
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else if (root) root.Phys = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPS = 1e-8;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  let nextId = 1;

  /* ---------------- 刚体 ---------------- */

  function updateTransform(b) {
    if (b.shape === 'circle') {
      b.minX = b.x - b.r; b.maxX = b.x + b.r;
      b.minY = b.y - b.r; b.maxY = b.y + b.r;
      return;
    }
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    const hw = b.hw, hh = b.hh;
    const lx = [-hw, hw, hw, -hw], ly = [-hh, -hh, hh, hh];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 4; i++) {
      const v = b.verts[i];
      v.x = b.x + c * lx[i] - s * ly[i];
      v.y = b.y + s * lx[i] + c * ly[i];
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    for (let i = 0; i < 4; i++) {
      const p1 = b.verts[i], p2 = b.verts[(i + 1) & 3];
      const ex = p2.x - p1.x, ey = p2.y - p1.y;
      const len = Math.hypot(ex, ey) || 1;
      const n = b.normals[i];
      n.x = ey / len;
      n.y = -ex / len;
    }
    b.minX = minX; b.maxX = maxX; b.minY = minY; b.maxY = maxY;
  }

  function finalizeBody(b, opts) {
    b.id = nextId++;
    b.data = opts.data || null;
    b.damping = opts.damping == null ? 0.999 : opts.damping;
    b.angularDamping = opts.angularDamping == null ? 0.995 : opts.angularDamping;
    b.restitution = opts.restitution == null ? 0.05 : opts.restitution;
    b.friction = opts.friction == null ? 0.6 : opts.friction;
    b.isStatic = !!opts.isStatic;
    b.vx = 0; b.vy = 0; b.av = 0;
    b.sleeping = false;
    b.restTime = 0;
    b.alive = true;
    const mass = b.isStatic ? 0 : Math.max(1e-4, opts.mass == null ? 1 : opts.mass);
    b.mass = mass;
    b.invMass = mass > 0 ? 1 / mass : 0;
    if (b.shape === 'box') {
      b.inertia = mass > 0 ? mass * (b.w * b.w + b.h * b.h) / 12 : 0;
    } else {
      b.inertia = mass > 0 ? 0.5 * mass * b.r * b.r : 0;
    }
    b.invInertia = b.inertia > 0 ? 1 / b.inertia : 0;
    updateTransform(b);
    return b;
  }

  function box(opts) {
    const b = {
      shape: 'box',
      x: opts.x, y: opts.y,
      angle: opts.angle || 0,
      w: opts.w, h: opts.h,
      hw: opts.w / 2, hh: opts.h / 2,
      r: 0,
      verts: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
      normals: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    };
    return finalizeBody(b, opts);
  }

  function circle(opts) {
    const b = {
      shape: 'circle',
      x: opts.x, y: opts.y,
      angle: opts.angle || 0,
      r: opts.r,
      hw: opts.r, hh: opts.r,
      w: opts.r * 2, h: opts.r * 2,
    };
    return finalizeBody(b, opts);
  }

  /* ---------------- 碰撞检测 ---------------- */

  function circleCircle(a, b) {
    let dx = b.x - a.x, dy = b.y - a.y;
    let d = Math.hypot(dx, dy);
    const rr = a.r + b.r;
    if (d >= rr) return null;
    let nx, ny;
    if (d < EPS) { nx = 1; ny = 0; d = 0; }
    else { nx = dx / d; ny = dy / d; }
    const pen = rr - d;
    const px = a.x + nx * (a.r - pen * 0.5);
    const py = a.y + ny * (a.r - pen * 0.5);
    return { normal: { x: nx, y: ny }, points: [{ x: px, y: py, sep: -pen }] };
  }

  // 返回法线由圆指向矩形
  function circleBox(c, b) {
    const dx = c.x - b.x, dy = c.y - b.y;
    const co = Math.cos(b.angle), si = Math.sin(b.angle);
    const lx = co * dx + si * dy;
    const ly = -si * dx + co * dy;
    const px = clamp(lx, -b.hw, b.hw);
    const py = clamp(ly, -b.hh, b.hh);
    let nlx = lx - px, nly = ly - py;
    let d2 = nlx * nlx + nly * nly;
    let pen;
    let inside = false;
    if (d2 > EPS) {
      const d = Math.sqrt(d2);
      if (d >= c.r) return null;
      pen = c.r - d;
      nlx /= d; nly /= d;
    } else {
      inside = true;
      const ox = b.hw - Math.abs(lx);
      const oy = b.hh - Math.abs(ly);
      if (ox <= oy) { nlx = lx < 0 ? -1 : 1; nly = 0; pen = c.r + ox; }
      else { nlx = 0; nly = ly < 0 ? -1 : 1; pen = c.r + oy; }
    }
    // 世界坐标：接触点取矩形表面上最近点
    const wx = b.x + co * px - si * py;
    const wy = b.y + si * px + co * py;
    // 世界坐标法线（圆 -> 矩形）= -(局部 n 旋转到世界)
    const sign = inside ? -1 : -1;
    const wnx = co * nlx - si * nly;
    const wny = si * nlx + co * nly;
    return {
      normal: { x: wnx * sign, y: wny * sign },
      points: [{ x: wx, y: wy, sep: -pen }],
    };
  }

  function maxSeparation(A, B) {
    let bestSep = -Infinity, bestIdx = 0;
    for (let i = 0; i < 4; i++) {
      const n = A.normals[i], va = A.verts[i];
      let minS = Infinity;
      for (let j = 0; j < 4; j++) {
        const vb = B.verts[j];
        const s = (vb.x - va.x) * n.x + (vb.y - va.y) * n.y;
        if (s < minS) minS = s;
      }
      if (minS > bestSep) { bestSep = minS; bestIdx = i; }
    }
    return { sep: bestSep, idx: bestIdx };
  }

  function clipHalf(seg, nx, ny, offset) {
    const d0 = seg[0].x * nx + seg[0].y * ny - offset;
    const d1 = seg[1].x * nx + seg[1].y * ny - offset;
    const out = [];
    if (d0 <= 0) out.push(seg[0]);
    if (d1 <= 0) out.push(seg[1]);
    if (d0 * d1 < 0) {
      const t = d0 / (d0 - d1);
      out.push({
        x: seg[0].x + (seg[1].x - seg[0].x) * t,
        y: seg[0].y + (seg[1].y - seg[0].y) * t,
      });
    }
    return out.length > 2 ? out.slice(0, 2) : out;
  }

  function boxBox(A, B) {
    const sa = maxSeparation(A, B);
    if (sa.sep > 0) return null;
    const sb = maxSeparation(B, A);
    if (sb.sep > 0) return null;

    let ref, inc, refIdx, flip;
    if (sa.sep >= sb.sep - 0.0005) { ref = A; inc = B; refIdx = sa.idx; flip = false; }
    else { ref = B; inc = A; refIdx = sb.idx; flip = true; }

    const refN = ref.normals[refIdx];
    const v1 = ref.verts[refIdx];
    const v2 = ref.verts[(refIdx + 1) & 3];

    let minDot = Infinity, incIdx = 0;
    for (let j = 0; j < 4; j++) {
      const d = inc.normals[j].x * refN.x + inc.normals[j].y * refN.y;
      if (d < minDot) { minDot = d; incIdx = j; }
    }
    let seg = [inc.verts[incIdx], inc.verts[(incIdx + 1) & 3]];

    const tx = v2.x - v1.x, ty = v2.y - v1.y;
    const len = Math.hypot(tx, ty) || 1;
    const ux = tx / len, uy = ty / len;

    seg = clipHalf(seg, -ux, -uy, -(ux * v1.x + uy * v1.y));
    if (!seg.length) return null;
    if (seg.length === 1) seg = [seg[0], seg[0]];
    seg = clipHalf(seg, ux, uy, ux * v2.x + uy * v2.y);
    if (!seg.length) return null;

    const points = [];
    for (let i = 0; i < seg.length; i++) {
      const p = seg[i];
      const sep = (p.x - v1.x) * refN.x + (p.y - v1.y) * refN.y;
      if (sep <= 0.4) points.push({ x: p.x, y: p.y, sep: Math.min(sep, 0) });
    }
    if (!points.length) return null;

    return {
      normal: flip ? { x: -refN.x, y: -refN.y } : { x: refN.x, y: refN.y },
      points: points,
    };
  }

  function collide(a, b) {
    if (a.shape === 'circle') {
      if (b.shape === 'circle') return circleCircle(a, b);
      const m = circleBox(a, b);
      if (!m) return null;
      // circleBox 返回 圆->矩形，这里 a 就是圆
      return m;
    }
    if (b.shape === 'circle') {
      const m = circleBox(b, a);
      if (!m) return null;
      return { normal: { x: -m.normal.x, y: -m.normal.y }, points: m.points };
    }
    return boxBox(a, b);
  }

  /* ---------------- 世界 ---------------- */

  function createWorld(opts) {
    opts = opts || {};
    const world = {
      gravity: opts.gravity == null ? 1500 : opts.gravity,
      iterations: opts.iterations == null ? 12 : opts.iterations,
      substeps: opts.substeps == null ? 3 : opts.substeps,
      slop: opts.slop == null ? 0.35 : opts.slop,
      beta: opts.beta == null ? 0.16 : opts.beta,
      maxBias: opts.maxBias == null ? 160 : opts.maxBias,
      restitutionThreshold: opts.restitutionThreshold == null ? 120 : opts.restitutionThreshold,
      bodies: [],
      contacts: [],
      time: 0,
      onCollision: opts.onCollision || null,
      stats: { pairs: 0, contacts: 0 },
      dirty: false,
      warm: new Map(),
    };

    world.add = function (b) { world.bodies.push(b); return b; };
    world.remove = function (b) {
      const i = world.bodies.indexOf(b);
      if (i >= 0) { world.bodies[i] = null; world.dirty = true; }
    };
    world.clear = function () { world.bodies.length = 0; world.contacts.length = 0; world.time = 0; };

    world.queryCircle = function (x, y, r, cb) {
      for (let i = 0; i < world.bodies.length; i++) {
        const b = world.bodies[i];
        if (!b) continue;
        const dx = b.x - x, dy = b.y - y;
        const rr = r + (b.shape === 'circle' ? b.r : Math.hypot(b.hw, b.hh));
        if (dx * dx + dy * dy <= rr * rr) cb(b);
      }
    };

    world.step = function (dt) {
      if (!(dt > 0)) return;
      dt = Math.min(dt, 1 / 30);
      const sub = world.substeps;
      const h = dt / sub;
      for (let s = 0; s < sub; s++) {
        substep(world, h);
        world.time += h;
      }
      if (world.dirty) {
        world.bodies = world.bodies.filter(Boolean);
        world.dirty = false;
      }
    };

    return world;
  }

  function substep(world, h) {
    const bodies = world.bodies;
    const g = world.gravity;
    world.stats.pairs = 0;
    world.stats.contacts = 0;

    // 1. 速度积分
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b || b.isStatic) continue;
      b.vy += g * h;
      b.vx *= b.damping;
      b.vy *= b.damping;
      b.av *= b.angularDamping;
      updateTransform(b);
    }

    // 2. 宽相 + 窄相
    const contacts = [];
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (!a) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (!b) continue;
        if (a.isStatic && b.isStatic) continue;
        if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) continue;
        world.stats.pairs++;
        const m = collide(a, b);
        if (!m) continue;
        const c = buildContact(world, a, b, m, h);
        if (c) contacts.push(c);
      }
    }
    world.contacts = contacts;
    world.stats.contacts = contacts.length;

    // 3. 热启动：复用上一子步的冲量，显著减少堆叠蠕变
    for (let ci = 0; ci < contacts.length; ci++) {
      const c = contacts[ci];
      const n = c.normal, tx = n.y, ty = -n.x;
      for (let k = 0; k < c.points.length; k++) {
        const p = c.points[k];
        if (p.jn === 0 && p.jt === 0) continue;
        const ix = n.x * p.jn + tx * p.jt;
        const iy = n.y * p.jn + ty * p.jt;
        applyImpulse(c.a, -ix, -iy, p.rax, p.ray);
        applyImpulse(c.b, ix, iy, p.rbx, p.rby);
      }
    }

    // 4. 求解
    for (let it = 0; it < world.iterations; it++) {
      for (let ci = 0; ci < contacts.length; ci++) solveContact(contacts[ci]);
    }

    // 5. 记录冲量供下一子步热启动
    const nextWarm = new Map();
    for (let ci = 0; ci < contacts.length; ci++) {
      const c = contacts[ci];
      const pts = [];
      for (let k = 0; k < c.points.length; k++) {
        const p = c.points[k];
        pts.push({ x: p.x, y: p.y, jn: p.jn, jt: p.jt });
      }
      nextWarm.set(c.a.id * 1e6 + c.b.id, pts);
    }
    world.warm = nextWarm;

    // 6. 位置积分
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b || b.isStatic) continue;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.angle += b.av * h;
      updateTransform(b);
    }

    // 5. 碰撞回调（伤害/音效）
    const cb = world.onCollision;
    if (cb) {
      for (let ci = 0; ci < contacts.length; ci++) {
        const c = contacts[ci];
        let jn = 0;
        for (let k = 0; k < c.points.length; k++) jn += c.points[k].jn;
        if (jn > 0.0001) cb(c.a, c.b, c, jn, c.speed);
      }
    }
  }

  function buildContact(world, a, b, m, h) {
    const n = m.normal;
    const e = Math.min(a.restitution, b.restitution);
    const mu = Math.sqrt(a.friction * b.friction);
    const c = { a: a, b: b, normal: n, points: [], speed: 0 };
    const prev = world.warm.get(a.id * 1e6 + b.id);

    for (let k = 0; k < m.points.length; k++) {
      const pt = m.points[k];
      const pen = -pt.sep;
      const rax = pt.x - a.x, ray = pt.y - a.y;
      const rbx = pt.x - b.x, rby = pt.y - b.y;

      const rnA = rax * n.y - ray * n.x;
      const rnB = rbx * n.y - rby * n.x;
      const kNormal = a.invMass + b.invMass + a.invInertia * rnA * rnA + b.invInertia * rnB * rnB;

      const tx = n.y, ty = -n.x;
      const rtA = rax * ty - ray * tx;
      const rtB = rbx * ty - rby * tx;
      const kTangent = a.invMass + b.invMass + a.invInertia * rtA * rtA + b.invInertia * rtB * rtB;

      // 初始相对法向速度
      const vax = a.vx - a.av * ray, vay = a.vy + a.av * rax;
      const vbx = b.vx - b.av * rby, vby = b.vy + b.av * rbx;
      const vn0 = (vbx - vax) * n.x + (vby - vay) * n.y;

      let bias = Math.min(world.beta / h * Math.max(pen - world.slop, 0), world.maxBias);
      if (-vn0 > world.restitutionThreshold) bias += -e * vn0;

      let cJn = 0, cJt = 0;
      if (prev) {
        let bestD = 196, best = null;
        for (let q = 0; q < prev.length; q++) {
          const pp = prev[q];
          const d = (pp.x - pt.x) * (pp.x - pt.x) + (pp.y - pt.y) * (pp.y - pt.y);
          if (d < bestD) { bestD = d; best = pp; }
        }
        if (best) {
          cJn = Math.max(0, best.jn);
          cJt = clamp(best.jt, -mu * cJn, mu * cJn);
        }
      }

      c.points.push({
        x: pt.x, y: pt.y, pen: pen,
        rax: rax, ray: ray, rbx: rbx, rby: rby,
        rnA: rnA, rnB: rnB, rtA: rtA, rtB: rtB,
        kNormal: kNormal > EPS ? kNormal : EPS,
        kTangent: kTangent > EPS ? kTangent : EPS,
        bias: bias, jn: cJn, jt: cJt, mu: mu,
      });
      if (kNormal > EPS && vn0 < c.speed) c.speed = vn0;
    }
    c.speed = -c.speed;
    return c;
  }

  function applyImpulse(b, px, py, rx, ry) {
    if (b.isStatic) return;
    b.vx += px * b.invMass;
    b.vy += py * b.invMass;
    b.av += (rx * py - ry * px) * b.invInertia;
  }

  function solveContact(c) {
    const a = c.a, b = c.b, n = c.normal;
    for (let k = 0; k < c.points.length; k++) {
      const p = c.points[k];

      // 法向
      let vax = a.vx - a.av * p.ray, vay = a.vy + a.av * p.rax;
      let vbx = b.vx - b.av * p.rby, vby = b.vy + b.av * p.rbx;
      const vn = (vbx - vax) * n.x + (vby - vay) * n.y;

      let jn = (p.bias - vn) / p.kNormal;
      const oldJn = p.jn;
      p.jn = Math.max(oldJn + jn, 0);
      jn = p.jn - oldJn;
      if (jn !== 0) {
        const ix = n.x * jn, iy = n.y * jn;
        applyImpulse(a, -ix, -iy, p.rax, p.ray);
        applyImpulse(b, ix, iy, p.rbx, p.rby);
      }

      // 切向摩擦
      const tx = n.y, ty = -n.x;
      vax = a.vx - a.av * p.ray; vay = a.vy + a.av * p.rax;
      vbx = b.vx - b.av * p.rby; vby = b.vy + b.av * p.rbx;
      const vt = (vbx - vax) * tx + (vby - vay) * ty;

      let jt = -vt / p.kTangent;
      const maxF = p.mu * p.jn;
      const oldJt = p.jt;
      p.jt = clamp(oldJt + jt, -maxF, maxF);
      jt = p.jt - oldJt;
      if (jt !== 0) {
        const ix = tx * jt, iy = ty * jt;
        applyImpulse(a, -ix, -iy, p.rax, p.ray);
        applyImpulse(b, ix, iy, p.rbx, p.rby);
      }
    }
  }

  return {
    createWorld: createWorld,
    box: box,
    circle: circle,
    updateTransform: updateTransform,
    clamp: clamp,
  };
});
