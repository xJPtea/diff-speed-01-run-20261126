# BUILD_LOG — diff-speed-01-run-20261126

Entry: "Diff two texts faster, 27 November 2026" (program/v1, pot $100,
10 places x $10, deadline 29 Nov 2026 13:07 WIB, 1,018 entries).
Builder session id: 0175d82e-9202-4bad-b240-fdf60c2e7379.

## (a) Technical plan

Goal: a dependency-free ES module `solve.js` exporting `run(input)` that
returns exactly what makefun-diff 1.0.0 returns for every `{old, new}`,
at least 3x faster than the house baseline on the practice set (4 cases,
~21–32k lines each, D* ≈ 3,500–4,000 edits per case).

Design (written from the reference's stated rules, in my own words):

- Cut lines after every `\n` (last line without one kept as a line).
- Intern each distinct line to an integer id once per case (`Map`), so the
  search compares ints, not strings. Keep the string arrays for rendering.
- Trim the common prefix, then the common suffix, on the id arrays.
- Myers forward search on the middle, storing only the furthest old-line
  count per (d, k) in flat `Int32Array` rows (x + 1 encoding, so 0 means
  unreachable), pooled as scratch across cases. No per-cell objects.
- Edge diagonals (k = -d, k = d) handled outside the interior loop, so the
  interior needs no index guards. Candidate validity is one branchless
  unsigned comparison per side (`(v - 1) >>> 0` is the count, or 2^32 - 1
  when unreachable, which fails the bounds test on its own).
- First (d, k) in scan order reaching both ends defines the script; walk
  the row history backwards re-applying the reference's exact choice rule
  (boundary checks, deletion wins ties) to recover the edit script.
- Render the patch per the reference's hunk rules (3 context lines,
  runs <= 6 kept lines apart share a hunk, `%` after no-trailing-newline
  lines, header only for identical texts).
- `main.ts` driver mirrors the baseline's structure (set
  `--no-incremental-marking` before importing `solve.js`, read
  `/input/cases.json` or `$MAKEFUN_INPUT_DIR`, write
  `/output/answers.json` or `$MAKEFUN_OUTPUT_DIR`), written in my own words.
- Repo: `solve.js`, `main.ts`, `package.json` (`{"type": "module"}` so
  `solve.js` parses as ESM first time), `README.md`, MIT `LICENSE`,
  `.makefun/owner.json` (wallet FhuQ1EuPsWqCUMJJs66VU3qAAV6RtSVBFPh8uoTkgSEA),
  `test_entry.mjs`, `fuzz_entry.mjs`, this log. Total 20,935 bytes (< 1 MiB).

## (b) Verification results

Practice set (`test_entry.mjs`, 7 fresh-process runs each):

- Exactness: **4/4 cases identical** to `practice/reference/expected.json`,
  byte for byte (g-0001..g-0004 all MATCH).
- Determinism: two runs byte-identical.
- `run()` CPU time (in-process, `process.cpuUsage`, median of 9 rounds
  alternating with the reference): **394.3 ms total** (g-0001 105.7,
  g-0002 103.9, g-0003 90.4, g-0004 94.4) vs reference **1,387.9 ms** →
  **3.52x speedup**. (An earlier 9-round run gave 413.0 ms vs 1,309.0 ms,
  3.17x; the VM is noisy, medians move ~5%.)
- Whole driver, wall clock, mean of 7 fresh `node main.ts` runs:
  **718.9 ms** vs baseline **1,610.2 ms → 2.24x**. The wall figure is
  diluted by ~350 ms of fixed process cost both entries pay (Node
  start-up, type-stripping `main.ts`, parsing `cases.json`); the heat
  scores CPU time net of the null-entry control, so the CPU figure is
  the one that ranks.
- Baseline measured beside it on this VM: ~1.9 s total in the parent's
  first measurement, 1,555–1,768 ms per run in the final 7-run comparison.

Fuzzing (differential, vs the reference vendor `diffPatch`):

- `fuzz_entry.mjs` seeds 12345, 777 and 999, 3,000 / 3,000 / 2,000 random
  small cases each: **8,514 checked, 0 failed** (includes 30 targeted edge
  cases: empty texts, one line, no trailing newline, CRLF, identical
  texts, all-deleted, all-inserted, repeated lines, swapped lines, moved
  blocks; plus 120 practice-text mutations per seed run).
- Large random texts (300–2,000 lines, seed 20261127, `/tmp/fuzz-big.mjs`):
  **64 checked, 0 failed** (includes identical 5,000-line texts,
  all-deleted / all-inserted 3,000-line texts, CRLF texts), run twice.
- Total: **8,578 fuzz inputs, 0 divergences**.

Repo size: **20,935 bytes**, under the 1,048,576-byte cap.

## (c) What worked / failed / post-mortem

What worked:

- The integer-interning + flat-V-history design was right: the reference
  spends its time allocating a path object per search cell (6–8M cells per
  case), and removing that allocation is most of the win.
- Profiling by phase before optimising: the snake is only ~0.03M steps per
  case, so snake work was never the cost; the cell loop was.
- CPU-time measurement (`process.cpuUsage`) instead of wall clock: the
  shared VM's wall clock swings ±40% run to run, which made early
  end-to-end comparisons (1.87x, then 2.08x) look worse than the scored
  CPU ratio. Alternating in-process CPU medians are stable to ~5%.
- The branchless validity check (`(v - 1) >>> 0`) saved ~12 ms/case in
  isolation and reproduced in the full entry (394 ms vs 413 ms).

What failed / cost time:

- v1 (rows of `Int32Array` with `fill(-1)`, per-cell index guards):
  4/4 correct but only 1.87x wall / ~2.9x CPU — not enough margin.
- A first microbenchmark "improvement" (flat slab layout) measured slower
  and was discarded; loop shape barely mattered, edge-splitting did.
- My draft microbenchmarks carried a tie-break bug (`vDown >= vUp`
  instead of `vDown + 1 >= vUp` in x + 1 encoding) and an unchecked-snake
  runaway at (n, m) (both out-of-bounds reads are `undefined` and compare
  equal). Both were caught by reasoning before they reached `solve.js` —
  the shipped code has the correct rule and a bounded snake — but they
  show why the fuzz step must run after every search change. A `const ny`
  slip also broke one run and was fixed immediately.
- The sentinel-padded-array idea (snake with no bounds check) measured
  slower, not faster: V8 bounds-checks typed-array loads anyway, so the
  explicit check was nearly free. Discarded.
- Two `MEMORY.md` / people-index change notices arrived mid-build from
  other sessions (stickman skill install); unrelated, ignored.

Skill to improve:

- Microbenchmark discipline: warm up, use CPU time, repeat with medians,
  and re-verify every "win" in the full entry — three supposed wins in
  this build (flat slab, sentinel snake, pre-snake reach check) measured
  neutral or negative in situ, and only the branchless validity check
  survived both levels of measurement.
- The remaining cost is the O(D^2/2) cell loop itself (~58–70 ms/case);
  further gains would need a cheaper per-cell step or fewer cells, and any
  cell-pruning must be proven against the reference's exact tie-break,
  not just fuzzed — the generator deliberately makes many scripts equally
  short, so tie-breaks decide whole hunks.
