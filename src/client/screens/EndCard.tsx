import { useState } from 'react';
import { context, showToast } from '@devvit/web/client';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { copyTextToClipboard } from './clipboard.ts';
import type { ShareResponse } from '../../shared/types';
import type { EndCardProps } from './endCardModel';
import { getEndCardViewModel } from './endCardModel';

export type { EndCardProps };

type ShareStatus = 'idle' | 'pending' | 'success' | 'error' | 'uncertain';
type CopyStatus = 'idle' | 'copied' | 'error';

export const EndCard = (props: EndCardProps) => {
  const {
    won,
    stars,
    streak,
    dayIndex = 0,
    movesUsed = 0,
    onShare,
  } = props;

  const model = getEndCardViewModel(props);
  const [shareStatus, setShareStatus] = useState<ShareStatus>('idle');
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRetryingConfirmation, setIsRetryingConfirmation] = useState(false);

  const handleRetryConfirmation = async () => {
    if (isRetryingConfirmation || !props.onRetryConfirmation) return;
    setIsRetryingConfirmation(true);
    try {
      await props.onRetryConfirmation();
    } finally {
      setIsRetryingConfirmation(false);
    }
  };

  const handleCopyDispatch = async () => {
    if (copyStatus === 'copied') return;

    if (props.onCopy) {
      try {
        const ok = await props.onCopy();
        if (ok) {
          setCopyStatus('copied');
          try {
            showToast({ text: 'Dispatch copied to clipboard!' });
          } catch {
            // Outside Devvit parent window
          }
          setTimeout(() => setCopyStatus('idle'), 2500);
          return;
        }
      } catch (err) {
        console.warn('[EndCard] onCopy prop failed:', err);
      }
    }

    const textToCopy = model.dispatchSummary;
    if (!textToCopy) return;

    const ok = await copyTextToClipboard(textToCopy);
    if (ok) {
      setCopyStatus('copied');
      try {
        showToast({ text: 'Dispatch copied to clipboard!' });
      } catch {
        // Outside Devvit parent window
      }
      setTimeout(() => setCopyStatus('idle'), 2500);
    } else {
      setCopyStatus('error');
      try {
        showToast({ text: "Couldn't copy to clipboard." });
      } catch {
        // Outside Devvit parent window
      }
      setTimeout(() => setCopyStatus('idle'), 3000);
    }
  };

  const handleShareClick = async () => {
    if (shareStatus === 'pending' || shareStatus === 'success') return;

    if (onShare) {
      setShareStatus('pending');
      setErrorMessage(null);
      try {
        await onShare();
        setShareStatus('success');
      } catch (err) {
        setShareStatus('error');
        setErrorMessage(err instanceof Error ? err.message : "Couldn't post to Reddit. Please try again.");
      }
      return;
    }

    setShareStatus('pending');
    setErrorMessage(null);

    try {
      const resolvedPostId = props.postId ?? (context && 'postId' in context && typeof context.postId === 'string' ? context.postId : undefined);

      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayIndex,
          won,
          movesUsed,
          stars,
          streak,
          ...(resolvedPostId ? { postId: resolvedPostId } : {}),
        }),
      });

      const data: ShareResponse = await res.json();
      if (res.ok && data.status === 'success') {
        setShareStatus('success');
      } else if (res.status === 409 && data.status === 'error' && data.error === 'already_shared') {
        setShareStatus('success');
      } else if (data.status === 'uncertain') {
        setShareStatus('uncertain');
        setErrorMessage(data.message);
      } else if (res.status === 409 && data.status === 'error' && data.error === 'share_in_progress') {
        setShareStatus('idle');
        setErrorMessage(data.message || 'Share in progress. Please wait a moment.');
      } else {
        setShareStatus('error');
        setErrorMessage(
          data.status === 'error' && data.message
            ? data.message
            : "Couldn't post to Reddit. Please try again."
        );
      }
    } catch (err) {
      console.error('[EndCard] Error submitting share comment:', err);
      setShareStatus('error');
      setErrorMessage("Couldn't post to Reddit. Please try again.");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-[340px] sm:max-w-[360px] mx-auto p-4 sm:p-5 rounded-xl border border-zinc-800 bg-zinc-900/95 shadow-2xl backdrop-blur-sm select-none font-mono text-center space-y-3.5">
      {/* 1. Result (Win/Loss) */}
      <div className="space-y-0.5">
        <div
          className={`text-xl sm:text-2xl font-black uppercase tracking-tight ${
            model.resultHeading === 'ALREADY DISPATCHED'
              ? 'text-zinc-300'
              : model.confirmationStatus === 'rejected'
                ? 'text-rose-400'
                : model.isWon
                  ? 'text-emerald-400'
                  : 'text-rose-400'
          }`}
        >
          {model.resultHeading}
        </div>
        {model.confirmationStatus === 'pending' && (
          <div className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">
            ⚠️ CONFIRMATION PENDING
          </div>
        )}
      </div>

      {/* 2. Stars */}
      {model.starsGlyphs ? (
        <div className="text-3xl text-amber-400 font-bold tracking-widest py-0.5">
          {model.starsGlyphs}
        </div>
      ) : null}

      {/* 3. Streak */}
      <div className="w-full py-2 px-3 rounded bg-zinc-950/80 border border-zinc-800 text-xs font-bold text-zinc-200 tracking-wide">
        {model.streakText}
      </div>

      {/* 4. Today's Traffic (Real counts only; below threshold shows "BE THE FIRST TO ROUTE") */}
      <div className="w-full py-2 px-4 rounded bg-zinc-950/80 border border-zinc-800 text-center">
        {model.isBelowTrafficThreshold ? (
          <span className="text-xs text-amber-400 font-semibold tracking-wide">
            {model.trafficDisplayText}
          </span>
        ) : (
          <div className="space-y-0.5">
            <div className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
              TODAY&apos;S TRAFFIC
            </div>
            <div className="text-xs text-emerald-400 font-bold tracking-wider">
              {model.courierCountText}
            </div>
          </div>
        )}
      </div>

      {/* Retry Confirmation Action for Pending State */}
      {model.showRetryConfirmation && (
        <div className="w-full space-y-2">
          {model.confirmationNotice && (
            <div className="w-full py-1.5 px-3 rounded bg-amber-950/40 border border-amber-500/50 text-[11px] font-bold text-amber-300">
              {model.confirmationNotice}
            </div>
          )}
          <button
            type="button"
            onClick={handleRetryConfirmation}
            disabled={isRetryingConfirmation}
            aria-label="Retry dispatch confirmation"
            className="w-full min-h-[44px] py-2.5 px-4 rounded font-bold text-xs uppercase tracking-wider bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 transition-all cursor-pointer flex items-center justify-center shadow-md"
          >
            {isRetryingConfirmation ? (
              <>
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-zinc-950 animate-pulse mr-2" />
                CONFIRMING DISPATCH...
              </>
            ) : (
              'RETRY CONFIRMING DISPATCH'
            )}
          </button>
        </div>
      )}

      {/* Rejection notice */}
      {model.confirmationStatus === 'rejected' && model.confirmationNotice && (
        <div className="w-full py-2 px-3 rounded bg-rose-950/40 border border-rose-500/50 text-[11px] font-bold text-rose-300">
          {model.confirmationNotice}
        </div>
      )}

      {/* 5. Share Button */}
      {model.showShareButton && (
        <div className="w-full space-y-2">
          <button
            type="button"
            onClick={handleShareClick}
            disabled={shareStatus === 'pending' || shareStatus === 'success' || shareStatus === 'uncertain'}
            aria-label="Share route summary to dispatch comments"
            className={`
              w-full min-h-[44px] py-2.5 px-4 rounded font-bold text-xs uppercase tracking-wider transition-all
              flex items-center justify-center
              ${
                shareStatus === 'success'
                  ? 'bg-emerald-950/40 border border-emerald-500/50 text-emerald-400 cursor-default'
                  : shareStatus === 'uncertain'
                    ? 'bg-amber-950/30 border border-amber-500/50 text-amber-300 cursor-default'
                    : shareStatus === 'error'
                      ? 'bg-rose-950/30 border border-rose-500/50 text-rose-300 hover:bg-rose-900/40 cursor-pointer'
                      : shareStatus === 'pending'
                        ? 'bg-zinc-800 border border-zinc-700 text-zinc-400 cursor-not-allowed opacity-80'
                        : 'bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-900 border border-zinc-700 text-zinc-200 hover:text-white cursor-pointer shadow-md'
              }
            `}
          >
            {shareStatus === 'pending' && (
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse mr-2" />
            )}
            {shareStatus === 'success'
              ? 'DISPATCH LOGGED ✓'
              : shareStatus === 'uncertain'
                ? 'DISPATCH UNCONFIRMED'
                : shareStatus === 'error'
                  ? 'RETRY DISPATCH SHARE'
                  : shareStatus === 'pending'
                    ? 'POSTING DISPATCH...'
                    : 'LOG ROUTE TO DISPATCH'}
          </button>

          {/* Copy Dispatch to Clipboard Button */}
          {model.canCopyDispatch && (
            <button
              type="button"
              onClick={handleCopyDispatch}
              disabled={copyStatus === 'copied'}
              aria-label="Copy dispatch summary to clipboard"
              className={`
                w-full min-h-[44px] py-2.5 px-4 rounded font-bold text-xs uppercase tracking-wider transition-all
                flex items-center justify-center cursor-pointer shadow-md
                ${
                  copyStatus === 'copied'
                    ? 'bg-emerald-950/40 border border-emerald-500/50 text-emerald-400 cursor-default'
                    : copyStatus === 'error'
                      ? 'bg-rose-950/30 border border-rose-500/50 text-rose-300 hover:bg-rose-900/40'
                      : 'bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-950 border border-zinc-700/80 text-zinc-300 hover:text-white'
                }
              `}
            >
              {copyStatus === 'copied'
                ? 'DISPATCH COPIED ✓'
                : copyStatus === 'error'
                  ? 'FAILED TO COPY'
                  : 'COPY DISPATCH'}
            </button>
          )}

          {errorMessage && shareStatus !== 'success' && (
            <p
              className={`text-[10px] tracking-tight ${
                shareStatus === 'uncertain' ? 'text-amber-400' : 'text-rose-400'
              }`}
            >
              {errorMessage}
            </p>
          )}
        </div>
      )}

      {/* 6. "Back tomorrow" Text & UTC Reset notice */}
      <div className="space-y-0.5 pt-0.5">
        <p className="text-xs text-zinc-400 tracking-wide">
          {model.backTomorrowText}
        </p>
        <p className="text-[10px] text-zinc-500 tracking-wider">
          New sector unlocks daily at 00:00 UTC (reopen or refresh to load).
        </p>
      </div>
    </div>
  );
};
