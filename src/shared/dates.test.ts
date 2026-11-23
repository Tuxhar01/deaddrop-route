/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { formatUtcDate, getDailyMap, getDailySeedIndex, getUtcDayIndex, LAUNCH_DATE_UTC, LAUNCH_EPOCH_MS, MS_PER_DAY, SEEDS } from './dates.ts';

void describe('Date and Daily Map Logic (src/shared/dates.ts)', () => {
  void it('should have a valid LAUNCH_DATE_UTC parseable to a timestamp', () => {
    assert.strictEqual(typeof LAUNCH_DATE_UTC, 'string');
    assert.ok(!Number.isNaN(LAUNCH_EPOCH_MS));
    assert.strictEqual(LAUNCH_DATE_UTC, '2026-11-23T00:00:00Z');
  });

  void it('should return dayIndex = 0 for any date on or before launch day', () => {
    const beforeLaunch = new Date(LAUNCH_EPOCH_MS - 1000 * 3600);
    assert.strictEqual(getUtcDayIndex(beforeLaunch), 0);

    const exactLaunch = new Date(LAUNCH_EPOCH_MS);
    assert.strictEqual(getUtcDayIndex(exactLaunch), 0);

    const laterLaunchDay = new Date(LAUNCH_EPOCH_MS + 1000 * 3600 * 12);
    assert.strictEqual(getUtcDayIndex(laterLaunchDay), 0);
  });

  void it('should compute integer days elapsed correctly for subsequent days', () => {
    const day1 = new Date(LAUNCH_EPOCH_MS + MS_PER_DAY);
    assert.strictEqual(getUtcDayIndex(day1), 1);

    const day1Later = new Date(LAUNCH_EPOCH_MS + MS_PER_DAY + 1000 * 3600 * 18);
    assert.strictEqual(getUtcDayIndex(day1Later), 1);

    const day15 = new Date(LAUNCH_EPOCH_MS + 15 * MS_PER_DAY);
    assert.strictEqual(getUtcDayIndex(day15), 15);
  });

  void it('should format UTC dates cleanly as YYYY-MM-DD', () => {
    const d = new Date(Date.UTC(2026, 10, 23, 14, 30, 0)); // Nov 23, 2026
    assert.strictEqual(formatUtcDate(d), '2026-11-23');

    const d2 = new Date(Date.UTC(2027, 0, 5, 2, 0, 0)); // Jan 5, 2027
    assert.strictEqual(formatUtcDate(d2), '2027-01-05');
  });

  void it('should compute seed index using non-negative modulo', () => {
    assert.strictEqual(getDailySeedIndex(0), 0);
    assert.strictEqual(getDailySeedIndex(14), 14);
    assert.strictEqual(getDailySeedIndex(15), 0); // 15 % 15 = 0
    assert.strictEqual(getDailySeedIndex(16), 1); // 16 % 15 = 1
    assert.strictEqual(getDailySeedIndex(30), 0);
  });

  void it('should retrieve today map deterministically and retain 7x7 structure', () => {
    assert.strictEqual(SEEDS.length, 15);

    for (let day = 0; day < 30; day++) {
      const map = getDailyMap(day);
      assert.ok(map);
      assert.strictEqual(map.grid.length, 7);
      assert.strictEqual(map.grid[0]?.length, 7);
      assert.strictEqual(map.drops.length, 3);
      assert.strictEqual(map.id, SEEDS[day % 15]?.id);
    }
  });
});
