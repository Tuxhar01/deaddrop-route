import type { TileType } from '../../shared/types';

export type TileVisuals = {
  bg: string;
  badge: string;
  label: string;
};

export const getTileVisuals = (
  tile: TileType,
  isDepot: boolean,
  isDrop: boolean,
  isDelivered: boolean,
  dropNumber: number | null,
  isRelayUsed: boolean,
  isVisited: boolean = false
): TileVisuals => {
  if (isDrop) {
    if (isDelivered) {
      return {
        bg: 'bg-emerald-950/40 border-emerald-500/50 text-emerald-400',
        badge: '✓',
        label: `DROP #${dropNumber ?? ''} DELIVERED`,
      };
    }
    return {
      bg: 'bg-cyan-950/60 border-cyan-400/80 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.35)] animate-pulse',
      badge: `D${dropNumber ?? ''}`,
      label: `PARCEL #${dropNumber ?? ''} TARGET`,
    };
  }

  if (isDepot) {
    return {
      bg: isVisited
        ? 'bg-amber-950/50 border-amber-500/70 text-amber-400'
        : 'bg-amber-950/40 border-amber-500/60 text-amber-400',
      badge: 'HQ',
      label: 'DISPATCH DEPOT',
    };
  }

  switch (tile) {
    case 'block':
      return {
        bg: 'bg-zinc-950 border-zinc-900 text-zinc-700',
        badge: '■',
        label: 'BLOCKED GRID',
      };
    case 'congested':
      return {
        bg: isVisited
          ? 'bg-amber-950/45 border-amber-500/60 text-amber-400'
          : 'bg-amber-950/30 border-amber-600/50 text-amber-500',
        badge: '+2',
        label: 'CONGESTION (+2 COST)',
      };
    case 'relay':
      if (isRelayUsed) {
        return {
          bg: 'bg-zinc-900/60 border-zinc-800 text-zinc-600',
          badge: '○',
          label: 'RELAY EXHAUSTED',
        };
      }
      return {
        bg: 'bg-emerald-950/60 border-emerald-400/80 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]',
        badge: '⚡',
        label: 'RELAY (+2 BOOST)',
      };
    case 'road':
    default:
      return {
        bg: isVisited
          ? 'bg-amber-950/20 border-amber-500/30 text-amber-400/90'
          : 'bg-zinc-900/50 border-zinc-800/80 text-zinc-500 hover:border-zinc-700',
        badge: '·',
        label: isVisited ? 'VISITED ROADWAY' : 'CLEAR ROADWAY',
      };
  }
};
