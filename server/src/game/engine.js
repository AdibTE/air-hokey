import { FIELD } from './constants.js';

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

/**
 * Authoritative air-hockey simulation for one match.
 * Clients only send desired paddle positions; the server owns the truth.
 */
export class GameEngine {
  constructor({ goalLimit, timeLimit }) {
    this.goalLimit = goalLimit;
    this.timeLimit = timeLimit; // seconds, 0 = unlimited
    this.reset(true);
  }

  reset(full = false) {
    const { width, height } = FIELD;
    this.puck = { x: width / 2, y: height / 2, vx: 0, vy: 0 };
    this.paddles = {
      home: { x: 120, y: height / 2, px: 120, py: height / 2, vx: 0, vy: 0 },
      away: { x: width - 120, y: height / 2, px: width - 120, py: height / 2, vx: 0, vy: 0 },
    };
    this.targets = {
      home: { x: 120, y: height / 2 },
      away: { x: width - 120, y: height / 2 },
    };
    if (full) {
      this.score = { home: 0, away: 0 };
      this.elapsedMs = 0;
      this.status = 'countdown';
      this.finished = null;
    }
    this.phaseUntil = Date.now() + FIELD.countdownMs;
    this.status = 'countdown';
  }

  setTarget(slot, x, y) {
    const t = this.targets[slot];
    if (!t) return;
    t.x = clamp(Number(x) || 0, 0, FIELD.width);
    t.y = clamp(Number(y) || 0, 0, FIELD.height);
  }

  /** Restrict a paddle to its own half and inside the rink. */
  constrainPaddle(slot, x, y) {
    const r = FIELD.paddleRadius;
    const half = FIELD.width / 2;
    const minX = slot === 'home' ? r : half + r * 0.05;
    const maxX = slot === 'home' ? half - r * 0.05 : FIELD.width - r;
    return {
      x: clamp(x, minX, maxX),
      y: clamp(y, r, FIELD.height - r),
    };
  }

  step() {
    const now = Date.now();

    if (this.status === 'countdown') {
      this.movePaddles();
      if (now >= this.phaseUntil) this.status = 'playing';
      return null;
    }
    if (this.status === 'goal') {
      this.movePaddles();
      if (now >= this.phaseUntil) this.status = 'playing';
      return null;
    }
    if (this.status !== 'playing') return null;

    this.elapsedMs += 1000 / FIELD.tickHz;
    this.movePaddles();
    this.movePuck();

    const goal = this.detectGoal();
    if (goal) {
      this.score[goal] += 1;
      const end = this.checkEnd();
      if (end) return { type: 'end', ...end, scorer: goal };
      this.reset(false);
      this.status = 'goal';
      this.phaseUntil = Date.now() + FIELD.goalPauseMs;
      return { type: 'goal', scorer: goal };
    }

    if (this.timeLimit > 0 && this.elapsedMs >= this.timeLimit * 1000) {
      const { home, away } = this.score;
      const winner = home === away ? 'draw' : home > away ? 'home' : 'away';
      this.status = 'finished';
      this.finished = { winner, reason: 'time-limit' };
      return { type: 'end', winner, reason: 'time-limit' };
    }
    return null;
  }

  checkEnd() {
    const { home, away } = this.score;
    if (home >= this.goalLimit || away >= this.goalLimit) {
      const winner = home > away ? 'home' : 'away';
      this.status = 'finished';
      this.finished = { winner, reason: 'goal-limit' };
      return { winner, reason: 'goal-limit' };
    }
    return null;
  }

  movePaddles() {
    for (const slot of ['home', 'away']) {
      const p = this.paddles[slot];
      const t = this.targets[slot];
      const goal = this.constrainPaddle(slot, t.x, t.y);
      let dx = goal.x - p.x;
      let dy = goal.y - p.y;
      const dist = Math.hypot(dx, dy);
      // Cap paddle speed so players cannot teleport through the puck.
      if (dist > FIELD.maxPaddleSpeed) {
        dx = (dx / dist) * FIELD.maxPaddleSpeed;
        dy = (dy / dist) * FIELD.maxPaddleSpeed;
      }
      p.px = p.x;
      p.py = p.y;
      p.x += dx;
      p.y += dy;
      p.vx = p.x - p.px;
      p.vy = p.y - p.py;
    }
  }

  movePuck() {
    const puck = this.puck;
    const r = FIELD.puckRadius;

    puck.vx *= FIELD.puckFriction;
    puck.vy *= FIELD.puckFriction;

    const speed = Math.hypot(puck.vx, puck.vy);
    if (speed > FIELD.maxPuckSpeed) {
      puck.vx = (puck.vx / speed) * FIELD.maxPuckSpeed;
      puck.vy = (puck.vy / speed) * FIELD.maxPuckSpeed;
    }

    // Sub-stepping keeps a fast puck from tunnelling through paddles/walls.
    const steps = Math.max(1, Math.ceil(Math.hypot(puck.vx, puck.vy) / (r * 0.6)));
    for (let i = 0; i < steps; i += 1) {
      puck.x += puck.vx / steps;
      puck.y += puck.vy / steps;

      if (puck.y - r < 0) {
        puck.y = r;
        puck.vy = Math.abs(puck.vy) * FIELD.wallRestitution;
      } else if (puck.y + r > FIELD.height) {
        puck.y = FIELD.height - r;
        puck.vy = -Math.abs(puck.vy) * FIELD.wallRestitution;
      }

      const inGoalMouth = Math.abs(puck.y - FIELD.height / 2) < FIELD.goalHeight / 2;
      if (!inGoalMouth) {
        if (puck.x - r < 0) {
          puck.x = r;
          puck.vx = Math.abs(puck.vx) * FIELD.wallRestitution;
        } else if (puck.x + r > FIELD.width) {
          puck.x = FIELD.width - r;
          puck.vx = -Math.abs(puck.vx) * FIELD.wallRestitution;
        }
      }

      for (const slot of ['home', 'away']) this.collidePaddle(this.paddles[slot]);
    }
  }

  collidePaddle(paddle) {
    const puck = this.puck;
    const minDist = FIELD.puckRadius + FIELD.paddleRadius;
    let dx = puck.x - paddle.x;
    let dy = puck.y - paddle.y;
    let dist = Math.hypot(dx, dy);
    if (dist >= minDist) return;
    if (dist === 0) {
      dx = 1;
      dy = 0;
      dist = 1;
    }

    const nx = dx / dist;
    const ny = dy / dist;

    // Push the puck out of the paddle.
    const overlap = minDist - dist;
    puck.x += nx * overlap;
    puck.y += ny * overlap;

    // Reflect relative velocity and add the paddle's own momentum (the "hit").
    const rvx = puck.vx - paddle.vx;
    const rvy = puck.vy - paddle.vy;
    const dot = rvx * nx + rvy * ny;
    if (dot < 0) {
      puck.vx -= 2 * dot * nx;
      puck.vy -= 2 * dot * ny;
    }
    puck.vx += paddle.vx * 0.55;
    puck.vy += paddle.vy * 0.55;

    const sp = Math.hypot(puck.vx, puck.vy);
    const minSp = 4.5;
    if (sp < minSp) {
      puck.vx = nx * minSp;
      puck.vy = ny * minSp;
    }
  }

  detectGoal() {
    const puck = this.puck;
    const r = FIELD.puckRadius;
    const inMouth = Math.abs(puck.y - FIELD.height / 2) < FIELD.goalHeight / 2;
    if (!inMouth) return null;
    if (puck.x + r < 0) return 'away'; // scored on home's net
    if (puck.x - r > FIELD.width) return 'home';
    return null;
  }

  remainingSec() {
    if (this.timeLimit <= 0) return null;
    return Math.max(0, Math.ceil(this.timeLimit - this.elapsedMs / 1000));
  }

  snapshot() {
    return {
      puck: { x: +this.puck.x.toFixed(2), y: +this.puck.y.toFixed(2) },
      paddles: {
        home: { x: +this.paddles.home.x.toFixed(2), y: +this.paddles.home.y.toFixed(2) },
        away: { x: +this.paddles.away.x.toFixed(2), y: +this.paddles.away.y.toFixed(2) },
      },
      score: { ...this.score },
      status: this.status,
      remaining: this.remainingSec(),
      countdown:
        this.status === 'countdown' || this.status === 'goal'
          ? Math.max(0, Math.ceil((this.phaseUntil - Date.now()) / 1000))
          : 0,
    };
  }
}
