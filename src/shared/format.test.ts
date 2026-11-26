/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { formatSectorName, toStarGlyphs, formatDispatchSummary } from './format.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getDailyMap } from './dates.ts';

void describe('Shared Format Utilities: formatSectorName & toStarGlyphs', () => {
  void it('formats standard sector ID into human-readable Sector XX: Name format', () => {
    assert.strictEqual(formatSectorName('sector-04-neon-quarter'), 'Sector 04: Neon Quarter');
    assert.strictEqual(formatSectorName('sector-01-downtown-core'), 'Sector 01: Downtown Core');
    assert.strictEqual(formatSectorName('sector-15-harbor-industrial'), 'Sector 15: Harbor Industrial');
  });

  void it('formats non-standard hyphenated names cleanly', () => {
    assert.strictEqual(formatSectorName('industrial-zone'), 'Industrial Zone');
    assert.strictEqual(formatSectorName('cyber-highway-loop'), 'Cyber Highway Loop');
  });

  void it('handles undefined, empty, or whitespace-only sector IDs safely', () => {
    assert.strictEqual(formatSectorName(undefined), 'Classified Sector');
    assert.strictEqual(formatSectorName(''), 'Classified Sector');
    assert.strictEqual(formatSectorName('   '), 'Classified Sector');
  });

  void it('formats all 15 daily seed maps successfully with valid Sector titles', () => {
    for (let i = 0; i < 15; i++) {
      const map = getDailyMap(i);
      assert.ok(map.id, `Map ${i} should have an id`);
      const formatted = formatSectorName(map.id);
      assert.ok(formatted.length > 5, `Formatted sector name for map ${i} should be descriptive`);
      assert.ok(
        !formatted.includes('undefined') && !formatted.includes('null'),
        `Formatted name for map ${i} must not contain undefined or null`
      );
    }
  });

  void it('toStarGlyphs converts star counts correctly for won runs', () => {
    assert.strictEqual(toStarGlyphs(3, true), '★★★');
    assert.strictEqual(toStarGlyphs(2, true), '★★☆');
    assert.strictEqual(toStarGlyphs(1, true), '★☆☆');
    assert.strictEqual(toStarGlyphs(0, true), '☆☆☆');
  });

  void it('toStarGlyphs always returns empty stars for lost runs regardless of star value', () => {
    assert.strictEqual(toStarGlyphs(3, false), '☆☆☆');
    assert.strictEqual(toStarGlyphs(2, false), '☆☆☆');
    assert.strictEqual(toStarGlyphs(1, false), '☆☆☆');
    assert.strictEqual(toStarGlyphs(0, false), '☆☆☆');
  });
});

void describe('Shared Format Utilities: formatDispatchSummary & Strict Spoiler Safety', () => {
  void it('formats a winning 3-star dispatch summary with par, sector name, and streak', () => {
    const summary = formatDispatchSummary({
      dayIndex: 3,
      sectorId: 'sector-04-neon-quarter',
      won: true,
      movesUsed: 18,
      par: 20,
      stars: 3,
      streak: 5,
    });

    assert.ok(summary.includes('📦 **DeadDrop Route — Night Shift Dispatch #4**'));
    assert.ok(summary.includes('Sector 04: Neon Quarter'));
    assert.ok(summary.includes('- **Status**: Route Delivered'));
    assert.ok(summary.includes('- **Rating**: ★★★'));
    assert.ok(summary.includes('- **Moves Used**: 18 / 20 (Par)'));
    assert.ok(summary.includes('- **Courier Streak**: 5 days'));
    assert.ok(summary.includes("Can you beat tonight's par? Route your run in r/deaddrop_route."));
  });

  void it('formats a lost run with Out of Moves and empty stars', () => {
    const summary = formatDispatchSummary({
      dayIndex: 0,
      sectorId: 'sector-01-downtown-core',
      won: false,
      movesUsed: 22,
      par: 18,
      stars: 0,
      streak: 0,
    });

    assert.ok(summary.includes('📦 **DeadDrop Route — Night Shift Dispatch #1**'));
    assert.ok(summary.includes('Sector 01: Downtown Core'));
    assert.ok(summary.includes('- **Status**: Out of Moves'));
    assert.ok(summary.includes('- **Rating**: ☆☆☆'));
    assert.ok(summary.includes('- **Moves Used**: 22 / 18 (Par)'));
    assert.ok(summary.includes('- **Courier Streak**: 0 days'));
  });

  void it('formats streak with singular vs plural grammar correctly', () => {
    const singular = formatDispatchSummary({
      dayIndex: 0,
      won: true,
      movesUsed: 15,
      stars: 3,
      streak: 1,
    });
    assert.ok(singular.includes('- **Courier Streak**: 1 day'));

    const plural = formatDispatchSummary({
      dayIndex: 0,
      won: true,
      movesUsed: 15,
      stars: 3,
      streak: 4,
    });
    assert.ok(plural.includes('- **Courier Streak**: 4 days'));
  });

  void it('resolves map par automatically from dayIndex when par is omitted', () => {
    const mapDay2 = getDailyMap(2);
    const summary = formatDispatchSummary({
      dayIndex: 2,
      won: true,
      movesUsed: 16,
      stars: 2,
      streak: 2,
    });

    assert.ok(summary.includes(`- **Moves Used**: 16 / ${mapDay2.par} (Par)`));
    assert.ok(summary.includes(formatSectorName(mapDay2.id)));
  });

  void it('uses custom subreddit parameter when provided', () => {
    const summary = formatDispatchSummary({
      dayIndex: 1,
      won: true,
      movesUsed: 14,
      stars: 3,
      streak: 2,
      subreddit: 'r/test_sub',
    });

    assert.ok(summary.includes('Route your run in r/test_sub.'));
  });

  void it('STRICT SPOILER SAFETY: dispatch summary contains zero coordinates, visited tiles, or path directions', () => {
    // Generate summaries for diverse scenarios
    const samples = [
      formatDispatchSummary({
        dayIndex: 0,
        sectorId: 'sector-01-downtown-core',
        won: true,
        movesUsed: 14,
        par: 16,
        stars: 3,
        streak: 3,
      }),
      formatDispatchSummary({
        dayIndex: 7,
        won: false,
        movesUsed: 25,
        par: 22,
        stars: 0,
        streak: 0,
      }),
    ];

    for (const text of samples) {
      // Must not contain coordinate representations
      assert.ok(!/\(\s*\d+\s*,\s*\d+\s*\)/.test(text), 'Must not contain coordinate tuples like (x, y)');
      assert.ok(!/\[\s*\d+\s*,\s*\d+\s*\]/.test(text), 'Must not contain coordinate arrays like [x, y]');
      assert.ok(!/[xy]\s*[:=]\s*\d+/i.test(text), 'Must not contain x: or y: coordinates');

      // Must not contain movement directions
      assert.ok(!/\b(UP|DOWN|LEFT|RIGHT|NORTH|SOUTH|EAST|WEST)\b/i.test(text), 'Must not contain cardinal directions');

      // Must not contain tile type reveals or internal engine tokens
      assert.ok(!/\b(congested|relay|drop|parcel|block|barrier|wall)\b/i.test(text), 'Must not reveal tile types');

      // Must not contain path sequences or solution arrays
      assert.ok(!/steps|path|route_nodes|visited/i.test(text), 'Must not contain path or step references');
    }
  });
});
