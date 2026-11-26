/// <reference types="node" />
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { getEndCardViewModel, renderStarGlyphs } from './endCardModel.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { TRAFFIC_THRESHOLD } from '../../shared/constants.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { isClipboardSupported, copyTextToClipboard } from './clipboard.ts';

void describe('EndCard Model & Traffic Display Logic (Prompt 18 PRD Alignment)', () => {
  void it('TRAFFIC_THRESHOLD is strictly 5 per specification', () => {
    assert.strictEqual(TRAFFIC_THRESHOLD, 5);
  });

  void it('renders "BE THE FIRST TO ROUTE" when completions < TRAFFIC_THRESHOLD', () => {
    const testCases = [
      { completions: 0, label: '0 completions' },
      { completions: 1, label: '1 completion' },
      { completions: 2, label: '2 completions' },
      { completions: 3, label: '3 completions' },
      { completions: 4, label: '4 completions' },
      { completions: undefined, label: 'undefined completions (default 0)' },
    ];

    for (const { completions, label } of testCases) {
      const model = getEndCardViewModel({
        won: true,
        stars: 3,
        streak: 1,
        completions,
      });

      assert.strictEqual(
        model.isBelowTrafficThreshold,
        true,
        `Expected isBelowTrafficThreshold=true for ${label}`
      );
      assert.strictEqual(
        model.trafficDisplayText,
        'BE THE FIRST TO ROUTE',
        `Expected "BE THE FIRST TO ROUTE" for ${label}`
      );
      assert.strictEqual(
        model.courierCountText,
        null,
        `Expected null courierCountText for below-threshold ${label}`
      );
    }
  });

  void it('renders real courier count when completions >= TRAFFIC_THRESHOLD (no synthetic data)', () => {
    const testCases = [
      { completions: 5, expectedText: '5 COURIERS DISPATCHED' },
      { completions: 6, expectedText: '6 COURIERS DISPATCHED' },
      { completions: 25, expectedText: '25 COURIERS DISPATCHED' },
      { completions: 100, expectedText: '100 COURIERS DISPATCHED' },
    ];

    for (const { completions, expectedText } of testCases) {
      const model = getEndCardViewModel({
        won: true,
        stars: 3,
        streak: 3,
        completions,
      });

      assert.strictEqual(
        model.isBelowTrafficThreshold,
        false,
        `Expected isBelowTrafficThreshold=false for ${completions} completions`
      );
      assert.strictEqual(
        model.courierCountText,
        expectedText,
        `Expected "${expectedText}" for ${completions} completions`
      );
    }
  });

  void it('renders correct result heading for win vs loss', () => {
    const winModel = getEndCardViewModel({
      won: true,
      stars: 3,
      streak: 2,
      completions: 10,
    });
    assert.strictEqual(winModel.resultHeading, 'ROUTE DELIVERED');
    assert.strictEqual(winModel.isWon, true);

    const lossModel = getEndCardViewModel({
      won: false,
      stars: 0,
      streak: 0,
      completions: 10,
    });
    assert.strictEqual(lossModel.resultHeading, 'OUT OF MOVES');
    assert.strictEqual(lossModel.isWon, false);
  });

  void it('renders star glyphs accurately for won runs and empty for lost runs', () => {
    assert.strictEqual(renderStarGlyphs(0, false), '☆☆☆');
    assert.strictEqual(renderStarGlyphs(0, true), '☆☆☆');
    assert.strictEqual(renderStarGlyphs(1, true), '★☆☆');
    assert.strictEqual(renderStarGlyphs(2, true), '★★☆');
    assert.strictEqual(renderStarGlyphs(3, true), '★★★');

    // Any lost run displays empty stars
    assert.strictEqual(renderStarGlyphs(3, false), '☆☆☆');
    assert.strictEqual(renderStarGlyphs(2, false), '☆☆☆');
    assert.strictEqual(renderStarGlyphs(1, false), '☆☆☆');
  });

  void it('produces correct resultHeading and starsGlyphs for a losing view model (won: false, stars: 0)', () => {
    const lossModel = getEndCardViewModel({
      won: false,
      stars: 0,
      streak: 0,
      completions: 10,
    });
    assert.strictEqual(lossModel.resultHeading, 'OUT OF MOVES');
    assert.strictEqual(lossModel.starsGlyphs, '☆☆☆');
    assert.strictEqual(lossModel.isWon, false);
  });

  void it('formats streak text with singular/plural grammar', () => {
    const streakOne = getEndCardViewModel({
      won: true,
      stars: 2,
      streak: 1,
      completions: 0,
    });
    assert.strictEqual(streakOne.streakText, 'STREAK: 1 DAY');

    const streakZero = getEndCardViewModel({
      won: false,
      stars: 0,
      streak: 0,
      completions: 0,
    });
    assert.strictEqual(streakZero.streakText, 'STREAK: 0 DAYS');

    const streakMultiple = getEndCardViewModel({
      won: true,
      stars: 3,
      streak: 7,
      completions: 0,
    });
    assert.strictEqual(streakMultiple.streakText, 'STREAK: 7 DAYS');
  });

  void it('includes "Back tomorrow for your next drop." PRD footer text', () => {
    const model = getEndCardViewModel({
      won: true,
      stars: 3,
      streak: 1,
      completions: 5,
    });
    assert.strictEqual(model.backTomorrowText, 'Back tomorrow for your next drop.');
  });

  void it('shows "ALREADY DISPATCHED" with no stars when attempt is null or alreadyDispatched is true', () => {
    // Case 1: attempt is null
    const modelAttemptNull = getEndCardViewModel({
      won: false,
      stars: 0,
      streak: 3,
      completions: 2,
      attempt: null,
    });
    assert.strictEqual(modelAttemptNull.resultHeading, 'ALREADY DISPATCHED');
    assert.strictEqual(modelAttemptNull.starsGlyphs, '');

    // Case 2: alreadyDispatched is true
    const modelAlreadyDispatched = getEndCardViewModel({
      won: false,
      stars: 0,
      streak: 3,
      completions: 2,
      alreadyDispatched: true,
    });
    assert.strictEqual(modelAlreadyDispatched.resultHeading, 'ALREADY DISPATCHED');
    assert.strictEqual(modelAlreadyDispatched.starsGlyphs, '');
  });

  void it('validates attempt record shape before rendering; shows "ALREADY DISPATCHED" with no stars on invalid shape', () => {
    // Malformed attempt (invalid outcome or invalid stars)
    const invalidAttemptModel = getEndCardViewModel({
      won: false,
      stars: 0,
      streak: 2,
      attempt: { outcome: 'corrupted', movesUsed: -5, stars: 99 },
    });
    assert.strictEqual(invalidAttemptModel.resultHeading, 'ALREADY DISPATCHED');
    assert.strictEqual(invalidAttemptModel.starsGlyphs, '');

    // Loss with non-zero stars is invalid
    const invalidLossModel = getEndCardViewModel({
      won: false,
      stars: 0,
      streak: 2,
      attempt: { outcome: 'lost', movesUsed: 15, stars: 3, deliveredCount: 1 },
    });
    assert.strictEqual(invalidLossModel.resultHeading, 'ALREADY DISPATCHED');
    assert.strictEqual(invalidLossModel.starsGlyphs, '');
  });

  void it('renders stored attempt correctly when valid (win or loss)', () => {
    // Valid win attempt
    const winModel = getEndCardViewModel({
      won: false, // props fallback overridden by valid attempt
      stars: 0,
      streak: 4,
      attempt: { outcome: 'won', movesUsed: 14, stars: 3, deliveredCount: 3 },
    });
    assert.strictEqual(winModel.resultHeading, 'ROUTE DELIVERED');
    assert.strictEqual(winModel.starsGlyphs, '★★★');
    assert.strictEqual(winModel.isWon, true);

    // Valid loss attempt
    const lossModel = getEndCardViewModel({
      won: true, // props fallback overridden by valid attempt
      stars: 3,
      streak: 4,
      attempt: { outcome: 'lost', movesUsed: 22, stars: 0, deliveredCount: 1 },
    });
    assert.strictEqual(lossModel.resultHeading, 'OUT OF MOVES');
    assert.strictEqual(lossModel.starsGlyphs, '☆☆☆');
    assert.strictEqual(lossModel.isWon, false);
  });

  void it('ALREADY DISPATCHED card has no share button', () => {
    // Attempt is null
    const modelNull = getEndCardViewModel({
      won: false,
      stars: 0,
      streak: 2,
      attempt: null,
    });
    assert.strictEqual(modelNull.resultHeading, 'ALREADY DISPATCHED');
    assert.strictEqual(modelNull.showShareButton, false, 'Null attempt must not show share button');

    // alreadyDispatched is true
    const modelAlreadyDispatched = getEndCardViewModel({
      won: false,
      stars: 0,
      streak: 2,
      alreadyDispatched: true,
    });
    assert.strictEqual(modelAlreadyDispatched.resultHeading, 'ALREADY DISPATCHED');
    assert.strictEqual(modelAlreadyDispatched.showShareButton, false, 'alreadyDispatched must not show share button');

    // Corrupted / malformed attempt
    const modelMalformed = getEndCardViewModel({
      won: false,
      stars: 0,
      streak: 2,
      attempt: { outcome: 'corrupted' },
    });
    assert.strictEqual(modelMalformed.resultHeading, 'ALREADY DISPATCHED');
    assert.strictEqual(modelMalformed.showShareButton, false, 'Malformed attempt must not show share button');
  });

  void it('Valid stored win card has a share button', () => {
    const winModel = getEndCardViewModel({
      won: true,
      stars: 3,
      streak: 3,
      movesUsed: 13,
      attempt: { outcome: 'won', movesUsed: 13, stars: 3, deliveredCount: 3 },
    });
    assert.strictEqual(winModel.resultHeading, 'ROUTE DELIVERED');
    assert.strictEqual(winModel.showShareButton, true, 'Valid win card must show share button');
  });

  void it('Valid stored loss card has a share button', () => {
    const lossModel = getEndCardViewModel({
      won: false,
      stars: 0,
      streak: 0,
      movesUsed: 20,
      attempt: { outcome: 'lost', movesUsed: 20, stars: 0, deliveredCount: 1 },
    });
    assert.strictEqual(lossModel.resultHeading, 'OUT OF MOVES');
    assert.strictEqual(lossModel.showShareButton, true, 'Valid loss card must show share button');
  });

  void it('Task 3B: Pending confirmation disables sharing and enables retry confirmation action', () => {
    const pendingModel = getEndCardViewModel({
      won: true,
      stars: 3,
      streak: 2,
      movesUsed: 14,
      completions: 3,
      confirmationStatus: 'pending',
      confirmationError: 'Connection timeout. Tap retry to save.',
    });

    assert.strictEqual(pendingModel.showShareButton, false, 'Sharing MUST be disabled until confirmed');
    assert.strictEqual(pendingModel.showRetryConfirmation, true, 'Retry confirmation action MUST be available');
    assert.strictEqual(pendingModel.resultHeading, 'ROUTE DELIVERED', 'Local outcome preserved');
    assert.strictEqual(pendingModel.starsGlyphs, '★★★', 'Stars preserved');
    assert.strictEqual(pendingModel.streakText, 'STREAK: 2 DAYS', 'Streak not fabricated');
    assert.ok(pendingModel.confirmationNotice?.includes('Connection timeout'));
  });

  void it('Task 3B: Rejected confirmation disables sharing and shows rejection state', () => {
    const rejectedModel = getEndCardViewModel({
      won: true,
      stars: 3,
      streak: 2,
      movesUsed: 14,
      completions: 3,
      confirmationStatus: 'rejected',
      confirmationError: 'Authentication session expired',
    });

    assert.strictEqual(rejectedModel.showShareButton, false, 'Sharing MUST be disabled when rejected');
    assert.strictEqual(rejectedModel.showRetryConfirmation, false, 'No retry when definitively rejected');
    assert.strictEqual(rejectedModel.resultHeading, 'DISPATCH REJECTED');
    assert.strictEqual(rejectedModel.starsGlyphs, '');
    assert.strictEqual(rejectedModel.confirmationNotice, 'Authentication session expired');
  });

  void it('Task 3B: Confirmed completion displays valid stars and enables sharing', () => {
    const confirmedModel = getEndCardViewModel({
      won: true,
      stars: 3,
      streak: 3,
      movesUsed: 14,
      completions: 4,
      confirmationStatus: 'confirmed',
    });

    assert.strictEqual(confirmedModel.showShareButton, true, 'Sharing enabled upon server confirmation');
    assert.strictEqual(confirmedModel.showRetryConfirmation, false);
    assert.strictEqual(confirmedModel.resultHeading, 'ROUTE DELIVERED');
  });

  void it('Phase 1: sectorTitle formats sectorId or defaults to Classified Sector', () => {
    const modelWithSector = getEndCardViewModel({
      won: true,
      stars: 3,
      streak: 1,
      sectorId: 'sector-04-neon-quarter',
    });
    assert.strictEqual(modelWithSector.sectorTitle, 'Sector 04: Neon Quarter');

    const modelNoSector = getEndCardViewModel({
      won: true,
      stars: 3,
      streak: 1,
    });
    assert.strictEqual(modelNoSector.sectorTitle, 'Classified Sector');
  });

  void it('Phase 1: dispatchSummary is generated on confirmed runs and empty when sharing is disabled', () => {
    const confirmedModel = getEndCardViewModel({
      won: true,
      stars: 3,
      streak: 4,
      movesUsed: 15,
      par: 18,
      dayIndex: 2,
      sectorId: 'sector-03-cyber-docks',
      confirmationStatus: 'confirmed',
    });
    assert.strictEqual(confirmedModel.showShareButton, true);
    assert.ok(confirmedModel.dispatchSummary.length > 0, 'dispatchSummary should be populated');
    assert.ok(confirmedModel.dispatchSummary.includes('Night Shift Dispatch #3'));
    assert.ok(confirmedModel.dispatchSummary.includes('Sector 03: Cyber Docks'));
    assert.ok(confirmedModel.dispatchSummary.includes('15 / 18 (Par)'));
    assert.ok(confirmedModel.dispatchSummary.includes('4 days'));

    const rejectedModel = getEndCardViewModel({
      won: true,
      stars: 3,
      streak: 4,
      confirmationStatus: 'rejected',
    });
    assert.strictEqual(rejectedModel.showShareButton, false);
    assert.strictEqual(rejectedModel.dispatchSummary, '', 'Rejected runs should have empty dispatchSummary');

    const pendingModel = getEndCardViewModel({
      won: true,
      stars: 3,
      streak: 4,
      confirmationStatus: 'pending',
    });
    assert.strictEqual(pendingModel.showShareButton, false);
    assert.strictEqual(pendingModel.dispatchSummary, '', 'Pending runs should have empty dispatchSummary');
  });

  void it('Phase 1: canCopyDispatch is a boolean and false when sharing is disabled', () => {
    const pendingModel = getEndCardViewModel({
      won: true,
      stars: 3,
      streak: 1,
      confirmationStatus: 'pending',
    });
    assert.strictEqual(pendingModel.canCopyDispatch, false);

    const rejectedModel = getEndCardViewModel({
      won: true,
      stars: 3,
      streak: 1,
      confirmationStatus: 'rejected',
    });
    assert.strictEqual(rejectedModel.canCopyDispatch, false);
  });

  void it('Phase 1: isClipboardSupported returns a boolean and does not throw in test environment', () => {
    const supported = isClipboardSupported();
    assert.strictEqual(typeof supported, 'boolean');
  });

  void it('Phase 1: copyTextToClipboard returns false safely in environment without navigator.clipboard', async () => {
    const res = await copyTextToClipboard('Test dispatch');
    assert.strictEqual(typeof res, 'boolean');
    assert.strictEqual(res, false);
  });
});
