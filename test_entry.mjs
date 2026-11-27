// Exactness check + benchmark for this entry, run from the entry directory:
//   node test_entry.mjs [runs]
// Checks the practice set against expected.json (4/4 byte-identical), then
// times this entry's main.ts against the house baseline's main.ts, `runs`
// times each (default 5), reporting mean ms per case and the speedup.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KIT = '/home/hatch/workspace/makefun/diff-speed-01-run-20261126/diff-speed-01-run-20261126-kit';
const ENTRY = '/home/hatch/workspace/makefun/diff-speed-01-run-20261126/entry';
const BASE = join(KIT, 'baselines/makefun-diff');
const RUNS = Number(process.argv[2] ?? 5);

function timeMain(dir) {
  const out = mkdtempSync(join(tmpdir(), 'diff-bench-'));
  try {
    const t0 = process.hrtime.bigint();
    execFileSync('node', [join(dir, 'main.ts')], {
      env: { ...process.env, MAKEFUN_INPUT_DIR: join(KIT, 'practice/input'), MAKEFUN_OUTPUT_DIR: out },
      stdio: 'pipe',
    });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    return { ms, answers: readFileSync(join(out, 'answers.json'), 'utf8') };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const expected = JSON.parse(readFileSync(join(KIT, 'practice/reference/expected.json'), 'utf8'));
const want = expected.cases.map((c) => c.output);

// Exactness: run this entry once and compare case by case.
const once = timeMain(ENTRY);
const got = JSON.parse(once.answers);
let pass = 0;
got.forEach((a, i) => {
  const ok = a === want[i];
  if (ok) pass++;
  console.log(`${expected.cases[i].id}: ${ok ? 'MATCH' : 'MISMATCH'}`);
});
console.log(`practice: ${pass}/${want.length} identical`);

// Determinism: a second run must be byte-identical.
const twice = timeMain(ENTRY);
console.log(`determinism: ${once.answers === twice.answers ? 'byte-identical' : 'DIFFERS'}`);

// Benchmark: several timed runs of each driver, fresh process each time.
const mine = [];
const base = [];
for (let r = 0; r < RUNS; r++) {
  mine.push(timeMain(ENTRY).ms);
  base.push(timeMain(BASE).ms);
}
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
const mineMean = mean(mine);
const baseMean = mean(base);
console.log(`entry ms per run: ${mine.map((v) => v.toFixed(1)).join(', ')} (mean ${mineMean.toFixed(1)}, per case ${(mineMean / 4).toFixed(1)})`);
console.log(`baseline ms per run: ${base.map((v) => v.toFixed(1)).join(', ')} (mean ${baseMean.toFixed(1)}, per case ${(baseMean / 4).toFixed(1)})`);
console.log(`speedup: ${(baseMean / mineMean).toFixed(2)}x`);
