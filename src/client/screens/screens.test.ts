/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

void describe('PRD Strict Screen Boundaries & Hygiene (Prompt 18)', () => {
  const startScreenContent = fs.readFileSync(path.join(__dirname, 'StartScreen.tsx'), 'utf-8');
  const playScreenContent = fs.readFileSync(path.join(__dirname, 'PlayScreen.tsx'), 'utf-8');
  const endCardContent = fs.readFileSync(path.join(__dirname, 'EndCard.tsx'), 'utf-8');
  const endCardModelContent = fs.readFileSync(path.join(__dirname, 'endCardModel.ts'), 'utf-8');
  const splashContent = fs.readFileSync(path.join(__dirname, '../splash.tsx'), 'utf-8');

  void it('StartScreen strictly contains Title, Date, Hook, Streak, and Play button', () => {
    // Allowed elements
    assert.ok(startScreenContent.includes('Dead Drop Route'), 'StartScreen must include title "Dead Drop Route"');
    assert.ok(startScreenContent.includes('{date}'), 'StartScreen must include date');
    assert.ok(startScreenContent.includes('Deliver clandestine packages through district gridlines before sunrise.'), 'StartScreen must include hook');
    assert.ok(startScreenContent.includes('STREAK: {streak}'), 'StartScreen must include streak');
    assert.ok(startScreenContent.includes('INITIALIZE RUN'), 'StartScreen must include Play button "INITIALIZE RUN"');

    // Forbidden non-PRD elements
    assert.ok(!startScreenContent.includes('milestone'), 'StartScreen must NOT include milestone badges');
    assert.ok(!startScreenContent.includes('ACHIEVEMENTS'), 'StartScreen must NOT include achievements');
    assert.ok(!startScreenContent.includes('achievements'), 'StartScreen must NOT accept achievements prop');
    assert.ok(!startScreenContent.includes('HINT'), 'StartScreen must NOT include hint');
  });

  void it('Splash visually aligns with StartScreen (matching title, hook, and CTA without telemetry clutter)', () => {
    assert.ok(splashContent.includes('Dead Drop Route'), 'Splash must include title "Dead Drop Route"');
    assert.ok(splashContent.includes('Deliver clandestine packages through district gridlines before sunrise.'), 'Splash must include concise hook');
    assert.ok(splashContent.includes('INITIALIZE RUN'), 'Splash must include CTA "INITIALIZE RUN"');

    // Forbidden clutter
    assert.ok(!splashContent.includes('COURIER HANDLE:'), 'Splash must NOT include courier handle');
    assert.ok(!splashContent.includes('TRANSIT PROTOCOL:'), 'Splash must NOT include transit protocol');
    assert.ok(!splashContent.includes('GRID STATUS:'), 'Splash must NOT include grid status telemetry');
    assert.ok(!splashContent.includes('Night Shift Courier'), 'Splash must NOT include old subtitle header');
  });

  void it('PlayScreen HUD strictly contains Day, Moves, Parcels left, and Reset button (no timer, no hint)', () => {
    // Allowed HUD elements
    assert.ok(playScreenContent.includes('DAY'), 'PlayScreen must include DAY');
    assert.ok(playScreenContent.includes('MOVES:'), 'PlayScreen must include MOVES');
    assert.ok(playScreenContent.includes('parcelsLeft'), 'PlayScreen must include parcels left');
    assert.ok(playScreenContent.includes('RESET ROUTE'), 'PlayScreen must include RESET ROUTE button');

    // Forbidden non-PRD elements
    assert.ok(!playScreenContent.includes('TIME:'), 'PlayScreen must NOT include TIME in HUD');
    assert.ok(!playScreenContent.includes('formattedTime'), 'PlayScreen must NOT accept formattedTime');
    assert.ok(!playScreenContent.includes('HINT'), 'PlayScreen must NOT include HINT button');
    assert.ok(!playScreenContent.includes('onHint'), 'PlayScreen must NOT accept onHint');
    assert.ok(!playScreenContent.includes('hintCoordinate'), 'PlayScreen must NOT accept hintCoordinate');
  });

  void it('EndCard strictly adheres to PRD elements (result, stars, streak, traffic, share, back tomorrow)', () => {
    // Allowed elements
    assert.ok(endCardContent.includes('resultHeading'), 'EndCard must render result heading');
    assert.ok(endCardContent.includes('starsGlyphs'), 'EndCard must render star rating');
    assert.ok(endCardContent.includes('streakText'), 'EndCard must render streak');
    assert.ok(endCardContent.includes('trafficDisplayText'), 'EndCard must render traffic threshold info');
    assert.ok(endCardContent.includes('LOG ROUTE TO DISPATCH'), 'EndCard must render Share CTA');
    assert.ok(endCardContent.includes('backTomorrowText'), 'EndCard must render "Back tomorrow" text');

    // Forbidden non-PRD elements
    assert.ok(!endCardContent.includes('elapsedMs'), 'EndCard must NOT display solve timer');
    assert.ok(!endCardContent.includes('fasterThanPercent'), 'EndCard must NOT display percentile module');
    assert.ok(!endCardContent.includes('newAchievements'), 'EndCard must NOT display achievement banner');
    assert.ok(!endCardContent.includes('onPlayAgain'), 'EndCard must NOT include practice play button');
    assert.ok(!endCardContent.includes('PLAY AGAIN'), 'EndCard must NOT include PLAY AGAIN');

    // Model fields hygiene
    assert.ok(!endCardModelContent.includes('formattedTime'), 'EndCardViewModel must NOT contain formattedTime');
    assert.ok(!endCardModelContent.includes('fasterThanPercent'), 'EndCardViewModel must NOT contain fasterThanPercent');
    assert.ok(!endCardModelContent.includes('milestoneBadge'), 'EndCardViewModel must NOT contain milestoneBadge');
    assert.ok(!endCardModelContent.includes('newAchievementBadges'), 'EndCardViewModel must NOT contain newAchievementBadges');
  });

  void it('StartScreen button displays "VIEW RESULT" when hasAttempt is true and "INITIALIZE RUN" when false', () => {
    assert.ok(
      startScreenContent.includes("hasAttempt ? 'VIEW RESULT' : 'INITIALIZE RUN'"),
      'StartScreen button must toggle between VIEW RESULT and INITIALIZE RUN based on hasAttempt'
    );
  });

  void it('StartScreen provides clear first-time player instructions and 00:00 UTC reset notice', () => {
    // Instructions coverage per Task 5B specification
    assert.ok(startScreenContent.includes('Deliver all 3 packages (D1–D3) in any order; no need to return to HQ.'), 'Must explain delivering all 3 in any order without return to HQ');
    assert.ok(startScreenContent.includes('Tap adjacent reachable tiles to move; desktop also supports arrow keys/WASD.'), 'Must explain tap and desktop movement controls');
    assert.ok(startScreenContent.includes('congested tiles (+2) cost 2 moves'), 'Must explain congested tile cost');
    assert.ok(startScreenContent.includes('Relay tiles (⚡) restore 2 moves once per run'), 'Must explain relay bonus mechanic');
    assert.ok(startScreenContent.includes('00:00 UTC'), 'Must state daily reset occurs at 00:00 UTC');
    assert.ok(startScreenContent.includes('Reopen post after 00:00 UTC to refresh'), 'Must not promise automatic webview refresh across midnight');
  });

  void it('PlayScreen includes responsive compact tile legend with HQ, D1-D3, congested, relay, and wall', () => {
    assert.ok(playScreenContent.includes('HQ'), 'Legend must include HQ');
    assert.ok(playScreenContent.includes('D1–D3'), 'Legend must include D1-D3');
    assert.ok(playScreenContent.includes('+2'), 'Legend must include +2 cost');
    assert.ok(playScreenContent.includes('⚡'), 'Legend must include relay ⚡');
    assert.ok(playScreenContent.includes('■'), 'Legend must include wall ■');
    assert.ok(playScreenContent.includes('flex-wrap'), 'Legend must wrap on narrow mobile viewports');
  });

  void it('EndCard clarifies 00:00 UTC reset without countdown timer', () => {
    assert.ok(endCardContent.includes('00:00 UTC'), 'EndCard must state 00:00 UTC reset');
    assert.ok(endCardContent.includes('reopen or refresh to load'), 'EndCard must clarify manual reload/reopen requirement');
    // Ensure no timers or countdowns were added
    assert.ok(!endCardContent.includes('countdown'), 'Must not contain countdown');
    assert.ok(!endCardContent.includes('timer'), 'Must not contain timer');
  });

  void it('Board visually distinguishes adjacent, affordable, passable tiles as legal moves and disables illegal tiles', () => {
    const boardContent = fs.readFileSync(path.join(__dirname, '../components/Board.tsx'), 'utf-8');
    assert.ok(boardContent.includes('isLegalMove'), 'Board must track isLegalMove state');
    assert.ok(boardContent.includes('isAffordable'), 'Board must evaluate tile affordability');
    assert.ok(boardContent.includes('LEGAL MOVE'), 'Accessible aria-label must identify legal moves');
    assert.ok(boardContent.includes('disabled={!isLegalMove}'), 'Board button must bind disabled directly to !isLegalMove');
    assert.ok(!boardContent.includes('isClickable'), 'Redundant isClickable must be eliminated');
    assert.ok(!boardContent.includes('disabled={isInputLocked || !isAdjacent}'), 'Outdated disabled={isInputLocked || !isAdjacent} must not exist');
  });
});
