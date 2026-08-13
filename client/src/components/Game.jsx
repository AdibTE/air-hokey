import { useCallback, useEffect, useRef, useState } from 'react';
import Rink from './Rink';
import { socket } from '../lib/socket';

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function Game({ field, players, settings, state, result, mySlot, onRematch, onLeave }) {
  const [rematchSent, setRematchSent] = useState(false);
  const lastSent = useRef(0);

  useEffect(() => {
    if (!result) setRematchSent(false);
  }, [result]);

  // Throttle input to ~45/s — enough for smooth play without flooding Render.
  const handleInput = useCallback((x, y) => {
    const now = performance.now();
    if (now - lastSent.current < 22) return;
    lastSent.current = now;
    socket.emit('game:input', { x, y });
  }, []);

  const home = players.home || { name: 'Home', color: '#22d3ee' };
  const away = players.away || { name: 'Away', color: '#ff3b6b' };
  const score = state?.score || { home: 0, away: 0 };
  const remaining = state?.remaining;

  const myName = mySlot === 'home' ? home.name : away.name;
  const iWon = result && result.winner === mySlot;
  const draw = result && result.winner === 'draw';

  const reasonText = {
    'goal-limit': 'Goal target reached',
    'time-limit': 'Time is up',
    forfeit: 'Opponent left the match',
  };

  return (
    <div className="stage">
      <div className="scoreboard">
        <div className="side">
          <span className="dot" style={{ background: home.color, boxShadow: `0 0 14px ${home.color}` }} />
          <span className="nm">{home.name}{mySlot === 'home' ? ' (you)' : ''}</span>
          <span className="sc" style={{ color: home.color }}>{score.home}</span>
        </div>

        <div className={`timer ${remaining !== null && remaining !== undefined && remaining <= 15 ? 'low' : ''}`}>
          {remaining === null || remaining === undefined ? '∞' : fmt(remaining)}
        </div>

        <div className="side right">
          <span className="sc" style={{ color: away.color }}>{score.away}</span>
          <span className="nm">{away.name}{mySlot === 'away' ? ' (you)' : ''}</span>
          <span className="dot" style={{ background: away.color, boxShadow: `0 0 14px ${away.color}` }} />
        </div>
      </div>

      <div style={{ position: 'relative', width: '100%', maxWidth: 1000 }}>
        <Rink field={field} players={players} mySlot={mySlot} onInput={handleInput} />

        {state?.status === 'countdown' && !result && (
          <div className="overlay">
            <p>You are the {mySlot === 'home' ? 'LEFT' : 'RIGHT'} paddle, {myName}</p>
            <div className="countdown-num">{state.countdown || 'GO!'}</div>
            <p>First to {settings.goalLimit} goals wins</p>
          </div>
        )}

        {state?.status === 'goal' && !result && (
          <div className="overlay">
            <h2>GOAL!</h2>
            <p>{score.home} — {score.away}</p>
          </div>
        )}

        {result && (
          <div className="overlay">
            <h2 style={{ color: draw ? 'var(--warn)' : iWon ? 'var(--ok)' : 'var(--accent2)' }}>
              {draw ? "It's a draw!" : iWon ? 'You win!' : 'You lost'}
            </h2>
            {iWon && (
              <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="1.8" aria-hidden="true">
                <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
                <path d="M7 6H4.5A2.5 2.5 0 0 0 7 10.5M17 6h2.5A2.5 2.5 0 0 1 17 10.5" />
              </svg>
            )}
            <p>
              {result.score.home} — {result.score.away} · {reasonText[result.reason] || result.reason}
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                type="button"
                className="btn-ok"
                disabled={rematchSent}
                onClick={() => {
                  setRematchSent(true);
                  onRematch();
                }}
              >
                {rematchSent ? 'Waiting for opponent…' : 'Rematch'}
              </button>
              <button type="button" className="btn-ghost" onClick={onLeave}>
                Back to lobbies
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="controls-hint">
        Move your mouse or drag on the canvas to control your paddle · Arrow keys / WASD also work
      </p>
    </div>
  );
}
