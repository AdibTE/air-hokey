import { useState } from 'react';
import { socket } from '../lib/socket';

const fmtTime = (s) => (s === 0 ? 'No limit' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

/* Inline SVG icons — emoji glyphs are missing on many Linux/older systems. */
const LockIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
    <rect x="4" y="10.5" width="16" height="11" rx="2.5" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <circle cx="12" cy="12" r="9.2" />
    <path d="M3 12h18M12 2.8c2.6 2.6 3.9 6 3.9 9.2s-1.3 6.6-3.9 9.2c-2.6-2.6-3.9-6-3.9-9.2S9.4 5.4 12 2.8Z" />
  </svg>
);

export default function LobbyRoom({ lobby, mySlot, palette, onLeave }) {
  const [copied, setCopied] = useState(false);

  const me = lobby.players.find((p) => p.slot === mySlot);
  const other = lobby.players.find((p) => p.slot !== mySlot);
  const isHost = !!me?.isHost;
  const takenColors = lobby.players
    .filter((p) => p.slot !== mySlot)
    .map((p) => p.color.toLowerCase());

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(lobby.code);
    } catch {
      /* clipboard blocked in sandboxed iframes — the code is visible anyway */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const setName = (name) => socket.emit('lobby:update-profile', { name });
  const setColor = (color) => socket.emit('lobby:update-profile', { color });
  const setSetting = (patch) => socket.emit('lobby:update-settings', patch);
  const toggleReady = () => socket.emit('lobby:ready', { ready: !me?.ready });

  const bothPresent = lobby.players.filter((p) => p.connected).length === 2;

  return (
    <div className="container">
      <div className="card">
        <div className="room-head">
          <div>
            <h2 style={{ fontSize: 21 }}>{lobby.name}</h2>
            <p className="hint" style={{ margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              {lobby.isPrivate ? <LockIcon /> : <GlobeIcon />}
              {lobby.isPrivate ? 'Password protected' : 'Public lobby'} · Share the code to invite
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="code-chip">{lobby.code}</span>
            <button type="button" className="copy-btn" onClick={copyCode}>
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
            <button type="button" className="btn-ghost" style={{ padding: '9px 14px' }} onClick={onLeave}>
              Leave
            </button>
          </div>
        </div>

        <div className="players-grid">
          {['home', 'away'].map((slot) => {
            const p = lobby.players.find((x) => x.slot === slot);
            if (!p) {
              return (
                <div className="player-card empty-slot" key={slot}>
                  Waiting for an opponent to join…
                </div>
              );
            }
            return (
              <div className="player-card" key={slot}>
                <div className="paddle-preview" style={{ background: p.color }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    {p.name} {p.slot === mySlot && <span className="pill">You</span>}
                  </div>
                  <div className="lobby-sub" style={{ marginTop: 4 }}>
                    <span
                      className="ready-dot"
                      style={{ background: p.ready ? 'var(--ok)' : 'var(--muted)' }}
                    />
                    {p.ready ? 'Ready' : 'Not ready'} · {p.isHost ? 'Host' : 'Guest'} ·{' '}
                    {slot === 'home' ? 'Left side' : 'Right side'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 18 }}>
        <div className="card">
          <h2>Your setup</h2>
          <p className="hint">Change these any time before the puck drops.</p>

          <label htmlFor="rname">Display name</label>
          <input
            id="rname"
            type="text"
            maxLength={16}
            value={me?.name || ''}
            onChange={(e) => setName(e.target.value)}
          />

          <label>Paddle colour</label>
          <div className="swatches">
            {palette.map((c) => {
              const taken = takenColors.includes(c.toLowerCase());
              return (
                <button
                  key={c}
                  type="button"
                  className="swatch"
                  style={{ background: c }}
                  data-active={me?.color === c}
                  data-taken={taken}
                  disabled={taken}
                  title={taken ? 'Taken by your opponent' : c}
                  onClick={() => setColor(c)}
                />
              );
            })}
          </div>
        </div>

        <div className="card">
          <h2>Match rules {!isHost && <span className="pill">Host only</span>}</h2>
          <p className="hint">
            {isHost ? 'Changing a rule resets both ready flags.' : `Only ${lobby.players.find((p) => p.isHost)?.name || 'the host'} can change these.`}
          </p>

          {isHost ? (
            <>
              <div className="row">
                <div>
                  <label htmlFor="rgoals">Goals to win</label>
                  <select
                    id="rgoals"
                    value={lobby.settings.goalLimit}
                    onChange={(e) => setSetting({ goalLimit: +e.target.value })}
                  >
                    {[1, 3, 5, 7, 10, 15, 21].map((n) => (
                      <option key={n} value={n}>{n} goals</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="rtime">Time limit</label>
                  <select
                    id="rtime"
                    value={lobby.settings.timeLimit}
                    onChange={(e) => setSetting({ timeLimit: +e.target.value })}
                  >
                    <option value={0}>No limit</option>
                    <option value={60}>1 minute</option>
                    <option value={120}>2 minutes</option>
                    <option value={180}>3 minutes</option>
                    <option value={300}>5 minutes</option>
                    <option value={600}>10 minutes</option>
                  </select>
                </div>
              </div>
              <p className="hint" style={{ marginTop: 12 }}>
                First to {lobby.settings.goalLimit} goals wins. {lobby.settings.timeLimit > 0
                  ? `If the clock runs out at ${fmtTime(lobby.settings.timeLimit)}, the higher score wins.`
                  : 'No clock — play until the goal target is reached.'}
              </p>
            </>
          ) : (
            <div className="settings-readonly">
              <span>Goals to win: <b>{lobby.settings.goalLimit}</b></span>
              <span>Time limit: <b>{fmtTime(lobby.settings.timeLimit)}</b></span>
            </div>
          )}

          <button
            type="button"
            className={me?.ready ? 'btn-primary btn-ghost' : 'btn-primary btn-ok'}
            onClick={toggleReady}
            disabled={!bothPresent}
          >
            {!bothPresent
              ? 'Waiting for opponent…'
              : me?.ready
                ? 'Cancel ready'
                : 'I am ready'}
          </button>

          {bothPresent && me?.ready && !other?.ready && (
            <div className="banner-ok">Waiting for {other?.name} to get ready…</div>
          )}
        </div>
      </div>
    </div>
  );
}
