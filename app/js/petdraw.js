// 宠物绘制 + 动画状态机（主窗、悬浮窗共用）
// 渲染源：agent-pet / Codex 格式精灵图集（8 列 × 9 或 11 行，每格 192×208）
// 图集加载失败时退回 drawVector 的矢量占位形象。
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

  const DEFAULT_SKIN = 'xiaoxin';

  // 宠物外观目录：全部来自 agent-pet 官方图集（codex-pets.net/assets/pets）
  // 前 5 只为新版外观，后 5 只为旧版外观（按用户要求重新并入）。
  // topR：idle 第 0 帧可见像素顶端在单元格里的比例（实测得到），
  // 用于把对话气泡精准贴到头顶 —— 各只宠物头顶留白差别很大。
  const SPRITES = {
    xiaoxin:  { file: 'xiaoxin.webp',        name: '蜡笔小新', desc: 'Crayon Shin-chan', accent: '#e8433f', topR: 0.024 },
    anon:     { file: 'anon.webp',           name: '阿诺',     desc: 'Anon',             accent: '#e58fb0', topR: 0.024 },
    momoco:   { file: 'momoco.webp',         name: '莫莫可',   desc: 'Momoco',           accent: '#f0a0b8', topR: 0.1635 },
    labubu:   { file: 'labubu-classic.webp', name: '拉布布',   desc: 'Labubu',           accent: '#8a5a3c', topR: 0.024 },
    hanabi:   { file: 'hanabi.webp',         name: '花火',     desc: 'Hanabi',           accent: '#d84a4a', topR: 0.024 },
    guga:     { file: 'guga.webp',           name: '咕嘎',     desc: '企鹅连帽衫',       accent: '#3a7bd5', topR: 0.024 },
    biscuit:  { file: 'biscuit.webp',        name: '饼干',     desc: '胖橘猫',           accent: '#c9822f', topR: 0.226 },
    kitsune:  { file: 'kitsune-spirit.webp', name: '月狐',     desc: '九尾狐',           accent: '#e6a15c', topR: 0.0385 },
    ember:    { file: 'ember-dragon.webp',   name: '余烬',     desc: '小火龙',           accent: '#ff8a3d', topR: 0.0337 },
    prism:    { file: 'crystal-kirin.webp',  name: '晶麟',     desc: '水晶麒麟',         accent: '#7ea0ff', topR: 0.0385 },
  };

  // 每只宠物一种气泡样式（pixel = 星露谷式像素气泡）
  const BUBBLE_THEMES = {
    xiaoxin: { kind: 'pixel',  bg: '#fffdf2', fg: '#33261f', bd: '#2f231d', accent: '#e8433f' },
    guga:    { kind: 'pixel',  bg: '#eef7ff', fg: '#1f2b38', bd: '#243447', accent: '#3a7bd5' },
    biscuit: { kind: 'pixel',  bg: '#fff6e3', fg: '#3d2b1f', bd: '#4a3323', accent: '#c9822f' },
    momoco:  { kind: 'pixel',  bg: '#fff0f7', fg: '#3d2333', bd: '#4a2a3c', accent: '#f0a0b8' },
    anon:    { kind: 'round',  bg: '#ffffff', fg: '#26233a', bd: 'rgba(0,0,0,.09)', accent: '#e58fb0' },
    labubu:  { kind: 'round',  bg: '#fdf8f2', fg: '#33281f', bd: 'rgba(0,0,0,.09)', accent: '#8a5a3c' },
    hanabi:  { kind: 'sharp',  bg: '#fff5f5', fg: '#3a1f22', bd: '#d84a4a', accent: '#d84a4a' },
    kitsune: { kind: 'ornate', bg: '#fff8ee', fg: '#3a2a1e', bd: '#e6a15c', accent: '#e6a15c' },
    ember:   { kind: 'ornate', bg: '#fff4ea', fg: '#3a221a', bd: '#ff8a3d', accent: '#ff8a3d' },
    prism:   { kind: 'ornate', bg: '#f4f7ff', fg: '#222a45', bd: '#7ea0ff', accent: '#7ea0ff' },
  };

  // 仅用于图集加载失败时的矢量占位（不作为可选外观）
  const PALETTES = {
    niulai: { body: '#ffffff', ink: '#2d2a30', horn: '#e8c494', pink: '#ff96aa', spot: '#343038', muzzle: '#ffe2e2' },
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
      entry.w = entry.img.width;
      entry.h = entry.img.height;
    };
    entry.img.onerror = () => { entry.error = true; };
    entry.img.src = 'vendor/pets/' + meta.file;
    sheetCache.set(skin, entry);
    return entry;
  }
  function isSpriteSkin(skin) { return !!SPRITES[skin]; }
  function preloadAll() { Object.keys(SPRITES).forEach(loadSheet); }
  function bubbleTheme(skin) { return BUBBLE_THEMES[skin] || BUBBLE_THEMES[DEFAULT_SKIN]; }

  /** 把气泡元素套上对应宠物的皮肤（主窗与悬浮气泡窗共用） */
  function styleBubble(el, skin) {
    const t = bubbleTheme(skin);
    el.classList.remove('pixel', 'round', 'sharp', 'ornate');
    el.classList.add('pd-bub', t.kind);
    el.style.setProperty('--pd-bg', t.bg);
    el.style.setProperty('--pd-fg', t.fg);
    el.style.setProperty('--pd-bd', t.bd);
    el.style.setProperty('--pd-accent', t.accent);
    el.dataset.skin = skin;
    return t;
  }

  class PetCanvas {
    constructor(canvas, opts = {}) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = Math.min(2, global.devicePixelRatio || 1);
      this.size = opts.size || 96;
      this.palette = PALETTES.niulai;
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
      // 长按不再放大：不再有 press/pressT 字段，绘制里也不乘缩放系数
      this.hearts = [];
      this.levelFlash = 0;
      this.idleMove = 0;
      this.idleMoveAt = 180;
      this.idleKind = 0;
      this.mode = 'roam'; // roam | drag | fly
      this.bounds = opts.bounds || { w: 800, h: 600 };
      this.flying = null;
      this.restUntil = 0;
      this.moving = false;
      // 行走速度：像素 / 秒（设置面板滑杆调节）
      this.speed = opts.speed || 280;
      this.lv = 1;
      this.xpRatio = 0;
      this.showProgress = opts.showProgress !== false;
      this._last = 0;
      this.setSkin(opts.skin || DEFAULT_SKIN);
      this.resize();
      this.loop = this.loop.bind(this);
      this._raf = requestAnimationFrame(this.loop);
    }

    destroy() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }

    resize() {
      const { cv, dpr } = this;
      const w = cv.clientWidth || cv.width / dpr, h = cv.clientHeight || cv.height / dpr;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.bounds = { w, h };
    }

    setSkin(skin) {
      this.skinId = SPRITES[skin] ? skin : DEFAULT_SKIN;
      this.sheet = loadSheet(this.skinId);
      return this.skinId;
    }
    setSize(s) { this.size = s; }
    /** 长按不再放大（保留空实现，兼容旧调用） */
    setPress() {}
    /** v: 1..10（设置里的滑杆）-> 105..555 px/s */
    setSpeedLevel(v) {
      const n = Math.max(1, Math.min(10, Number(v) || 5));
      this.speed = 60 + n * 45;
    }
    setPos(x, y) { this.x = this.tx = x; this.y = this.ty = y; }
    setState(s) { this.state = s; if (s === 'happy') { this.hop = 0; this.spawnHearts(6); } }

    /** 等级 + 能量条（画在宠物脚下，跟随宠物） */
    setProgress(lv, ratio) {
      this.lv = lv || 1;
      this.xpRatio = Math.max(0, Math.min(1, ratio || 0));
    }

    /** 宠物头顶（图集可见内容的顶部）在画布上的 y，用于气泡定位 */
    headTop() {
      const s = SPRITES[this.skinId] || SPRITES[DEFAULT_SKIN];
      const topR = typeof s.topR === 'number' ? s.topR : 0.07;
      // dh 是整格高度；可见头顶 = 中心 - 半格 + 格高*topR
      const dh = this.size * (CELL_H / CELL_W);
      return this.y - dh * 0.5 + dh * topR;
    }

    /** 鼠标在窗口内时朝它走，保持一段距离（恒速，不瞬移） */
    followMouse(mx, my, minDist = 90) {
      if (this.mode === 'drag' || this.mode === 'fly') return;
      if (this.restUntil && this.t < this.restUntil) return;
      const dx = mx - this.x, dy = my - this.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < minDist) {
        this.tx = this.x; this.ty = this.y;
        return;
      }
      this.tx = mx - dx / d * minDist;
      this.ty = my - dy / d * minDist;
    }

    idleAt(x, y) { this.tx = x; this.ty = y; if (this.mode === 'roam') this.state = 'idle'; }

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
      const r = this.size * 0.46 + pad;
      return Math.hypot(mx - this.x, my - this.y) < r;
    }

    loop(ts) {
      const dt = this._last ? Math.min(3, (ts - this._last) / 16.67) : 1;
      this._last = ts;
      try { this.tick(dt); } catch (e) {
        console.error('[pet] frame error', e);
        this.mode = 'roam';
        this.flying = null;
        this.state = 'idle';
        if (!Number.isFinite(this.x)) this.x = this.bounds.w - 120;
        if (!Number.isFinite(this.y)) this.y = this.bounds.h - 130;
        this.tx = this.x; this.ty = this.y;
      }
      this._raf = requestAnimationFrame(this.loop);
    }

    tick(dt) {
      this.t += dt;
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
          this.tx = this.x; this.ty = this.y;
          this.restUntil = this.t + 90;
          this.spawnHearts(4);
        }
      } else if (this.mode === 'roam') {
        const dx = this.tx - this.x, dy = this.ty - this.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.8) {
          // 恒速行走：按时间推进，接近终点时自然停下
          const step = Math.min(d, this.speed / 60 * dt);
          this.x += dx / d * step;
          this.y += dy / d * step;
          if (Math.abs(dx) > 1.2) this.face = dx >= 0 ? 1 : -1;
          this.moving = d - step > 1.5;
          this.state = this.moving ? 'walk' : 'idle';
        } else {
          this.moving = false;
          if (this.state === 'walk') this.state = 'idle';
        }
        this.x = Math.max(this.size * 0.5, Math.min(w - this.size * 0.5, this.x));
        this.y = Math.max(this.size * 0.6, Math.min(h - this.size * 0.5, this.y));
      }

      // ---- 眨眼 ----
      if (--this.blinkAt <= 0) { this.blink = 1; this.blinkAt = 90 + Math.random() * 180; }
      if (this.blink > 0) this.blink = Math.max(0, this.blink - 0.12 * dt);

      // ---- 闲置小动作 ----
      if (this.mode === 'roam' && this.state === 'idle' && --this.idleMoveAt <= 0) {
        this.idleMove = 60 + Math.random() * 40;
        this.idleMoveAt = 300 + Math.random() * 300;
        this.idleKind = Math.floor(Math.random() * 3);
      }
      if (this.idleMove > 0) this.idleMove -= dt;

      if (this.hop > 0) this.hop = Math.max(0, this.hop - 0.045 * dt);
      if (this.squash > 0) this.squash = Math.max(0, this.squash - 0.06 * dt);
      if (this.levelFlash > 0) this.levelFlash = Math.max(0, this.levelFlash - 0.012 * dt);

      // ---- 爱心 ----
      this.hearts = this.hearts.filter(p => {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.01 * dt; p.life -= 0.012 * dt;
        return p.life > 0;
      });

      c.clearRect(0, 0, w, h);
      this.draw();
      if (this.showProgress) this.drawProgress();
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
      const bob = Math.sin(this.t * (walking ? 0.42 : 0.12)) * (walking ? 2.2 : 1);
      const hopY = 0;
      const tilt = walking ? Math.sin(this.t * 0.42) * 0.045 : Math.sin(this.t * 0.12) * 0.015;

      const row = this.rowForSprite();
      const def = CODEX_ROWS[row];
      const frame = Math.floor(this.t * (def.fps / 60) * (walking ? 1.25 : 1)) % def.frames;
      const cw = sheet.cw || CELL_W, ch = sheet.ch || CELL_H;

      const dw = S, dh = S * (ch / cw);

      c.save();
      c.translate(this.x, this.y + bob + hopY);
      c.rotate(tilt);
      // running-left 行本身朝左，其余行按 face 镜像
      const mirror = (row !== ROW['running-left'] && this.face < 0) ? -1 : 1;
      c.scale(mirror, 1);
      c.imageSmoothingEnabled = true;
      c.drawImage(
        sheet.img,
        frame * cw, row * ch, cw, ch,
        -dw / 2, -dh / 2, dw, dh
      );
      c.restore();
    }

    /** Lv.N + 细能量条，画在宠物下方，低调跟随（带半透明底片，深浅背景都清晰） */
    drawProgress() {
      const c = this.ctx;
      const S = this.size;
      const label = 'Lv.' + this.lv;
      const barH = 3.5;
      const barW = Math.max(42, S * 0.5);
      const padX = 7, gap = 6, padY = 3.5;
      c.save();
      c.font = '700 10px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
      c.textBaseline = 'middle';
      const tw = c.measureText(label).width;
      const innerW = tw + gap + barW;
      const boxW = innerW + padX * 2;
      const boxH = barH + padY * 2 + 1;
      const bx0 = this.x - boxW / 2;
      const by0 = this.y + S * 0.5 + 6;

      // 底片
      c.globalAlpha = 0.42;
      c.fillStyle = 'rgba(12,16,24,.55)';
      c.beginPath();
      if (c.roundRect) c.roundRect(bx0, by0, boxW, boxH, boxH / 2); else c.rect(bx0, by0, boxW, boxH);
      c.fill();
      c.globalAlpha = 1;

      // Lv.N
      c.textAlign = 'left';
      c.fillStyle = 'rgba(255,255,255,.92)';
      c.fillText(label, bx0 + padX, by0 + boxH / 2 + 0.5);

      // 细能量条
      const bx = bx0 + padX + tw + gap;
      const by = by0 + (boxH - barH) / 2;
      const r = barH / 2;
      c.beginPath();
      if (c.roundRect) c.roundRect(bx, by, barW, barH, r); else c.rect(bx, by, barW, barH);
      c.fillStyle = 'rgba(255,255,255,.22)';
      c.fill();

      const fw = Math.max(barH, barW * this.xpRatio);
      const g = c.createLinearGradient(bx, 0, bx + barW, 0);
      g.addColorStop(0, '#8ff0ff');
      g.addColorStop(1, '#25a8ff');
      c.beginPath();
      if (c.roundRect) c.roundRect(bx, by, fw, barH, r); else c.rect(bx, by, fw, barH);
      c.fillStyle = g;
      c.fill();
      c.restore();
    }

    drawVector() {
      const c = this.ctx, P = this.palette;
      const t = this.t;
      const walking = this.state === 'walk';
      const bob = Math.sin(t * (walking ? 0.42 : 0.12)) * (walking ? 3 : 1.5);
      const hopY = 0;
      const tilt = walking ? Math.sin(t * 0.42) * 0.05 : Math.sin(t * 0.12) * 0.02;
      // 尺寸恒定：升级/开心等状态不再改变宠物大小，避免视觉上"变大一点"
      const sq = 1;

      c.save();
      c.translate(this.x, this.y + bob + hopY);
      c.rotate(tilt);
      c.scale(this.face * sq, sq);

      const S = this.size;

      c.save();
      c.globalAlpha = 0.12;
      c.fillStyle = '#000';
      c.beginPath();
      c.ellipse(0, S * 0.52 - bob * 0.5, S * 0.34, S * 0.08, 0, 0, 7);
      c.fill();
      c.restore();

      c.fillStyle = P.horn;
      [[-0.32, -0.34], [0.32, -0.34]].forEach(([ex, ey]) => {
        c.beginPath();
        c.ellipse(ex * S, ey * S, S * 0.085, S * 0.13, ex * 0.35, 0, 7);
        c.fill();
      });

      c.fillStyle = P.body;
      [[-0.36, -0.14], [0.36, -0.14]].forEach(([ex, ey]) => {
        c.beginPath();
        c.ellipse(ex * S, ey * S, S * 0.16, S * 0.11, ex * 0.5, 0, 7);
        c.fill();
      });

      c.beginPath();
      c.ellipse(0, 0, S * 0.46, S * 0.44, 0, 0, 7);
      c.fillStyle = P.body;
      c.fill();

      c.fillStyle = P.spot;
      c.beginPath(); c.ellipse(-S * 0.14, -S * 0.17, S * 0.11, S * 0.09, -0.4, 0, 7); c.fill();
      c.beginPath(); c.ellipse(S * 0.2, S * 0.03, S * 0.07, S * 0.055, 0.3, 0, 7); c.fill();

      c.fillStyle = P.muzzle;
      c.beginPath(); c.ellipse(0, S * 0.22, S * 0.26, S * 0.18, 0, 0, 7); c.fill();
      c.fillStyle = P.ink;
      c.beginPath(); c.ellipse(-S * 0.075, S * 0.2, S * 0.028, S * 0.04, 0, 0, 7); c.fill();
      c.beginPath(); c.ellipse(S * 0.075, S * 0.2, S * 0.028, S * 0.04, 0, 0, 7); c.fill();

      const blinkK = this.blink;
      const eyeH = S * 0.075 * (1 - blinkK * 0.95);
      const eyeY = -S * 0.06;
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
        ctx.drawImage(sheet.img, 0, 0, cw, ch, (size - dw) / 2, (size - dh) / 2, dw, dh);
      };
      if (sheet.ready) paint();
      else sheet.img.addEventListener('load', paint, { once: true });
      return;
    }
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
  global.PET_BUBBLE_THEMES = BUBBLE_THEMES;
  global.PET_DEFAULT_SKIN = DEFAULT_SKIN;
  global.PET_SKIN_LIST = Object.keys(SPRITES).map(id => ({ id, ...SPRITES[id], source: 'agent-pet' }));
  global.petBubbleTheme = bubbleTheme;
  global.stylePetBubble = styleBubble;
  global.drawPetPreview = drawPetPreview;
  global.preloadPetSkins = preloadAll;
})(window);
