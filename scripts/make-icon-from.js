// 由一张位图生成 app/build/icon.png(256) 与 icon.ico —— 用 Electron nativeImage 缩放，无第三方依赖
// 用法：npx electron ../scripts/make-icon-from.js <源图路径>
const { app, nativeImage } = require('electron');
const fs = require('fs'), path = require('path');

const S = 256;
const src = process.argv[process.argv.length - 1];

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const img = nativeImage.createFromPath(src);
  if (img.isEmpty()) { console.error('无法读取图片:', src); app.exit(1); return; }
  const { width: w, height: h } = img.getSize();

  // 等比缩放到 256 见方，居中，四周用不透明底色补边
  const k = Math.min(S / w, S / h);
  const rw = Math.max(1, Math.round(w * k)), rh = Math.max(1, Math.round(h * k));
  const resized = img.resize({ width: rw, height: rh, quality: 'best' });
  const canvas = Buffer.alloc(S * S * 4);
  const rb = resized.toBitmap(); // BGRA, 每行 rbRow 字节
  const rbRow = rw * 4;
  const ox = Math.floor((S - rw) / 2), oy = Math.floor((S - rh) / 2);
  // 先填满背景色（取源图左上角像素），避免留白边
  const bg = [rb[0], rb[1], rb[2], 255];
  for (let i = 0; i < S * S; i++) {
    canvas[i * 4] = bg[0]; canvas[i * 4 + 1] = bg[1];
    canvas[i * 4 + 2] = bg[2]; canvas[i * 4 + 3] = 255;
  }
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const s = y * rbRow + x * 4, d = ((y + oy) * S + (x + ox)) * 4;
      const a = rb[s + 3] / 255;
      canvas[d] = Math.round(rb[s] * a + bg[0] * (1 - a));
      canvas[d + 1] = Math.round(rb[s + 1] * a + bg[1] * (1 - a));
      canvas[d + 2] = Math.round(rb[s + 2] * a + bg[2] * (1 - a));
      canvas[d + 3] = 255;
    }
  }

  const out = nativeImage.createFromBitmap(canvas, { width: S, height: S });
  const png = out.toPNG();

  // ICO 容器（内嵌 PNG，Vista+ 支持）
  const ico = Buffer.alloc(22);
  ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
  ico[6] = 0; ico[7] = 0; ico[8] = 0; ico[9] = 0;
  ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
  ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);

  const dir = path.join(__dirname, '..', 'app', 'build');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'icon.png'), png);
  fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([ico, png]));
  console.log(`icon.png ${png.length} B  icon.ico ${ico.length + png.length} B  (源 ${w}x${h} -> ${rw}x${rh})`);
  app.exit(0);
});
