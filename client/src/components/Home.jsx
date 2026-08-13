import { useEffect, useState } from 'react';
import { api, socket } from '../lib/socket';

const fmtTime = (s) => (s === 0 ? 'No limit' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

export default function Home({ palette, profile, setProfile, onEnter }) {
  const [tab, setTab] = useState('browse');
  const [lobbies, setLobbies] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Create form
  const [lobbyName, setLobbyName] = useState('');
  const [password, setPassword] = useState('');
  const [goalLimit, setGoalLimit] = useState(7);
  const [timeLimit, setTimeLimit] = useState(180);

  // Join form
  const [joinCode, setJoinCode] = useState('');
  const [joinPass, setJoinPass] = useState('');

  useEffect(() => {
    socket.emit('lobbies:subscribe');
    const onList = ({ lobbies: list }) => setLobbies(list);
    socket.on('lobbies:list', onList);
    const t = setInterval(() => socket.emit('lobbies:subscribe'), 4000);
    return () => {
      socket.off('lobbies:list', onList);
      clearInterval(t);
    };
  }, []);

  const validName = profile.name.trim().length >= 2;

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    if (!validName) return setError('Please set your player name first');
    setBusy(true);
    try {
      const { code } = await api.post('/lobbies', {
        name: lobbyName.trim(),
        hostName: profile.name.trim(),
        password: password || undefined,
        goalLimit,
        timeLimit,
      });
      onEnter(code, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const handleJoinCode = async (e) => {
    e.preventDefault();
    setError('');
    if (!validName) return setError('Please set your player name first');
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) return setError('A lobby code is 6 characters');
    setBusy(true);
    try {
      await api.post(`/lobbies/${code}/verify`, { password: joinPass });
      onEnter(code, joinPass);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const quickJoin = async (lobby) => {
    setError('');
    if (!validName) return setError('Please set your player name first');
    if (lobby.isPrivate) {
      setTab('code');
      setJoinCode(lobby.code);
      setError('This lobby is locked — enter its password below');
      return undefined;
    }
    setBusy(true);
    try {
      await api.post(`/lobbies/${lobby.code}/verify`, {});
      onEnter(lobby.code, '');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <div className="container">
      <div className="grid-2">
        {/* -------- Profile + create -------- */}
        <div>
          <div className="card">
            <h2>Your player</h2>
            <p className="hint">Shown to your opponent and used on your paddle.</p>

            <label htmlFor="pname">Display name</label>
            <input
              id="pname"
              type="text"
              maxLength={16}
              placeholder="e.g. Sasan"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />

            <label>Paddle colour</label>
            <div className="swatches">
              {palette.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="swatch"
                  style={{ background: c }}
                  data-active={profile.color === c}
                  aria-label={`Colour ${c}`}
                  onClick={() => setProfile({ ...profile, color: c })}
                />
              ))}
            </div>
          </div>

          <div className="card" style={{ marginTop: 18 }}>
            <h2>Create a lobby</h2>
            <p className="hint">You get a 6-character code to share with a friend.</p>
            <form onSubmit={handleCreate}>
              <label htmlFor="lname">Lobby name</label>
              <input
                id="lname"
                type="text"
                maxLength={24}
                placeholder="Friday night rematch"
                value={lobbyName}
                onChange={(e) => setLobbyName(e.target.value)}
              />

              <label htmlFor="lpass">Password (optional)</label>
              <input
                id="lpass"
                type="password"
                maxLength={32}
                placeholder="Leave empty for a public lobby"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <div className="row">
                <div>
                  <label htmlFor="goals">Goals to win</label>
                  <select id="goals" value={goalLimit} onChange={(e) => setGoalLimit(+e.target.value)}>
                    {[1, 3, 5, 7, 10, 15, 21].map((n) => (
                      <option key={n} value={n}>{n} goals</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="time">Time limit</label>
                  <select id="time" value={timeLimit} onChange={(e) => setTimeLimit(+e.target.value)}>
                    <option value={0}>No limit</option>
                    <option value={60}>1 minute</option>
                    <option value={120}>2 minutes</option>
                    <option value={180}>3 minutes</option>
                    <option value={300}>5 minutes</option>
                    <option value={600}>10 minutes</option>
                  </select>
                </div>
              </div>

              <button className="btn-primary" type="submit" disabled={busy || lobbyName.trim().length < 2}>
                {busy ? 'Creating…' : 'Create lobby'}
              </button>
            </form>
          </div>
        </div>

        {/* -------- Browse / join -------- */}
        <div className="card">
          <div className="tabs">
            <button type="button" className="tab" data-active={tab === 'browse'} onClick={() => setTab('browse')}>
              Browse lobbies
            </button>
            <button type="button" className="tab" data-active={tab === 'code'} onClick={() => setTab('code')}>
              Join with code
            </button>
          </div>

          {tab === 'browse' ? (
            <>
              <h2>Open lobbies</h2>
              <p className="hint">Updates live. Locked lobbies need their password.</p>
              <div className="lobby-list">
                {lobbies.length === 0 && (
                  <div className="empty">No lobbies yet — create the first one!</div>
                )}
                {lobbies.map((l) => {
                  const full = l.playerCount >= 2;
                  const playing = l.status === 'playing';
                  return (
                    <div className="lobby-item" key={l.code}>
                      <div className="lobby-meta">
                        <span className="lobby-name">
                          {l.name}
                          {l.isPrivate && <span className="pill locked">Locked</span>}
                          {playing && <span className="pill live">Live</span>}
                          {full && !playing && <span className="pill full">Full</span>}
                        </span>
                        <span className="lobby-sub">
                          Host {l.hostName} · {l.playerCount}/2 · {l.settings.goalLimit} goals ·{' '}
                          {fmtTime(l.settings.timeLimit)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={busy || full || playing}
                        onClick={() => quickJoin(l)}
                      >
                        {playing ? 'In game' : full ? 'Full' : 'Join'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <form onSubmit={handleJoinCode}>
              <h2>Join with a code</h2>
              <p className="hint">Ask your friend for the 6-character lobby code.</p>

              <label htmlFor="jcode">Lobby code</label>
              <input
                id="jcode"
                className="code-input"
                type="text"
                maxLength={6}
                placeholder="A7K2QP"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              />

              <label htmlFor="jpass">Password (if the lobby is locked)</label>
              <input
                id="jpass"
                type="password"
                placeholder="Leave empty for public lobbies"
                value={joinPass}
                onChange={(e) => setJoinPass(e.target.value)}
              />

              <button className="btn-primary" type="submit" disabled={busy}>
                {busy ? 'Checking…' : 'Join lobby'}
              </button>
            </form>
          )}

          {error && <div className="error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
