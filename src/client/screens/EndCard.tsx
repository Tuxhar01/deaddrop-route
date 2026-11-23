import { useState } from 'react';
import { context } from '@devvit/web/client';
import type { ShareResponse } from '../../shared/types';
import type { EndCardProps } from './endCardModel';
import { getEndCardViewModel } from './endCardModel';

export type { EndCardProps };

type ShareStatus = 'idle' | 'pending' | 'success' | 'error';

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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
              : model.isWon
                ? 'text-emerald-400'
                : 'text-rose-400'
          }`}
        >
          {model.resultHeading}
        </div>
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

      {/* 5. Share Button */}
      {model.showShareButton && (
        <div className="w-full space-y-2">
          <button
            type="button"
            onClick={handleShareClick}
            disabled={shareStatus === 'pending' || shareStatus === 'success'}
            aria-label="Share route summary to dispatch comments"
            className={`
              w-full min-h-[44px] py-2.5 px-4 rounded font-bold text-xs uppercase tracking-wider transition-all
              flex items-center justify-center
              ${
                shareStatus === 'success'
                  ? 'bg-emerald-950/40 border border-emerald-500/50 text-emerald-400 cursor-default'
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
              : shareStatus === 'error'
                ? 'RETRY DISPATCH SHARE'
                : shareStatus === 'pending'
                  ? 'POSTING DISPATCH...'
                  : 'LOG ROUTE TO DISPATCH'}
          </button>

          {shareStatus === 'error' && errorMessage && (
            <p className="text-[10px] text-rose-400 tracking-tight">
              {errorMessage}
            </p>
          )}
        </div>
      )}

      {/* 6. "Back tomorrow" Text */}
      <p className="text-xs text-zinc-400 tracking-wide pt-0.5">
        {model.backTomorrowText}
      </p>
    </div>
  );
};
