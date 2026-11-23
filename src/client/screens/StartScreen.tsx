export type StartScreenProps = {
  date: string;
  streak: number;
  onPlay: () => void;
  hasAttempt?: boolean | undefined;
};

export const StartScreen = ({ date, streak, onPlay, hasAttempt }: StartScreenProps) => {
  return (
    <div className="flex flex-col items-center justify-center w-full max-w-[340px] sm:max-w-[360px] mx-auto p-4 sm:p-5 rounded-xl border border-zinc-800 bg-zinc-900/95 shadow-2xl backdrop-blur-sm select-none font-mono text-center space-y-4">
      {/* 1. Title */}
      <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white uppercase">
        Dead Drop Route
      </h1>

      {/* 2. Today's Date */}
      <div className="text-xs font-semibold text-amber-400 tracking-wider">
        {date}
      </div>

      {/* 3. One-line Hook */}
      <p className="text-xs text-zinc-300 leading-relaxed max-w-xs">
        Deliver clandestine packages through district gridlines before sunrise.
      </p>

      {/* 4. User's Streak */}
      <div className="w-full py-2 px-3 rounded bg-zinc-950/80 border border-zinc-800 text-xs font-bold text-zinc-200 tracking-wide">
        STREAK: {streak} {streak === 1 ? 'DAY' : 'DAYS'}
      </div>

      {/* 5. Play Button */}
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
