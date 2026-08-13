import bcrypt from 'bcryptjs';
import { GameEngine } from './engine.js';
import { FIELD, PALETTE } from './constants.js';
import { lobbyRepo, matchRepo } from '../repo/index.js';

/** code -> { engine, interval, players } runtime state (never persisted) */
const rooms = new Map();

const sanitize = (s, max) => String(s || '').replace(/[<>]/g, '').trim().slice(0, max);
const validColor = (c) => (/^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c : PALETTE[0]);

function roomOf(code) {
  return rooms.get(code) || null;
}

function stopLoop(code) {
  const room = roomOf(code);
  if (room?.interval) {
    clearInterval(room.interval);
    room.interval = null;
  }
}

async function lobbyState(lobby) {
  return {
    code: lobby.code,
    name: lobby.name,
    isPrivate: lobby.isPrivate,
    status: lobby.status,
    settings: {
      goalLimit: lobby.settings.goalLimit,
      timeLimit: lobby.settings.timeLimit,
    },
    players: lobby.players.map((p) => ({
      name: p.name,
      color: p.color,
      slot: p.slot,
      isHost: p.isHost,
      ready: p.ready,
      connected: p.connected,
    })),
  };
}

export function registerSocketHandlers(io) {
  const emitLobbyState = async (lobby) => {
    io.to(lobby.code).emit('lobby:state', await lobbyState(lobby));
  };

  const broadcastList = async () => {
    const docs = await lobbyRepo.listPublic();
    io.emit('lobbies:list', { lobbies: docs.map((d) => d.toPublic()) });
  };

  io.on('connection', (socket) => {
    socket.data.code = null;
    socket.data.slot = null;

    socket.on('lobbies:subscribe', async () => {
      const docs = await lobbyRepo.listPublic();
      socket.emit('lobbies:list', { lobbies: docs.map((d) => d.toPublic()) });
    });

    socket.on('lobby:join', async (payload = {}, ack) => {
      const respond = (data) => typeof ack === 'function' && ack(data);
      try {
        const code = String(payload.code || '').toUpperCase().trim();
        const lobby = await lobbyRepo.findByCode(code, true);
        if (!lobby) return respond({ error: 'Lobby not found' });

        if (lobby.isPrivate) {
          const ok = await bcrypt.compare(String(payload.password || ''), lobby.passwordHash || '');
          if (!ok) return respond({ error: 'Wrong password' });
        }

        const active = lobby.players.filter((p) => p.connected);
        if (active.length >= 2) return respond({ error: 'Lobby is full' });
        if (lobby.status === 'playing') return respond({ error: 'Match already in progress' });

        const name = sanitize(payload.name, 16) || 'Player';
        const color = validColor(payload.color);
        const takenSlots = new Set(active.map((p) => p.slot));
        const slot = takenSlots.has('home') ? 'away' : 'home';
        const isHost = active.length === 0;

        // Same color as the opponent? nudge to the next palette entry.
        let finalColor = color;
        if (active.some((p) => p.color.toLowerCase() === color.toLowerCase())) {
          finalColor = PALETTE.find(
            (c) => !active.some((p) => p.color.toLowerCase() === c.toLowerCase())
          ) || color;
        }

        lobby.players = active.concat([
          { socketId: socket.id, name, color: finalColor, slot, isHost, ready: false, connected: true },
        ]);
        if (isHost) lobby.hostName = name;
        lobby.status = 'waiting';
        await lobbyRepo.save(lobby);

        socket.data.code = lobby.code;
        socket.data.slot = slot;
        socket.join(lobby.code);

        respond({ ok: true, slot, state: await lobbyState(lobby) });
        await emitLobbyState(lobby);
        await broadcastList();
        return undefined;
      } catch (err) {
        return respond({ error: err.message || 'Join failed' });
      }
    });

    const withLobby = async (fn) => {
      const code = socket.data.code;
      if (!code) return;
      const lobby = await lobbyRepo.findByCode(code);
      if (!lobby) return;
      const me = lobby.players.find((p) => p.socketId === socket.id);
      if (!me) return;
      await fn(lobby, me);
    };

    socket.on('lobby:update-profile', async ({ name, color } = {}) => {
      await withLobby(async (lobby, me) => {
        if (name !== undefined) me.name = sanitize(name, 16) || me.name;
        if (color !== undefined) {
          const wanted = validColor(color);
          const clash = lobby.players.some(
            (p) => p.socketId !== socket.id && p.connected && p.color.toLowerCase() === wanted.toLowerCase()
          );
          if (!clash) me.color = wanted;
        }
        if (me.isHost) lobby.hostName = me.name;
        me.ready = false;
        await lobbyRepo.save(lobby);
        await emitLobbyState(lobby);
        await broadcastList();
      });
    });

    // Host-only match rules.
    socket.on('lobby:update-settings', async ({ goalLimit, timeLimit } = {}) => {
      await withLobby(async (lobby, me) => {
        if (!me.isHost) return;
        if (goalLimit !== undefined) {
          const n = Number.parseInt(goalLimit, 10);
          if (!Number.isNaN(n)) lobby.settings.goalLimit = Math.min(21, Math.max(1, n));
        }
        if (timeLimit !== undefined) {
          const n = Number.parseInt(timeLimit, 10);
          if (!Number.isNaN(n)) lobby.settings.timeLimit = Math.min(3600, Math.max(0, n));
        }
        lobby.players.forEach((p) => {
          p.ready = false;
        });
        if (lobby.markModified) lobby.markModified('settings');
        await lobbyRepo.save(lobby);
        await emitLobbyState(lobby);
        await broadcastList();
      });
    });

    socket.on('lobby:ready', async ({ ready } = {}) => {
      await withLobby(async (lobby, me) => {
        me.ready = !!ready;
        await lobbyRepo.save(lobby);
        await emitLobbyState(lobby);

        const active = lobby.players.filter((p) => p.connected);
        if (active.length === 2 && active.every((p) => p.ready) && lobby.status !== 'playing') {
          await startMatch(io, lobby);
          await broadcastList();
        }
      });
    });

    socket.on('game:input', ({ x, y } = {}) => {
      const code = socket.data.code;
      const slot = socket.data.slot;
      const room = roomOf(code);
      if (!room || !slot) return;
      room.engine.setTarget(slot, x, y);
    });

    socket.on('game:rematch', async () => {
      await withLobby(async (lobby, me) => {
        me.ready = true;
        const active = lobby.players.filter((p) => p.connected);
        lobby.status = 'waiting';
        await lobbyRepo.save(lobby);
        await emitLobbyState(lobby);
        if (active.length === 2 && active.every((p) => p.ready)) {
          await startMatch(io, lobby);
        }
      });
    });

    socket.on('lobby:leave', async () => {
      await handleLeave(io, socket);
      await broadcastList();
    });

    socket.on('disconnect', async () => {
      await handleLeave(io, socket);
      await broadcastList();
    });
  });
}

async function startMatch(io, lobby) {
  const code = lobby.code;
  stopLoop(code);

  const engine = new GameEngine({
    goalLimit: lobby.settings.goalLimit,
    timeLimit: lobby.settings.timeLimit,
  });

  const players = {};
  lobby.players.forEach((p) => {
    players[p.slot] = { name: p.name, color: p.color };
  });

  rooms.set(code, { engine, interval: null, players, startedAt: Date.now() });

  lobby.status = 'playing';
  lobby.players.forEach((p) => {
    p.ready = false;
  });
  await lobbyRepo.save(lobby);

  // Tell clients the lobby is now in-game *before* the start event, so no
  // client-side guard can see a stale "waiting" status once the match begins.
  io.to(code).emit('lobby:state', await lobbyStateSafe(lobby));
  io.to(code).emit('game:start', {
    field: FIELD,
    players,
    settings: {
      goalLimit: lobby.settings.goalLimit,
      timeLimit: lobby.settings.timeLimit,
    },
  });

  const room = rooms.get(code);
  room.interval = setInterval(async () => {
    const event = engine.step();
    io.to(code).emit('game:state', engine.snapshot());

    if (event?.type === 'goal') {
      io.to(code).emit('game:goal', { scorer: event.scorer, score: engine.score });
    }
    if (event?.type === 'end') {
      stopLoop(code);
      io.to(code).emit('game:end', {
        winner: event.winner,
        reason: event.reason,
        score: engine.score,
        players,
      });
      await saveMatch(code, lobby, engine, event, players);
      const fresh = await lobbyRepo.findByCode(code);
      if (fresh) {
        fresh.status = 'waiting';
        fresh.players.forEach((p) => {
          p.ready = false;
        });
        await lobbyRepo.save(fresh);
        io.to(code).emit('lobby:state', await lobbyStateSafe(fresh));
      }
    }
  }, 1000 / FIELD.tickHz);
}

async function lobbyStateSafe(lobby) {
  return {
    code: lobby.code,
    name: lobby.name,
    isPrivate: lobby.isPrivate,
    status: lobby.status,
    settings: {
      goalLimit: lobby.settings.goalLimit,
      timeLimit: lobby.settings.timeLimit,
    },
    players: lobby.players.map((p) => ({
      name: p.name,
      color: p.color,
      slot: p.slot,
      isHost: p.isHost,
      ready: p.ready,
      connected: p.connected,
    })),
  };
}

async function saveMatch(code, lobby, engine, event, players) {
  try {
    await matchRepo.create({
      lobbyCode: code,
      lobbyName: lobby.name,
      home: { ...(players.home || {}), score: engine.score.home },
      away: { ...(players.away || {}), score: engine.score.away },
      winner: event.winner,
      reason: event.reason,
      durationSec: Math.round(engine.elapsedMs / 1000),
      settings: { goalLimit: engine.goalLimit, timeLimit: engine.timeLimit },
    });
  } catch (err) {
    console.warn('[match] could not persist result:', err.message);
  }
}

async function handleLeave(io, socket) {
  const code = socket.data.code;
  if (!code) return;
  socket.data.code = null;

  const lobby = await lobbyRepo.findByCode(code);
  if (!lobby) return;

  const leaving = lobby.players.find((p) => p.socketId === socket.id);
  lobby.players = lobby.players.filter((p) => p.socketId !== socket.id);
  socket.leave(code);

  const room = roomOf(code);
  if (room && lobby.status === 'playing') {
    // Opponent walked away mid-match -> the remaining player takes the win.
    stopLoop(code);
    const winner = leaving?.slot === 'home' ? 'away' : 'home';
    io.to(code).emit('game:end', {
      winner,
      reason: 'forfeit',
      score: room.engine.score,
      players: room.players,
    });
    await saveMatch(code, lobby, room.engine, { winner, reason: 'forfeit' }, room.players);
    rooms.delete(code);
  }

  if (lobby.players.length === 0) {
    stopLoop(code);
    rooms.delete(code);
    await lobbyRepo.deleteByCode(code);
    return;
  }

  // Promote the remaining player to host.
  if (leaving?.isHost && lobby.players[0]) {
    lobby.players[0].isHost = true;
    lobby.hostName = lobby.players[0].name;
  }
  lobby.status = 'waiting';
  lobby.players.forEach((p) => {
    p.ready = false;
  });
  await lobbyRepo.save(lobby);
  io.to(code).emit('lobby:state', await lobbyStateSafe(lobby));
  io.to(code).emit('lobby:opponent-left', { name: leaving?.name || 'Opponent' });
}
