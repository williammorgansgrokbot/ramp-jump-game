import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const oa = px[i + 3] / 255;
    const na = a / 255;
    const out = na + oa * (1 - na);
    if (out <= 0) return;
    px[i] = Math.round((r * na + px[i] * oa * (1 - na)) / out);
    px[i + 1] = Math.round((g * na + px[i + 1] * oa * (1 - na)) / out);
    px[i + 2] = Math.round((b * na + px[i + 2] * oa * (1 - na)) / out);
    px[i + 3] = Math.round(out * 255);
  };
  const rect = (x, y, w, h, r, g, b) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) set(xx | 0, yy | 0, r, g, b);
  };
  const circle = (cx, cy, rad, r, g, b) => {
    const r2 = rad * rad;
    for (let yy = cy - rad; yy <= cy + rad; yy++) {
      for (let xx = cx - rad; xx <= cx + rad; xx++) {
        const dx = xx - cx;
        const dy = yy - cy;
        if (dx * dx + dy * dy <= r2) set(xx | 0, yy | 0, r, g, b);
      }
    }
  };
  const s = size;
  for (let y = 0; y < s; y++) {
    const t = y / s;
    const r = 90 + t * 80;
    const g = 190 + (1 - t) * 30;
    const b = 255 - t * 40;
    for (let x = 0; x < s; x++) set(x, y, r, g, b);
  }
  rect(0, (s * 0.72) | 0, s, (s * 0.28) | 0, 62, 196, 92);
  // ramp
  for (let x = (s * 0.42) | 0; x < (s * 0.78) | 0; x++) {
    const t = (x - s * 0.42) / (s * 0.36);
    const top = s * 0.72 - t * s * 0.28;
    for (let y = top; y < s * 0.78; y++) set(x | 0, y | 0, 255, 140, 26);
  }
  const carX = s * 0.28;
  const carY = s * 0.58;
  rect(carX, carY, s * 0.28, s * 0.12, 255, 59, 48);
  rect(carX + s * 0.05, carY - s * 0.07, s * 0.16, s * 0.08, 255, 214, 10);
  circle(carX + s * 0.06, carY + s * 0.12, s * 0.035, 30, 30, 34);
  circle(carX + s * 0.22, carY + s * 0.12, s * 0.035, 30, 30, 34);
  circle(s * 0.18, s * 0.22, s * 0.015, 255, 214, 10);
  circle(s * 0.78, s * 0.16, s * 0.012, 255, 255, 255);
  return png(s, s, px);
}

const dir = path.resolve('public/icons');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon-512.png'), draw(512));
fs.writeFileSync(path.join(dir, 'icon-192.png'), draw(192));
fs.writeFileSync(path.join(dir, 'apple-touch-icon.png'), draw(180));
fs.writeFileSync(path.join(dir, 'favicon-32.png'), draw(32));
console.log('icons written');
