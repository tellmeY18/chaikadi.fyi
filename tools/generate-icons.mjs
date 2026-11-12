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
  x /= 8; y /= 8;
  if (maskable) { x = (x - 32) / .8 + 32; y = (y - 32) / .8 + 32; }
  const ink = [17, 17, 17], paper = [255, 255, 255];
  // The same tapered tumbler and two steam strokes as icon.svg.
  if (y >= 29 && y <= 53.5) {
    const inset = (y - 29) * .155;
    if (x >= 19 + inset && x <= 45 - inset) {
      if (y >= 36 && y <= 42) return ink;
      return paper;
    }
  }
  for (const [sx, top] of [[26, 17], [34, 15]]) {
    if (y >= top && y <= top + 8 && Math.abs(x - (sx - Math.sin((y - top) / 8 * Math.PI * 2) * 1.1)) <= 1.3) return paper;
  }
  return ink;
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
