// A faster drop-in for makefun-diff 1.0.0: run(input) returns make.fun's own
// patch of { old, new } as one string, byte for byte. Dependency-free.
//
// How it gets there: lines are cut the same way the reference cuts them
// (after every "\n", a last line without one kept as a line), then each
// distinct line is numbered once per case in a Map, so the search compares
// small integers instead of strings. The common prefix and suffix are trimmed on those numbers. The middle is diffed with Myers's
// greedy search, keeping only the furthest old-line count per (d, k) in
// flat Int32Array rows — no object per cell — and the script is rebuilt by
// walking that history backwards with the reference's own choice rule.
// The patch is rendered from the runs with the reference's hunk rules.
//
// The choice rule, exactly as the reference states it: on diagonal k at
// depth d, the deletion candidate comes from (d-1, k-1) and the insertion
// candidate from (d-1, k+1); a candidate counts only when its move stays
// inside its text; the deletion wins when both moves land equally far into
// the old text. The first (d, k) scanned in d-ascending, k-ascending order
// whose snake reaches both ends defines the script. (At any depth only
// k = n - m can reach both ends, so the scan order fixes the minimal depth.)
//
// Numbering note: a row stores x + 1, where x is the old lines consumed,
// so 0 means "that diagonal was unreachable at that depth" and a freshly
// allocated row already reads as unreachable. Rows live in one pool that
// is reused across cases as scratch only: every cell a search reads is
// rewritten by that search first, so no result ever carries from one case
// to the next.

const KEEP = 0;
const DEL = 1;
const INS = 2;

/** Cut a text into lines, each keeping its "\n" except a last line without one. */
function splitLines(text) {
  const out = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) {
      if (start < text.length) out.push(text.slice(start));
      return out;
    }
    out.push(text.slice(start, nl + 1));
    start = nl + 1;
  }
}

/** Number each distinct line, sharing one table for both texts of a case. */
function intern(lines, table) {
  const ids = new Int32Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i];
    let id = table.get(s);
    if (id === undefined) {
      id = table.size;
      table.set(s, id);
    }
    ids[i] = id;
  }
  return ids;
}

/** Scratch rows for the search, one per depth, reused across cases. */
const rowPool = [];

/** Fetch (allocating on first use) the row for depth d: 2d + 1 cells. */
function rowFor(d) {
  let row = rowPool[d];
  if (row === undefined) {
    row = new Int32Array(2 * d + 1);
    rowPool[d] = row;
  }
  return row;
}

/**
 * The edit runs of the middle slice a[a0..a1) into b[b0..b1), as
 * [kind, count] pairs in order. Runs use the counts convention: x old
 * lines and y new lines consumed, diagonal k = x - y.
 */
function middleRuns(a, b, a0, a1, b0, b1) {
  const n = a1 - a0;
  const m = b1 - b0;
  if (n === 0 && m === 0) return [];
  const A = a.subarray(a0, a1);
  const B = b.subarray(b0, b1);

  // Depth 0: the snake from the start.
  let x = 0;
  let y = 0;
  while (x < n && y < m && A[x] === B[y]) {
    x++;
    y++;
  }
  rowFor(0)[0] = x + 1;
  if (x === n && y === m) return x > 0 ? [[KEEP, x]] : [];

  let dStar = -1;
  let kStar = 0;
  for (let d = 1; d <= n + m; d++) {
    const prev = rowPool[d - 1];
    const cur = rowFor(d);
    let found = false;

    // Edge k = -d: only the insertion from the previous row's first cell.
    {
      const k = -d;
      const vUp = prev[0];
      // Branchless validity: vUp holds x + 1 (0 when unreachable), so
      // (vUp - 1) >>> 0 is the old lines consumed, or 2^32 - 1 when there
      // is no path; the insertion's new line is that minus k, and it must
      // stay inside the new text.
      if (((vUp - 1) >>> 0) - k <= m) {
        let nx = vUp - 1;
        let ny = nx - k;
        while (nx < n && A[nx] === B[ny]) {
          nx++;
          ny++;
        }
        cur[0] = nx + 1;
        if (nx === n && ny === m) {
          dStar = d;
          kStar = k;
          found = true;
        }
      } else {
        cur[0] = 0;
      }
    }

    // Interior diagonals: both neighbours exist, so no index guards.
    if (!found) {
      for (let k = -d + 2, i = 2; k <= d - 2; k += 2, i += 2) {
        const vDown = prev[i - 2];
        const vUp = prev[i];
        // Branchless validity, as above: a deletion's old line is
        // (vDown - 1) >>> 0 and must stay inside the old text; an
        // insertion's new line is ((vUp - 1) >>> 0) - k and must stay
        // inside the new text. An unreachable diagonal reads as 2^32 - 1
        // and fails both tests.
        const canDel = ((vDown - 1) >>> 0) < n;
        const canIns = (((vUp - 1) >>> 0) - k) <= m;
        if (!canDel && !canIns) {
          cur[i] = 0;
          continue;
        }
        let nx;
        if (!canIns) nx = vDown;
        else if (!canDel) nx = vUp - 1;
        else nx = vDown + 1 >= vUp ? vDown : vUp - 1;
        let ny = nx - k;
        while (nx < n && A[nx] === B[ny]) {
          nx++;
          ny++;
        }
        cur[i] = nx + 1;
        if (nx === n && ny === m) {
          dStar = d;
          kStar = k;
          found = true;
          break;
        }
      }
    }

    // Edge k = d: only the deletion from the previous row's last cell.
    if (!found) {
      const k = d;
      const vDown = prev[2 * d - 2];
      if (((vDown - 1) >>> 0) < n) {
        let nx = vDown;
        let ny = nx - k;
        while (nx < n && A[nx] === B[ny]) {
          nx++;
          ny++;
        }
        cur[2 * d] = nx + 1;
        if (nx === n && ny === m) {
          dStar = d;
          kStar = k;
          found = true;
        }
      } else {
        cur[2 * d] = 0;
      }
    }

    if (found) break;
  }
  if (dStar < 0) throw new Error('diff: the search ended without reaching both ends');

  // Walk the history backwards from (dStar, kStar), re-applying the same
  // choice rule at every step to recover the exact script.
  const rev = [];
  let d = dStar;
  let k = kStar;
  let cx = rowPool[d][k + d] - 1;
  while (d > 0) {
    const prev = rowPool[d - 1];
    const i = k + d;
    const vDown = i >= 2 ? prev[i - 2] : 0;
    const vUp = i < prev.length ? prev[i] : 0;
    const canDel = ((vDown - 1) >>> 0) < n;
    const canIns = (((vUp - 1) >>> 0) - k) <= m;
    let del;
    if (!canIns) del = true;
    else if (!canDel) del = false;
    else del = vDown + 1 >= vUp;
    let x0;
    let px;
    let pk;
    if (del) {
      x0 = vDown;
      px = vDown - 1;
      pk = k - 1;
    } else {
      x0 = vUp - 1;
      px = vUp - 1;
      pk = k + 1;
    }
    const snake = cx - x0;
    if (snake > 0) rev.push([KEEP, snake]);
    rev.push([del ? DEL : INS, 1]);
    cx = px;
    k = pk;
    d--;
  }
  if (cx > 0) rev.push([KEEP, cx]);
  rev.reverse();

  const runs = [];
  for (let t = 0; t < rev.length; t++) {
    const kind = rev[t][0];
    const count = rev[t][1];
    const last = runs.length > 0 ? runs[runs.length - 1] : undefined;
    if (last !== undefined && last[0] === kind) last[1] += count;
    else runs.push([kind, count]);
  }
  return runs;
}

/** One patch line: op, the line, and "%" on its own line when it had no newline. */
function written(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/** makefun-diff 1.0.0's answer for one case's input { old, new }. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const aStr = splitLines(input.old);
  const bStr = splitLines(input.new);
  const n = aStr.length;
  const m = bStr.length;

  const table = new Map();
  const a = intern(aStr, table);
  const b = intern(bStr, table);

  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;

  const runs = [];
  const pushRun = (kind, count) => {
    if (count <= 0) return;
    const last = runs.length > 0 ? runs[runs.length - 1] : undefined;
    if (last !== undefined && last[0] === kind) last[1] += count;
    else runs.push([kind, count]);
  };
  pushRun(KEEP, prefix);
  const mid = middleRuns(a, b, prefix, n - suffix, prefix, m - suffix);
  for (let t = 0; t < mid.length; t++) pushRun(mid[t][0], mid[t][1]);
  pushRun(KEEP, suffix);

  // Change runs: each a stretch of deletions and insertions between keeps.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (let t = 0; t < runs.length; t++) {
    const kind = runs[t][0];
    const count = runs[t][1];
    if (kind === KEEP) {
      o += count;
      p += count;
      continue;
    }
    let c = changes.length > 0 ? changes[changes.length - 1] : undefined;
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === DEL) {
      c.dels += count;
      o += count;
      deleted += count;
    } else {
      c.ins += count;
      p += count;
      inserted += count;
    }
  }

  // Hunks: change runs at most 6 kept lines apart share one.
  const hunks = [];
  for (let t = 0; t < changes.length; t++) {
    const c = changes[t];
    const h = hunks.length > 0 ? hunks[hunks.length - 1] : undefined;
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 6) h.push(c);
    else hunks.push([c]);
  }

  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (let t = 0; t < hunks.length; t++) {
    const h = hunks[t];
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - 3);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(3, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (let u = 0; u < h.length; u++) {
      const c = h[u];
      for (; at < c.o; at++) out.push(written('=', aStr[at]));
      for (let i = 0; i < c.dels; i++) out.push(written('-', aStr[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written('+', bStr[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', aStr[at]));
  }
  return out.join('');
}
