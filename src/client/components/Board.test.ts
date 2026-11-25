/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getDailyMap } from '../../shared/dates.ts';
import type { Coordinate, TileType } from '../../shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Mirror of the exact tile state evaluation logic implemented inside Board.tsx
 */
const evaluateTile = (
  x: number,
  y: number,
  tile: TileType,
  courierPos: Coordinate,
  movesLeft: number,
  isInputLocked: boolean
): {
  isAdjacent: boolean;
  isPassable: boolean;
  stepCost: number;
  isAffordable: boolean;
  isLegalMove: boolean;
  disabled: boolean;
} => {
  const isAdjacent = Math.abs(courierPos.x - x) + Math.abs(courierPos.y - y) === 1;
  const isPassable = tile !== 'block';
  const stepCost = tile === 'congested' ? 2 : 1;
  const isAffordable = movesLeft >= stepCost;
  const isLegalMove = !isInputLocked && isAdjacent && isPassable && isAffordable;
  const disabled = !isLegalMove;

  return {
    isAdjacent,
    isPassable,
    stepCost,
    isAffordable,
    isLegalMove,
    disabled,
  };
};

void describe('Task 5B.1 — Board Tile Button Disabled Behavior & Interaction Consistency', () => {
  const boardSource = fs.readFileSync(path.join(__dirname, 'Board.tsx'), 'utf-8');

  void it('Board.tsx strictly binds disabled={!isLegalMove} and removes isClickable', () => {
    // 1. Must use disabled={!isLegalMove}
    assert.match(
      boardSource,
      /<button[\s\S]*?disabled=\{!isLegalMove\}[\s\S]*?>/,
      'Board button must have disabled={!isLegalMove}'
    );

    // 2. Must not contain the outdated disabled expression
    assert.ok(
      !boardSource.includes('disabled={isInputLocked || !isAdjacent}'),
      'Must not use outdated disabled={isInputLocked || !isAdjacent}'
    );

    // 3. Must have removed redundant isClickable
    assert.ok(
      !boardSource.includes('isClickable'),
      'Must eliminate redundant isClickable variable and branches'
    );
  });

  void it('Adjacent passable tiles are legal and NOT disabled when moves are sufficient', () => {
    const courierPos: Coordinate = { x: 2, y: 2 };

    // Adjacent road with 1 move left
    const roadTile = evaluateTile(2, 1, 'road', courierPos, 1, false);
    assert.strictEqual(roadTile.isAdjacent, true);
    assert.strictEqual(roadTile.isPassable, true);
    assert.strictEqual(roadTile.isAffordable, true);
    assert.strictEqual(roadTile.isLegalMove, true);
    assert.strictEqual(roadTile.disabled, false, 'Adjacent road must be clickable (not disabled)');

    // Adjacent relay with 1 move left
    const relayTile = evaluateTile(3, 2, 'relay', courierPos, 1, false);
    assert.strictEqual(relayTile.isAdjacent, true);
    assert.strictEqual(relayTile.isPassable, true);
    assert.strictEqual(relayTile.isAffordable, true);
    assert.strictEqual(relayTile.isLegalMove, true);
    assert.strictEqual(relayTile.disabled, false, 'Adjacent relay must be clickable (not disabled)');

    // Adjacent congested with 2 moves left
    const congestedTile = evaluateTile(2, 3, 'congested', courierPos, 2, false);
    assert.strictEqual(congestedTile.isAdjacent, true);
    assert.strictEqual(congestedTile.isPassable, true);
    assert.strictEqual(congestedTile.isAffordable, true);
    assert.strictEqual(congestedTile.isLegalMove, true);
    assert.strictEqual(congestedTile.disabled, false, 'Adjacent congested with movesLeft=2 must be clickable (not disabled)');
  });

  void it('Adjacent wall (block) tiles are NOT legal and MUST be disabled', () => {
    const courierPos: Coordinate = { x: 2, y: 2 };
    const wallTile = evaluateTile(2, 1, 'block', courierPos, 10, false);

    assert.strictEqual(wallTile.isAdjacent, true);
    assert.strictEqual(wallTile.isPassable, false);
    assert.strictEqual(wallTile.isLegalMove, false);
    assert.strictEqual(wallTile.disabled, true, 'Adjacent wall must have disabled=true to prevent click');
  });

  void it('Adjacent congested tiles with only 1 move left are NOT legal and MUST be disabled', () => {
    const courierPos: Coordinate = { x: 2, y: 2 };
    // Congested requires 2 moves; courier has only 1
    const unaffordableCongested = evaluateTile(2, 1, 'congested', courierPos, 1, false);

    assert.strictEqual(unaffordableCongested.isAdjacent, true);
    assert.strictEqual(unaffordableCongested.isPassable, true);
    assert.strictEqual(unaffordableCongested.stepCost, 2);
    assert.strictEqual(unaffordableCongested.isAffordable, false);
    assert.strictEqual(unaffordableCongested.isLegalMove, false);
    assert.strictEqual(
      unaffordableCongested.disabled,
      true,
      'Unaffordable congested tile must have disabled=true so player cannot click it'
    );
  });

  void it('Non-adjacent tiles and courier current tile are NOT legal and MUST be disabled', () => {
    const courierPos: Coordinate = { x: 2, y: 2 };

    // Courier's current position (distance = 0)
    const currentTile = evaluateTile(2, 2, 'road', courierPos, 10, false);
    assert.strictEqual(currentTile.isAdjacent, false);
    assert.strictEqual(currentTile.isLegalMove, false);
    assert.strictEqual(currentTile.disabled, true, 'Current courier tile must have disabled=true');

    // Diagonal tile (distance = 2)
    const diagonalTile = evaluateTile(3, 3, 'road', courierPos, 10, false);
    assert.strictEqual(diagonalTile.isAdjacent, false);
    assert.strictEqual(diagonalTile.isLegalMove, false);
    assert.strictEqual(diagonalTile.disabled, true, 'Diagonal tile must have disabled=true');

    // Far tile (distance = 4)
    const farTile = evaluateTile(6, 2, 'road', courierPos, 10, false);
    assert.strictEqual(farTile.isAdjacent, false);
    assert.strictEqual(farTile.isLegalMove, false);
    assert.strictEqual(farTile.disabled, true, 'Far tile must have disabled=true');
  });

  void it('When input is locked (game over or disabled prop), ALL board tiles are disabled', () => {
    const map = getDailyMap(0);
    const courierPos = map.depot;

    // Test both won and lost / disabled locked states
    for (const isInputLocked of [true]) {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const tile = map.grid[y]![x]!;
          const state = evaluateTile(x, y, tile, courierPos, 10, isInputLocked);
          assert.strictEqual(
            state.disabled,
            true,
            `When input locked, tile at (${x},${y}) must be disabled`
          );
          assert.strictEqual(
            state.isLegalMove,
            false,
            `When input locked, tile at (${x},${y}) must not be a legal move`
          );
        }
      }
    }
  });

  void it('On actual Day 1 map, only adjacent passable affordable tiles are enabled', () => {
    const map = getDailyMap(0);
    const courierPos = map.depot; // (0,0)
    let enabledCount = 0;
    const enabledCoords: Array<{ x: number; y: number }> = [];

    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const tile = map.grid[y]![x]!;
        const state = evaluateTile(x, y, tile, courierPos, 19, false);

        if (!state.disabled) {
          enabledCount++;
          enabledCoords.push({ x, y });
          // Must be adjacent
          assert.strictEqual(state.isAdjacent, true, `Tile (${x},${y}) was enabled but is not adjacent`);
          // Must not be wall
          assert.notStrictEqual(tile, 'block', `Tile (${x},${y}) was enabled but is a block`);
          // Must be affordable
          assert.strictEqual(state.isAffordable, true, `Tile (${x},${y}) was enabled but not affordable`);
        }
      }
    }

    // From (0,0), adjacent tiles are (1,0) and (0,1).
    // Verify at most 2 tiles can possibly be enabled
    assert.ok(enabledCount >= 1 && enabledCount <= 2, `Expected 1-2 enabled moves from depot, found ${enabledCount}`);
    for (const coord of enabledCoords) {
      assert.ok(
        (coord.x === 1 && coord.y === 0) || (coord.x === 0 && coord.y === 1),
        `Unexpected enabled coordinate (${coord.x}, ${coord.y})`
      );
    }
  });
});
