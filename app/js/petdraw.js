// 宠物绘制 + 动画状态机（主窗与悬浮窗共用）
// 两种渲染源：
//   1. agent-pet / Codex 格式精灵图集（8 列 × 9 行，每格 192×208），见 https://agent-pet.pages.dev
//   2. 内置矢量小牛（无资源依赖，作为兜底）
(function (global) {
  const CELL_W = 192, CELL_H = 208;

  // Codex atlas 行定义（行号 = 数组下标）
  const CODEX_ROWS = [
    { id: 'idle', frames: 6, fps: 6 },
    { id: 'running-right', frames: 8, fps: 8 },
    { id: 'running-left', frames: 8, fps: 8 },
    { id: 'waving', frames: 4, fps: 6 },
    { id: 'jumping', frames: 5, fps: 7 },
    { id: 'failed', frames: 8, fps: 7 },
    { id: 'waiting', frames: 6, fps: 6 },
    { id: 'running', frames: 6, fps: 8 },
    { id: 'review', frames: 6, fps: 6 },
  ];
  const ROW = {};
  CODEX_ROWS.forEach((r, i) => { ROW[r.id] = i; });

  // 宠物外观目录：前 5 个来自 codex-pets.net（agent-pet 官方目录），后 4 个为内置矢量
  const SPRITES = {
    guga:    { file: 'guga.webp',           name: '咕嘎', desc: '企鹅连帽衫', accent: '#7eb8da' },
    biscuit: { file: 'biscuit.webp',        name: '饼干', desc: '胖橘猫',     accent: '#c98b5e' },
    kitsune: { file: 'kitsune-spirit.webp', name: '月狐', desc: '九尾狐',     accent: '#d4783f' },
    cinder:  { file: 'ember-dragon.webp',   name: '余烬', desc: '小火龙',     accent: '#e0663c' },
    prism:   { file: 'crystal-kirin.webp',  name: '晶麟', desc: '水晶麒麟',   accent: '#8fc9e8' },
  };

  const PALETTES = {
    niulai: { body: '#ffffff', ink: '#2d2a30', horn: '#e8c494', pink: '#ff96aa', spot: '#343038', muzzle: '#ffe2e2' },
    mint:   { body: '#e8fff4', ink: '#1f3b32', horn: '#9fe0c0', pink: '#ff9ec4', spot: '#2e6b57', muzzle: '#f4fffa' },
    sakura: { body: '#fff0f6', ink: '#4a2338', horn: '#ffb3cf', pink: '#ff7aa8', spot: '#8a3d63', muzzle: '#fff7fb' },
    night:  { body: '#3a3a4a', ink: '#f2f2f8', horn: '#8d86b8', pink: '#ff8fb0', spot: '#1e1e2a', muzzle: '#4a4a5e' },
  };

  // 图集缓存：多个窗口 / 多个实例共享同一张解码后的图
  const sheetCache = new Map();
  function loadSheet(skin) {
    if (sheetCache.has(skin)) return sheetCache.get(skin);
    const meta = SPRITES[skin];
    const entry = { id: skin, meta, img: new Image(), ready: false, error: false };
    entry.img.onload = () => {
      entry.ready = true;
      // 格高恒为 208（=2288/11 或 1872/9），格宽恒为 192；行数可能 9 也可能 11，
      // 但前 9 行的语义固定，多出的行是额外视角，不用。
      entry.cw = entry.img.width / 8;
      entry.ch = CELL_H;
      entry.rows = Math.floor(entry.img.height / CELL_H);
    };
    entry.img.onerror = () => { entry.error = true; };
    entry.img.src = 'vendor/pets/' + meta.file;
    sheetCache.set(skin, entry);
    return entry;
  }
  function isSpriteSkin(skin) { return !!SPRITES[skin]; }
  function preloadAll() { Object.keys(SPRITES).forEach(loadSheet); }

  class PetCanvas {
    constructor(canvas, opts = {}) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = Math.min(2, global.devicePixelRatio || 1);
      this.size = opts.size || 96;
      this.palette = PALETTES[opts.skin] || PALETTES.niulai;
      this.sheet = null;
      this.x = opts.x || 0;
      this.y = opts.y || 0;
      this.vx = 0; this.vy = 0;
      this.tx = this.x; this.ty = this.y;
      this.state = 'idle';
      this.face = 1;
      this.t = 0;
      this.blink = 0;
      this.blinkAt = 60 + Math.random() * 120;
      this.hop = 0;
      this.squash = 0;
      this.hearts = [];
      this.levelFlash = 0;
      this.idleMove = 0;
      this.idleMoveAt = 180;
      this.mode = 'roam'; // roam | drag | fly | happy
      this.bubble = null;
      this.bounds = opts.bounds || { w: 800, h: 600 };
      this.flying = null; // {body, engine}
      this.setSkin(opts.skin || 'niulai');
      this.resize();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    resize() {
      const { cv, dpr } = this;
      const w = cv.clientWidth || cv.width / dpr, h = cv.clientHeight || cv.height / dpr;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.bounds = { w, h };
    }

    setSkin(skin) {
      this.skinId = skin;
      if (SPRITES[skin]) {
        this.sheet = loadSheet(skin);
        this.palette = PALETTES.niulai; // 精灵加载失败时用矢量兜底
      } else {
        this.sheet = null;
        this.palette = PALETTES[skin] || PALETTES.niulai;
      }
    }
    setSize(s) { this.size = s; }
    setPos(x, y) { this.x = this.tx = x; this.y = this.ty = y; }
    setState(s) { this.state = s; if (s === 'happy') { this.hop = 1; this.spawnHearts(6); } }

    /** 鼠标在窗口内时朝它跑，保持一段距离 */
    followMouse(mx, my, minDist = 90) {
      if (this.mode === 'drag' || this.mode === 'fly') return;
      if (this.restUntil && this.t < this.restUntil) return;
      const dx = mx - this.x, dy = my - this.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < minDist) { this.state = this.state === 'happy' ? 'happy' : 'idle'; return; }
      this.tx = mx - dx / d * minDist;
      this.ty = my - dy / d * minDist;
      this.face = dx >= 0 ? 1 : -1;
      if (this.state !== 'happy') this.state = 'walk';
    }

    idleAt(x, y) { this.tx = x; this.ty = y; this.state = 'idle'; }

    spawnHearts(n = 5) {
      for (let i = 0; i < n; i++) {
        this.hearts.push({
          x: this.x + (Math.random() - 0.5) * 30,
          y: this.y - this.size * 0.4,
          vy: -0.8 - Math.random() * 0.8,
          vx: (Math.random() - 0.5) * 0.8,
          life: 1, s: 6 + Math.random() * 6,
        });
      }
    }
    celebrate() { this.levelFlash = 1; this.spawnHearts(14); }

    // ---- 弹弓飞行（Matter.js）----
    launch(vx, vy, bounds) {
      if (!global.Matter) return false;
      const { Engine, Bodies, Composite, Body } = global.Matter;
      const eng = Engine.create({ gravity: { x: 0, y: 0.9 } });
      const opt = { isStatic: true, restitution: 0.55, friction: 0 };
      const W = bounds.w, H = bounds.h;
      Composite.add(eng.world, [
        Bodies.rectangle(W / 2, -30, W * 2, 60, opt),
        Bodies.rectangle(W / 2, H + 30, W * 2, 60, opt),
        Bodies.rectangle(-30, H / 2, 60, H * 2, opt),
        Bodies.rectangle(W + 30, H / 2, 60, H * 2, opt),
      ]);
      const r = this.size * 0.42;
      const body = Bodies.circle(this.x, this.y, r, { restitution: 0.6, frictionAir: 0.02, density: 0.002 });
      Composite.add(eng.world, body);
      Body.setVelocity(body, { x: vx, y: vy });
      this.flying = { eng, body, frames: 0, still: 0 };
      this.mode = 'fly';
      this.state = 'fly';
      return true;
    }

    hitTest(mx, my, pad = 12) {
      const r = this.size * 0.5 + pad;
      return Math.hypot(mx - this.x, my - this.y) < r;
    }

    loop() {
      try { this.tick(); } catch (e) {
        // 单帧异常不能让整个动画循环停掉
        console.error('[pet] frame error', e);
        this.mode = 'roam';
        this.flying = null;
        this.state = 'idle';
        if (!Number.isFinite(this.x)) this.x = this.bounds.w - 120;
        if (!Number.isFinite(this.y)) this.y = this.bounds.h - 130;
        this.tx = this.x; this.ty = this.y;
      }
      requestAnimationFrame(this.loop);
    }

    tick() {
      this.t++;
      const c = this.ctx, { w, h } = this.bounds;

      // ---- 物理更新 ----
      if (this.mode === 'fly' && this.flying) {
        const { Engine } = global.Matter;
        Engine.update(this.flying.eng, 1000 / 60);
        const p = this.flying.body.position;
        this.x = p.x; this.y = p.y;
        this.vx = this.flying.body.velocity.x;
        this.vy = this.flying.body.velocity.y;
        this.face = this.vx >= 0 ? 1 : -1;
        const speed = Math.hypot(this.vx, this.vy);
        this.flying.still = speed < 0.35 ? this.flying.still + 1 : 0;
        this.flying.frames++;
        if ((this.flying.still > 12 || this.flying.frames > 300) && this.mode === 'fly') {
          this.mode = 'roam';
          this.state = 'idle';
          this.flying = null;
          // 落地后停留在落点附近，不要立刻被鼠标跟随拉走
          this.tx = this.x; this.ty = this.y;
          this.restUntil = this.t + 90;
          this.spawnHearts(4);
        }
      } else if (this.mode === 'roam') {
        const dx = this.tx - this.x, dy = this.ty - this.y;
        const d = Math.hypot(dx, dy);
        if (d > 1.5) {
          const sp = this.state === 'walk' ? 0.16 : 0.09;
          this.x += dx * sp;
          this.y += dy * sp;
          if (Math.abs(dx) > 1) this.face = dx >= 0 ? 1 : -1;
          if (d < 40) this.state = 'idle';
        }
        this.x = Math.max(this.size * 0.5, Math.min(w - this.size * 0.5, this.x));
        this.y = Math.max(this.size * 0.6, Math.min(h - this.size * 0.5, this.y));
      }

      // ---- 眨眼 ----
      if (--this.blinkAt <= 0) { this.blink = 1; this.blinkAt = 90 + Math.random() * 180; }
      if (this.blink > 0) this.blink = Math.max(0, this.blink - 0.12);

      // ---- 闲置小动作 ----
      if (this.mode === 'roam' && this.state === 'idle' && --this.idleMoveAt <= 0) {
        this.idleMove = 60 + Math.random() * 40;
        this.idleMoveAt = 300 + Math.random() * 300;
        this.idleKind = Math.floor(Math.random() * 3);
      }
      if (this.idleMove > 0) this.idleMove--;

      if (this.hop > 0) this.hop = Math.max(0, this.hop - 0.045);
      if (this.squash > 0) this.squash = Math.max(0, this.squash - 0.06);
      if (this.levelFlash > 0) this.levelFlash = Math.max(0, this.levelFlash - 0.012);

      // ---- 爱心 ----
      this.hearts = this.hearts.filter(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.01; p.life -= 0.012;
        return p.life > 0;
      });

      c.clearRect(0, 0, w, h);
      this.draw();
      this.drawOverlay();
    }

    // 精灵图可用则用图集，否则回退矢量
    draw() {
      const s = this.sheet;
      if (s && s.ready && !s.error) this.drawSprite(s);
      else this.drawVector();
    }

    rowForSprite() {
      const st = this.state;
      if (this.mode === 'drag') return ROW.waving;
      if (st === 'happy' || st === 'fly') return ROW.jumping;
      if (st === 'walk') return this.face >= 0 ? ROW['running-right'] : ROW['running-left'];
      if (st === 'sleep') return ROW.waiting;
      return ROW.idle;
    }

    drawSprite(sheet) {
      const c = this.ctx, S = this.size;
      const walking = this.state === 'walk';
      const bob = Math.sin(this.t * (walking ? 0.35 : 0.12)) * (walking ? 2 : 1);
      const hopY = -Math.sin(this.hop * Math.PI) * 26;
      const tilt = walking ? Math.sin(this.t * 0.35) * 0.04 : Math.sin(this.t * 0.12) * 0.015;

      const row = this.rowForSprite();
      const def = CODEX_ROWS[row];
      const frame = Math.floor(this.t * (def.fps / 60)) % def.frames;
      const cw = sheet.cw || CELL_W, ch = sheet.ch || CELL_H;

      const dw = S, dh = S * (ch / cw);

      c.save();
      c.translate(this.x, this.y + bob + hopY);
      c.rotate(tilt);
      // running-left 行本身朝左，其余行按 face 镜像
      const mirror = (row !== ROW['running-left'] && this.face < 0) ? -1 : 1;
      c.scale(mirror, 1);
      c.drawImage(
        sheet.img,
        frame * cw, row * ch, cw, ch,
        -dw / 2, -dh / 2, dw, dh
      );
      c.restore();
    }

    drawVector() {
      const c = this.ctx, P = this.palette;
      const t = this.t;
      const walking = this.state === 'walk';
      const bob = Math.sin(t * (walking ? 0.35 : 0.12)) * (walking ? 3 : 1.5);
      const hopY = -Math.sin(this.hop * Math.PI) * 26;
      const tilt = walking ? Math.sin(t * 0.35) * 0.05 : Math.sin(t * 0.12) * 0.02;
      const sq = 1 + this.hop * 0.12 - this.squash * 0.1;

      c.save();
      c.translate(this.x, this.y + bob + hopY);
      c.rotate(tilt);
      c.scale(this.face * sq, sq);

      const S = this.size;

      // 影子
      c.save();
      c.globalAlpha = 0.12;
      c.fillStyle = '#000';
      c.beginPath();
      c.ellipse(0, S * 0.52 - bob * 0.5, S * 0.34, S * 0.08, 0, 0, 7);
      c.fill();
      c.restore();

      // 角
      c.fillStyle = P.horn;
      [[-0.32, -0.34], [0.32, -0.34]].forEach(([ex, ey]) => {
        c.beginPath();
        c.ellipse(ex * S, ey * S, S * 0.085, S * 0.13, ex * 0.35, 0, 7);
        c.fill();
      });

      // 耳朵
      c.fillStyle = P.body;
      [[-0.36, -0.14], [0.36, -0.14]].forEach(([ex, ey]) => {
        c.beginPath();
        c.ellipse(ex * S, ey * S, S * 0.16, S * 0.11, ex * 0.5, 0, 7);
        c.fill();
      });

      // 身体
      c.beginPath();
      c.ellipse(0, 0, S * 0.46, S * 0.44, 0, 0, 7);
      c.fillStyle = P.body;
      c.fill();

      // 斑点
      c.fillStyle = P.spot;
      c.beginPath(); c.ellipse(-S * 0.14, -S * 0.17, S * 0.11, S * 0.09, -0.4, 0, 7); c.fill();
      c.beginPath(); c.ellipse(S * 0.2, S * 0.03, S * 0.07, S * 0.055, 0.3, 0, 7); c.fill();

      // 嘴部
      c.fillStyle = P.muzzle;
      c.beginPath(); c.ellipse(0, S * 0.22, S * 0.26, S * 0.18, 0, 0, 7); c.fill();
      c.fillStyle = P.ink;
      c.beginPath(); c.ellipse(-S * 0.075, S * 0.2, S * 0.028, S * 0.04, 0, 0, 7); c.fill();
      c.beginPath(); c.ellipse(S * 0.075, S * 0.2, S * 0.028, S * 0.04, 0, 0, 7); c.fill();

      // 眼睛
      const blinkK = this.blink;
      const eyeH = S * 0.075 * (1 - blinkK * 0.95);
      const eyeY = -S * 0.06;
      const angry = this.state === 'fly' && Math.hypot(this.vx, this.vy) > 6;
      c.fillStyle = P.ink;
      [-0.15, 0.15].forEach(ex => {
        c.beginPath();
        c.ellipse(ex * S, eyeY, S * 0.062, Math.max(1, eyeH), 0, 0, 7);
        c.fill();
      });
      if (blinkK < 0.4) {
        c.fillStyle = '#fff';
        [-0.15, 0.15].forEach(ex => {
          c.beginPath(); c.ellipse(ex * S + S * 0.018, eyeY - S * 0.025, S * 0.018, S * 0.022, 0, 0, 7); c.fill();
        });
      }
      if (angry) {
        c.strokeStyle = P.ink; c.lineWidth = S * 0.022; c.lineCap = 'round';
        [-1, 1].forEach(s => {
          c.beginPath();
          c.moveTo(s * S * 0.08, -S * 0.16);
          c.lineTo(s * S * 0.21, -S * 0.13);
          c.stroke();
        });
      }

      // 腮红
      c.globalAlpha = 0.5;
      c.fillStyle = P.pink;
      [-0.28, 0.28].forEach(ex => {
        c.beginPath(); c.ellipse(ex * S, S * 0.11, S * 0.06, S * 0.04, 0, 0, 7); c.fill();
      });
      c.globalAlpha = 1;

      c.restore();
    }

    // 爱心 / 升级光环：两种渲染源共用
    drawOverlay() {
      const c = this.ctx;

      this.hearts.forEach(p => {
        c.save();
        c.globalAlpha = Math.max(0, p.life);
        c.fillStyle = '#ff5b7f';
        c.translate(p.x, p.y);
        const s = p.s * p.life;
        c.beginPath();
        c.moveTo(0, s * 0.3);
        c.bezierCurveTo(-s, -s * 0.35, -s * 0.45, -s, 0, -s * 0.4);
        c.bezierCurveTo(s * 0.45, -s, s, -s * 0.35, 0, s * 0.3);
        c.fill();
        c.restore();
      });

      if (this.levelFlash > 0) {
        c.save();
        c.globalAlpha = this.levelFlash * 0.7;
        c.strokeStyle = '#ffcf4d';
        c.lineWidth = 3;
        c.beginPath();
        c.arc(this.x, this.y, this.size * (0.5 + (1 - this.levelFlash) * 0.9), 0, 7);
        c.stroke();
        c.restore();
      }
    }
  }

  /** 设置面板用：把某只宠物的静态缩略图（idle 第 0 帧）画到 canvas 上 */
  function drawPetPreview(canvas, skin, size) {
    const dpr = 2;
    const ctx = canvas.getContext('2d');
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    if (isSpriteSkin(skin)) {
      const sheet = loadSheet(skin);
      const paint = () => {
        const cw = sheet.cw, ch = sheet.ch;
        const dh = size * (ch / cw);
        const dw = size;
        // 精灵图整格是 192×208，略小于正方形，按高度居中即可
        ctx.drawImage(sheet.img, 0, 0, cw, ch, (size - dw) / 2, (size - dh) / 2, dw, dh);
      };
      if (sheet.ready) paint();
      else sheet.img.addEventListener('load', paint, { once: true });
      return;
    }
    // 矢量小牛简版
    const P = PALETTES[skin] || PALETTES.niulai;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.scale(size / 52, size / 52);
    ctx.fillStyle = P.horn;
    ctx.beginPath(); ctx.ellipse(-8, -9, 2.4, 3.4, -0.3, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8, -9, 2.4, 3.4, 0.3, 0, 7); ctx.fill();
    ctx.fillStyle = P.body;
    ctx.beginPath(); ctx.ellipse(-9, -3.6, 4.2, 2.9, -0.5, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(9, -3.6, 4.2, 2.9, 0.5, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 0, 12, 11.5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = P.spot;
    ctx.beginPath(); ctx.ellipse(-3.6, -4.4, 2.9, 2.4, -0.4, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5.2, 0.8, 1.8, 1.4, 0.3, 0, 7); ctx.fill();
    ctx.fillStyle = P.muzzle;
    ctx.beginPath(); ctx.ellipse(0, 5.7, 6.8, 4.7, 0, 0, 7); ctx.fill();
    ctx.fillStyle = P.ink;
    ctx.beginPath(); ctx.ellipse(-2, 5.2, 0.75, 1.05, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(2, 5.2, 0.75, 1.05, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-3.9, -1.6, 1.6, 2, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(3.9, -1.6, 1.6, 2, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(-3.4, -2.3, 0.47, 0.57, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4.4, -2.3, 0.47, 0.57, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = .5; ctx.fillStyle = P.pink;
    ctx.beginPath(); ctx.ellipse(-7.3, 2.9, 1.6, 1.05, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(7.3, 2.9, 1.6, 1.05, 0, 0, 7); ctx.fill();
    ctx.restore();
  }

  global.PetCanvas = PetCanvas;
  global.PET_PALETTES = PALETTES;
  global.PET_SPRITES = SPRITES;
  global.PET_SKIN_LIST = [
    ...Object.keys(SPRITES).map(id => ({ id, ...SPRITES[id], source: 'agent-pet' })),
    { id: 'niulai', name: '小牛', desc: '内置', accent: '#e8c494', source: 'builtin' },
    { id: 'mint', name: '薄荷', desc: '内置', accent: '#9fe0c0', source: 'builtin' },
    { id: 'sakura', name: '樱花', desc: '内置', accent: '#ffb3cf', source: 'builtin' },
    { id: 'night', name: '暗夜', desc: '内置', accent: '#8d86b8', source: 'builtin' },
  ];
  global.drawPetPreview = drawPetPreview;
  global.preloadPetSkins = preloadAll;
})(window);
