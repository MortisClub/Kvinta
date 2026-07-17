/* Генератор иконок Kvinta: рисует логотип (полосы-эквалайзер) во все размеры
   Android (mipmap + adaptive foreground) и Electron (assets/icon.png + .ico).
   Без зависимостей: растеризация и кодирование PNG/ICO — свои.
   Запуск: node tools/make-icons.js */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const RES = path.join(ROOT, 'mobile', 'android', 'app', 'src', 'main', 'res');
const ASSETS = path.join(ROOT, 'assets');

// ---------- геометрия логотипа (как в .logo-mark, viewBox 0 0 44 44) ----------
const BARS = [
  { x: 3,  y: 16, w: 5, h: 12, r: 2.5 },
  { x: 12, y: 9,  w: 5, h: 26, r: 2.5 },
  { x: 21, y: 3,  w: 5, h: 38, r: 2.5 },
  { x: 30, y: 11, w: 5, h: 22, r: 2.5 },
  { x: 39, y: 18, w: 2, h: 8,  r: 1 }
];
const C1 = [255, 30, 66];    // #ff1e42
const C2 = [255, 106, 61];   // #ff6a3d
const BG = [13, 7, 9];       // #0d0709
const GLOW_BG = [58, 13, 24]; // #3a0d18 — бордовое свечение фона

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

// расстояние до скруглённого прямоугольника (<0 — внутри)
function rrectDist(px, py, rc) {
  const cx = rc.x + rc.w / 2, cy = rc.y + rc.h / 2;
  const qx = Math.abs(px - cx) - (rc.w / 2 - rc.r);
  const qy = Math.abs(py - cy) - (rc.h / 2 - rc.r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - rc.r;
}

/* Рендер квадрата size×size с 4× суперсэмплингом.
   mode: 'legacy' — фон + маска-скруглённый квадрат;
         'round'  — фон + круглая маска;
         'square' — фон без маски (Play Store / .ico);
         'fg'     — прозрачный фон, только полосы со свечением (adaptive foreground) */
function render(size, mode) {
  const SS = 4, N = size * SS;
  const out = new Uint8Array(size * size * 4);
  const contentScale =
    mode === 'fg' ? 0.50 :
    size <= 32 ? 0.74 : size <= 48 ? 0.68 : 0.62;
  const scale = contentScale * N / 44;
  const maskR = mode === 'legacy' || mode === 'square' ? N * 0.21 : N * 0.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let R = 0, G = 0, B = 0, A = 0; // premultiplied-сумма сабпикселей
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = x * SS + sx + 0.5, v = y * SS + sy + 0.5;
          const nx = u / N, ny = v / N;
          const lu = (u - N / 2) / scale + 22, lv = (v - N / 2) / scale + 22;

          let r = 0, g = 0, b = 0, a = 0;
          if (mode !== 'fg') {
            // фон: тёмная база + бордовое свечение сверху-справа + красная дымка за полосами
            const d1 = Math.hypot(nx - 0.75, ny - 0.18) / 0.85;
            const f1 = Math.pow(clamp(1 - d1, 0, 1), 1.5);
            r = lerp(BG[0], GLOW_BG[0], f1);
            g = lerp(BG[1], GLOW_BG[1], f1);
            b = lerp(BG[2], GLOW_BG[2], f1);
            const d2 = Math.hypot(nx - 0.5, ny - 0.52) / 0.55;
            const f2 = Math.pow(clamp(1 - d2, 0, 1), 2);
            r = clamp(r + C1[0] * f2 * 0.10, 0, 255);
            g = clamp(g + C1[1] * f2 * 0.10, 0, 255);
            b = clamp(b + C1[2] * f2 * 0.10, 0, 255);
            a = 1;
          } else {
            // adaptive foreground: лёгкое свечение за полосами на прозрачном
            const d2 = Math.hypot(nx - 0.5, ny - 0.5) / 0.34;
            const ga = 0.28 * Math.pow(clamp(1 - d2, 0, 1), 2);
            r = C1[0]; g = C1[1]; b = C1[2]; a = ga;
          }

          // полосы с диагональным градиентом
          let inBar = false;
          for (const rc of BARS) {
            if (rrectDist(lu, lv, rc) <= 0) { inBar = true; break; }
          }
          if (inBar) {
            const t = clamp(((lu - 3) / 38 + (41 - lv) / 38) / 2, 0, 1);
            r = lerp(C1[0], C2[0], t);
            g = lerp(C1[1], C2[1], t);
            b = lerp(C1[2], C2[2], t);
            a = 1;
          }

          // маска формы (для fg не нужна)
          if (mode !== 'fg') {
            const rrc = { x: 0, y: 0, w: N, h: N, r: maskR };
            const md = mode === 'round'
              ? Math.hypot(u - N / 2, v - N / 2) - N / 2
              : rrectDist(u, v, rrc);
            if (md > 0) a = 0;
          }

          R += r * a; G += g * a; B += b * a; A += a;
        }
      }
      const n = SS * SS, i = (y * size + x) * 4;
      const alpha = A / n;
      out[i]     = alpha > 0 ? Math.round(R / A) : 0;
      out[i + 1] = alpha > 0 ? Math.round(G / A) : 0;
      out[i + 2] = alpha > 0 ? Math.round(B / A) : 0;
      out[i + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

// ---------- PNG ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, 'ascii');
  data.copy(b, 8);
  b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
  return b;
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 бит, RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
function writePng(file, size, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(size, render(size, mode)));
  console.log('✓', path.relative(ROOT, file), size + 'px');
}

// ---------- ICO (PNG-вложения, Vista+) ----------
function writeIco(file, sizes, mode) {
  const pngs = sizes.map(s => encodePng(s, render(s, mode)));
  const head = Buffer.alloc(6 + sizes.length * 16);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let off = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    head[e] = s >= 256 ? 0 : s;
    head[e + 1] = s >= 256 ? 0 : s;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(pngs[i].length, e + 8);
    head.writeUInt32LE(off, e + 12);
    off += pngs[i].length;
  });
  fs.writeFileSync(file, Buffer.concat([head, ...pngs]));
  console.log('✓', path.relative(ROOT, file), sizes.join('/'));
}

// ---------- выхлоп ----------
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITIES)) {
  const dir = path.join(RES, 'mipmap-' + d);
  writePng(path.join(dir, 'ic_launcher.png'), Math.round(48 * k), 'legacy');
  writePng(path.join(dir, 'ic_launcher_round.png'), Math.round(48 * k), 'round');
  writePng(path.join(dir, 'ic_launcher_foreground.png'), Math.round(108 * k), 'fg');
}
writePng(path.join(ASSETS, 'icon.png'), 512, 'legacy');
writePng(path.join(ASSETS, 'icon-playstore.png'), 512, 'square');
writeIco(path.join(ASSETS, 'icon.ico'), [256, 128, 64, 48, 32, 24, 16], 'legacy');
console.log('Готово.');
