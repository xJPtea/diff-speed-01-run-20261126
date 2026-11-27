// Differential fuzz: my run() against the reference vendor diffPatch.
//   node fuzz_entry.mjs [seed] [random-count]
// Targeted edge cases first, then random small cases and random mutations
// of practice-case texts (sliced to keep the reference fast). Any mismatch
// prints the failing input and exits 1.

import { readFileSync } from 'node:fs';
import { run } from './solve.js';
import { diffPatch } from '/home/hatch/workspace/makefun/diff-speed-01-run-20261126/diff-speed-01-run-20261126-kit/baselines/makefun-diff/vendor/makefun-diff/index.js';

const KIT = '/home/hatch/workspace/makefun/diff-speed-01-run-20261126/diff-speed-01-run-20261126-kit';

let seed = Number(process.argv[2] ?? 12345);
const RANDOM_COUNT = Number(process.argv[3] ?? 3000);
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

let checked = 0;
let failed = 0;
function check(oldText, newText, label) {
  checked++;
  const input = { old: oldText, new: newText };
  let mine;
  let ref;
  try {
    mine = run(input);
  } catch (e) {
    console.log(`THROW mine [${label}]: ${e.message}`);
    failed++;
    return;
  }
  try {
    ref = diffPatch(input);
  } catch (e) {
    console.log(`THROW ref [${label}]: ${e.message}`);
    failed++;
    return;
  }
  if (mine !== ref) {
    failed++;
    console.log(`MISMATCH [${label}] old=${JSON.stringify(oldText.slice(0, 200))} new=${JSON.stringify(newText.slice(0, 200))}`);
    if (failed <= 2) {
      console.log('--- mine ---'); console.log(mine.slice(0, 800));
      console.log('--- ref ---'); console.log(ref.slice(0, 800));
    }
  }
}

// --- targeted edge cases ---
const E = [
  ['', ''], ['', 'a\n'], ['a\n', ''], ['a', 'a'], ['a', 'b'], ['a\n', 'a\n'],
  ['a', 'a\n'], ['a\n', 'a'], ['\n', '\n'], ['\n', ''], ['', '\n'],
  ['a\nb\nc\n', 'a\nb\nc\n'], ['a\nb\nc\n', 'a\nx\nc\n'],
  ['a\nb\nc', 'a\nb\nc'], ['a\nb\nc', 'a\nb\nd'],
  ['x\n'.repeat(50), 'x\n'.repeat(50)], ['x\n'.repeat(50), 'x\n'.repeat(49)],
  ['x\n'.repeat(50), 'y\n' + 'x\n'.repeat(49)],
  ['a\r\nb\r\n', 'a\r\nb\r\n'], ['a\r\nb\r\n', 'a\nb\r\n'],
  ['a\rb\nc\n', 'a\rb\nc\n'], ['a\n\n\nb\n', 'a\n\nb\n'],
  ['}\n}\n}\n', '}\n}\n'], ['a\nb\n', 'b\na\n'],
  ['one\ntwo\nthree\nfour\n', 'four\nthree\ntwo\none\n'],
  ['a\nb\nc\nd\ne\nf\ng\n', 'a\nc\nd\nx\ne\nf\ng\n'],
  ['\n\n\n', '\n\n'], ['a', ''], ['', 'a'],
  ['line\n'.repeat(200), 'line\n'.repeat(200).replace('line\n', 'LINE\n')],
];
for (const [o, n] of E) check(o, n, 'edge');

// --- random small cases: tiny vocab, so ties and repeated lines abound ---
const VOCAB = ['', '}', '  }', 'a', 'b', 'c', 'x', 'y', 'foo;', 'bar', 'end', '  return;', 'a\r', 'b\r', '\r'];
function randText(nLines, bare) {
  const lines = [];
  for (let i = 0; i < nLines; i++) lines.push(pick(VOCAB));
  if (lines.length === 0) return '';
  const body = lines.join('\n');
  return bare ? body : body + '\n';
}
function mutate(lines) {
  const out = [...lines];
  const ops = ri(0, 6);
  for (let k = 0; k < ops; k++) {
    const op = ri(0, 5);
    const at = out.length === 0 ? 0 : ri(0, out.length - 1);
    if (op === 0 && out.length > 0) out.splice(at, 1);
    else if (op === 1) out.splice(at, 0, pick(VOCAB));
    else if (op === 2 && out.length > 0) out[at] = pick(VOCAB);
    else if (op === 3 && out.length > 1 && at + 1 < out.length) [out[at], out[at + 1]] = [out[at + 1], out[at]];
    else if (op === 4 && out.length > 0) out.splice(at, 0, out[at]);
    else if (op === 5 && out.length > 3) {
      const len = ri(1, Math.min(4, out.length - at));
      const block = out.splice(at, len);
      out.splice(ri(0, out.length), 0, ...block);
    }
  }
  return out;
}
for (let t = 0; t < RANDOM_COUNT; t++) {
  const n = ri(0, 25);
  const base = Array.from({ length: n }, () => pick(VOCAB));
  const neu = mutate(base);
  const bareOld = rnd() < 0.3;
  const bareNew = rnd() < 0.3;
  const oldText = base.length === 0 ? '' : base.join('\n') + (bareOld ? '' : '\n');
  const newText = neu.length === 0 ? '' : neu.join('\n') + (bareNew ? '' : '\n');
  check(oldText, newText, `random-${t}`);
  if (failed > 5) break;
}

// --- random mutations of practice texts, sliced to a few hundred lines ---
const practice = JSON.parse(readFileSync(`${KIT}/practice/input/cases.json`, 'utf8'));
for (let t = 0; t < 120 && failed <= 5; t++) {
  const c = pick(practice).input;
  const oldLines = c.old.split('\n');
  const start = ri(0, Math.max(0, oldLines.length - 400));
  const slice = oldLines.slice(start, start + ri(50, 400));
  const neu = mutate(slice);
  const bare = rnd() < 0.3;
  check(slice.join('\n') + (bare ? '' : '\n'), neu.join('\n') + (bare ? '' : '\n'), `practice-mut-${t}`);
}

console.log(`fuzz: ${checked} checked, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
