import { useCallback, useEffect, useRef, useState } from 'react';
import Home from './components/Home';
import LobbyRoom from './components/LobbyRoom';
import Game from './components/Game';
import { api, socket } from './lib/socket';

const DEFAULT_FIELD = {
  width: 1000,
  height: 600,
  goalHeight: 210,
  puckRadius: 18,
  paddleRadius: 36,
};

const FALLBACK_PALETTE = [
  '#ff3b6b', '#22d3ee', '#facc15', '#4ade80',
  '#a855f7', '#fb923c', '#f472b6', '#60a5fa',
];

const loadProfile = () => {
  try {
    const raw = localStorage.getItem('ah:profile');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { name: '', color: FALLBACK_PALETTE[1] };
};

export default function App() {
  const [screen, setScreen] = useState('home'); // home | lobby | game
  const [profile, setProfile] = useState(loadProfile);
  const [palette, setPalette] = useState(FALLBACK_PALETTE);
  const [field, setField] = useState(DEFAULT_FIELD);
  const [storage, setStorage] = useState('');
  const [connected, setConnected] = useState(socket.connected);

  const [lobby, setLobby] = useState(null);
  const [mySlot, setMySlot] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [gamePlayers, setGamePlayers] = useState({});
  const [gameSettings, setGameSettings] = useState({ goalLimit: 7, timeLimit: 180 });
  const [result, setResult] = useState(null);
  const [toast, setToast] = useState('');

  const toastTimer = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  }, []);

  useEffect(() => {
    localStorage.setItem('ah:profile', JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    api.get('/lobbies/config')
      .then((cfg) => {
        if (cfg.palette?.length) setPalette(cfg.palette);
        if (cfg.field) setField(cfg.field);
        setStorage(cfg.storage);
        setProfile((p) => (p.color ? p : { ...p, color: cfg.palette[1] }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => {
      setConnected(false);
      showToast('Connection lost — reconnecting…');
    };
    const onLobbyState = (state) => {
      setLobby(state);
      setGameSettings(state.settings);
    };
    const onStart = ({ field: f, players, settings }) => {
      if (f) setField(f);
      setGamePlayers(players);
      setGameSettings(settings);
      setResult(null);
      setGameState(null);
      setScreen('game');
    };
    const onState = (s) => setGameState(s);
    const onGoal = ({ scorer }) => {
      const who = scorer === mySlot ? 'You scored!' : 'Opponent scored';
      showToast(who);
    };
    const onEnd = (payload) => {
      setResult(payload);
      if (payload.players) setGamePlayers(payload.players);
    };
    const onOpponentLeft = ({ name }) => showToast(`${name} left the lobby`);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('lobby:state', onLobbyState);
    socket.on('game:start', onStart);
    socket.on('game:state', onState);
    socket.on('game:goal', onGoal);
    socket.on('game:end', onEnd);
    socket.on('lobby:opponent-left', onOpponentLeft);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('lobby:state', onLobbyState);
      socket.off('game:start', onStart);
      socket.off('game:state', onState);
      socket.off('game:goal', onGoal);
      socket.off('game:end', onEnd);
      socket.off('lobby:opponent-left', onOpponentLeft);
    };
  }, [mySlot, showToast]);

  const enterLobby = useCallback((code, password) => {
    socket.emit(
      'lobby:join',
      { code, password, name: profile.name.trim(), color: profile.color },
      (res) => {
        if (res?.error) {
          showToast(res.error);
          return;
        }
        setMySlot(res.slot);
        setLobby(res.state);
        setGameSettings(res.state.settings);
        setScreen('lobby');
      }
    );
  }, [profile, showToast]);

  const leaveLobby = useCallback(() => {
    socket.emit('lobby:leave');
    setLobby(null);
    setMySlot(null);
    setGameState(null);
    setResult(null);
    setScreen('home');
  }, []);

  const backToLobby = useCallback(() => {
    setResult(null);
    setGameState(null);
    setScreen('lobby');
  }, []);

  // Note: navigation away from the game screen is explicit (result overlay ->
  // "Back to lobbies", or leaving the lobby). An automatic "lobby is waiting ->
  // go back" effect would race with game:start and eject players immediately.

  return (
    <div className="app">
      <div className="brand">
        <span className="puck-dot" />
        <h1>Neon Air Hockey</h1>
      </div>
      <p className="subtitle">
        Real-time 2-player table hockey · Express · React · Node · Socket.IO
      </p>

      {screen === 'home' && (
        <Home palette={palette} profile={profile} setProfile={setProfile} onEnter={enterLobby} />
      )}

      {screen === 'lobby' && lobby && (
        <LobbyRoom lobby={lobby} mySlot={mySlot} palette={palette} onLeave={leaveLobby} />
      )}

      {screen === 'game' && (
        <Game
          field={field}
          players={gamePlayers}
          settings={gameSettings}
          state={gameState}
          result={result}
          mySlot={mySlot}
          onRematch={() => socket.emit('game:rematch')}
          onLeave={backToLobby}
        />
      )}

      <div className="status-bar">
        <span className="dot" style={{ background: connected ? 'var(--ok)' : 'var(--accent2)' }} />
        {connected ? 'Connected' : 'Offline'}
        {storage && ` · storage: in-memory`}
      </div>

      {screen === 'home' && (
        <p className="footer-note">
          Tip: open this page in two browser windows to test a match against yourself.
        </p>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
