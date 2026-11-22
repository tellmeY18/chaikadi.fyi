// A fake webcam that films one QR code. Chromium plays a Y4M file as the
// camera when started with --use-file-for-fake-video-capture, so the real
// scanner (getUserMedia + jsQR) runs end to end with no hardware.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

// The vendored library is a UMD script; run it with a CommonJS-style module object.
const qrcode = (() => { const module = { exports: {} }; new Function('module', 'exports', readFileSync(join(ROOT, 'vendor/qrcode.js'), 'utf8'))(module, module.exports); return module.exports; })();

export function qrVideo(text, { width = 640, height = 480, frames = 30 } = {}) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  const count = qr.getModuleCount(), margin = 4, scale = Math.floor(Math.min(width, height) / (count + margin * 2));
  const size = (count + margin * 2) * scale, x0 = (width - size) >> 1, y0 = (height - size) >> 1;
  const y = Buffer.alloc(width * height, 235);
  for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) {
    if (!qr.isDark(r, c)) continue;
    for (let dy = 0; dy < scale; dy++) y.fill(16, (y0 + (r + margin) * scale + dy) * width + x0 + (c + margin) * scale, (y0 + (r + margin) * scale + dy) * width + x0 + (c + margin + 1) * scale);
  }
  const chroma = Buffer.alloc((width >> 1) * (height >> 1), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, chroma, chroma]);
  const file = join(mkdtempSync(join(tmpdir(), 'chaikadi-cam-')), 'qr.y4m');
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`), ...Array(frames).fill(frame)]));
  return file;
}
