/**
 * End-to-end smoke test: drives two real socket clients through
 * create -> password -> list -> join by code -> settings -> ready -> play -> win.
 * Run the server first, then: node test-e2e.mjs
 */
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://127.0.0.1:4000';
const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const get = async (path) => (await fetch(`${BASE}${path}`)).json();

const connect = () =>
  new Promise((resolve) => {
    const s = io(BASE, { transports: ['websocket'] });
    s.on('connect', () => resolve(s));
  });

const join = (sock, payload) =>
  new Promise((resolve) => sock.emit('lobby:join', payload, resolve));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. health
  const health = await get('/api/health');
  check('health endpoint responds', health.ok === true, `storage=${health.storage}`);

  // 2. create a password protected lobby
  const created = await post('/api/lobbies', {
    name: 'Test Arena',
    hostName: 'Alice',
    password: 'secret1',
    goalLimit: 2,
    timeLimit: 0,
  });
  check('create lobby returns 201', created.status === 201, `code=${created.data.code}`);
  const code = created.data.code;
  check('generated code is 6 chars', code?.length === 6, code);
  check('lobby marked private', created.data.lobby.isPrivate === true);
  check('goal limit persisted', created.data.lobby.settings.goalLimit === 2);

  // 3. validation
  const bad = await post('/api/lobbies', { name: 'x', hostName: 'Bob' });
  check('rejects too-short lobby name', bad.status === 400, bad.data.error);

  // 4. lobby list
  const list = await get('/api/lobbies');
  check('lobby appears in list', list.lobbies.some((l) => l.code === code));
  const listed = list.lobbies.find((l) => l.code === code);
  check('list hides password hash', listed && listed.passwordHash === undefined);

  // 5. password verification
  const wrongPass = await post(`/api/lobbies/${code}/verify`, { password: 'nope' });
  check('wrong password rejected (401)', wrongPass.status === 401, wrongPass.data.error);
  const rightPass = await post(`/api/lobbies/${code}/verify`, { password: 'secret1' });
  check('correct password accepted', rightPass.status === 200);
  const noSuch = await post('/api/lobbies/ZZZZZZ/verify', {});
  check('unknown code returns 404', noSuch.status === 404);

  // 6. two players join over sockets
  const a = await connect();
  const b = await connect();

  const badJoin = await join(a, { code, password: 'wrong', name: 'Alice', color: '#22d3ee' });
  check('socket join with wrong password fails', !!badJoin.error, badJoin.error);

  const joinA = await join(a, { code, password: 'secret1', name: 'Alice', color: '#22d3ee' });
  check('player A joins', joinA.ok === true, `slot=${joinA.slot}`);

  const joinB = await join(b, { code, password: 'secret1', name: 'Bob', color: '#ff3b6b' });
  check('player B joins opposite slot', joinB.ok && joinB.slot !== joinA.slot, `slot=${joinB.slot}`);

  // duplicate colour should be auto-corrected
  const c = await connect();
  const joinC = await join(c, { code, password: 'secret1', name: 'Eve', color: '#00ff00' });
  check('third player rejected (lobby full)', !!joinC.error, joinC.error);
  c.close();

  // 7. host-only settings (verify against authoritative server state, since an
  // ignored update correctly emits no lobby:state event)
  let lobbyState = null;
  a.on('lobby:state', (s) => { lobbyState = s; });

  b.emit('lobby:update-settings', { goalLimit: 9 }); // B is not host -> must be ignored
  await wait(300);
  const afterNonHost = await get(`/api/lobbies/${code}`);
  check('non-host cannot change settings', afterNonHost.lobby.settings.goalLimit === 2,
    `goalLimit=${afterNonHost.lobby.settings.goalLimit}`);

  a.emit('lobby:update-settings', { goalLimit: 4, timeLimit: 0 }); // host -> applied
  await wait(300);
  const afterHost = await get(`/api/lobbies/${code}`);
  check('host can change settings', afterHost.lobby.settings.goalLimit === 4,
    `goalLimit=${afterHost.lobby.settings.goalLimit}`);
  check('host settings broadcast to clients', lobbyState?.settings.goalLimit === 4);

  // put it back to a short match so the test finishes quickly
  a.emit('lobby:update-settings', { goalLimit: 2, timeLimit: 0 });
  await wait(250);

  // 8. start the match
  const started = new Promise((resolve) => a.once('game:start', resolve));
  a.emit('lobby:ready', { ready: true });
  b.emit('lobby:ready', { ready: true });
  const startPayload = await Promise.race([started, wait(3000).then(() => null)]);
  check('match starts when both ready', !!startPayload,
    startPayload ? `${startPayload.players.home.name} vs ${startPayload.players.away.name}` : 'timeout');

  // 9. state streaming
  let ticks = 0;
  let sawPlaying = false;
  const onState = (s) => { ticks += 1; if (s.status === 'playing') sawPlaying = true; };
  a.on('game:state', onState);
  await wait(1200);
  check('server streams game state', ticks > 30, `${ticks} ticks in 1.2s`);

  // 10. play until someone wins (drive paddles at the puck)
  const ended = new Promise((resolve) => a.once('game:end', resolve));
  await wait(2200); // let the countdown finish
  check('match reaches playing status', sawPlaying);

  let lastState = null;
  a.on('game:state', (s) => { lastState = s; });

  // Alice chases the puck to force goals; Bob parks off-centre so the net is open.
  const driver = setInterval(() => {
    if (!lastState) return;
    const p = lastState.puck;
    a.emit('game:input', { x: Math.min(480, p.x - 40), y: p.y });
    b.emit('game:input', { x: 900, y: 60 });
  }, 16);

  const endPayload = await Promise.race([ended, wait(60000).then(() => null)]);
  clearInterval(driver);

  check('match ends and reports a winner', !!endPayload,
    endPayload ? `winner=${endPayload.winner} score=${endPayload.score.home}-${endPayload.score.away} reason=${endPayload.reason}` : 'timeout');
  if (endPayload) {
    check('winner reached the goal limit',
      endPayload.score.home === 2 || endPayload.score.away === 2,
      `${endPayload.score.home}-${endPayload.score.away}`);
  }

  // 11. match history persisted
  await wait(400);
  const hist = await get('/api/lobbies/history/recent');
  check('match saved to history', hist.matches.length > 0,
    hist.matches[0] ? `${hist.matches[0].home.name} ${hist.matches[0].home.score}-${hist.matches[0].away.score} ${hist.matches[0].away.name}` : '');

  // 12. forfeit + cleanup
  b.close();
  await wait(500);
  a.close();
  await wait(600);
  const after = await fetch(`${BASE}/api/lobbies/${code}`);
  check('empty lobby is deleted', after.status === 404, `status=${after.status}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
