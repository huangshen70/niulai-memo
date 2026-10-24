// 宠物绘制 + 动画状态机（主窗与悬浮窗共用）
(function (global) {
  const PALETTES = {
    niulai: { body: '#ffffff', ink: '#2d2a30', horn: '#e8c494', pink: '#ff96aa', spot: '#343038', muzzle: '#ffe2e2' },
    mint:   { body: '#e8fff4', ink: '#1f3b32', horn: '#9fe0c0', pink: '#ff9ec4', spot: '#2e6b57', muzzle: '#f4fffa' },
    sakura: { body: '#fff0f6', ink: '#4a2338', horn: '#ffb3cf', pink: '#ff7aa8', spot: '#8a3d63', muzzle: '#fff7fb' },
    night:  { body: '#3a3a4a', ink: '#f2f2f8', horn: '#8d86b8', pink: '#ff8fb0', spot: '#1e1e2a', muzzle: '#4a4a5e' },
  };

  class PetCanvas {
    constructor(canvas, opts = {}) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = Math.min(2, global.devicePixelRatio || 1);
      this.size = opts.size || 96;
      this.palette = PALETTES[opts.skin] || PALETTES.niulai;
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

    setSkin(skin) { this.palette = PALETTES[skin] || PALETTES.niulai; }
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
    }

    draw() {
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
      [[-0.36, -0.14], [0.36, -0.14]].forEach(([ex, ey], i) => {
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

      // 爱心
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

      // 升级光环
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

  global.PetCanvas = PetCanvas;
  global.PET_PALETTES = PALETTES;
})(window);
