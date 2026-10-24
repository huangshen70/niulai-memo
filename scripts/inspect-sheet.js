// 一次性工具：把 Codex 精灵图集按行切出首帧，用于确认行序
// 用法： npx electron scripts/inspect-sheet.js app/vendor/pets/kitsune-spirit.webp
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const file = process.argv[2] || 'app/vendor/pets/kitsune-spirit.webp';
const outDir = path.join(__dirname, '..', '.tmp', 'frames');

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');

  const dataUrl = 'data:image/webp;base64,' + fs.readFileSync(path.resolve(file)).toString('base64');
  const result = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = ${JSON.stringify(dataUrl)}; });
    const cols = 8, cw = img.width / cols, ch = 208, rows = Math.floor(img.height / ch);
    const out = [];
    for (let r = 0; r < rows; r++) {
      const cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      cv.getContext('2d').drawImage(img, 0, r * ch, cw, ch, 0, 0, cw, ch);
      out.push(cv.toDataURL('image/png'));
    }
    // 再切一列：每行第 0..7 帧拼成一行，检查每行帧数
    return { w: img.width, h: img.height, rows, rowPngs: out };
  })()`);

  console.log('sheet', result.w + 'x' + result.h, 'rows', result.rows);
  result.rowPngs.forEach((d, i) => {
    const p = path.join(outDir, `row${i}.png`);
    fs.writeFileSync(p, Buffer.from(d.split(',')[1], 'base64'));
  });
  console.log('written to', outDir);
  app.quit();
});
