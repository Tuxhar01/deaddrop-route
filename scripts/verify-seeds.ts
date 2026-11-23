import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { validateMap } from '../src/shared/rules.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { solveMapDetailed } from '../src/shared/solver.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import type { GameMap } from '../src/shared/types.ts';

const SEEDS_PATH = path.resolve(process.cwd(), 'src/shared/seeds.json');

export const verifySeeds = (): void => {
  console.log(`[Seed Validator] Reading seeds from ${SEEDS_PATH}...`);

  if (!fs.existsSync(SEEDS_PATH)) {
    console.error(`[Seed Validator ERROR] seeds.json not found at ${SEEDS_PATH}`);
    process.exit(1);
  }

  let rawData: unknown;
  try {
    const fileContent = fs.readFileSync(SEEDS_PATH, 'utf-8');
    rawData = JSON.parse(fileContent);
  } catch (err) {
    console.error(`[Seed Validator ERROR] Failed to parse seeds.json:`, err);
    process.exit(1);
  }

  if (!Array.isArray(rawData)) {
    console.error(`[Seed Validator ERROR] seeds.json must contain a JSON array of maps.`);
    process.exit(1);
  }

  if (rawData.length !== 15) {
    console.error(
      `[Seed Validator ERROR] seeds.json must contain exactly 15 maps, found ${rawData.length}.`
    );
    process.exit(1);
  }

  const maps = rawData as GameMap[];
  const results: Array<{ id: string; minMoves: number; par: number; status: string }> = [];
  const errors: string[] = [];

  for (let i = 0; i < maps.length; i++) {
    const map = maps[i];
    const mapId = map?.id ?? `seed-${i + 1}`;

    if (!map) {
      errors.push(`Map at index ${i} is null or undefined.`);
      continue;
    }

    // 1. Structure validation
    const validation = validateMap(map);
    if (!validation.valid) {
      errors.push(`Map "${mapId}" failed structural validation: ${validation.errors.join('; ')}`);
      continue;
    }

    // 2. Ensure presence of relay and congested tiles
    let hasRelay = false;
    let hasCongested = false;
    for (let r = 0; r < map.grid.length; r++) {
      const row = map.grid[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        if (row[c] === 'relay') hasRelay = true;
        if (row[c] === 'congested') hasCongested = true;
      }
    }

    if (!hasRelay) {
      errors.push(`Map "${mapId}" is missing required 'relay' tile(s).`);
    }
    if (!hasCongested) {
      errors.push(`Map "${mapId}" is missing required 'congested' tile(s).`);
    }

    // 3. Solver check: must be solvable
    const solved = solveMapDetailed(map);
    if (!solved) {
      errors.push(`Map "${mapId}" is UNSOLVABLE by BFS solver (all 3 drops unreachable).`);
      continue;
    }

    const minMoves = solved.minMoves;

    // 4. Par range check: minMoves <= par <= minMoves + 4
    const minAllowedPar = minMoves;
    const maxAllowedPar = minMoves + 4;

    if (map.par < minAllowedPar || map.par > maxAllowedPar) {
      errors.push(
        `Map "${mapId}" par violation: par is ${map.par}, but must be between ${minAllowedPar} and ${maxAllowedPar} (minMoves: ${minMoves}).`
      );
      continue;
    }

    results.push({
      id: mapId,
      minMoves,
      par: map.par,
      status: 'VALID',
    });
  }

  if (errors.length > 0) {
    console.error('\n========================================');
    console.error(`[Seed Validator FAILED] ${errors.length} error(s) found:`);
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    console.error('========================================\n');
    process.exit(1);
  }

  console.log('\n[Seed Validator] All 15 seeds successfully verified:\n');
  console.log('Index | Seed ID                  | Min Moves | Par | Status');
  console.log('------+--------------------------+-----------+-----+--------');
  results.forEach((r, idx) => {
    const num = String(idx + 1).padStart(5, ' ');
    const id = r.id.padEnd(24, ' ');
    const mm = String(r.minMoves).padStart(9, ' ');
    const par = String(r.par).padStart(3, ' ');
    console.log(`${num} | ${id} | ${mm} | ${par} | ${r.status}`);
  });
  console.log('------+--------------------------+-----------+-----+--------\n');
  console.log('[Seed Validator] Build verification PASSED.\n');
};

verifySeeds();

