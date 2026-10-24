// 把 webp 图集的任意矩形裁出来，存成 PNG，用于判断真实格子尺寸
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const APP = path.join(__dirname, '..', 'app');
const OUT = path.join(__dirname, '..', '.tmp', 'crop');
const src = process.argv[2];
const sx = +process.argv[3] || 0, sy = +process.argv[4] || 0;
const sw = +process.argv[5] || 192, sh = +process.argv[6] || 208;
const scale = +process.argv[7] || 2;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(APP, '.crop.html'), '<!DOCTYPE html><meta charset=utf-8><body style="margin:0;background:#444"><canvas id=c></canvas>');
  const win = new BrowserWindow({ width: 900, height: 700, show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  await win.loadFile(path.join(APP, '.crop.html'));
  const data = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'vendor/pets/' + ${JSON.stringify(path.basename(src))}; });
    const c = document.getElementById('c');
    c.width = ${sw * scale}; c.height = ${sh * scale};
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, ${sx}, ${sy}, ${sw}, ${sh}, 0, 0, ${sw * scale}, ${sh * scale});
    return { w: img.naturalWidth, h: img.naturalHeight, png: c.toDataURL('image/png') };
  })()`);
  fs.writeFileSync(path.join(OUT, path.basename(src) + '.png'), Buffer.from(data.png.split(',')[1], 'base64'));
  console.log(`IMG ${data.w}x${data.h} crop ${sx},${sy} ${sw}x${sh} -> .tmp/crop/${path.basename(src)}.png`);
  app.exit(0);
});
