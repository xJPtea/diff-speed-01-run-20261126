# diff-speed-01-run-20261126 — a faster drop-in for makefun-diff 1.0.0

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/xJPtea/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/xJPtea/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A dependency-free ES module (`solve.js`) whose `run(input)` returns exactly
what make.fun's makefun-diff 1.0.0 returns for `{old, new}` — the same patch
string, byte for byte — in about a third of the CPU time. `main.ts` is the
harness driver: it reads every case from `/input/cases.json` and writes the
answers to `/output/answers.json`.

## The policy, exactly

A text is cut after every `\n`, a last line without one kept as a line; two
lines are equal only when they are the same code units, newline or its
absence included. The common prefix is kept, then the common suffix of what
is left; between them Myers's greedy search runs from the first lines,
keeping on each diagonal the path reaching furthest into the old text, with
the deletion winning when deletion and insertion reach the same point, never
moving past either text's end and pruning no edge diagonal; the first path
to reach both ends is the script. The patch header reads
`makefun-diff/1 old=N new=M hunks=H deleted=D inserted=I`, then each hunk
`@ os ol ns nl` with `=`/`-`/`+` lines, 3 lines of context, `%` after a
line with no trailing newline; identical texts are the header alone.

## How it is faster

The reference builds a path object per search cell (millions of them) and
compares strings. This entry never does either in the hot loop:

- Lines are numbered once per case in a `Map`, so the search compares
  small integers, not strings.
- The search keeps only the furthest old-line count per (d, k) in flat
  `Int32Array` rows (stored as x + 1, so 0 means unreachable), with the
  rows pooled as scratch across cases; no object is allocated per cell.
- Edge diagonals are handled outside the interior loop, so the interior
  needs no index guards.
- Candidate validity is one branchless unsigned comparison per side:
  `(v - 1) >>> 0` is the consumed count, or 2^32 - 1 when the diagonal
  was unreachable, which fails the bounds test on its own.
- The script is rebuilt by walking that history backwards, re-applying
  the reference's exact choice rule (including its boundary checks and
  deletion-wins tie-break) at every step.

## Benchmarks (practice set, 4 cases, ~21–32k lines each, this VM)

| measurement | this entry | makefun-diff 1.0.0 | speedup |
|-------------|-----------|-------------------|---------|
| `run()` CPU time, median of 9 rounds (`process.cpuUsage`, alternating with the reference) | 394 ms total (91–106 ms/case) | 1,388 ms total | **3.52x** |
| whole driver, wall clock, mean of 7 fresh `node main.ts` runs | 719 ms | 1,610 ms | 2.24x |

The wall-clock figure is diluted by ~350 ms of fixed process cost both
entries pay (Node start-up, type-stripping `main.ts`, parsing `cases.json`);
the heat scores CPU time net of the null-entry control, so the CPU figure
is the one that ranks.

Exactness on the practice set: **4/4 cases match `expected.json`**, byte
for byte, and two runs are byte-identical. Differential fuzzing against
the reference vendor code: **8,578 inputs, 0 divergences** (targeted edge
cases, 8,000 random small cases, practice-text mutations, and 128 larger
random texts of 300–2,000 lines).

## Files

- `solve.js` — the differ (dependency-free ES module, `run(input)`).
- `main.ts` — the harness driver (Node 22, turns V8 incremental marking off).
- `package.json` — `{"type": "module"}`, so `solve.js` parses as ESM first time.
- `test_entry.mjs` — practice-set check + benchmark vs the baseline.
- `fuzz_entry.mjs` — differential fuzz vs the reference vendor code.
- `BUILD_LOG.md` — plan, verification results, post-mortem.
