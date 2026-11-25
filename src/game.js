/*!
 * 愤怒的小鸟 —— 纯 Canvas 实现，5 种小鸟
 * 依赖：Phys（physics.js）
 */
(function (root) {
  'use strict';

  /* ================= 基础常量 ================= */

  const W = 1280, H = 720;
  const GROUND_Y = 640;
  const SLING = { x: 208, y: 508, baseY: 636 };
  const MAX_PULL = 116;
  const LAUNCH_POWER = 12.6;
  const GRAVITY = 1200;

  const C = {
    skyTop: '#7ec8f2',
    skyBottom: '#d9f0ff',
    hillFar: '#9fd6a8',
    hillNear: '#7cc48e',
    grassTop: '#5eb96a',
    grassBottom: '#3f8f4c',
    soil: '#8a5a3b',
    soilDark: '#6f452c',
    ink: '#243044',
    cream: '#fff8e7',
  };

  /* ================= 工具函数 ================= */

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const TAU = Math.PI * 2;

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function drawStar(ctx, cx, cy, outer, inner, points, fill) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = -Math.PI / 2 + (i * Math.PI) / points;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  }

  // 固定种子的伪随机，保证裂纹纹理稳定
  function seeded(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  /* ================= 画布 ================= */

  const view = { scale: 1, dpr: 1, canvas: null, ctx: null, cssW: W, cssH: H };

  function setupCanvas(canvas) {
    view.canvas = canvas;
    view.ctx = canvas.getContext('2d');
    resize();
    if (typeof root.addEventListener === 'function') {
      root.addEventListener('resize', resize);
    }
  }

  function resize() {
    const canvas = view.canvas;
    if (!canvas) return;
    const vw = (root.innerWidth || W);
    const vh = (root.innerHeight || H);
    const scale = Math.min(vw / W, vh / H);
    view.scale = scale;
    view.cssW = Math.round(W * scale);
    view.cssH = Math.round(H * scale);
    const dpr = Math.min(root.devicePixelRatio || 1, 2);
    view.dpr = dpr;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    if (canvas.style) {
      canvas.style.width = view.cssW + 'px';
      canvas.style.height = view.cssH + 'px';
    }
    const ctx = view.ctx;
    if (ctx && ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ================= 音效（WebAudio 合成，无外部资源） ================= */

  const Sfx = (function () {
    let ac = null;
    let muted = false;
    let noiseBuf = null;

    function ctx() {
      if (muted) return null;
      try {
        if (!ac) {
          const AC = root.AudioContext || root.webkitAudioContext;
          if (!AC) return null;
          ac = new AC();
        }
        if (ac.state === 'suspended' && ac.resume) ac.resume();
        return ac;
      } catch (e) { return null; }
    }

    function tone(o) {
      const a = ctx(); if (!a) return;
      try {
        const t0 = a.currentTime + (o.delay || 0);
        const osc = a.createOscillator();
        const gain = a.createGain();
        osc.type = o.type || 'sine';
        osc.frequency.setValueAtTime(o.freq, t0);
        if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), t0 + o.dur);
        const v = (o.vol == null ? 0.16 : o.vol);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(v, t0 + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
        osc.connect(gain); gain.connect(a.destination);
        osc.start(t0); osc.stop(t0 + o.dur + 0.03);
      } catch (e) { /* 忽略 */ }
    }

    function noise(o) {
      const a = ctx(); if (!a) return;
      try {
        if (!noiseBuf) {
          noiseBuf = a.createBuffer(1, a.sampleRate * 1.2, a.sampleRate);
          const d = noiseBuf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        const t0 = a.currentTime + (o.delay || 0);
        const src = a.createBufferSource();
        src.buffer = noiseBuf;
        const filter = a.createBiquadFilter();
        filter.type = o.filter || 'lowpass';
        filter.frequency.setValueAtTime(o.freq || 900, t0);
        if (o.to) filter.frequency.exponentialRampToValueAtTime(Math.max(60, o.to), t0 + o.dur);
        const gain = a.createGain();
        gain.gain.setValueAtTime(o.vol == null ? 0.18 : o.vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
        src.connect(filter); filter.connect(gain); gain.connect(a.destination);
        src.start(t0); src.stop(t0 + o.dur + 0.03);
      } catch (e) { /* 忽略 */ }
    }

    return {
      unlock() { ctx(); },
      setMuted(m) { muted = m; },
      isMuted() { return muted; },
      launch() { tone({ freq: 620, to: 200, dur: 0.16, type: 'sawtooth', vol: 0.14 }); },
      stretch() { tone({ freq: 180, to: 320, dur: 0.09, type: 'sine', vol: 0.06 }); },
      thud(v) { noise({ freq: 420, to: 120, dur: 0.12 + v * 0.04, vol: 0.1 + v * 0.06 }); },
      wood(v) { noise({ freq: 1500, to: 320, dur: 0.16, vol: 0.12 + v * 0.05, filter: 'bandpass' }); },
      glass() { noise({ freq: 4200, to: 2400, dur: 0.22, vol: 0.13, filter: 'highpass' });
        tone({ freq: 2400, to: 3600, dur: 0.12, type: 'triangle', vol: 0.05 }); },
      stone(v) { noise({ freq: 640, to: 140, dur: 0.2, vol: 0.14 + v * 0.05 }); },
      pop() { tone({ freq: 480, to: 980, dur: 0.12, type: 'square', vol: 0.1 });
        tone({ freq: 900, to: 1500, dur: 0.09, type: 'sine', vol: 0.07, delay: 0.03 }); },
      boom() {
        noise({ freq: 900, to: 60, dur: 0.5, vol: 0.3 });
        tone({ freq: 150, to: 34, dur: 0.45, type: 'sine', vol: 0.3 });
      },
      dash() { tone({ freq: 900, to: 2400, dur: 0.14, type: 'square', vol: 0.07 }); },
      split() { tone({ freq: 700, to: 1300, dur: 0.12, type: 'triangle', vol: 0.08 });
        tone({ freq: 900, to: 1600, dur: 0.12, type: 'triangle', vol: 0.06, delay: 0.06 }); },
      egg() { tone({ freq: 1100, to: 400, dur: 0.16, type: 'sine', vol: 0.1 }); },
      win() {
        [523, 659, 784, 1047].forEach((f, i) =>
          tone({ freq: f, dur: 0.24, type: 'triangle', vol: 0.14, delay: i * 0.11 }));
      },
      lose() {
        [392, 330, 262].forEach((f, i) =>
          tone({ freq: f, dur: 0.3, type: 'sawtooth', vol: 0.1, delay: i * 0.14 }));
      },
      click() { tone({ freq: 760, to: 980, dur: 0.06, type: 'square', vol: 0.06 }); },
    };
  })();

  /* ================= 材质 & 小鸟 ================= */

  const MAT = {
    wood: { hp: 62, density: 0.00092, friction: 0.62, restitution: 0.05, value: 500,
      fill: '#c98f4f', edge: '#9a6633', dark: '#8a5a2c', kind: 'wood' },
    glass: { hp: 26, density: 0.00062, friction: 0.4, restitution: 0.04, value: 350,
      fill: '#a6dcf0', edge: '#6fb6d6', dark: '#5a9dbb', kind: 'glass' },
    stone: { hp: 130, density: 0.00185, friction: 0.72, restitution: 0.03, value: 800,
      fill: '#a7b0bb', edge: '#7c8794', dark: '#69737f', kind: 'stone' },
    tnt: { hp: 22, density: 0.00105, friction: 0.6, restitution: 0.05, value: 1200,
      fill: '#e05348', edge: '#a2302a', dark: '#8d251f', kind: 'tnt' },
  };

  const BIRDS = {
    red: {
      key: 'red', name: '红红', r: 19, mass: 2.4, color: '#e4433b', belly: '#ffe9c9',
      ability: null, abilityName: '无技能', hint: '皮糙肉厚，撞击最狠',
      damage: 1.25,
    },
    yellow: {
      key: 'yellow', name: '飞镖黄', r: 16, mass: 1.9, color: '#f7d02c', belly: '#fff3c0',
      ability: 'dash', abilityName: '加速冲刺', hint: '空中点击，猛冲一段',
      damage: 1,
    },
    blue: {
      key: 'blue', name: '蓝弟弟', r: 13, mass: 1.15, color: '#4fa9e8', belly: '#d8f1ff',
      ability: 'split', abilityName: '一分为三', hint: '空中点击，分成三只',
      damage: 0.85,
    },
    black: {
      key: 'black', name: '炸弹黑', r: 20, mass: 3.1, color: '#3a3b44', belly: '#8e8f99',
      ability: 'boom', abilityName: '引爆', hint: '空中点击，就地爆炸',
      damage: 1,
    },
    white: {
      key: 'white', name: '白姐姐', r: 20, mass: 2.7, color: '#f6f2e6', belly: '#ffffff',
      ability: 'egg', abilityName: '投蛋', hint: '空中点击，丢下蛋炸弹',
      damage: 0.95,
    },
    balloon: {
      key: 'balloon', name: '气球鸟', r: 18, mass: 1.7, color: '#b06ee0', belly: '#f0dcff',
      ability: 'float', abilityName: '浮空', hint: '空中点击，升空越过高墙',
      damage: 0.9,
    },
    big: {
      key: 'big', name: '大块头', r: 27, mass: 6.4, color: '#c23530', belly: '#ffdcc0',
      ability: null, abilityName: '无技能', hint: '又大又重，撞塔神器',
      damage: 1.9,
    },
    ice: {
      key: 'ice', name: '冰霜鸟', r: 17, mass: 1.8, color: '#74cfea', belly: '#eafcff',
      ability: 'freeze', abilityName: '寒冰冲击', hint: '空中点击，把周围冻脆',
      damage: 0.95,
    },
    bolt: {
      key: 'bolt', name: '闪电鸟', r: 17, mass: 1.9, color: '#f7dc4a', belly: '#fff9cf',
      ability: 'lightning', abilityName: '落雷', hint: '空中点击，向下劈一道闪电',
      damage: 1,
    },
    boomerang: {
      key: 'boomerang', name: '回旋鸟', r: 17, mass: 1.9, color: '#61c97e', belly: '#e2ffe8',
      ability: 'return', abilityName: '回旋', hint: '空中点击，掉头砸回来',
      damage: 1,
    },
  };

  const BIRD_ORDER = ['red', 'yellow', 'blue', 'black', 'white', 'balloon', 'big', 'ice', 'bolt', 'boomerang'];

  /* ================= 关卡 ================= */

  // b: 木块  g: 玻璃  s: 石头  t: TNT  p: 猪  h: 铁皮猪  k: 猪王
  const LEVELS = [
    {
      name: '木头小屋',
      subtitle: '第 1 关',
      birds: ['red', 'yellow', 'red'],
      star: [7000, 12000, 17000],
      parts: [
        ['b', 872, 570, 26, 140],
        ['b', 1048, 570, 26, 140],
        ['b', 960, 488, 232, 24],
        ['p', 960, 574, 26],
        ['p', 960, 450, 26],
        ['b', 1112, 620, 40, 40],
        ['b', 960, 620, 40, 40],
      ],
    },
    {
      name: '玻璃城堡',
      subtitle: '第 2 关',
      birds: ['yellow', 'blue', 'blue', 'red'],
      star: [9000, 14000, 19000],
      parts: [
        ['g', 860, 560, 20, 160],
        ['g', 980, 560, 20, 160],
        ['g', 1100, 560, 20, 160],
        ['g', 980, 470, 280, 20],
        ['g', 910, 410, 18, 100],
        ['g', 1050, 410, 18, 100],
        ['g', 980, 351, 180, 18],
        ['p', 910, 618, 22],
        ['p', 1050, 618, 22],
        ['p', 980, 320, 22],
        ['b', 1140, 620, 40, 40],
      ],
    },
    {
      name: '石之堡垒',
      subtitle: '第 3 关',
      birds: ['red', 'black', 'blue', 'yellow', 'red'],
      star: [11000, 17000, 23000],
      parts: [
        ['s', 840, 550, 30, 180],
        ['s', 1120, 550, 30, 180],
        ['s', 980, 445, 310, 30],
        ['b', 900, 550, 20, 180],
        ['b', 1060, 550, 20, 180],
        ['t', 772, 618, 42, 44],
        ['p', 955, 616, 24],
        ['p', 1015, 616, 24],
        ['p', 980, 406, 24],
        ['b', 1100, 410, 60, 40],
      ],
    },
    {
      name: '双塔决战',
      subtitle: '第 4 关',
      birds: ['red', 'yellow', 'blue', 'black', 'white'],
      star: [13000, 20000, 27000],
      parts: [
        // 左：玻璃塔
        ['g', 782, 560, 20, 160],
        ['g', 872, 560, 20, 160],
        ['g', 827, 470, 150, 20],
        ['p', 827, 618, 22],
        ['p', 827, 438, 22],
        // 中：炸药堆
        ['t', 962, 618, 44, 44],
        ['b', 962, 566, 90, 20],
        ['p', 962, 520, 22],
        // 右：石头塔
        ['s', 1048, 555, 30, 170],
        ['s', 1150, 555, 30, 170],
        ['s', 1099, 458, 150, 24],
        ['b', 1099, 606, 40, 68],
        ['p', 1099, 415, 24],
        ['b', 1210, 620, 40, 40],
      ],
    },
    {
      name: '高墙要塞',
      subtitle: '第 5 关',
      birds: ['red', 'balloon', 'boomerang', 'bolt', 'big'],
      parts: [
        ['s', 800, 515, 44, 250],
        ['b', 940, 555, 22, 170],
        ['b', 1100, 555, 22, 170],
        ['b', 1020, 458, 200, 24],
        ['h', 860, 618, 22],
        ['b', 985, 620, 40, 40],
        ['p', 985, 574, 22],
        ['p', 1040, 618, 22],
        ['p', 1020, 424, 22],
        ['p', 1150, 618, 22],
        ['t', 1210, 618, 40, 44],
      ],
    },
    {
      name: '三塔连城',
      subtitle: '第 6 关',
      birds: ['red', 'yellow', 'blue', 'ice', 'bolt', 'big'],
      parts: [
        ['g', 740, 580, 20, 120],
        ['g', 810, 580, 20, 120],
        ['g', 775, 508, 140, 24],
        ['p', 775, 474, 22],
        ['p', 775, 618, 22],
        ['b', 900, 570, 22, 140],
        ['b', 970, 570, 22, 140],
        ['b', 935, 488, 140, 24],
        ['p', 935, 454, 22],
        ['s', 1060, 560, 26, 160],
        ['s', 1140, 560, 26, 160],
        ['s', 1100, 468, 170, 24],
        ['p', 1100, 434, 22],
        ['h', 1100, 618, 22],
        ['t', 855, 618, 40, 44],
        ['t', 1210, 618, 40, 44],
      ],
    },
    {
      name: '铁壁堡垒',
      subtitle: '第 7 关',
      birds: ['red', 'ice', 'big', 'yellow', 'bolt', 'black'],
      parts: [
        ['s', 760, 540, 36, 200],
        ['s', 1180, 540, 36, 200],
        ['s', 970, 428, 456, 24],
        ['b', 880, 540, 20, 200],
        ['b', 1060, 540, 20, 200],
        ['p', 940, 618, 24],
        ['p', 1010, 618, 24],
        ['p', 830, 618, 22],
        ['h', 970, 392, 24],
        ['h', 690, 618, 22],
        ['t', 1110, 618, 40, 44],
        ['b', 1230, 620, 40, 40],
      ],
    },
    {
      name: '猪王城堡',
      subtitle: '第 8 关',
      birds: ['red', 'ice', 'big', 'bolt', 'black', 'yellow'],
      parts: [
        ['g', 800, 570, 30, 140],
        ['s', 1160, 570, 30, 140],
        ['s', 980, 488, 390, 24],
        ['b', 880, 420, 20, 112],
        ['b', 1080, 420, 20, 112],
        ['s', 980, 352, 260, 24],
        ['h', 860, 618, 22],
        ['t', 910, 618, 40, 44],
        ['k', 1010, 606, 32],
        ['h', 1090, 618, 22],
        ['p', 980, 316, 22],
        ['p', 920, 316, 22],
        ['t', 1210, 618, 40, 44],
      ],
    },
    {
      name: '终极决战',
      subtitle: '第 9 关',
      birds: ['balloon', 'yellow', 'ice', 'black', 'big', 'bolt', 'white'],
      parts: [
        ['g', 700, 570, 20, 140],
        ['g', 770, 570, 20, 140],
        ['g', 735, 488, 140, 24],
        ['p', 735, 454, 22],
        ['p', 735, 618, 22],
        ['g', 900, 580, 36, 120],
        ['g', 900, 460, 36, 120],
        ['s', 1080, 520, 36, 240],
        ['s', 990, 388, 216, 24],
        ['t', 950, 618, 40, 44],
        ['k', 1010, 606, 32],
        ['h', 990, 352, 24],
        ['b', 1170, 560, 22, 160],
        ['b', 1250, 560, 22, 160],
        ['b', 1210, 468, 130, 24],
        ['p', 1210, 434, 22],
        ['p', 1210, 618, 22],
        ['t', 855, 618, 40, 44],
      ],
    },
  ];

  /* ================= 游戏状态 ================= */

  const Game = {
    scene: 'menu',          // menu | levels | play
    phase: 'ready',         // ready | aiming | flying | winning | won | lost
    levelIndex: 0,
    score: 0,
    shownScore: 0,
    stars: 0,
    world: null,
    blocks: [],
    pigs: [],
    activeBirds: [],
    held: null,
    queue: [],
    used: 0,
    dragging: false,
    dragPt: { x: SLING.x, y: SLING.y },
    particles: [],
    textPops: [],
    shake: 0,
    time: 0,
    waitTimer: 0,
    winTimer: 0,
    endTimer: 0,
    message: '',
    messageT: 0,
    best: {},
    buttons: [],
    hover: -1,
    hintT: 0,
    launched: 0,
    abilityFlash: 0,
    slowmo: 0,
    muted: false,
    lastQuiet: true,
    bolts: [],
    queueSlide: 0,
    introLevel: 0,
    debug: {},
  };

  function loadProgress() {
    try {
      const raw = root.localStorage && root.localStorage.getItem('ab.progress');
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function saveProgress() {
    try {
      const p = loadProgress();
      const cur = p[Game.levelIndex] || { stars: 0, score: 0 };
      if (Game.score > (cur.score || 0)) cur.score = Game.score;
      cur.stars = Math.max(cur.stars || 0, Game.stars);
      p[Game.levelIndex] = cur;
      if (root.localStorage) root.localStorage.setItem('ab.progress', JSON.stringify(p));
    } catch (e) { /* 忽略 */ }
  }

  let debugUnlockAll = false;

  function unlocked(i) {
    if (i === 0) return true;
    if (debugUnlockAll) return true;
    const p = loadProgress();
    return !!(p[i - 1] && (p[i - 1].stars || 0) > 0);
  }

  /* ================= 关卡构建 ================= */

  function addBlock(matKey, x, y, w, h) {
    const mat = MAT[matKey];
    const area = w * h;
    const b = Phys.box({
      x, y, w, h,
      mass: Math.max(0.35, area * mat.density),
      friction: mat.friction,
      restitution: mat.restitution,
    });
    b.kind = 'block';
    b.matKey = matKey;
    b.mat = mat;
    b.maxHp = mat.hp * clamp(0.55 + area / 6000, 0.55, 1.85);
    b.hp = b.maxHp;
    b.seed = (Math.random() * 100000) | 0;
    b.flash = 0;
    b.dead = false;
    Game.world.add(b);
    Game.blocks.push(b);
    return b;
  }

  const PIG_VARIANTS = {
    normal: { hpMul: 1, score: 5000, label: '普通猪' },
    helmet: { hpMul: 1.95, score: 6500, label: '铁皮猪' },
    king: { hpMul: 3.2, score: 9000, label: '猪王' },
  };

  function addPig(x, y, r, variant) {
    const v = PIG_VARIANTS[variant] || PIG_VARIANTS.normal;
    const b = Phys.circle({
      x, y, r,
      mass: (0.85 + r * r * 0.0038) * (v.hpMul > 2 ? 1.25 : 1),
      friction: 0.5,
      restitution: 0.18,
    });
    b.kind = 'pig';
    b.variant = variant || 'normal';
    b.scoreValue = v.score;
    b.maxHp = (28 + r * 1.05) * v.hpMul;
    b.hp = b.maxHp;
    b.flash = 0;
    b.frozen = 0;
    b.dead = false;
    b.blink = rand(0, 3);
    b.squish = 0;
    Game.world.add(b);
    Game.pigs.push(b);
    return b;
  }

  const PART_MAT = { b: 'wood', g: 'glass', s: 'stone', t: 'tnt' };

  // 三星目标按关卡理论上限动态计算
  function starTargets(def) {
    let blocks = 0, pigs = 0;
    for (const p of def.parts) {
      if (p[0] === 'p') { pigs += PIG_VARIANTS.normal.score; }
      else if (p[0] === 'h') { pigs += PIG_VARIANTS.helmet.score; }
      else if (p[0] === 'k') { pigs += PIG_VARIANTS.king.score; }
      else blocks += MAT[PART_MAT[p[0]]].value;
    }
    const max = blocks + pigs + Math.max(0, def.birds.length - 1) * 10000;
    return [
      Math.round(max * 0.46 / 500) * 500,
      Math.round(max * 0.63 / 500) * 500,
      Math.round(max * 0.8 / 500) * 500,
    ];
  }

  function buildLevel(idx) {
    const def = LEVELS[idx];
    Game.levelIndex = idx;
    Game.scene = 'play';
    Game.phase = 'ready';
    Game.score = 0;
    Game.shownScore = 0;
    Game.stars = 0;
    Game.particles.length = 0;
    Game.textPops.length = 0;
    Game.bolts.length = 0;
    Game.activeBirds.length = 0;
    Game.blocks.length = 0;
    Game.pigs.length = 0;
    Game.held = null;
    Game.used = 0;
    Game.queue = def.birds.slice();
    Game.waitTimer = 0;
    Game.winTimer = 0;
    Game.endTimer = 0;
    Game.shake = 0;
    Game.dragging = false;
    Game.hintT = 0;
    Game.launched = 0;
    Game.message = '';
    Game.messageT = 0;
    Game.starTargets = starTargets(def);

    const world = Phys.createWorld({ gravity: GRAVITY, iterations: 12, substeps: 3 });
    world.onCollision = onCollision;
    Game.world = world;

    const ground = Phys.box({
      x: W / 2, y: GROUND_Y + 80, w: 3000, h: 160,
      isStatic: true, friction: 0.92, restitution: 0.02,
    });
    ground.kind = 'ground';
    world.add(ground);

    for (const part of def.parts) {
      const t = part[0];
      if (t === 'p') addPig(part[1], part[2], part[3], 'normal');
      else if (t === 'h') addPig(part[1], part[2], part[3], 'helmet');
      else if (t === 'k') addPig(part[1], part[2], part[3], 'king');
      else addBlock({ b: 'wood', g: 'glass', s: 'stone', t: 'tnt' }[t], part[1], part[2], part[3], part[4]);
    }

    // 让结构先落定，避免开场抖动
    for (let i = 0; i < 45; i++) world.step(1 / 60);

    spawnNextBird(true);
  }

  /* ================= 小鸟 ================= */

  function makeBird(typeKey) {
    const t = BIRDS[typeKey];
    return {
      kind: 'bird',
      btype: typeKey,
      x: SLING.x,
      y: SLING.y,
      r: t.r,
      angle: 0,
      vx: 0, vy: 0,
      dead: false,
      held: true,
      abilityUsed: false,
      slowT: 0,
      life: 0,
      trail: [],
    };
  }

  function spawnNextBird(initial) {
    if (Game.used >= Game.queue.length) {
      Game.held = null;
      return;
    }
    Game.held = makeBird(Game.queue[Game.used]);
    Game.phase = 'ready';
    Game.dragging = false;
    Game.dragPt.x = SLING.x;
    Game.dragPt.y = SLING.y;
    Game.waitTimer = 0;
    if (!initial) {
      Game.hintT = 0;
      Game.queueSlide = 1;
    }
  }

  function launchBird() {
    const bird = Game.held;
    if (!bird) return;
    const dx = SLING.x - bird.x;
    const dy = SLING.y - bird.y;
    const pull = Math.hypot(dx, dy);
    if (pull < 14) {
      bird.x = SLING.x; bird.y = SLING.y;
      Game.dragging = false;
      return;
    }
    const speed = pull * LAUNCH_POWER;
    const t = BIRDS[bird.btype];
    const body = Phys.circle({
      x: bird.x, y: bird.y, r: t.r,
      mass: t.mass, friction: 0.55, restitution: 0.34,
      damping: 0.9996, angularDamping: 0.995,
    });
    body.kind = 'bird';
    body.btype = bird.btype;
    body.zigzag = false;
    body.vx = dx * LAUNCH_POWER;
    body.vy = dy * LAUNCH_POWER;
    body.angle = Math.atan2(body.vy, body.vx);
    body.av = rand(-3, 3);
    body.abilityUsed = false;
    body.life = 0;
    body.trail = [];
    body.slowT = 0;
    body.dead = false;
    body.flash = 0;
    body.bornAt = Game.time;
    body.offscreen = false;
    Game.world.add(body);
    Game.activeBirds.push(body);
    Game.used++;
    Game.held = null;
    Game.dragging = false;
    Game.phase = 'flying';
    Game.waitTimer = 0;
    Game.launched++;
    Sfx.launch();
    for (let i = 0; i < 10; i++) {
      pushParticle({
        kind: 'dust', x: bird.x, y: bird.y, vx: -body.vx * rand(0.05, 0.14) + rand(-40, 40),
        vy: -body.vy * rand(0.05, 0.14) + rand(-40, 40),
        r: rand(3, 8), life: rand(0.25, 0.5), max: 0.5, color: 'rgba(255,255,255,0.9)',
      });
    }
  }

  /* ================= 技能 ================= */

  function triggerAbility(body) {
    const t = BIRDS[body.btype];
    body.abilityUsed = true;
    if (t.ability === 'dash') {
      const sp = Math.hypot(body.vx, body.vy) || 1;
      const boost = Math.max(sp * 1.85, 1500);
      body.vx = body.vx / sp * boost;
      body.vy = body.vy / sp * boost;
      Game.shake = Math.max(Game.shake, 4);
      Game.abilityFlash = 0.18;
      body.dashTrail = 0.55;
      for (let i = 0; i < 12; i++) {
        pushParticle({
          kind: 'star',
          x: body.x - body.vx * 0.004 * i + rand(-8, 8),
          y: body.y - body.vy * 0.004 * i + rand(-8, 8),
          vx: -body.vx * 0.12 + rand(-70, 70),
          vy: -body.vy * 0.12 + rand(-70, 70),
          r: rand(3, 7), life: rand(0.3, 0.6), max: 0.6,
          color: i % 2 ? '#fff3b0' : '#ffe066',
          rot: rand(0, TAU), av: rand(-8, 8),
        });
      }
      for (let i = 0; i < 14; i++) {
        pushParticle({
          kind: 'dash', x: body.x - body.vx * 0.01 * i, y: body.y - body.vy * 0.01 * i,
          vx: -body.vx * 0.1, vy: -body.vy * 0.1,
          r: rand(2, 5), life: 0.35, max: 0.35, color: 'rgba(255,245,180,0.9)',
        });
      }
      Sfx.dash();
    } else if (t.ability === 'split') {
      const sp = Math.hypot(body.vx, body.vy) || 1;
      const baseA = Math.atan2(body.vy, body.vx);
      for (const da of [-0.3, 0.3]) {
        const a = baseA + da;
        const t2 = BIRDS.blue;
        const b2 = Phys.circle({
          x: body.x + Math.cos(a) * 6, y: body.y + Math.sin(a) * 6,
          r: t2.r * 0.92, mass: t2.mass * 0.8,
          friction: 0.55, restitution: 0.34, damping: 0.9996,
        });
        b2.kind = 'bird';
        b2.btype = 'blue';
        b2.abilityUsed = true;
        b2.vx = Math.cos(a) * sp * 1.02;
        b2.vy = Math.sin(a) * sp * 1.02;
        b2.angle = a;
        b2.life = 0; b2.slowT = 0; b2.trail = []; b2.dead = false; b2.offscreen = false;
        Game.world.add(b2);
        Game.activeBirds.push(b2);
      }
      Sfx.split();
      Game.abilityFlash = 0.16;
      for (let i = 0; i < 12; i++) {
        pushParticle({
          kind: 'spark', x: body.x, y: body.y, vx: rand(-260, 260), vy: rand(-260, 260),
          r: rand(2, 4), life: 0.4, max: 0.4, color: '#bfe9ff',
        });
      }
    } else if (t.ability === 'boom') {
      explode(body.x, body.y, 178, 3200, 165);
      body.dead = true;
      Game.world.remove(body);
    } else if (t.ability === 'egg') {
      const egg = Phys.circle({
        x: body.x, y: body.y + 20, r: 12, mass: 1.5,
        friction: 0.4, restitution: 0.2, damping: 0.999,
      });
      egg.kind = 'egg';
      egg.vx = body.vx * 0.35;
      egg.vy = body.vy + 760;
      egg.dead = false;
      Game.world.add(egg);
      body.vy -= 700;
      body.vx *= 0.85;
      Sfx.egg();
      for (let i = 0; i < 8; i++) {
        pushParticle({
          kind: 'dust', x: egg.x, y: egg.y, vx: rand(-90, 90), vy: rand(-40, 80),
          r: rand(3, 6), life: 0.35, max: 0.35, color: 'rgba(255,250,235,0.9)',
        });
      }
    } else if (t.ability === 'float') {
      body.vx *= 0.42;
      body.vy = -900;
      body.floatT = 0.95;
      body.balloon = true;
      Sfx.dash();
      for (let i = 0; i < 12; i++) {
        pushParticle({
          kind: 'dust', x: body.x + rand(-10, 10), y: body.y + rand(-10, 10),
          vx: rand(-40, 40), vy: rand(-140, -40),
          r: rand(3, 7), life: 0.5, max: 0.5, color: 'rgba(226,190,255,0.9)',
        });
      }
    } else if (t.ability === 'freeze') {
      freezeBlast(body.x, body.y, 165);
      body.vx *= 0.55;
      Sfx.glass();
      Game.abilityFlash = 0.12;
    } else if (t.ability === 'lightning') {
      lightningStrike(body.x, body.y);
      body.vx *= 0.1;
      body.vy = Math.max(body.vy, 260);
      Game.abilityFlash = 0.14;
      Game.shake = Math.max(Game.shake, 6);
    } else if (t.ability === 'return') {
      body.vx *= -0.95;
      body.vy = -Math.abs(body.vy) * 0.4 - 280;
      body.returned = true;
      Sfx.dash();
      for (let i = 0; i < 12; i++) {
        pushParticle({
          kind: 'spark', x: body.x, y: body.y, vx: rand(-220, 220), vy: rand(-220, 220),
          r: rand(2, 4), life: 0.35, max: 0.35, color: '#b7ffc9',
        });
      }
    }
  }

  // 寒冰冲击：把周围冻脆（掉一半血并挂上霜）
  function freezeBlast(x, y, radius) {
    const targets = [];
    Game.world.queryCircle(x, y, radius, function (b) {
      if (b.isStatic || b.dead) return;
      if (b.kind !== 'block' && b.kind !== 'pig') return;
      targets.push(b);
    });
    for (const b of targets) {
      const d = Math.hypot(b.x - x, b.y - y);
      const f = clamp(1 - d / radius, 0, 1);
      b.frozen = 1.4;
      b.vx *= 0.45;
      b.vy *= 0.45;
      b.hp = Math.max(1, b.hp * (1 - 0.45 * (0.3 + f * 0.7)));
      damageBody(b, 8 + f * 12, 400);
    }
    for (let i = 0; i < 26; i++) {
      const a = rand(0, TAU), sp = rand(60, 420);
      pushParticle({
        kind: i % 3 === 0 ? 'shard' : 'spark',
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: rand(2, 7), life: rand(0.35, 0.8), max: 0.8,
        color: i % 2 ? '#d8f6ff' : '#8ee0f5',
        rot: rand(0, TAU), av: rand(-10, 10),
      });
    }
  }

  // 落雷：以鸟为中心向下一道闪电柱
  function lightningStrike(x, y) {
    const halfW = 82;
    const targets = [];
    Game.world.queryCircle(x, (y + GROUND_Y) / 2, (GROUND_Y - y) / 2 + 120, function (b) {
      if (b.isStatic || b.dead) return;
      if (b.kind !== 'block' && b.kind !== 'pig') return;
      if (Math.abs(b.x - x) > halfW) return;
      if (b.y < y - 120) return;
      targets.push(b);
    });
    for (const b of targets) {
      const f = clamp(1 - Math.abs(b.x - x) / halfW, 0, 1);
      b.vy += 220 * f;
      b.vx += rand(-60, 60);
      damageBody(b, 78 + f * 46, 900);
    }
    Game.bolts = Game.bolts || [];
    Game.bolts.push({ x, y0: Math.max(0, y - 220), y1: GROUND_Y + 10, t: 0.26, seed: rand(0, 1000) });
    for (let i = 0; i < 18; i++) {
      pushParticle({
        kind: 'spark', x: x + rand(-halfW, halfW) * 0.6, y: rand(y, GROUND_Y),
        vx: rand(-160, 160), vy: rand(-120, 60),
        r: rand(2, 4), life: rand(0.2, 0.45), max: 0.45, color: i % 2 ? '#fffbd1' : '#ffe066',
      });
    }
    Sfx.boom();
  }

  function useAbility() {
    if (Game.phase !== 'flying' && Game.phase !== 'ready') return false;
    let did = false;
    for (const b of Game.activeBirds.slice()) {
      if (b.dead || b.offscreen || b.abilityUsed) continue;
      if (!BIRDS[b.btype].ability) continue;
      triggerAbility(b);
      did = true;
      break;
    }
    return did;
  }

  /* ================= 爆炸 ================= */

  function explode(x, y, radius, power, damage) {
    Sfx.boom();
    Game.shake = Math.max(Game.shake, 15);
    for (let i = 0; i < 34; i++) {
      const a = rand(0, TAU), sp = rand(60, 620);
      pushParticle({
        kind: i % 3 === 0 ? 'spark' : 'dust',
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        r: rand(3, 12), life: rand(0.3, 0.75), max: 0.75,
        color: i % 4 === 0 ? '#fff3b0' : (i % 3 === 0 ? '#ffb03a' : 'rgba(120,110,105,0.75)'),
      });
    }
    Game.shake = Math.max(Game.shake, 16);
    const targets = [];
    Game.world.queryCircle(x, y, radius, function (b) {
      if (b.isStatic || b.dead || b.kind === 'ground') return;
      targets.push(b);
    });
    for (const b of targets) {
      const dx = b.x - x, dy = b.y - y;
      const d = Math.hypot(dx, dy) || 1;
      const f = clamp(1 - d / radius, 0, 1);
      const nx = dx / d, ny = dy / d;
      const J = power * f * 0.55;
      b.vx += nx * J / Math.max(b.mass, 0.4);
      b.vy += ny * J / Math.max(b.mass, 0.4) - 120 * f;
      b.av += rand(-4, 4) * f;
      if (b.kind === 'pig' || b.kind === 'block') {
        damageBody(b, damage * (0.45 + f * 0.85), 600);
      }
    }
    // 爆炸把附近的鸟也推开
    for (const b of Game.activeBirds) {
      if (b.dead) continue;
      const dx = b.x - x, dy = b.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < radius) {
        const f = clamp(1 - d / radius, 0, 1);
        b.vx += dx / d * power * 0.4 * f / Math.max(b.mass, 0.4);
        b.vy += dy / d * power * 0.4 * f / Math.max(b.mass, 0.4);
      }
    }
  }

  /* ================= 伤害 ================= */

  const DMG = { threshold: 120, base: 190, k: 0.045, bodyMul: 0.58 };

  function onCollision(a, b, c, jn, speed) {
    const big = jn > 480;
    if (big) {
      Game.shake = Math.min(Game.shake + Math.max(0, jn - 460) * 0.0009, 9);
    }
    if (a.kind === 'egg' || b.kind === 'egg') {
      const egg = a.kind === 'egg' ? a : b;
      if (!egg.dead) {
        egg.dead = true;
        Game.world.remove(egg);
        explode(egg.x, egg.y, 150, 2600, 140);
      }
      return;
    }
    if (speed < DMG.threshold) return;
    const isBird = a.kind === 'bird' || b.kind === 'bird';
    const srcMul = isBird ? 1 : DMG.bodyMul;
    const raw = Math.max(0, jn - DMG.base) * DMG.k * srcMul;
    if (raw < 0.5) return;

    const mulA = a.kind === 'bird' ? BIRDS[a.btype].damage : 1;
    const mulB = b.kind === 'bird' ? BIRDS[b.btype].damage : 1;

    if (raw * mulA > 0.5 && a.kind !== 'ground') damageBody(a, raw * mulA, speed, c);
    if (raw * mulB > 0.5 && b.kind !== 'ground') damageBody(b, raw * mulB, speed, c);

    if (jn > 1400) Sfx.thud(1);
    else if (jn > 700) Sfx.thud(0.4);
  }

  function damageBody(body, dmg, speed, contact) {
    if (body.dead || body.isStatic) return;
    if (body.kind !== 'pig' && body.kind !== 'block') return;
    body.hp -= dmg;
    body.flash = 0.16;
    if (body.hp <= 0) destroyBody(body, speed);
    else if (body.kind === 'block' && body.hp < body.maxHp * 0.45 && Math.random() < 0.4) {
      const m = body.mat;
      for (let i = 0; i < 2; i++) {
        pushParticle({
          kind: 'chip', x: body.x + rand(-body.hw, body.hw), y: body.y + rand(-body.hh, body.hh),
          vx: rand(-90, 90), vy: rand(-160, -20), r: rand(2, 5),
          life: rand(0.3, 0.6), max: 0.6, color: m.dark, rot: rand(0, TAU), av: rand(-8, 8),
        });
      }
    }
  }

  function popPig(pig, points, label) {
    const i = Game.pigs.indexOf(pig);
    if (i >= 0) Game.pigs.splice(i, 1);
    if (!pig.dead) {
      pig.dead = true;
      Game.world.remove(pig);
    }
    Game.score += points;
    addText(pig.x, pig.y - 20, label, '#ffe066');
    Sfx.pop();
    popPigParticles(pig.x, pig.y, pig.r);
    Game.shake = Math.max(Game.shake, 7);
  }

  function destroyBody(body, speed) {
    if (body.dead) return;
    if (body.kind === 'pig') {
      const val = body.scoreValue || 5000;
      popPig(body, val, '+' + val);
      return;
    }
    body.dead = true;
    Game.world.remove(body);
    if (body.kind === 'block') {
      const i = Game.blocks.indexOf(body);
      if (i >= 0) Game.blocks.splice(i, 1);
      Game.score += body.mat.value;
      addText(body.x, body.y - 12, '+' + body.mat.value, '#e8f4ff');
      breakBlockParticles(body);
      if (body.matKey === 'glass') Sfx.glass();
      else if (body.matKey === 'stone') Sfx.stone(clamp((speed || 300) / 900, 0, 1));
      else Sfx.wood(clamp((speed || 300) / 900, 0, 1));
      if (body.matKey === 'tnt') {
        explode(body.x, body.y, 165, 3200, 160);
      }
    }
  }

  // 掉出场地 / 被挤到弹弓后面（射程外）的猪自动消失，避免卡关
  function updateStrays(dt) {
    for (let i = Game.pigs.length - 1; i >= 0; i--) {
      const p = Game.pigs[i];
      if (p.dead) continue;
      const stray = p.x < 430 || p.x > W + 160 || p.y > H + 120;
      if (stray) {
        p.escapeT = (p.escapeT || 0) + dt;
        if (p.escapeT > 0.9) popPig(p, 2000, '跑远啦 +2000');
      } else {
        p.escapeT = 0;
      }
    }
  }

  /* ================= 粒子 ================= */

  function pushParticle(p) {
    if (Game.particles.length > 460) Game.particles.shift();
    p.vx = p.vx || 0; p.vy = p.vy || 0;
    p.life = p.life == null ? 0.5 : p.life;
    p.max = p.max || p.life;
    p.rot = p.rot || 0;
    p.av = p.av || 0;
    Game.particles.push(p);
  }

  function addText(x, y, text, color) {
    Game.textPops.push({ x, y, text, color, life: 1.1, max: 1.1, vy: -70 });
  }

  function popPigParticles(x, y, r) {
    for (let i = 0; i < 16; i++) {
      const a = rand(0, TAU), sp = rand(80, 340);
      pushParticle({
        kind: 'chip', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90,
        r: rand(3, 8), life: rand(0.35, 0.7), max: 0.7,
        color: i % 3 === 0 ? '#8ddc62' : '#5fbe3f', rot: rand(0, TAU), av: rand(-10, 10),
      });
    }
    addText(x, y - r - 16, 'BOOM!', '#ffffff');
  }

  function breakBlockParticles(body) {
    const m = body.mat;
    const n = m.kind === 'glass' ? 14 : 12;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(60, 320);
      pushParticle({
        kind: m.kind === 'glass' ? 'shard' : 'chip',
        x: body.x + rand(-body.hw, body.hw) * 0.7,
        y: body.y + rand(-body.hh, body.hh) * 0.7,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rand(40, 160),
        r: rand(3, 9), life: rand(0.4, 0.85), max: 0.85,
        color: m.fill, dark: m.dark, rot: rand(0, TAU), av: rand(-12, 12),
      });
    }
    for (let i = 0; i < 6; i++) {
      pushParticle({
        kind: 'dust', x: body.x + rand(-body.hw, body.hw), y: body.y + rand(-body.hh, body.hh),
        vx: rand(-60, 60), vy: rand(-70, 10), r: rand(6, 14),
        life: rand(0.3, 0.6), max: 0.6, color: 'rgba(230,225,210,0.5)',
      });
    }
  }

  function updateParticles(dt) {
    for (let i = Game.particles.length - 1; i >= 0; i--) {
      const p = Game.particles[i];
      p.life -= dt;
      if (p.life <= 0) { Game.particles.splice(i, 1); continue; }
      if (p.kind === 'dust') {
        p.vx *= 0.96; p.vy = p.vy * 0.96 - 20 * dt;
      } else if (p.kind === 'star') {
        p.vx *= 0.93;
        p.vy = p.vy * 0.93 - 30 * dt;
      } else {
        p.vy += 1500 * dt;
        p.vx *= 0.995;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.av * dt;
      if (p.kind !== 'dust' && p.y > GROUND_Y - 2 && p.vy > 0) {
        p.y = GROUND_Y - 2;
        p.vy *= -0.32;
        p.vx *= 0.7;
        p.av *= 0.6;
      }
    }
    for (let i = Game.textPops.length - 1; i >= 0; i--) {
      const t = Game.textPops[i];
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= 0.96;
      if (t.life <= 0) Game.textPops.splice(i, 1);
    }
  }

  /* ================= 更新循环 ================= */

  function worldQuiet() {
    const bodies = Game.world ? Game.world.bodies : [];
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b || b.isStatic) continue;
      if (Math.hypot(b.vx, b.vy) > 30 || Math.abs(b.av) > 1.0) return false;
    }
    return true;
  }

  function updateActiveBirds(dt) {
    const list = Game.activeBirds;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.dead) continue;
      b.life = (b.life || 0) + dt;
      if (b.floatT > 0) {
        // 气球鸟：抵消大部分重力，缓缓飘升
        b.floatT -= dt;
        b.vy -= GRAVITY * 0.94 * dt;
      }
      if (b.dashTrail > 0) {
        // 冲刺时尾部拖出星光
        b.dashTrail -= dt;
        b.starAcc = (b.starAcc || 0) + dt;
        while (b.starAcc > 0.028) {
          b.starAcc -= 0.028;
          const sp2 = Math.hypot(b.vx, b.vy) || 1;
          pushParticle({
            kind: 'star',
            x: b.x - (b.vx / sp2) * b.r * 1.35 + rand(-6, 6),
            y: b.y - (b.vy / sp2) * b.r * 1.35 + rand(-6, 6),
            vx: -(b.vx / sp2) * rand(20, 80) + rand(-40, 40),
            vy: -(b.vy / sp2) * rand(20, 80) + rand(-40, 40),
            r: rand(2.5, 6), life: rand(0.25, 0.5), max: 0.5,
            color: Math.random() < 0.5 ? '#fff3b0' : '#ffe066',
            rot: rand(0, TAU), av: rand(-6, 6),
          });
        }
      }
      if (b.trail) {
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 34) b.trail.shift();
      }
      const sp = Math.hypot(b.vx, b.vy);
      if (sp < 34) b.slowT = (b.slowT || 0) + dt; else b.slowT = 0;
      if (b.x < -260 || b.x > W + 460 || b.y > H + 380) b.offscreen = true;
      const done = b.offscreen || (b.life > 1.4 && (b.slowT || 0) > 1.0) || b.life > 9;
      if (done) {
        b.dead = true;
        Game.world.remove(b);
      }
    }
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].dead) list.splice(i, 1);
    }
  }

  function beginWin() {
    Game.phase = 'won';
    Game.endTimer = 0;
    const remaining = Math.max(0, Game.queue.length - Game.used) + (Game.held ? 1 : 0);
    Game.score += remaining * 10000;
    const t = Game.starTargets || [0, 0, 0];
    Game.stars = Game.score >= t[2] ? 3 : (Game.score >= t[1] ? 2 : 1);
    saveProgress();
    Sfx.win();
    for (let i = 0; i < 60; i++) {
      pushParticle({
        kind: 'chip',
        x: rand(200, W - 200), y: rand(-120, 120),
        vx: rand(-60, 60), vy: rand(40, 220),
        r: rand(4, 9), life: rand(1.2, 2.4), max: 2.4,
        color: ['#ffd166', '#ef476f', '#06d6a0', '#118ab2'][i % 4],
        rot: rand(0, TAU), av: rand(-8, 8),
      });
    }
  }

  function beginLose() {
    Game.phase = 'lost';
    Game.endTimer = 0;
    Sfx.lose();
  }

  function checkOutcome(dt) {
    if (Game.phase === 'won' || Game.phase === 'lost') { Game.endTimer += dt; return; }
    if (Game.phase === 'winning') {
      Game.endTimer += dt;
      if (Game.endTimer > 0.55) beginWin();
      return;
    }
    if (Game.pigs.length === 0) {
      Game.phase = 'winning';
      Game.endTimer = 0;
      return;
    }
    if (Game.phase === 'flying') {
      if (Game.activeBirds.length === 0) {
        Game.waitTimer += dt;
        if (Game.waitTimer > 0.4 && (worldQuiet() || Game.waitTimer > 3.2)) {
          if (Game.used < Game.queue.length) spawnNextBird(false);
          else beginLose();
        }
      } else {
        Game.waitTimer = 0;
      }
    }
  }

  function update(dt) {
    dt = Math.min(dt, 1 / 30);
    Game.time += dt;
    updateSky(dt);
    Game.queueSlide = Math.max(0, Game.queueSlide - dt * 4.5);
    Game.shake = Math.max(0, Game.shake - dt * 42);
    Game.abilityFlash = Math.max(0, Game.abilityFlash - dt);
    Game.messageT = Math.max(0, Game.messageT - dt);
    if (Game.scene !== 'play') {
      updateParticles(dt);
      return;
    }
    if (Game.world) Game.world.step(dt);
    if (Game.autoFire) {
      Game.autoFire.t -= dt;
      if (Game.autoFire.t <= 0) {
        if (Game.phase === 'ready' && Game.held) {
          updateDrag({ x: SLING.x + Game.autoFire.dx, y: SLING.y + Game.autoFire.dy });
          launchBird();
          if (Game.autoAbilityDelay != null) Game.autoAbility = Game.autoAbilityDelay;
        }
        Game.autoFire = null;
      }
    }
    if (Game.autoAbility != null && Game.autoAbility >= 0) {
      Game.autoAbility -= dt;
      if (Game.autoAbility <= 0) {
        if (Game.phase === 'flying') useAbility();
        Game.autoAbility = null;
      }
    }
    if (Game.hintT < 1e9) Game.hintT += dt;
    updateActiveBirds(dt);
    updateStrays(dt);
    updateParticles(dt);
    for (let i = Game.bolts.length - 1; i >= 0; i--) {
      Game.bolts[i].t -= dt;
      if (Game.bolts[i].t <= 0) Game.bolts.splice(i, 1);
    }
    for (const b of Game.blocks) if (b.frozen > 0) b.frozen -= dt;
    for (const p of Game.pigs) if (p.frozen > 0) p.frozen -= dt;
    checkOutcome(dt);
  }

  /* ================= 输入 ================= */

  function pointerToWorld(e) {
    const canvas = view.canvas;
    let rect = { left: 0, top: 0, width: W, height: H };
    if (canvas && canvas.getBoundingClientRect) {
      try {
        const r = canvas.getBoundingClientRect();
        if (r && r.width > 0) rect = r;
      } catch (err) { /* 忽略 */ }
    }
    const cx = (e.clientX == null ? 0 : e.clientX);
    const cy = (e.clientY == null ? 0 : e.clientY);
    const l = (e.offsetX != null && rect.width === W) ? 0 : 0;
    void l;
    return {
      x: ((cx - rect.left) / rect.width) * W,
      y: ((cy - rect.top) / rect.height) * H,
    };
  }

  function hitButton(p) {
    for (let i = Game.buttons.length - 1; i >= 0; i--) {
      const b = Game.buttons[i];
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return b;
    }
    return null;
  }

  function openIntro(idx) {
    const i = clamp(idx | 0, 0, LEVELS.length - 1);
    Game.introLevel = i;
    buildLevel(i);          // 先把关卡搭好，介绍页背后就是真实场景
    Game.scene = 'intro';
  }

  function activate(id) {
    Sfx.click();
    if (id === 'start') {
      Game.scene = 'levels';
    } else if (id === 'fight') {
      Game.scene = 'play';
    } else if (id === 'introBack') {
      Game.scene = 'levels';
    } else if (id === 'levels') {
      Game.scene = 'levels';
    } else if (id === 'back') {
      Game.scene = 'menu';
    } else if (id === 'retry') {
      buildLevel(Game.levelIndex);
    } else if (id === 'next') {
      if (Game.levelIndex + 1 < LEVELS.length) openIntro(Game.levelIndex + 1);
      else Game.scene = 'levels';
    } else if (id === 'menu') {
      Game.scene = 'menu';
    } else if (id === 'mute') {
      Game.muted = !Game.muted;
      Sfx.setMuted(Game.muted);
    } else if (id.indexOf('level:') === 0) {
      const i = parseInt(id.slice(6), 10);
      if (unlocked(i)) openIntro(i);
    }
  }

  function updateDrag(p) {
    if (!Game.held) return;
    let dx = p.x - SLING.x;
    let dy = p.y - SLING.y;
    const len = Math.hypot(dx, dy);
    if (len > MAX_PULL) { dx = dx / len * MAX_PULL; dy = dy / len * MAX_PULL; }
    if (dy < -MAX_PULL * 0.55) dy = -MAX_PULL * 0.55;
    Game.held.x = SLING.x + dx;
    Game.held.y = SLING.y + dy;
    Game.dragPt.x = Game.held.x;
    Game.dragPt.y = Game.held.y;
    Game.phase = 'aiming';
  }

  function onDown(p) {
    const btn = hitButton(p);
    if (btn) { activate(btn.id); return; }
    if (Game.scene !== 'play') return;
    if (Game.phase === 'won' || Game.phase === 'lost') return;
    if ((Game.phase === 'ready' || Game.phase === 'aiming') && Game.held) {
      const d = Math.hypot(p.x - Game.held.x, p.y - Game.held.y);
      if (d < 130) {
        Game.dragging = true;
        updateDrag(p);
      }
    } else if (Game.phase === 'flying') {
      useAbility();
    }
  }

  function onMove(p) {
    const btn = hitButton(p);
    Game.hover = btn ? btn.id : null;
    if (Game.dragging) updateDrag(p);
  }

  function onUp() {
    if (Game.dragging) {
      Game.dragging = false;
      launchBird();
    }
  }

  function bindInput(canvas) {
    if (!canvas || !canvas.addEventListener) return;
    const down = function (e) {
      if (e.preventDefault) e.preventDefault();
      Sfx.unlock();
      onDown(pointerToWorld(e));
    };
    const move = function (e) {
      onMove(pointerToWorld(e));
    };
    const up = function () { onUp(); };
    canvas.addEventListener('pointerdown', down, { passive: false });
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', function () { Game.hover = null; });
    if (root.addEventListener) {
      root.addEventListener('pointerup', up);
      root.addEventListener('keydown', function (e) {
        if (e.key === 'r' || e.key === 'R') {
          if (Game.scene === 'play') buildLevel(Game.levelIndex);
        } else if (e.key === 'm' || e.key === 'M') {
          Game.muted = !Game.muted; Sfx.setMuted(Game.muted);
        } else if (e.key === ' ' || e.key === 'Enter') {
          if (Game.scene === 'play' && Game.phase === 'flying') useAbility();
        } else if (e.key === 'Escape') {
          if (Game.scene === 'play' || Game.scene === 'intro') Game.scene = 'levels';
        }
      });
    }
  }

  /* ================= 绘制：场景 ================= */

  /* ---------------- 动态星空 ---------------- */
  const sky = { stars: [], fireflies: [], shoot: [], clouds: [], nextShoot: 3.2 };

  function ensureSky() {
    if (sky.stars.length) return;
    const rnd = seeded(20240917);
    for (let i = 0; i < 240; i++) {
      const big = rnd() > 0.9;
      sky.stars.push({
        x: rnd() * W,
        y: rnd() * (GROUND_Y - 6),
        r: big ? 1.5 + rnd() * 1.5 : 0.45 + rnd() * 1.05,
        a: 0.28 + rnd() * 0.72,
        sp: 0.5 + rnd() * 2.6,
        ph: rnd() * TAU,
        big: big,
        tint: rnd() < 0.12 ? '200,220,255' : (rnd() < 0.18 ? '255,228,190' : '255,255,255'),
      });
    }
    for (let i = 0; i < 16; i++) {
      sky.fireflies.push({
        x: rand(30, W - 30), y: GROUND_Y - rand(4, 90),
        ph: rand(0, TAU), sp: rand(0.5, 1.4), amp: rand(6, 26), r: rand(1.1, 2.4),
      });
    }
    for (let i = 0; i < 5; i++) {
      sky.clouds.push({
        x: rand(0, W), y: rand(40, 260), s: rand(0.5, 1.1), v: rand(2, 7),
      });
    }
  }

  function updateSky(dt) {
    ensureSky();
    sky.nextShoot -= dt;
    if (sky.nextShoot <= 0) {
      sky.nextShoot = rand(4.5, 11);
      const dir = Math.random() < 0.5 ? 1 : -1;
      sky.shoot.push({
        x: dir > 0 ? rand(0, W * 0.55) : rand(W * 0.45, W),
        y: rand(20, 240),
        vx: dir * rand(520, 900),
        vy: rand(140, 300),
        life: 1.1, max: 1.1,
      });
    }
    for (let i = sky.shoot.length - 1; i >= 0; i--) {
      const s = sky.shoot[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.life <= 0 || s.x < -260 || s.x > W + 260 || s.y > GROUND_Y) sky.shoot.splice(i, 1);
    }
  }

  function drawMilkyWay(ctx) {
    ctx.save();
    ctx.translate(W * 0.5, GROUND_Y * 0.4);
    ctx.rotate(-0.38);
    const g = ctx.createLinearGradient(0, -190, 0, 190);
    g.addColorStop(0, 'rgba(110,130,220,0)');
    g.addColorStop(0.36, 'rgba(126,140,235,0.07)');
    g.addColorStop(0.5, 'rgba(196,186,255,0.15)');
    g.addColorStop(0.64, 'rgba(126,140,235,0.07)');
    g.addColorStop(1, 'rgba(110,130,220,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-1000, -190, 2000, 380);
    ctx.restore();
  }

  function drawStars(ctx) {
    const time = Game.time;
    for (let i = 0; i < sky.stars.length; i++) {
      const s = sky.stars[i];
      const tw = 0.5 + 0.5 * Math.sin(time * s.sp + s.ph);
      const a = s.a * (0.35 + 0.65 * tw);
      if (a < 0.03) continue;
      ctx.fillStyle = 'rgba(' + s.tint + ',' + a.toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
      if (s.big) {
        const k = s.r * (2.4 + tw * 1.6);
        ctx.strokeStyle = 'rgba(220,235,255,' + (a * 0.4).toFixed(2) + ')';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(s.x - k, s.y);
        ctx.lineTo(s.x + k, s.y);
        ctx.moveTo(s.x, s.y - k);
        ctx.lineTo(s.x, s.y + k);
        ctx.stroke();
      }
    }
  }

  function drawMoon(ctx) {
    const mx = 1072, my = 132, mr = 50;
    const halo = ctx.createRadialGradient(mx, my, mr * 0.7, mx, my, mr * 4.6);
    halo.addColorStop(0, 'rgba(200,220,255,0.24)');
    halo.addColorStop(0.35, 'rgba(150,180,255,0.08)');
    halo.addColorStop(1, 'rgba(150,180,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(mx, my, mr * 4.6, 0, TAU);
    ctx.fill();

    const mg = ctx.createRadialGradient(mx - mr * 0.35, my - mr * 0.4, mr * 0.1, mx, my, mr * 1.02);
    mg.addColorStop(0, '#fffef6');
    mg.addColorStop(0.62, '#f2eeda');
    mg.addColorStop(1, '#cfc9b4');
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, TAU);
    ctx.fill();

    const rnd = seeded(9137);
    ctx.save();
    ctx.beginPath();
    ctx.arc(mx, my, mr * 0.98, 0, TAU);
    ctx.clip();
    for (let i = 0; i < 11; i++) {
      const a = rnd() * TAU, d = rnd() * mr * 0.76, cr = 2 + rnd() * 8;
      const cx2 = mx + Math.cos(a) * d, cy2 = my + Math.sin(a) * d;
      ctx.fillStyle = 'rgba(184,180,162,0.38)';
      ctx.beginPath();
      ctx.arc(cx2, cy2, cr, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,246,0.3)';
      ctx.beginPath();
      ctx.arc(cx2 - cr * 0.25, cy2 - cr * 0.3, cr * 0.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mx, my, mr, Math.PI * 0.9, Math.PI * 1.7);
    ctx.stroke();
  }

  function drawShootingStars(ctx) {
    for (let i = 0; i < sky.shoot.length; i++) {
      const s = sky.shoot[i];
      const a = Math.max(0, s.life / s.max);
      const tx = s.x - s.vx * 0.085, ty = s.y - s.vy * 0.085;
      const g = ctx.createLinearGradient(s.x, s.y, tx, ty);
      g.addColorStop(0, 'rgba(255,255,255,' + (a * 0.95).toFixed(2) + ')');
      g.addColorStop(0.4, 'rgba(190,215,255,' + (a * 0.42).toFixed(2) + ')');
      g.addColorStop(1, 'rgba(190,215,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.2, 0, TAU);
      ctx.fill();
    }
  }

  function drawNightClouds(ctx) {
    for (let i = 0; i < sky.clouds.length; i++) {
      const c = sky.clouds[i];
      const x = ((c.x + Game.time * c.v) % (W + 400)) - 200;
      ctx.fillStyle = 'rgba(150,170,215,0.09)';
      drawCloud(ctx, x, c.y, c.s);
    }
  }

  function drawFireflies(ctx) {
    for (let i = 0; i < sky.fireflies.length; i++) {
      const f = sky.fireflies[i];
      const t = Game.time * f.sp + f.ph;
      const x = f.x + Math.sin(t) * f.amp;
      const y = f.y + Math.cos(t * 0.8) * f.amp * 0.5;
      const a = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * 2.3));
      const g = ctx.createRadialGradient(x, y, 0, x, y, f.r * 5);
      g.addColorStop(0, 'rgba(255,242,150,' + (a * 0.9).toFixed(2) + ')');
      g.addColorStop(0.35, 'rgba(220,240,120,' + (a * 0.32).toFixed(2) + ')');
      g.addColorStop(1, 'rgba(200,255,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, f.r * 5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,214,' + a.toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(x, y, f.r * 0.7, 0, TAU);
      ctx.fill();
    }
  }

  function drawSky(ctx) {
    ensureSky();
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y + 40);
    g.addColorStop(0, '#05070f');
    g.addColorStop(0.35, '#0b1226');
    g.addColorStop(0.68, '#17233f');
    g.addColorStop(1, '#2a3a5c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, GROUND_Y + 60);

    drawMilkyWay(ctx);
    drawStars(ctx);
    drawMoon(ctx);
    drawShootingStars(ctx);
    drawFireflies(ctx);
  }

  function drawCloud(ctx, x, y, s) {
    ctx.beginPath();
    ctx.arc(x, y, 30 * s, 0, TAU);
    ctx.arc(x + 34 * s, y - 14 * s, 24 * s, 0, TAU);
    ctx.arc(x + 64 * s, y + 4 * s, 26 * s, 0, TAU);
    ctx.arc(x + 30 * s, y + 18 * s, 26 * s, 0, TAU);
    ctx.fill();
  }

  function drawHills(ctx) {
    // 远山
    ctx.fillStyle = '#111c33';
    ctx.beginPath();
    ctx.moveTo(-40, GROUND_Y);
    ctx.quadraticCurveTo(160, GROUND_Y - 210, 400, GROUND_Y - 30);
    ctx.quadraticCurveTo(560, GROUND_Y - 170, 820, GROUND_Y - 20);
    ctx.quadraticCurveTo(1040, GROUND_Y - 190, 1340, GROUND_Y);
    ctx.lineTo(1340, GROUND_Y + 10);
    ctx.lineTo(-40, GROUND_Y + 10);
    ctx.closePath();
    ctx.fill();

    // 近山
    ctx.fillStyle = '#0b1424';
    ctx.beginPath();
    ctx.moveTo(-40, GROUND_Y);
    ctx.quadraticCurveTo(240, GROUND_Y - 130, 520, GROUND_Y - 10);
    ctx.quadraticCurveTo(760, GROUND_Y - 120, 1060, GROUND_Y - 6);
    ctx.quadraticCurveTo(1220, GROUND_Y - 70, 1340, GROUND_Y);
    ctx.closePath();
    ctx.fill();
    // 山脊月光
    ctx.strokeStyle = 'rgba(130,175,255,0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 树丛
    ctx.fillStyle = '#070d19';
    for (let i = 0; i < 9; i++) {
      const x = 60 + i * 150 + (i % 2) * 30;
      const y = GROUND_Y - 6;
      const s = 0.7 + (i % 3) * 0.22;
      ctx.beginPath();
      ctx.arc(x, y - 26 * s, 30 * s, 0, TAU);
      ctx.arc(x + 26 * s, y - 12 * s, 24 * s, 0, TAU);
      ctx.arc(x - 26 * s, y - 12 * s, 22 * s, 0, TAU);
      ctx.fill();
    }
  }

  function drawGround(ctx) {
    const g = ctx.createLinearGradient(0, GROUND_Y - 10, 0, H);
    g.addColorStop(0, '#2b5f52');
    g.addColorStop(0.16, '#1d4239');
    g.addColorStop(0.42, '#2a2130');
    g.addColorStop(1, '#100c16');
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND_Y - 10, W, H - GROUND_Y + 10);

    // 草叶
    const rnd = seeded(7);
    ctx.strokeStyle = 'rgba(140,225,175,0.32)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < 90; i++) {
      const x = rnd() * W;
      const h = 5 + rnd() * 9;
      ctx.moveTo(x, GROUND_Y - 6);
      ctx.quadraticCurveTo(x + 3, GROUND_Y - 6 - h * 0.6, x + (rnd() > 0.5 ? 4 : -4), GROUND_Y - 6 - h);
    }
    ctx.stroke();

    // 土里的石子
    const rnd2 = seeded(31);
    ctx.fillStyle = 'rgba(200,220,255,0.06)';
    for (let i = 0; i < 60; i++) {
      const x = rnd2() * W, y = GROUND_Y + 18 + rnd2() * (H - GROUND_Y - 30);
      const r = 1.5 + rnd2() * 3.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }

    // 月光高光
    ctx.fillStyle = 'rgba(170,210,255,0.16)';
    ctx.fillRect(0, GROUND_Y - 10, W, 3);
  }

  const SLING_GEO = {
    baseTop: 556,
    tipL: { x: SLING.x - 42, y: 480 },
    tipR: { x: SLING.x + 36, y: 476 },
  };

  function slingAnchor() {
    if (Game.dragging && Game.held) return { x: Game.held.x, y: Game.held.y };
    return { x: SLING.x, y: SLING.y };
  }

  function drawWoodArm(ctx, from, to, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo((from.x + to.x) / 2, (from.y + to.y) / 2 + 6, to.x, to.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = Math.max(2, width * 0.26);
    ctx.beginPath();
    ctx.moveTo(from.x - width * 0.2, from.y);
    ctx.quadraticCurveTo((from.x + to.x) / 2 - 3, (from.y + to.y) / 2 + 4, to.x - width * 0.18, to.y + 3);
    ctx.stroke();
  }

  function drawSlingBack(ctx) {
    const g = SLING_GEO;
    const a = slingAnchor();

    // 立柱
    ctx.fillStyle = '#7a4f2d';
    ctx.beginPath();
    ctx.moveTo(SLING.x - 19, GROUND_Y + 2);
    ctx.lineTo(SLING.x - 13, g.baseTop + 10);
    ctx.lineTo(SLING.x + 13, g.baseTop + 10);
    ctx.lineTo(SLING.x + 19, GROUND_Y + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath();
    ctx.moveTo(SLING.x - 12, GROUND_Y);
    ctx.lineTo(SLING.x - 8, g.baseTop + 12);
    ctx.lineTo(SLING.x - 1, g.baseTop + 12);
    ctx.lineTo(SLING.x - 4, GROUND_Y);
    ctx.closePath();
    ctx.fill();
    // 底座石头
    ctx.fillStyle = '#77808c';
    roundRect(ctx, SLING.x - 30, GROUND_Y - 14, 60, 20, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    roundRect(ctx, SLING.x - 26, GROUND_Y - 12, 24, 6, 3);
    ctx.fill();

    // 后臂
    drawWoodArm(ctx, { x: SLING.x + 4, y: g.baseTop + 4 }, g.tipR, 18, '#6b4227');

    // 后皮筋
    if (Game.held) {
      ctx.strokeStyle = '#3d2617';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(g.tipR.x, g.tipR.y);
      ctx.lineTo(a.x + 5, a.y + 3);
      ctx.stroke();
    }
  }

  function drawSlingFront(ctx) {
    const g = SLING_GEO;
    const a = slingAnchor();

    if (Game.held) {
      ctx.strokeStyle = '#5a3820';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(g.tipL.x, g.tipL.y);
      ctx.lineTo(a.x - 5, a.y + 3);
      ctx.stroke();
      // 皮兜
      ctx.fillStyle = '#3d2617';
      ctx.beginPath();
      ctx.ellipse(a.x, a.y, 7, 12.5, 0, 0, TAU);
      ctx.fill();
    }

    // 前臂
    drawWoodArm(ctx, { x: SLING.x - 4, y: g.baseTop + 4 }, g.tipL, 18, '#8a5a34');
  }

  function drawTrajectory(ctx) {
    if (!Game.dragging || !Game.held) return;
    const h = 1 / 60;
    let x = Game.held.x, y = Game.held.y;
    let vx = (SLING.x - x) * LAUNCH_POWER;
    let vy = (SLING.y - y) * LAUNCH_POWER;
    ctx.save();
    for (let i = 0; i < 110; i++) {
      vy += GRAVITY * h;
      x += vx * h;
      y += vy * h;
      if (y > GROUND_Y - 4 || x > W + 200) break;
      if (i % 4 === 0) {
        const t = i / 110;
        ctx.fillStyle = 'rgba(255,255,255,' + (0.85 - t * 0.6) + ')';
        ctx.beginPath();
        ctx.arc(x, y, 4.5 - t * 2.4, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /* ================= 绘制：精灵 ================= */

  function circlePath(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.1, r), 0, TAU);
  }

  /* ---- 小鸟 3D 化渲染 ---- */
  const LIGHT = { x: -0.36, y: -0.44 };

  function birdBodyPath(ctx, type, r) {
    if (type === 'yellow') {
      ctx.beginPath();
      ctx.moveTo(r * 1.45, 0);
      ctx.quadraticCurveTo(r * 0.3, -r * 1.15, -r * 0.95, -r * 1.0);
      ctx.quadraticCurveTo(-r * 0.35, 0, -r * 0.95, r * 1.0);
      ctx.quadraticCurveTo(r * 0.35, r * 1.15, r * 1.45, 0);
      ctx.closePath();
    } else if (type === 'white') {
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.94, r * 1.12, 0, 0, TAU);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
    }
  }

  function drawBirdTail(ctx, t, r) {
    const g = ctx.createLinearGradient(-r * 1.5, 0, -r * 0.45, 0);
    g.addColorStop(0, shade(t.color, -0.4));
    g.addColorStop(0.55, shade(t.color, -0.14));
    g.addColorStop(1, shade(t.color, 0.05));
    ctx.fillStyle = g;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, i * r * 0.26);
      ctx.quadraticCurveTo(-r * 1.02, i * r * 0.44 - r * 0.04, -r * 1.46, i * r * 0.62 - r * 0.1);
      ctx.quadraticCurveTo(-r * 1.0, i * r * 0.28 + r * 0.14, -r * 0.66, i * r * 0.24 + r * 0.2);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawEye3D(ctx, x, y, er, sy) {
    const k = sy == null ? 1 : sy;
    if (k < 1) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, k);
      ctx.translate(-x, -y);
    }
    const socket = ctx.createRadialGradient(x, y + er * 0.12, er * 0.2, x, y + er * 0.12, er * 1.3);
    socket.addColorStop(0, 'rgba(0,0,0,0.11)');
    socket.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = socket;
    ctx.beginPath();
    ctx.arc(x, y + er * 0.12, er * 1.3, 0, TAU);
    ctx.fill();

    const wg = ctx.createRadialGradient(x - er * 0.4, y - er * 0.45, er * 0.08, x, y, er * 1.02);
    wg.addColorStop(0, '#ffffff');
    wg.addColorStop(0.7, '#f4f7fc');
    wg.addColorStop(1, '#c0cbdb');
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.arc(x, y, er, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(50,60,80,0.25)';
    ctx.lineWidth = Math.max(0.7, er * 0.08);
    ctx.stroke();

    const px = x + er * 0.3, py = y + er * 0.14;
    const pg = ctx.createRadialGradient(px - er * 0.2, py - er * 0.22, er * 0.04, px, py, er * 0.52);
    pg.addColorStop(0, '#5a5a67');
    pg.addColorStop(1, '#0f0f14');
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(px, py, er * 0.5, 0, TAU);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(px - er * 0.17, py - er * 0.21, er * 0.18, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.arc(px + er * 0.14, py + er * 0.22, er * 0.08, 0, TAU);
    ctx.fill();
    if (k < 1) ctx.restore();
  }

  function drawBeak3D(ctx, r, beakY) {
    const x0 = r * 0.5, x1 = r * 1.2;
    const yTop = beakY - r * 0.1, yMid = beakY + r * 0.1, yBot = beakY + r * 0.33;
    const g = ctx.createLinearGradient(x0, yTop, x1, yBot);
    g.addColorStop(0, '#ffd873');
    g.addColorStop(0.45, '#f9a72c');
    g.addColorStop(1, '#c97611');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0, yTop);
    ctx.quadraticCurveTo(x0 + r * 0.45, yTop + r * 0.03, x1, yMid);
    ctx.lineTo(x0 + r * 0.05, yMid + r * 0.02);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = shade('#f0a02a', -0.24);
    ctx.beginPath();
    ctx.moveTo(x0 + r * 0.06, yMid + r * 0.04);
    ctx.lineTo(x1 - r * 0.02, yMid + r * 0.03);
    ctx.quadraticCurveTo(x0 + r * 0.42, yBot, x0 + r * 0.02, yBot - r * 0.02);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.beginPath();
    ctx.moveTo(x0 + r * 0.08, yTop + r * 0.02);
    ctx.quadraticCurveTo(x0 + r * 0.5, yTop + r * 0.05, x1 - r * 0.08, yMid - r * 0.01);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(140,80,10,0.45)';
    ctx.lineWidth = Math.max(0.8, r * 0.04);
    ctx.beginPath();
    ctx.moveTo(x0 + r * 0.04, yMid + r * 0.03);
    ctx.lineTo(x1 - r * 0.04, yMid + r * 0.02);
    ctx.stroke();
  }

  function drawBird(ctx, type, x, y, r, angle, dim) {
    const t = BIRDS[type];
    const detail = r >= 16;
    ctx.save();
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    if (dim) ctx.globalAlpha = dim;
    ctx.rotate(Math.sin(Game.time * 4 + x * 0.02) * 0.02);

    const lx = LIGHT.x * r, ly = LIGHT.y * r;
    const round = type !== 'yellow' && type !== 'white';

    drawBirdTail(ctx, t, r);

    // 球面主体
    const bodyG = ctx.createRadialGradient(lx, ly, r * 0.08, 0, 0, r * 1.24);
    bodyG.addColorStop(0, shade(t.color, 0.46));
    bodyG.addColorStop(0.4, t.color);
    bodyG.addColorStop(0.76, shade(t.color, -0.15));
    bodyG.addColorStop(1, shade(t.color, -0.42));
    birdBodyPath(ctx, type, r);
    ctx.fillStyle = bodyG;
    ctx.fill();

    // 身体内部细节
    ctx.save();
    birdBodyPath(ctx, type, r);
    ctx.clip();

    if (detail) {
      const ao = ctx.createRadialGradient(r * 0.05, r * 0.78, r * 0.15, r * 0.05, r * 0.72, r * 1.3);
      ao.addColorStop(0, 'rgba(0,0,0,0.3)');
      ao.addColorStop(0.6, 'rgba(0,0,0,0.1)');
      ao.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ao;
      ctx.fillRect(-r * 1.6, -r * 1.6, r * 3.2, r * 3.2);
    }

    if (type !== 'yellow') {
      const bellyG = ctx.createLinearGradient(0, r * 0.02, 0, r * 0.92);
      bellyG.addColorStop(0, shade(t.belly, -0.18));
      bellyG.addColorStop(0.5, t.belly);
      bellyG.addColorStop(1, shade(t.belly, -0.1));
      ctx.fillStyle = bellyG;
      ctx.beginPath();
      ctx.ellipse(r * 0.08, r * 0.45, r * 0.6, r * 0.42, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
      ctx.lineWidth = Math.max(1, r * 0.05);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.beginPath();
      ctx.ellipse(r * 0.12, r * 0.46, r * 0.46, r * 0.27, 0.2, 0, TAU);
      ctx.fill();
    }

    // 高光
    const spec = ctx.createRadialGradient(lx * 0.85, ly * 0.85, r * 0.02, lx * 0.85, ly * 0.85, r * 0.6);
    spec.addColorStop(0, 'rgba(255,255,255,0.62)');
    spec.addColorStop(0.42, 'rgba(255,255,255,0.12)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec;
    ctx.fillRect(-r * 1.6, -r * 1.6, r * 3.2, r * 3.2);

    // 夜色冷光
    if (detail) {
      const bounce = ctx.createRadialGradient(r * 0.5, r * 0.74, r * 0.02, r * 0.5, r * 0.74, r * 0.85);
      bounce.addColorStop(0, 'rgba(150,190,255,0.15)');
      bounce.addColorStop(1, 'rgba(150,190,255,0)');
      ctx.fillStyle = bounce;
      ctx.fillRect(-r * 1.6, -r * 1.6, r * 3.2, r * 3.2);
    }
    ctx.restore();

    // 描边
    birdBodyPath(ctx, type, r);
    ctx.strokeStyle = shade(t.color, -0.52);
    ctx.lineWidth = Math.max(1.1, r * 0.055);
    ctx.stroke();

    // 边缘光
    if (round || type === 'white') {
      ctx.save();
      if (type === 'white') {
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.9, r * 1.07, 0, Math.PI * 0.94, Math.PI * 1.55);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.965, Math.PI * 0.94, Math.PI * 1.55);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = Math.max(1.3, r * 0.1);
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // 专属装饰
    if (type === 'ice') {
      ctx.strokeStyle = 'rgba(58,169,201,0.9)';
      ctx.lineWidth = Math.max(1.2, r * 0.05);
      const sx = r * 0.06, sy = r * 0.46, sr = r * 0.24;
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(sx - Math.cos(a) * sr, sy - Math.sin(a) * sr);
        ctx.lineTo(sx + Math.cos(a) * sr, sy + Math.sin(a) * sr);
        ctx.stroke();
      }
    } else if (type === 'bolt') {
      const bg = ctx.createLinearGradient(0, -r * 1.5, r * 0.42, -r * 0.86);
      bg.addColorStop(0, '#ffe98a');
      bg.addColorStop(1, '#eda200');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(-r * 0.12, -r * 1.02);
      ctx.lineTo(r * 0.22, -r * 1.5);
      ctx.lineTo(r * 0.16, -r * 1.18);
      ctx.lineTo(r * 0.42, -r * 1.14);
      ctx.lineTo(r * 0.02, -r * 0.86);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(150,90,0,0.45)';
      ctx.lineWidth = Math.max(0.7, r * 0.04);
      ctx.stroke();
    } else if (type === 'boomerang') {
      ctx.fillStyle = shade('#3f9e5c', 0.1);
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.ellipse(r * 0.12 + i * r * 0.2, -r * 0.95 + Math.abs(i) * r * 0.08,
          r * 0.1, r * 0.22, i * 0.5, 0, TAU);
        ctx.fill();
      }
    }

    if (type === 'black') {
      ctx.strokeStyle = '#6d6d78';
      ctx.lineWidth = Math.max(1.5, r * 0.12);
      ctx.beginPath();
      ctx.moveTo(r * 0.1, -r * 0.92);
      ctx.quadraticCurveTo(r * 0.32, -r * 1.4, r * 0.02, -r * 1.55);
      ctx.stroke();
      const spark = 0.7 + Math.sin(Game.time * 22) * 0.3;
      const sg = ctx.createRadialGradient(r * 0.02, -r * 1.58, 0, r * 0.02, -r * 1.58, r * 0.3);
      sg.addColorStop(0, 'rgba(255,240,180,' + spark + ')');
      sg.addColorStop(0.5, 'rgba(255,190,60,' + spark * 0.7 + ')');
      sg.addColorStop(1, 'rgba(255,150,40,0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(r * 0.02, -r * 1.58, r * 0.3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,250,210,0.95)';
      ctx.beginPath();
      ctx.arc(r * 0.02, -r * 1.58, r * 0.09, 0, TAU);
      ctx.fill();
    }

    // 眼睛
    const e1 = { x: r * 0.02, y: -r * 0.33 };
    const e2 = { x: r * 0.5, y: -r * 0.27 };
    const er = (type === 'blue' ? r * 0.3 : r * 0.27) * (type === 'big' ? 0.9 : 1);
    drawEye3D(ctx, e1.x, e1.y, er);
    drawEye3D(ctx, e2.x, e2.y, er * 0.96);

    // 眉毛
    ctx.strokeStyle = 'rgba(28,30,40,0.92)';
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(e1.x - er * 1.0, e1.y - er * 1.95);
    ctx.lineTo(e1.x + er * 0.9, e1.y - er * 1.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(e2.x - er * 0.9, e2.y - er * 1.15);
    ctx.lineTo(e2.x + er * 1.0, e2.y - er * 1.8);
    ctx.stroke();

    // 喙
    drawBeak3D(ctx, r, type === 'white' ? r * 0.16 : r * 0.08);

    if (type === 'white') {
      ctx.fillStyle = 'rgba(240,160,170,0.5)';
      ctx.beginPath();
      ctx.arc(-r * 0.36, r * 0.12, r * 0.16, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(r * 0.24, r * 0.14, r * 0.13, 0, TAU);
      ctx.fill();
    }

    // 小脚丫
    const footY = type === 'yellow' ? r * 0.88 : r * 0.97;
    const footX = type === 'yellow' ? r * 0.52 : r * 0.34;
    for (const sx of [-footX, footX]) {
      const fg2 = ctx.createRadialGradient(sx - r * 0.04, footY - r * 0.04, r * 0.01, sx, footY, r * 0.24);
      fg2.addColorStop(0, '#ffc76b');
      fg2.addColorStop(1, '#cf7b12');
      ctx.fillStyle = fg2;
      ctx.beginPath();
      ctx.ellipse(sx, footY, r * 0.2, r * 0.115, 0, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }

  // 颜色明暗
  function shade(hex, amt) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const num = parseInt(h, 16);
    let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    if (amt >= 0) {
      r = Math.round(r + (255 - r) * amt);
      g = Math.round(g + (255 - g) * amt);
      b = Math.round(b + (255 - b) * amt);
    } else {
      r = Math.round(r * (1 + amt));
      g = Math.round(g * (1 + amt));
      b = Math.round(b * (1 + amt));
    }
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function drawPig(ctx, p) {
    const r = p.r;
    const lx = LIGHT.x * r * 0.9, ly = LIGHT.y * r * 0.9;
    ctx.save();
    ctx.translate(p.x, p.y);

    // 地面投影（不随身体旋转）
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.94, r * 0.9, r * 0.26, 0, 0, TAU);
    ctx.fill();

    ctx.rotate(clamp(p.av * 0.05, -0.3, 0.3) + p.angle * 0.25);

    // 耳朵（球面渐变）
    for (const sgn of [-1, 1]) {
      const ex = sgn * r * 0.62, ey = -r * 0.7;
      const eg = ctx.createRadialGradient(ex - r * 0.08, ey - r * 0.12, r * 0.05, ex, ey, r * 0.36);
      eg.addColorStop(0, '#95e26c');
      eg.addColorStop(1, '#3d8722');
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.ellipse(ex, ey, r * 0.3, r * 0.34, sgn * 0.5, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(45,95,20,0.55)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(55,115,28,0.32)';
      ctx.beginPath();
      ctx.ellipse(ex, ey + r * 0.05, r * 0.15, r * 0.19, sgn * 0.5, 0, TAU);
      ctx.fill();
    }

    // 身体球面
    const bodyG = ctx.createRadialGradient(lx, ly, r * 0.12, 0, 0, r * 1.26);
    bodyG.addColorStop(0, '#cdf79f');
    bodyG.addColorStop(0.34, '#9be36b');
    bodyG.addColorStop(0.72, '#74c244');
    bodyG.addColorStop(1, '#3f7c20');
    ctx.fillStyle = bodyG;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();

    // 内部：底部压暗 + 高光
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.clip();

    const ao = ctx.createRadialGradient(0, r * 0.7, r * 0.15, 0, r * 0.62, r * 1.2);
    ao.addColorStop(0, 'rgba(18,58,8,0.34)');
    ao.addColorStop(1, 'rgba(18,58,8,0)');
    ctx.fillStyle = ao;
    ctx.fillRect(-r * 1.4, -r * 1.4, r * 2.8, r * 2.8);

    const spec = ctx.createRadialGradient(lx * 0.9, ly * 0.9, r * 0.03, lx * 0.9, ly * 0.9, r * 0.65);
    spec.addColorStop(0, 'rgba(255,255,255,0.52)');
    spec.addColorStop(0.4, 'rgba(255,255,255,0.1)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec;
    ctx.fillRect(-r * 1.4, -r * 1.4, r * 2.8, r * 2.8);

    // 夜色冷反射
    const bounce = ctx.createRadialGradient(r * 0.5, r * 0.72, r * 0.02, r * 0.5, r * 0.72, r * 0.8);
    bounce.addColorStop(0, 'rgba(150,190,255,0.14)');
    bounce.addColorStop(1, 'rgba(150,190,255,0)');
    ctx.fillStyle = bounce;
    ctx.fillRect(-r * 1.4, -r * 1.4, r * 2.8, r * 2.8);
    ctx.restore();

    // 轮廓 + 边缘光
    ctx.strokeStyle = 'rgba(45,95,20,0.85)';
    ctx.lineWidth = Math.max(1.3, r * 0.06);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = Math.max(1.2, r * 0.07);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.95, Math.PI * 0.95, Math.PI * 1.5);
    ctx.stroke();

    // 鼻子（凸起球面 + 凹陷鼻孔）
    const ny = r * 0.24;
    const sg = ctx.createRadialGradient(-r * 0.1, ny - r * 0.14, r * 0.04, 0, ny, r * 0.48);
    sg.addColorStop(0, '#c2f099');
    sg.addColorStop(0.55, '#93da63');
    sg.addColorStop(1, '#63b238');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.ellipse(0, ny, r * 0.42, r * 0.31, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(55,110,25,0.55)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    for (const nx of [-0.15, 0.15]) {
      ctx.fillStyle = 'rgba(38,78,18,0.8)';
      ctx.beginPath();
      ctx.ellipse(nx * r, ny, r * 0.075, r * 0.1, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.ellipse(nx * r, ny - r * 0.05, r * 0.055, r * 0.028, 0, 0, TAU);
      ctx.fill();
    }

    // 眼睛
    const bl = Math.sin(Game.time * 1.3 + p.blink) > 0.97 ? 0.1 : 1;
    drawEye3D(ctx, -r * 0.3, -r * 0.25, r * 0.19, bl);
    drawEye3D(ctx, r * 0.3, -r * 0.25, r * 0.19, bl);

    // 头盔 / 王冠
    if (p.variant === 'helmet') {
      const hg = ctx.createLinearGradient(-r, -r * 1.2, r, r * 0.05);
      hg.addColorStop(0, '#e6ecf3');
      hg.addColorStop(0.45, '#a9b4c1');
      hg.addColorStop(1, '#68737f');
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(0, -r * 0.1, r * 0.96, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(70,80,95,0.7)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, -r * 0.1, r * 0.96, Math.PI, 0);
      ctx.stroke();

      const rg = ctx.createLinearGradient(0, -r * 0.24, 0, 0);
      rg.addColorStop(0, '#c6cfda');
      rg.addColorStop(1, '#76818d');
      ctx.fillStyle = rg;
      roundRect(ctx, -r * 1.02, -r * 0.24, r * 2.04, r * 0.22, r * 0.11);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = Math.max(1.2, r * 0.09);
      ctx.beginPath();
      ctx.arc(0, -r * 0.1, r * 0.8, Math.PI * 1.06, Math.PI * 1.44);
      ctx.stroke();

      ctx.fillStyle = 'rgba(90,100,115,0.85)';
      ctx.beginPath(); ctx.arc(-r * 0.6, -r * 0.15, r * 0.07, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.6, -r * 0.15, r * 0.07, 0, TAU); ctx.fill();
    } else if (p.variant === 'king') {
      const cg = ctx.createLinearGradient(0, -r * 1.4, 0, -r * 0.6);
      cg.addColorStop(0, '#fff0a6');
      cg.addColorStop(0.5, '#ffcf3f');
      cg.addColorStop(1, '#d18f0d');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, -r * 0.64);
      ctx.lineTo(-r * 0.52, -r * 1.3);
      ctx.lineTo(-r * 0.16, -r * 0.88);
      ctx.lineTo(r * 0.2, -r * 1.36);
      ctx.lineTo(r * 0.54, -r * 0.86);
      ctx.lineTo(r * 0.84, -r * 1.24);
      ctx.lineTo(r * 0.8, -r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(160,110,10,0.75)';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.74);
      ctx.lineTo(-r * 0.5, -r * 1.16);
      ctx.stroke();

      const gem = ctx.createRadialGradient(-r * 0.04, -r * 1.0, r * 0.02, 0, -r * 0.94, r * 0.14);
      gem.addColorStop(0, '#ffb0b0');
      gem.addColorStop(1, '#bc2a2a');
      ctx.fillStyle = gem;
      ctx.beginPath();
      ctx.arc(0, -r * 0.94, r * 0.1, 0, TAU);
      ctx.fill();
    }

    // 受伤：绷带
    if (p.hp < p.maxHp * 0.6) {
      ctx.save();
      ctx.rotate(-0.5);
      const bg = ctx.createLinearGradient(-r * 0.12, -r * 1.05, r * 0.12, -r * 0.5);
      bg.addColorStop(0, 'rgba(255,255,255,0.98)');
      bg.addColorStop(1, 'rgba(214,214,206,0.98)');
      ctx.fillStyle = bg;
      roundRect(ctx, -r * 0.12, -r * 1.05, r * 0.24, r * 0.55, r * 0.08);
      ctx.fill();
      ctx.fillStyle = 'rgba(226,120,120,0.55)';
      roundRect(ctx, -r * 0.12, -r * 0.92, r * 0.24, r * 0.1, 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();

    // 命中闪白
    if (p.flash > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(p.flash * 5, 0, 0.85);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.02, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    // 冰冻
    if (p.frozen > 0) {
      ctx.globalAlpha = clamp(p.frozen * 0.8, 0, 0.55);
      ctx.fillStyle = '#c8f2ff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.03, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawBlock(ctx, b) {
    const m = b.mat;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    const w = b.w, h = b.h;
    const x = -w / 2, y = -h / 2;
    const dmg = 1 - clamp(b.hp / b.maxHp, 0, 1);

    ctx.globalAlpha = m.kind === 'glass' ? 0.92 : 1;

    if (m.kind === 'glass') {
      ctx.fillStyle = 'rgba(176,228,246,0.82)';
      roundRect(ctx, x, y, w, h, 3);
      ctx.fill();
      // 内部亮片
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(x + w * 0.2, y + 2);
      ctx.lineTo(x + w * 0.42, y + 2);
      ctx.lineTo(x + w * 0.2, y + h - 2);
      ctx.lineTo(x + w * 0.02, y + h - 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(120,200,230,0.35)';
      roundRect(ctx, x + w * 0.62, y + 2, Math.max(2, w * 0.1), h - 4, 2);
      ctx.fill();
      ctx.strokeStyle = '#5fa9c9';
      ctx.lineWidth = 2.4;
      roundRect(ctx, x, y, w, h, 3);
      ctx.stroke();
    } else if (m.kind === 'stone') {
      ctx.fillStyle = m.fill;
      roundRect(ctx, x, y, w, h, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      roundRect(ctx, x, y, w, Math.min(6, h * 0.12), 4);
      ctx.fill();
      const rnd = seeded(b.seed);
      ctx.fillStyle = 'rgba(80,90,100,0.25)';
      const n = Math.max(3, Math.floor(w * h / 900));
      for (let i = 0; i < n; i++) {
        const px = x + rnd() * w, py = y + rnd() * h;
        ctx.beginPath();
        ctx.arc(px, py, 1 + rnd() * 3, 0, TAU);
        ctx.fill();
      }
      ctx.strokeStyle = m.edge;
      ctx.lineWidth = 2;
      roundRect(ctx, x, y, w, h, 4);
      ctx.stroke();
    } else if (m.kind === 'tnt') {
      ctx.fillStyle = m.fill;
      roundRect(ctx, x, y, w, h, 4);
      ctx.fill();
      ctx.fillStyle = '#2b2b33';
      roundRect(ctx, x, y + h * 0.18, w, h * 0.62, 3);
      ctx.fill();
      ctx.fillStyle = '#ffe066';
      ctx.font = 'bold ' + Math.max(11, Math.min(w, h) * 0.34) + 'px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('TNT', 0, 0);
      ctx.strokeStyle = m.edge;
      ctx.lineWidth = 2;
      roundRect(ctx, x, y, w, h, 4);
      ctx.stroke();
    } else {
      ctx.fillStyle = m.fill;
      roundRect(ctx, x, y, w, h, 3);
      ctx.fill();
      // 木纹
      ctx.strokeStyle = 'rgba(120,74,32,0.35)';
      ctx.lineWidth = 1.3;
      const along = w >= h;
      const n = Math.floor((along ? h : w) / 9);
      for (let i = 1; i < n; i++) {
        ctx.beginPath();
        if (along) {
          const yy = y + (h / n) * i;
          ctx.moveTo(x + 3, yy); ctx.lineTo(x + w - 3, yy);
        } else {
          const xx = x + (w / n) * i;
          ctx.moveTo(xx, y + 3); ctx.lineTo(xx, y + h - 3);
        }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      roundRect(ctx, x, y, w, Math.min(5, h * 0.1), 3);
      ctx.fill();
      ctx.strokeStyle = m.edge;
      ctx.lineWidth = 2;
      roundRect(ctx, x, y, w, h, 3);
      ctx.stroke();
    }

    // 裂纹
    if (dmg > 0.15) {
      const rnd = seeded(b.seed + 7);
      const cracks = Math.min(6, 1 + Math.floor(dmg * 6));
      ctx.strokeStyle = 'rgba(60,45,30,' + (0.25 + dmg * 0.5) + ')';
      ctx.lineWidth = 1.6;
      for (let i = 0; i < cracks; i++) {
        let px = x + rnd() * w;
        let py = y + rnd() * h;
        ctx.beginPath();
        ctx.moveTo(px, py);
        for (let k = 0; k < 3; k++) {
          px += (rnd() - 0.5) * w * 0.4;
          py += (rnd() - 0.5) * h * 0.4;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }

    if (b.flash > 0) {
      ctx.globalAlpha = clamp(b.flash * 4.5, 0, 0.9);
      ctx.fillStyle = '#fff';
      roundRect(ctx, x, y, w, h, 3);
      ctx.fill();
    }
    if (b.frozen > 0) {
      ctx.globalAlpha = clamp(b.frozen * 0.8, 0, 0.55);
      ctx.fillStyle = '#c8f2ff';
      roundRect(ctx, x, y, w, h, 3);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ================= 绘制：世界 ================= */

  function drawParticles(ctx) {
    for (let i = 0; i < Game.particles.length; i++) {
      const p = Game.particles[i];
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = p.kind === 'dust' ? a * 0.75 : a;
      if (p.kind === 'dust') {
        ctx.fillStyle = p.color;
        circlePath(ctx, p.x, p.y, p.r * (0.6 + a * 0.6));
        ctx.fill();
      } else if (p.kind === 'star') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        drawSparkle(ctx, 0, 0, p.r * (0.5 + a * 0.8), 1, p.color);
        ctx.restore();
      } else if (p.kind === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, p.r * 0.5);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
        ctx.stroke();
      } else if (p.kind === 'shard') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(-p.r, -p.r * 0.5);
        ctx.lineTo(p.r, -p.r * 0.2);
        ctx.lineTo(-p.r * 0.2, p.r);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 'dash') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.r * 0.6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.06, p.y - p.vy * 0.06);
        ctx.stroke();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        roundRect(ctx, -p.r, -p.r * 0.72, p.r * 2, p.r * 1.44, 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        roundRect(ctx, -p.r, p.r * 0.15, p.r * 2, p.r * 0.55, 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawBolts(ctx) {
    for (let i = 0; i < Game.bolts.length; i++) {
      const bolt = Game.bolts[i];
      const a = clamp(bolt.t / 0.26, 0, 1);
      const rnd = seeded(Math.floor(bolt.seed) + 3);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.lineCap = 'round';
      ctx.beginPath();
      let y = bolt.y0;
      let x = bolt.x;
      ctx.moveTo(x, y);
      while (y < bolt.y1) {
        y += 16 + rnd() * 26;
        x = bolt.x + (rnd() - 0.5) * 46;
        ctx.lineTo(x, Math.min(y, bolt.y1));
      }
      ctx.strokeStyle = 'rgba(255,235,120,0.55)';
      ctx.lineWidth = 11;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,248,180,0.95)';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawTextPops(ctx) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < Game.textPops.length; i++) {
      const t = Game.textPops[i];
      const a = clamp(t.life / t.max, 0, 1);
      const sc = 1 + (1 - a) * 0.25;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(t.x, t.y);
      ctx.scale(sc, sc);
      ctx.font = 'bold 26px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(30,30,40,0.55)';
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /* ---- 待发小鸟排队（每只都有自己的等待动作） ---- */
  const WAIT_ANIM = {
    red: { kind: 'chew', sp: 2.2, amp: 2.0, ph: 0.0 },
    yellow: { kind: 'jump', sp: 3.2, amp: 12, ph: 0.9 },
    blue: { kind: 'shake', sp: 8.5, amp: 1.4, ph: 1.7 },
    black: { kind: 'bob', sp: 1.5, amp: 2.6, ph: 2.5 },
    white: { kind: 'stretch', sp: 1.8, amp: 0.06, ph: 3.2 },
    balloon: { kind: 'float', sp: 1.3, amp: 7, ph: 4.0 },
    big: { kind: 'bob', sp: 1.0, amp: 2.0, ph: 4.7 },
    ice: { kind: 'shake', sp: 4.2, amp: 1.2, ph: 5.3 },
    bolt: { kind: 'shake', sp: 11, amp: 1.6, ph: 6.1 },
    boomerang: { kind: 'hop', sp: 2.3, amp: 6, ph: 6.8 },
  };

  const CANDY_COLORS = ['#4aa8ff', '#ffd23f', '#f4f4ee'];

  function drawCandyShape(ctx, x, y, s, color, tilt) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.fillStyle = shade(color, -0.4);
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(dir * s * 0.5, 0);
      ctx.lineTo(dir * s * 1.2, -s * 0.36);
      ctx.lineTo(dir * s * 1.2, s * 0.36);
      ctx.closePath();
      ctx.fill();
    }
    const g = ctx.createRadialGradient(-s * 0.24, -s * 0.26, s * 0.06, 0, 0, s * 0.82);
    g.addColorStop(0, shade(color, 0.58));
    g.addColorStop(0.55, color);
    g.addColorStop(1, shade(color, -0.34));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.62, s * 0.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.beginPath();
    ctx.ellipse(-s * 0.18, -s * 0.18, s * 0.17, s * 0.1, -0.6, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // 红红的待机：吃糖，蓝/黄/白三色循环
  function drawCandyEat(ctx, r, seed) {
    const period = 3.6;
    const tt = Game.time + seed * 0.73;
    const p = (tt % period) / period;
    const idx = Math.floor(tt / period) % 3;
    const color = CANDY_COLORS[idx];
    const s = r * 0.62;
    let scale = 1;
    let cx = r * 1.16;
    let cy = r * 0.2;

    if (p < 0.1) {
      const k = p / 0.1;
      scale = 0.25 + k * 0.85;
      cy -= (1 - k) * r * 0.22;
    } else if (p < 0.56) {
      cx += Math.sin(tt * 5.2) * r * 0.03;
      cy += Math.sin(tt * 7.4) * r * 0.02;
    } else if (p < 0.86) {
      const k = (p - 0.56) / 0.3;
      scale = Math.max(0, 1 - k * 1.1);
      cx = r * (1.16 - k * 0.34);
      cy = r * (0.2 - k * 0.05);
    } else {
      return;
    }
    if (scale <= 0.02) return;
    drawCandyShape(ctx, cx, cy, s * scale, color, Math.sin(tt * 3) * 0.28);
  }

  function drawSparkle(ctx, x, y, r, alpha, color) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * 0.28;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 飞镖黄跳跃时脚下的星光
  function drawFeetStars(ctx, x, y, r, phase) {
    for (let i = 0; i < 4; i++) {
      const k = 0.5 + 0.5 * Math.sin(phase * 2.4 + i * 1.7);
      const ox = (i - 1.5) * r * 0.78 + Math.sin(phase + i) * 2.4;
      const oy = -Math.abs(Math.sin(phase * 2 + i)) * r * 0.5 + r * 0.2;
      const rr = 2.4 + k * 4.2;
      const glow = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rr * 2.6);
      glow.addColorStop(0, 'rgba(255,240,160,' + (0.5 * (0.4 + k * 0.6)).toFixed(2) + ')');
      glow.addColorStop(1, 'rgba(255,220,80,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, rr * 2.6, 0, TAU);
      ctx.fill();
      drawSparkle(ctx, x + ox, y + oy, rr, 0.55 + k * 0.45,
        i % 2 === 0 ? '#fffbe0' : '#ffd23f');
    }
  }

  function drawBirdQueue(ctx) {
    const start = Game.used + (Game.held ? 1 : 0);
    const list = Game.queue.slice(start);
    const n = list.length;
    if (!n) return;
    const rightX = 152;
    const spacing = n > 1 ? Math.min(34, 132 / (n - 1)) : 0;
    const leftX = rightX - spacing * (n - 1);
    const slide = Game.queueSlide || 0;
    const shift = spacing * slide * slide;

    for (let i = 0; i < n; i++) {
      const type = list[i];
      const t = BIRDS[type];
      const anim = WAIT_ANIM[type] || WAIT_ANIM.red;
      const phase = Game.time * anim.sp + anim.ph + i * 0.8;
      const r = clamp(t.r * 0.76, 11, 17);
      const x0 = leftX + spacing * i + shift;

      let dx = 0, dy = 0, rot = 0, sx = 1, sy = 1;
      const s = Math.sin(phase);
      if (anim.kind === 'bob') {
        dy = s * anim.amp;
      } else if (anim.kind === 'sway') {
        rot = s * anim.amp;
        dx = s * anim.amp * 8;
      } else if (anim.kind === 'shake') {
        dx = Math.sin(phase * 3) * anim.amp;
        dy = Math.abs(Math.sin(phase * 1.5)) * 1.4;
      } else if (anim.kind === 'stretch') {
        sy = 1 + s * anim.amp;
        sx = 1 - s * anim.amp * 0.55;
      } else if (anim.kind === 'float') {
        dy = -Math.abs(s) * anim.amp - 3;
      } else if (anim.kind === 'hop') {
        dy = -Math.abs(Math.sin(phase)) * anim.amp;
      } else if (anim.kind === 'chew') {
        const ch = Math.sin(phase * 4.2);
        dy = ch * 1.1;
        sy = 1 + ch * 0.026;
        sx = 1 - ch * 0.016;
      } else if (anim.kind === 'jump') {
        const j = Math.abs(Math.sin(phase));
        dy = -j * anim.amp;
        sy = 1 + j * 0.05;
        sx = 1 - j * 0.035;
        rot = Math.sin(phase * 2) * 0.06;
      }

      const x = x0 + dx;
      const y = GROUND_Y - r + dy;

      // 地面投影
      const lift = Math.max(0, GROUND_Y - r - y);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.3 - Math.min(0.16, lift * 0.02)).toFixed(2) + ')';
      ctx.beginPath();
      ctx.ellipse(x, GROUND_Y + 5, r * (1.02 - Math.min(0.3, lift * 0.02)), r * 0.28, 0, 0, TAU);
      ctx.fill();

      // 飞镖黄：跳跃时脚下星光（画在身体后面，从脚边透出来）
      if (type === 'yellow') drawFeetStars(ctx, x, y + r * 0.9 * sy, r, phase);

      // 排队时面朝右边（弓的方向）
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(sx, sy);
      drawBird(ctx, type, 0, 0, r, rot);
      if (type === 'red') drawCandyEat(ctx, r, i);
      ctx.restore();
    }
  }

  function drawWorld(ctx) {
    for (const b of Game.blocks) if (!b.dead) drawBlock(ctx, b);
    for (const p of Game.pigs) if (!p.dead) drawPig(ctx, p);
    for (const b of Game.activeBirds) {
      if (b.dead) continue;
      // 地面投影：高度越高越淡越小
      if (b.y < GROUND_Y + 20) {
        const hh = clamp((GROUND_Y - b.y) / 420, 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,' + (0.34 * (1 - hh * 0.72)).toFixed(2) + ')';
        ctx.beginPath();
        ctx.ellipse(b.x, GROUND_Y + 6, b.r * (1.3 - hh * 0.55), b.r * 0.3 * (1 - hh * 0.3), 0, 0, TAU);
        ctx.fill();
      }
      if (b.trail) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        for (let i = 0; i < b.trail.length; i += 2) {
          const q = b.trail[i];
          const a = (i / b.trail.length) * 0.5;
          ctx.globalAlpha = a;
          circlePath(ctx, q.x, q.y, 3 * (i / b.trail.length) + 1);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      const ang = Math.atan2(b.vy, b.vx);
      drawBird(ctx, b.btype, b.x, b.y, b.r, ang);
      if (b.balloon && b.floatT > 0) {
        const by = b.y - b.r - 28;
        ctx.strokeStyle = 'rgba(90,60,120,0.55)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y - b.r);
        ctx.lineTo(b.x, by + 13);
        ctx.stroke();
        const bg = ctx.createRadialGradient(b.x - 5, by - 6, 2, b.x, by, 17);
        bg.addColorStop(0, '#e9bdff');
        bg.addColorStop(1, '#9e52d6');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.ellipse(b.x, by, 13, 16, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.ellipse(b.x - 4, by - 6, 3.5, 5, -0.4, 0, TAU);
        ctx.fill();
      }
      // 技能可用提示
      const t = BIRDS[b.btype];
      if (t.ability && !b.abilityUsed && b.life > 0.12) {
        const pulse = 0.6 + Math.sin(Game.time * 9) * 0.4;
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.35 + pulse * 0.4) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 9 + pulse * 3, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,' + (0.55 + pulse * 0.35) + ')';
        ctx.font = 'bold 15px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('点击', b.x, b.y - b.r - 16);
      }
    }

    // 排队待发的小鸟
    drawBirdQueue(ctx);

    // 皮兜上的小鸟
    if (Game.held) {
      const pull = Math.hypot(Game.held.x - SLING.x, Game.held.y - SLING.y);
      const ang = Game.dragging ? Math.atan2(SLING.y - Game.held.y, SLING.x - Game.held.x) : 0;
      drawBird(ctx, Game.held.btype, Game.held.x, Game.held.y, BIRDS[Game.held.btype].r, ang);
      // 红红在弓上待机也吃糖
      if (Game.held.btype === 'red' && !Game.dragging) {
        ctx.save();
        ctx.translate(Game.held.x, Game.held.y);
        drawCandyEat(ctx, BIRDS.red.r, 0);
        ctx.restore();
      }
      if (pull > 20) {
        const p = clamp(pull / MAX_PULL, 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(Game.held.x, GROUND_Y + 6, 30 * p + 8, 7, 0, 0, TAU);
        ctx.fill();
      }
      // 小鸟说明
      const tt = BIRDS[Game.held.btype];
      const label = tt.name + ' · ' + tt.abilityName;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 15px "PingFang SC","Microsoft YaHei",sans-serif';
      const lw = (ctx.measureText(label).width || label.length * 15) + 28;
      ctx.fillStyle = 'rgba(30,44,64,0.5)';
      roundRect(ctx, SLING.x - lw / 2, 396, lw, 32, 16);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText(label, SLING.x, 413);
    }
  }

  /* ================= 绘制：HUD / 菜单 ================= */

  function addButton(id, x, y, w, h, label, style) {
    const b = { id, x, y, w, h, label, style: style || 'primary' };
    Game.buttons.push(b);
    return b;
  }

  function drawButton(ctx, b) {
    if (b.style === 'hit') return;   // 纯点击热区，不绘制
    const hover = Game.hover === b.id;
    ctx.save();
    if (b.style === 'icon') {
      ctx.fillStyle = hover ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.72)';
      circlePath(ctx, b.x + b.w / 2, b.y + b.h / 2, b.w / 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,60,80,0.22)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#37414f';
      ctx.font = 'bold ' + Math.round(b.h * 0.52) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    } else if (b.style === 'ghost') {
      ctx.fillStyle = hover ? 'rgba(44,62,86,0.78)' : 'rgba(28,42,62,0.6)';
      roundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + Math.round(b.h * 0.4) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    } else {
      const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      g.addColorStop(0, hover ? '#ffb43d' : '#ffa72e');
      g.addColorStop(1, hover ? '#f4771a' : '#e96a12');
      ctx.fillStyle = g;
      roundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + Math.round(b.h * 0.42) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 2);
    }
    ctx.restore();
  }

  function drawButtons(ctx) {
    for (const b of Game.buttons) drawButton(ctx, b);
  }

  function panel(ctx, x, y, w, h, r) {
    ctx.fillStyle = 'rgba(18,26,38,0.55)';
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawHUD(ctx) {
    ctx.save();

    // 分数
    panel(ctx, 22, 18, 232, 74, 16);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = 'bold 15px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('分数', 42, 40);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 34px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(String(Math.round(Game.shownScore)), 42, 70);

    // 关卡名
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = 'bold 20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.shadowColor = 'rgba(20,44,70,0.55)';
    ctx.shadowBlur = 8;
    ctx.fillText(LEVELS[Game.levelIndex].subtitle + ' · ' + LEVELS[Game.levelIndex].name, W / 2, 40);
    ctx.shadowBlur = 0;

    // 右上按钮
    addButton('retry', W - 168, 22, 44, 44, '↻', 'icon');
    addButton('mute', W - 112, 22, 44, 44, Game.muted ? '🔇' : '🔊', 'icon');
    addButton('menu', W - 56, 22, 44, 44, '☰', 'icon');
    drawButtons(ctx);

    // 剩余小鸟数量（小鸟本身在画面左侧排队）
    const left = Game.queue.length - Game.used;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 15px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.shadowColor = 'rgba(20,44,70,0.55)';
    ctx.shadowBlur = 6;
    ctx.fillText('待发小鸟 ' + left, 26, 106);
    ctx.shadowBlur = 0;

    // 底部提示
    ctx.textAlign = 'center';
    let hintText = '';
    if (Game.phase === 'ready' || Game.phase === 'aiming') {
      hintText = '按住小鸟向后拖 · 松手发射';
    } else if (Game.phase === 'flying') {
      const hasAbility = Game.activeBirds.some((b) => !b.dead && !b.abilityUsed && BIRDS[b.btype].ability);
      if (hasAbility) hintText = '点击屏幕触发技能';
    }
    if (hintText) {
      const a = clamp(Game.hintT * 1.6, 0, 1) * (0.7 + Math.sin(Game.time * 3) * 0.18);
      ctx.globalAlpha = a;
      ctx.font = 'bold 20px "PingFang SC","Microsoft YaHei",sans-serif';
      const tw = (ctx.measureText(hintText).width || hintText.length * 20) + 44;
      ctx.fillStyle = 'rgba(12,18,30,0.66)';
      roundRect(ctx, W / 2 - tw / 2, H - 70, tw, 44, 22);
      ctx.fill();
      ctx.strokeStyle = 'rgba(170,200,255,0.22)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillText(hintText, W / 2, H - 47);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* ---- 首页：红红带队冲锋 ---- */
  const MENU_ESCORTS = [
    ['yellow', -108, -78], ['blue', -146, 62], ['black', -206, -60],
    ['white', -238, 98], ['balloon', -292, -12], ['big', -318, 120],
    ['ice', -370, 34], ['bolt', -398, -96], ['boomerang', -428, 142],
  ];

  function drawChargeScene(ctx) {
    const t = Game.time;
    const redX = 512, redY = 372 + Math.sin(t * 1.9) * 7;

    // 冲锋光晕
    const halo = ctx.createRadialGradient(redX, redY, 24, redX, redY, 200);
    halo.addColorStop(0, 'rgba(255,120,90,0.16)');
    halo.addColorStop(0.5, 'rgba(255,120,90,0.05)');
    halo.addColorStop(1, 'rgba(255,120,90,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(redX, redY, 200, 0, TAU);
    ctx.fill();

    // 速度线
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < 20; i++) {
      const sp = 170 + (i % 6) * 80;
      const x = ((t * sp + i * 151) % (W + 360)) - 180;
      const y = 236 + ((i * 61) % 330);
      const len = 34 + (i % 5) * 26;
      const a = 0.04 + (i % 3) * 0.03;
      const g = ctx.createLinearGradient(x, y, x + len, y);
      g.addColorStop(0, 'rgba(200,220,255,0)');
      g.addColorStop(0.6, 'rgba(200,220,255,' + a + ')');
      g.addColorStop(1, 'rgba(200,220,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y);
      ctx.stroke();
    }
    ctx.restore();

    // 跟在后面的小鸟（次要，画得小一点）
    for (let i = 0; i < MENU_ESCORTS.length; i++) {
      const e = MENU_ESCORTS[i];
      const bx = redX + e[1] + Math.sin(t * 1.5 + i * 0.9) * 7;
      const by = redY + e[2] + Math.cos(t * 2.2 + i * 0.7) * 8;
      drawBird(ctx, e[0], bx, by, e[0] === 'big' ? 30 : 24,
        -0.1 + Math.sin(t * 2 + i) * 0.08);
    }

    // 红红（主角色，最大最靠前）
    drawBird(ctx, 'red', redX, redY, 60 + Math.sin(t * 3.1) * 1.5,
      -0.14 + Math.sin(t * 1.8) * 0.05);

    // 尾迹尘土
    for (let i = 0; i < 7; i++) {
      const k = (t * 1.1 + i * 0.32) % 1;
      const dx = redX - 72 - k * 150;
      const dy = redY + 44 + Math.sin((t + i) * 2) * 9;
      ctx.fillStyle = 'rgba(220,232,255,' + (0.15 * (1 - k)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(dx, dy, 4 + k * 13, 0, TAU);
      ctx.fill();
    }

    // 右边惊慌的猪
    const pigs = [[1010, 26], [1092, 22], [1168, 24]];
    for (let i = 0; i < pigs.length; i++) {
      const px = pigs[i][0], pr = pigs[i][1];
      const shake = Math.sin(t * 16 + i * 2.1) * 3;
      const hop = Math.abs(Math.sin(t * 3.2 + i * 1.4)) * 7;
      drawPig(ctx, {
        x: px + shake, y: GROUND_Y - pr - hop, r: pr,
        variant: 'normal', hp: 10, maxHp: 10, flash: 0, frozen: 0,
        blink: i * 2.3, av: 0, angle: 0,
      });
      const sx = px + (i % 2 ? 20 : -20);
      const sy = GROUND_Y - pr * 1.55 - hop - Math.abs(Math.sin(t * 5 + i)) * 5;
      ctx.fillStyle = 'rgba(160,220,255,0.85)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 2.6, 4.4, 0.3, 0, TAU);
      ctx.fill();
    }
  }

  function drawMenu(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 标题
    ctx.save();
    ctx.translate(W / 2, 82);
    ctx.translate(0, Math.sin(Game.time * 1.6) * 3);
    ctx.font = 'bold 78px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(120,60,10,0.85)';
    ctx.strokeText('愤怒的小鸟', 0, 0);
    const tg = ctx.createLinearGradient(0, -46, 0, 46);
    tg.addColorStop(0, '#ffd964');
    tg.addColorStop(1, '#f5871f');
    ctx.fillStyle = tg;
    ctx.fillText('愤怒的小鸟', 0, 0);
    ctx.restore();

    ctx.font = 'bold 21px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.shadowColor = 'rgba(10,20,40,0.6)';
    ctx.shadowBlur = 8;
    ctx.fillText('红红带队 · 10 只小鸟一起冲锋', W / 2, 150);
    ctx.shadowBlur = 0;

    drawChargeScene(ctx);

    // 唯一的按钮
    addButton('start', W / 2 - 120, 578, 240, 70, '开始游戏', 'primary');
    drawButtons(ctx);

    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = '15px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.restore();
  }

  /* ---- 每关开始前的出战介绍 ---- */
  function drawIntro(ctx) {
    const def = LEVELS[Game.introLevel] || LEVELS[0];
    ctx.save();
    ctx.fillStyle = 'rgba(4,8,16,0.6)';
    ctx.fillRect(0, 0, W, H);

    const birds = def.birds;
    const cols = Math.min(4, birds.length);
    const rows = Math.ceil(birds.length / cols);
    const cw = 210, chh = 100, gx = 12, gy = 12;
    const pw = 900;
    const ph = 150 + rows * chh + (rows - 1) * gy + 36 + 76;
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;
    ctx.fillStyle = 'rgba(20,30,46,0.96)';
    roundRect(ctx, px, py, pw, ph, 26);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,210,120,0.5)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd964';
    ctx.font = 'bold 40px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(def.subtitle, W / 2, py + 52);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 26px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(def.name, W / 2, py + 94);

    let pigs = 0;
    for (const p of def.parts) {
      if (p[0] === 'p' || p[0] === 'h' || p[0] === 'k') pigs++;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 16px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('本关出战 ' + def.birds.length + ' 只小鸟 · 场上 ' + pigs +
      ' 只猪 · 飞行中点击屏幕释放技能', W / 2, py + 132);

    const totalW = cols * cw + (cols - 1) * gx;
    const startX = (W - totalW) / 2;
    const startY = py + 150;

    for (let i = 0; i < birds.length; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const inRow = Math.min(cols, birds.length - row * cols);
      const rowOffset = (cols - inRow) * (cw + gx) / 2;
      const x = startX + rowOffset + col * (cw + gx);
      const y = startY + row * (chh + gy);
      const bt = BIRDS[birds[i]];

      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      roundRect(ctx, x, y, cw, chh, 14);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      drawBird(ctx, birds[i], x + 38, y + chh / 2, 24, 0);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(bt.name, x + 72, y + 30);
      ctx.fillStyle = 'rgba(255,235,180,0.92)';
      ctx.font = 'bold 13px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(bt.abilityName, x + 72, y + 55);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '12px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(bt.hint, x + 72, y + 78);
      ctx.textAlign = 'center';
    }

    addButton('fight', W / 2 - 210, py + ph - 76, 200, 58, '开始战斗', 'primary');
    addButton('introBack', W / 2 + 10, py + ph - 76, 180, 58, '返回选关', 'ghost');
    drawButtons(ctx);
    ctx.restore();
  }

  function drawLevels(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = 'bold 46px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(120,60,10,0.6)';
    ctx.strokeText('选择关卡', W / 2, 96);
    ctx.fillStyle = '#fff';
    ctx.fillText('选择关卡', W / 2, 96);

    const cw = 224, ch = 190, gapX = 20, gapY = 22;
    const cols = Math.min(5, LEVELS.length);
    const rows = Math.ceil(LEVELS.length / cols);
    const totalW = cols * cw + (cols - 1) * gapX;
    const sx = (W - totalW) / 2;
    const sy = rows > 1 ? 150 : 200;
    const prog = loadProgress();

    for (let i = 0; i < LEVELS.length; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const x = sx + col * (cw + gapX);
      const y = sy + row * (ch + gapY);
      const open = unlocked(i);
      const st = prog[i] || { stars: 0, score: 0 };
      const hover = Game.hover === 'level:' + i;

      ctx.fillStyle = open ? (hover ? 'rgba(60,80,110,0.82)' : 'rgba(30,44,64,0.72)') : 'rgba(20,26,36,0.6)';
      roundRect(ctx, x, y, cw, ch, 20);
      ctx.fill();
      ctx.strokeStyle = open ? 'rgba(255,214,120,0.85)' : 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.fillStyle = open ? '#ffd964' : 'rgba(255,255,255,0.35)';
      ctx.font = 'bold 22px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(LEVELS[i].subtitle, x + cw / 2, y + 32);
      ctx.fillStyle = open ? '#fff' : 'rgba(255,255,255,0.35)';
      ctx.font = 'bold 17px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText(LEVELS[i].name, x + cw / 2, y + 62);

      // 小鸟预览
      const bl = LEVELS[i].birds;
      const sp = bl.length > 5 ? 30 : 36;
      for (let k = 0; k < bl.length; k++) {
        ctx.globalAlpha = open ? 1 : 0.35;
        drawBird(ctx, bl[k], x + cw / 2 + (k - (bl.length - 1) / 2) * sp, y + 102, bl.length > 5 ? 12 : 14, 0);
        ctx.globalAlpha = 1;
      }

      // 星星
      for (let s = 0; s < 3; s++) {
        drawStar(ctx, x + cw / 2 - 36 + s * 36, y + 140, 13, 6, 5,
          s < st.stars ? '#ffd23f' : 'rgba(255,255,255,0.18)');
      }

      ctx.fillStyle = 'rgba(255,255,255,0.68)';
      ctx.font = 'bold 13px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('最高 ' + (st.score || 0), x + cw / 2, y + 170);

      if (!open) {
        ctx.fillStyle = 'rgba(0,0,0,0.46)';
        roundRect(ctx, x, y, cw, ch, 20);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 30px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.fillText('🔒', x + cw / 2, y + ch / 2 - 12);
        ctx.font = 'bold 13px "PingFang SC","Microsoft YaHei",sans-serif';
        ctx.fillText('先通关上一关', x + cw / 2, y + ch / 2 + 28);
      } else {
        Game.buttons.push({ id: 'level:' + i, x, y, w: cw, h: ch, label: '', style: 'hit' });
      }
    }

    addButton('back', W / 2 - 100, H - 74, 200, 54, '返回', 'ghost');
    drawButtons(ctx);
    ctx.restore();
  }

  function drawResult(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(10,16,26,0.55)';
    ctx.fillRect(0, 0, W, H);

    const pw = 620, ph = 440;
    const px = (W - pw) / 2, py = (H - ph) / 2 - 10;
    ctx.fillStyle = 'rgba(28,38,54,0.96)';
    roundRect(ctx, px, py, pw, ph, 28);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,210,120,0.7)';
    ctx.lineWidth = 3;
    ctx.stroke();

    const won = Game.phase === 'won';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 46px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = won ? '#ffd964' : '#ff8a80';
    ctx.fillText(won ? '过关！' : '差一点点…', W / 2, py + 68);

    for (let s = 0; s < 3; s++) {
      const filled = won && s < Game.stars;
      drawStar(ctx, W / 2 - 86 + s * 86, py + 146, 32, 14, 5,
        filled ? '#ffd23f' : 'rgba(255,255,255,0.16)');
      if (filled) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = 'bold 18px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('得分', W / 2, py + 202);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 52px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(String(Math.round(Game.shownScore)), W / 2, py + 250);

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 15px "PingFang SC","Microsoft YaHei",sans-serif';
    const t3 = (Game.starTargets || [0, 0, 0])[2];
    ctx.fillText('三星目标 ' + t3 + ' 分', W / 2, py + 292);

    if (won && Game.levelIndex + 1 < LEVELS.length) {
      addButton('retry', W / 2 - 226, py + ph - 96, 150, 58, '重玩', 'ghost');
      addButton('next', W / 2 - 52, py + ph - 96, 150, 58, '下一关', 'primary');
      addButton('back', W / 2 + 122, py + ph - 96, 150, 58, '选关', 'ghost');
    } else if (won) {
      addButton('retry', W / 2 - 226, py + ph - 96, 150, 58, '再玩一次', 'ghost');
      addButton('back', W / 2 - 52, py + ph - 96, 150, 58, '返回选关', 'primary');
    } else {
      addButton('retry', W / 2 - 226, py + ph - 96, 150, 58, '重试', 'primary');
      addButton('back', W / 2 - 52, py + ph - 96, 150, 58, '选关', 'ghost');
    }
    drawButtons(ctx);
    ctx.restore();
  }

  /* ================= 渲染总入口 ================= */

  function render() {
    const ctx = view.ctx;
    if (!ctx) return;
    Game.buttons.length = 0;

    const shake = Game.shake;
    const ox = shake > 0.3 ? rand(-shake, shake) : 0;
    const oy = shake > 0.3 ? rand(-shake, shake) : 0;

    ctx.save();
    ctx.translate(ox, oy);
    drawSky(ctx);
    if (Game.scene === 'play') {
      drawHills(ctx);
      drawGround(ctx);
      drawSlingBack(ctx);
      if (Game.world) drawWorld(ctx);
      drawParticles(ctx);
      drawBolts(ctx);
      drawSlingFront(ctx);
      drawTrajectory(ctx);
      drawTextPops(ctx);
    } else if (Game.scene === 'intro') {
      // 介绍页背后直接展示已经搭好的关卡
      drawHills(ctx);
      drawGround(ctx);
      drawSlingBack(ctx);
      if (Game.world) drawWorld(ctx);
      drawParticles(ctx);
      drawSlingFront(ctx);
    } else {
      drawHills(ctx);
      drawGround(ctx);
      drawParticles(ctx);
      drawTextPops(ctx);
    }
    ctx.restore();

    if (Game.scene === 'play') {
      drawHUD(ctx);
      if (Game.phase === 'won' || Game.phase === 'lost') drawResult(ctx);
    } else if (Game.scene === 'menu') {
      drawMenu(ctx);
    } else if (Game.scene === 'levels') {
      drawLevels(ctx);
    } else if (Game.scene === 'intro') {
      drawIntro(ctx);
    }

    // 技能闪光
    if (Game.abilityFlash > 0) {
      ctx.fillStyle = 'rgba(255,248,200,' + Math.min(0.16, Game.abilityFlash * 0.7) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ================= 主循环 ================= */

  let lastTs = 0;
  function frame(ts) {
    if (!lastTs) lastTs = (ts || 0) - 16;
    let dt = ((ts || 0) - lastTs) / 1000;
    lastTs = ts || 0;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.1) dt = 1 / 30;
    update(dt);
    Game.shownScore += (Game.score - Game.shownScore) * Math.min(1, dt * 8);
    if (Math.abs(Game.score - Game.shownScore) < 1) Game.shownScore = Game.score;
    for (const b of Game.blocks) if (b.flash > 0) b.flash -= dt;
    for (const p of Game.pigs) if (p.flash > 0) p.flash -= dt;
    render();
    if (root.requestAnimationFrame) root.requestAnimationFrame(frame);
  }

  function init(canvasEl) {
    const canvas = canvasEl || (root.document && root.document.getElementById('game'));
    if (!canvas) return false;
    setupCanvas(canvas);
    bindInput(canvas);
    ensureSky();
    Game.best = loadProgress();
    Game.scene = 'menu';
    applyQuery();
    render();
    if (root.requestAnimationFrame) root.requestAnimationFrame(frame);
    return true;
  }

  // 支持 ?level=1&fire=-100,26&steps=120&screen=levels 直接进入某状态（调试/截图用）
  function applyQuery() {
    let q = '';
    try { q = (root.location && root.location.search) || ''; } catch (e) { q = ''; }
    if (!q) return;
    if (/[?&]unlock=1/.test(q)) debugUnlockAll = true;
    const lv = /[?&]level=(\d+)/.exec(q);
    if (lv) {
      buildLevel(clamp(parseInt(lv[1], 10) || 0, 0, LEVELS.length - 1));
      const birdQ = /[?&]bird=(\w+)/.exec(q);
      if (birdQ && BIRDS[birdQ[1]]) {
        Game.queue[0] = birdQ[1];
        Game.used = 0;
        Game.held = null;
        spawnNextBird(true);
      }
      const fire = /[?&]fire=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(q);
      if (fire) Game.autoFire = { dx: parseFloat(fire[1]), dy: parseFloat(fire[2]), t: 0.5 };
      const ab = /[?&]ability=(\d+)/.exec(q);
      if (ab) Game.autoAbilityDelay = parseInt(ab[1], 10) / 60;
      else Game.autoAbilityDelay = null;
    }
    const scr = /[?&]screen=(\w+)/.exec(q);
    if (scr) {
      if (scr[1] === 'levels') Game.scene = 'levels';
      else if (scr[1] === 'intro') openIntro(Game.levelIndex);
      else if (scr[1] === 'won' || scr[1] === 'lost') {
        if (Game.scene !== 'play') buildLevel(0);
        Game.score = 28000; Game.shownScore = 28000; Game.stars = 3;
        Game.phase = scr[1];
      }
    }
    const steps = /[?&]steps=(\d+)/.exec(q);
    if (steps) {
      const n = clamp(parseInt(steps[1], 10) || 0, 0, 3000);
      for (let i = 0; i < n; i++) update(1 / 60);
      Game.shownScore = Game.score;
    }
  }

  // 供测试使用的单步推进
  function tick(dt) {
    update(dt);
    for (const b of Game.blocks) if (b.flash > 0) b.flash -= dt;
    for (const p of Game.pigs) if (p.flash > 0) p.flash -= dt;
    Game.shownScore += (Game.score - Game.shownScore) * Math.min(1, dt * 8);
  }

  const api = {
    init: init,
    tick: tick,
    update: update,
    render: render,
    Game: Game,
    LEVELS: LEVELS,
    BIRDS: BIRDS,
    buildLevel: buildLevel,
    launchBird: launchBird,
    spawnNextBird: spawnNextBird,
    useAbility: useAbility,
    updateDrag: updateDrag,
    onDown: onDown,
    onMove: onMove,
    onUp: onUp,
    slingPos: SLING,
    maxPull: MAX_PULL,
    launchPower: LAUNCH_POWER,
    _internals: {
      explode: explode,
      destroyBody: destroyBody,
      damageBody: damageBody,
      worldQuiet: worldQuiet,
      checkOutcome: checkOutcome,
      freezeBlast: freezeBlast,
      lightningStrike: lightningStrike,
      Sfx: Sfx,
    },
  };

  root.AngryBirds = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

