// Генератор иконок PWA без зависимостей: чистый PNG-энкодер на node:zlib.
// Логотип: белый пин карты с зелёной точкой на фирменном зелёном фоне.
// Запуск: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const GREEN = [22, 163, 74]; // #16A34A
const WHITE = [255, 255, 255];

// --- PNG encoder -----------------------------------------------------------
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- рисование -------------------------------------------------------------
// Пин: круг + хвост-треугольник вниз; внутри — капля топлива цвета фона
// (бренд: геометка + капля, одна иконка для favicon/PWA/сторов).
function shapeAt(px, py, s) {
  const cx = 0.5, cyC = 0.42, R = 0.21, tipY = 0.8;
  const x = px / s, y = py / s;
  const sign = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const inTriangle = (pt, p1, p2, p3) => {
    const d1 = sign(pt, p1, p2), d2 = sign(pt, p2, p3), d3 = sign(pt, p3, p1);
    return (d1 <= 0 && d2 <= 0 && d3 <= 0) || (d1 >= 0 && d2 >= 0 && d3 >= 0);
  };

  const inCircle = (x - cx) ** 2 + (y - cyC) ** 2 <= R * R;
  const a = Math.PI / 4;
  const inTail = inTriangle(
    [x, y],
    [cx - R * Math.cos(a), cyC + R * Math.sin(a)],
    [cx + R * Math.cos(a), cyC + R * Math.sin(a)],
    [cx, tipY]
  );

  // капля: круглое дно + острая вершина
  const dropR = 0.075, dropCy = cyC + 0.035, dropTipY = cyC - 0.105;
  const inDropBase = (x - cx) ** 2 + (y - dropCy) ** 2 <= dropR * dropR;
  const inDropTip = inTriangle(
    [x, y],
    [cx - dropR * 0.92, dropCy - dropR * 0.35],
    [cx + dropR * 0.92, dropCy - dropR * 0.35],
    [cx, dropTipY]
  );
  if (inDropBase || inDropTip) return 'dot';
  if (inCircle || inTail) return 'pin';
  return 'bg';
}

function draw(size, { rounded }) {
  const rgba = Buffer.alloc(size * size * 4);
  const rr = size * 0.22;
  const SS = 3; // суперсэмплинг 3×3 — сглаживание краёв
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          // скруглённые углы (для обычной иконки)
          let alpha = 255;
          if (rounded) {
            const nx = Math.max(rr - fx, fx - (size - rr), 0);
            const ny = Math.max(rr - fy, fy - (size - rr), 0);
            if (nx * nx + ny * ny > rr * rr) alpha = 0;
          }
          const kind = alpha === 0 ? null : shapeAt(fx, fy, size);
          const col =
            kind === 'pin' ? WHITE : kind === 'dot' || kind === 'bg' ? GREEN : [0, 0, 0];
          if (alpha > 0) {
            rSum += col[0]; gSum += col[1]; bSum += col[2]; aSum += 255;
          }
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const a = aSum / n;
      rgba[i] = a ? Math.round(rSum / (aSum / 255)) : 0;
      rgba[i + 1] = a ? Math.round(gSum / (aSum / 255)) : 0;
      rgba[i + 2] = a ? Math.round(bSum / (aSum / 255)) : 0;
      rgba[i + 3] = Math.round(a);
    }
  }
  return encodePNG(size, rgba);
}

const out = new URL('../public/', import.meta.url).pathname;
writeFileSync(`${out}icon-192.png`, draw(192, { rounded: true }));
writeFileSync(`${out}icon-512.png`, draw(512, { rounded: true }));
writeFileSync(`${out}icon-maskable-512.png`, draw(512, { rounded: false }));
writeFileSync(`${out}apple-touch-icon.png`, draw(180, { rounded: false }));
console.log('✓ иконки: icon-192, icon-512, icon-maskable-512, apple-touch-icon');
