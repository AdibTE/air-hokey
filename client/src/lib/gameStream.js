/** Latest authoritative snapshot — updated without React re-renders. */
let latest = null;
const listeners = new Set();

export function pushGameSnapshot(snap) {
  latest = snap;
  for (const fn of listeners) fn(snap);
}

export function getGameSnapshot() {
  return latest;
}

export function clearGameSnapshot() {
  latest = null;
}

/** Subscribe to every network snapshot (for canvas). Returns unsubscribe. */
export function onGameSnapshot(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** True when scoreboard / overlays need a React update. */
export function hudChanged(prev, next) {
  if (!next) return false;
  if (!prev) return true;
  return (
    prev.status !== next.status ||
    prev.countdown !== next.countdown ||
    prev.remaining !== next.remaining ||
    prev.score?.home !== next.score?.home ||
    prev.score?.away !== next.score?.away
  );
}
