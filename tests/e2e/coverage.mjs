// Merge the V8 coverage written by every e2e file (and optionally enforce a
// floor). Browser-side only: it measures js/*.js as the real app executes it.
//   node tests/e2e/coverage.mjs            report
//   COVERAGE_MIN=80 node tests/e2e/coverage.mjs   fail below 80% lines overall
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { COVERAGE_DIR, ROOT } from './helpers.mjs';

const files = {};
for (const name of await readdir(COVERAGE_DIR).catch(() => [])) {
  if (!name.endsWith('.json') || name === 'summary.json') continue;
  for (const entry of JSON.parse(await readFile(join(COVERAGE_DIR, name), 'utf8'))) {
    if (!/^\/js\/.+\.js$/.test(entry.url)) continue;
    const mark = (files[entry.url] ||= { source: entry.source, covered: new Uint8Array(entry.length) }).covered;
    const run = new Uint8Array(entry.length);
    // V8 block ranges nest: later (inner) ranges override outer ones.
    for (const fn of entry.functions) for (const r of fn.ranges) run.fill(r.count > 0 ? 1 : 0, r.startOffset, r.endOffset);
    for (let i = 0; i < run.length; i++) if (run[i]) mark[i] = 1;
  }
}
const rows = []; let total = 0, hit = 0;
for (const [url, { source, covered }] of Object.entries(files).sort()) {
  let offset = 0, lines = 0, ok = 0; const missed = [];
  source.split('\n').forEach((line, index) => {
    const start = offset; offset += line.length + 1;
    const code = line.replace(/\/\/.*$/, '').trim();
    if (!code || /^[}\])\s;,]*$/.test(code)) return;
    lines++;
    let any = false; for (let i = start; i < start + line.length; i++) if (covered[i] && !/\s/.test(source[i])) { any = true; break; }
    if (any) ok++; else missed.push(index + 1);
  });
  total += lines; hit += ok;
  rows.push({ file: url.slice(1), lines, covered: ok, pct: lines ? +(100 * ok / lines).toFixed(1) : 100, missed });
}
const pct = total ? +(100 * hit / total).toFixed(1) : 0;
for (const r of rows) console.log(`${String(r.pct).padStart(6)}%  ${r.file}  (${r.covered}/${r.lines})`);
console.log(`${String(pct).padStart(6)}%  TOTAL js/ line coverage under real-browser e2e`);
await writeFile(join(COVERAGE_DIR, 'summary.json'), JSON.stringify({ pct, rows }, null, 1));
const min = Number(process.env.COVERAGE_MIN || 0);
if (pct < min) { console.error(`Coverage ${pct}% is below COVERAGE_MIN=${min}%. Uncovered lines: see coverage/e2e/summary.json`); process.exit(1); }
void ROOT;
