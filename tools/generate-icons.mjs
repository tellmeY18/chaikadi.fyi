// Optional developer utility. Icons are committed; this is NOT a build step.
// Dependency-free PNG generation with supersampling, using only Node built-ins.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crc32 = buffer => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}
function pixel(x, y, maskable) {
  if (maskable) { x = (x - 256) / .78 + 256; y = (y - 256) / .78 + 256; }
  const bg = [53, 100, 75], cream = [247, 245, 239], tea = [182, 129, 65];
  if (y >= 401 && y <= 421 && x >= 119 && x <= 387) return cream;
  if (((x - 374) / 46) ** 2 + ((y - 260) / 49) ** 2 <= 1 &&
      ((x - 374) / 23) ** 2 + ((y - 260) / 27) ** 2 >= 1 && x >= 335) return cream;
  if (x >= 139 && x <= 352 && y >= 211 && y <= 281) {
    if (((x - 246) / 85) ** 2 + ((y - 218) / 15) ** 2 <= 1) return tea;
    return cream;
  }
  if (y > 281 && ((x - 245.5) / 106.5) ** 2 + ((y - 281) / 102) ** 2 <= 1) return cream;
  if (y >= 87 && y <= 160) for (const sx of [190, 253, 316]) {
    if (Math.abs(x - (sx + Math.sin((y - 87) / 73 * Math.PI * 2) * 9)) < 7.5) return cream;
  }
  return bg;
}
function png(size, maskable = false) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const rgb = [0, 0, 0];
    for (const dy of [.25, .75]) for (const dx of [.25, .75]) {
      const color = pixel((x + dx) / size * 512, (y + dy) / size * 512, maskable);
      for (let c = 0; c < 3; c++) rgb[c] += color[c] / 4;
    }
    const index = y * (size * 3 + 1) + 1 + x * 3;
    for (let c = 0; c < 3; c++) raw[index + c] = Math.round(rgb[c]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const [file, size, mask] of [['icon-192.png', 192], ['icon-512.png', 512], ['maskable-512.png', 512, true], ['apple-touch-icon.png', 180]]) {
  writeFileSync(new URL(`../icons/${file}`, import.meta.url), png(size, mask));
}
