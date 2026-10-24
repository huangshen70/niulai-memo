// 生成 build/icon.png (256) 与 build/icon.ico —— 纯 Node，无第三方依赖
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const S = 256;
const px = new Float32Array(S * S * 4); // premultiplied-free RGBA 0..255

function blend(x, y, r, g, b, a) {
  if (a <= 0) return;
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const sa = Math.min(1, a), da = px[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  px[i]     = (r * sa + px[i]     * da * (1 - sa)) / oa;
  px[i + 1] = (g * sa + px[i + 1] * da * (1 - sa)) / oa;
  px[i + 2] = (b * sa + px[i + 2] * da * (1 - sa)) / oa;
  px[i + 3] = oa * 255;
}

// 距离场 -> 抗锯齿覆盖率
const cov = d => Math.max(0, Math.min(1, 0.5 - d));

function ellipse(cx, cy, rx, ry, [r, g, b], alpha = 1) {
  const x0 = Math.max(0, Math.floor(cx - rx - 1)), x1 = Math.min(S - 1, Math.ceil(cx + rx + 1));
  const y0 = Math.max(0, Math.floor(cy - ry - 1)), y1 = Math.min(S - 1, Math.ceil(cy + ry + 1));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
    const d = (Math.sqrt(dx * dx + dy * dy) - 1) * Math.min(rx, ry);
    blend(x, y, r, g, b, cov(d) * alpha);
  }
}
function rrect(x, y, w, h, rad, [r, g, b], alpha = 1) {
  for (let py2 = Math.floor(y); py2 < y + h; py2++) for (let pxx = Math.floor(x); pxx < x + w; pxx++) {
    const cx = Math.max(x + rad, Math.min(x + w - rad, pxx + 0.5));
    const cy = Math.max(y + rad, Math.min(y + h - rad, py2 + 0.5));
    const d = Math.hypot(pxx + 0.5 - cx, py2 + 0.5 - cy) - rad;
    blend(pxx, py2, r, g, b, cov(d) * alpha);
  }
}

const C = {
  bg1: [255, 214, 102], bg2: [255, 159, 10],
  body: [255, 255, 255], ink: [45, 42, 48],
  horn: [232, 196, 148], pink: [255, 150, 170],
  spot: [52, 48, 56], muzzle: [255, 226, 226],
};

// 背景：圆角方块 + 竖向渐变
rrect(8, 8, 240, 240, 58, C.bg1);
for (let y = 8; y < 248; y++) {
  const t = (y - 8) / 240;
  for (let x = 8; x < 248; x++) {
    const i = (y * S + x) * 4;
    if (px[i + 3] < 250) continue;
    const dx = Math.max(8 + 58 - (x + 0.5), (x + 0.5) - (248 - 58), 0);
    const dy = Math.max(8 + 58 - (y + 0.5), (y + 0.5) - (248 - 58), 0);
    if (Math.hypot(dx, dy) > 58) continue;
    const r = C.bg1[0] + (C.bg2[0] - C.bg1[0]) * t;
    const g = C.bg1[1] + (C.bg2[1] - C.bg1[1]) * t;
    const b = C.bg1[2] + (C.bg2[2] - C.bg1[2]) * t;
    px[i] = r; px[i + 1] = g; px[i + 2] = b;
  }
}

// 牛：耳朵 -> 角 -> 身体 -> 斑点 -> 眼睛 -> 鼻子
ellipse(58, 118, 26, 17, C.body);      // 左耳
ellipse(198, 118, 26, 17, C.body);
ellipse(70, 86, 13, 20, C.horn);       // 左角
ellipse(186, 86, 13, 20, C.horn);
ellipse(128, 148, 78, 70, C.body);     // 脸
ellipse(104, 118, 20, 16, C.spot);     // 斑
ellipse(160, 150, 12, 10, C.spot);
ellipse(108, 148, 15, 18, C.ink);      // 眼
ellipse(148, 148, 15, 18, C.ink);
ellipse(112, 142, 5, 6, [255, 255, 255]);
ellipse(152, 142, 5, 6, [255, 255, 255]);
ellipse(128, 186, 40, 30, C.muzzle);   // 嘴部
ellipse(112, 184, 5, 7, C.ink);        // 鼻孔
ellipse(144, 184, 5, 7, C.ink);
ellipse(128, 198, 15, 7, C.pink, 0.55);

// ---- PNG 编码 ----
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return buf => { let c = -1; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td));
  return Buffer.concat([len, td, crc]);
};
function pngFrom(w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const rgba = Buffer.alloc(S * S * 4);
for (let i = 0; i < S * S; i++) {
  rgba[i * 4] = Math.round(px[i * 4]);
  rgba[i * 4 + 1] = Math.round(px[i * 4 + 1]);
  rgba[i * 4 + 2] = Math.round(px[i * 4 + 2]);
  rgba[i * 4 + 3] = Math.round(px[i * 4 + 3]);
}
const png = pngFrom(S, S, rgba);

// ICO 容器（内嵌 PNG，Vista+ 支持）
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico[6] = 0; ico[7] = 0; ico[8] = 0; ico[9] = 0;
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);

const out = path.join(__dirname, '..', 'app', 'build');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), png);
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([ico, png]));
console.log('icon.png', png.length, 'B  icon.ico', ico.length + png.length, 'B');
