// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { formatSectorName } from '../../shared/format.ts';

export type StartScreenProps = {
  date: string;
  streak: number;
  onPlay: () => void;
  hasAttempt?: boolean | undefined;
  dayIndex?: number | undefined;
  sectorId?: string | undefined;
  sectorName?: string | undefined;
};

export const StartScreen = ({
  date,
  streak,
  onPlay,
  hasAttempt,
  dayIndex,
  sectorId,
  sectorName,
}: StartScreenProps) => {
  const sectorTitle = sectorName ?? formatSectorName(sectorId);

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-[340px] sm:max-w-[360px] mx-auto p-4 sm:p-5 rounded-xl border border-zinc-800 bg-zinc-900/95 shadow-2xl backdrop-blur-sm select-none font-mono text-center space-y-4">
      {/* 1. Title */}
      <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white uppercase">
        Dead Drop Route
      </h1>

      {/* 2. Today's Sector, Date & UTC Reset */}
      <div className="space-y-1">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-950/40 border border-amber-500/30 text-amber-400 text-xs font-bold tracking-wider">
          <span>{dayIndex !== undefined ? `DISPATCH #${dayIndex + 1}` : 'NIGHT SHIFT'}</span>
          <span className="text-amber-500/50">•</span>
          <span className="text-zinc-200">{sectorTitle}</span>
        </div>
        <div className="text-xs font-semibold text-zinc-400 tracking-wider">
          {date}
        </div>
        <div className="text-[10px] text-zinc-500 tracking-wider">
          New sector unlocks daily at 00:00 UTC
        </div>
      </div>

      {/* 3. One-line Hook */}
      <p className="text-xs text-zinc-300 leading-relaxed max-w-xs">
        Deliver clandestine packages through district gridlines before sunrise.
      </p>

      {/* 4. User's Streak */}
      <div className="w-full py-2 px-3 rounded bg-zinc-950/80 border border-zinc-800 text-xs font-bold text-zinc-200 tracking-wide">
        STREAK: {streak} {streak === 1 ? 'DAY' : 'DAYS'}
      </div>

      {/* 5. Courier Briefing / Instructions */}
      <div className="w-full p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800/80 text-left space-y-1 text-[11px] leading-snug text-zinc-400">
        <div className="text-[10px] font-bold text-amber-400 tracking-widest uppercase">
          Shift Briefing
        </div>
        <ul className="space-y-1">
          <li className="flex items-start gap-1.5">
            <span className="text-amber-500 font-bold">•</span>
            <span>Deliver all 3 packages (D1–D3) in any order; no need to return to HQ.</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="text-amber-500 font-bold">•</span>
            <span>Tap adjacent reachable tiles to move; desktop also supports arrow keys/WASD.</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="text-amber-500 font-bold">•</span>
            <span>Every move consumes budget; congested tiles (+2) cost 2 moves.</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="text-amber-500 font-bold">•</span>
            <span>Relay tiles (⚡) restore 2 moves once per run.</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="text-amber-500 font-bold">•</span>
            <span>One recorded attempt per UTC day. Reopen post after 00:00 UTC to refresh.</span>
          </li>
        </ul>
      </div>

      {/* 6. Play Button */}
      <button
        type="button"
        onClick={onPlay}
        className="w-full min-h-[48px] py-3 px-4 rounded bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-black text-sm tracking-widest uppercase transition-colors shadow-lg shadow-amber-500/10 cursor-pointer flex items-center justify-center"
      >
        {hasAttempt ? 'VIEW RESULT' : 'INITIALIZE RUN'}
      </button>
    </div>
  );
};
