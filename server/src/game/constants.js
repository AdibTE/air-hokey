// Shared field geometry. The client renders the exact same coordinate space.
export const FIELD = {
  width: 1000,
  height: 600,
  goalHeight: 210,
  puckRadius: 18,
  paddleRadius: 36,
  wallRestitution: 0.94,
  puckFriction: 0.9965,
  maxPuckSpeed: 26,
  minPaddleSpeed: 0,
  maxPaddleSpeed: 34, // units per tick
  tickHz: 60,
  countdownMs: 3000,
  goalPauseMs: 1200,
};

export const PALETTE = [
  '#ff3b6b',
  '#22d3ee',
  '#facc15',
  '#4ade80',
  '#a855f7',
  '#fb923c',
  '#f472b6',
  '#60a5fa',
];
