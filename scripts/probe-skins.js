// 独立图集探针：不依赖 preload/IPC，直接在空页面里加载 petdraw.js 画每个皮肤
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const APP = path.join(__dirname, '..', 'app');
const OUT = path.join(__dirname, '..', '.tmp', 'probe');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 520, height: 520, show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  await win.loadFile(path.join(APP, '.probe.html'));
  await new Promise(r => setTimeout(r, 1500));

  const report = await win.webContents.executeJavaScript(`(async () => {
    const out = [];
    for (const s of PET_SKIN_LIST) {
      const cv = document.createElement('canvas');
      cv.width = 128; cv.height = 128;
      document.body.appendChild(cv);
      const p = new PetCanvas(cv, { size: 100, skin: s.id, x: 64, y: 64, bounds: { w: 128, h: 128 } });
      p.setState('idle');
      await new Promise(r => setTimeout(r, 700));
      const sh = p.sheet;
      out.push({ id: s.id, name: s.name, ready: !!(sh && sh.ready), err: !!(sh && sh.error), cw: sh && sh.cw, ch: sh && sh.ch, rows: sh && sh.rows, w: sh && sh.img.naturalWidth, h: sh && sh.img.naturalHeight, skinId: p.skinId });
      // 截图用：把当前帧画到 128 画布中心
      p.drawSprite(sh);
      out[out.length - 1].png = cv.toDataURL().slice(0, 32);
      cv.remove();
    }
    return out;
  })()`);
  console.log('PROBE ' + JSON.stringify(report, null, 1));

  // 视觉核对：把每只宠物画进一张大图
  const sheet = await win.webContents.executeJavaScript(`(() => {
    const cv = document.createElement('canvas');
    cv.width = 5 * 160; cv.height = 160;
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#222'; ctx.fillRect(0, 0, cv.width, cv.height);
    PET_SKIN_LIST.forEach((s, i) => {
      const c = document.createElement('canvas'); c.width = 160; c.height = 160;
      const p = new PetCanvas(c, { size: 130, skin: s.id, x: 80, y: 85, bounds: { w: 160, h: 160 } });
      p.t = 0; p.state = 'idle';
      if (p.sheet && p.sheet.ready) p.drawSprite(p.sheet);
      ctx.drawImage(c, i * 160, 0);
      ctx.fillStyle = '#fff'; ctx.font = '16px sans-serif';
      ctx.fillText(s.id, i * 160 + 8, 154);
    });
    return cv.toDataURL('image/png');
  })()`);
  fs.writeFileSync(path.join(OUT, 'all.png'), Buffer.from(sheet.split(',')[1], 'base64'));
  console.log('WROTE .tmp/probe/all.png');
  app.exit(0);
});
