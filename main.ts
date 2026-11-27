// The harness driver: it runs as `node /bot/main.ts` (Node 22). It loads the
// cases from /input/cases.json, answers each one alone with run() from
// solve.js, and drops the answers in order into /output/answers.json.
// Outside a container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in
// for /input and /output.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// Switch V8's incremental marking off first, so solve.js does all of its
// work under the same setting the house baseline is timed with.
setFlagsFromString('--no-incremental-marking');

// solve.js is a plain .js module, so it comes in by URL and is typed here
// by the contract it keeps: run(input) answers one case.
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as {
  id: string;
  input: unknown;
}[];

const answers = cases.map((c) => run(c.input));
writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
