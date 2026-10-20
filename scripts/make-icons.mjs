// Genera public/icon-192.png y public/icon-512.png sin dependencias (rasterizado propio).
// Uso: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const BG = [11, 13, 24];
const COOL = [126, 166, 255];
const WARM = [245, 185, 113];

function render(size) {
  const S = 4; // supersampling
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0];
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const u = ((x + (sx + 0.5) / S) / size) * 64;
          const v = ((y + (sy + 0.5) / S) / size) * 64;
          let c = BG;
          const grad = mix(COOL, WARM, Math.min(1, Math.max(0, (u + v) / 128)));
          for (const cx of [24, 40]) {
            const d = Math.hypot(u - cx, v - 32);
            if (Math.abs(d - 14) <= 2.2) c = grad;
          }
          if (Math.hypot(u - 32, v - 32) <= 4.2) c = WARM;
          acc = acc.map((a, i) => a + c[i]);
        }
      row.push(...acc.map((a) => Math.round(a / (S * S))));
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), render(size));
  console.log(`public/icon-${size}.png`);
}
