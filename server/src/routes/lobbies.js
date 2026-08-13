import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { lobbyRepo, matchRepo, storageMode } from '../repo/index.js';
import { generateUniqueCode } from '../game/codes.js';
import { PALETTE, FIELD } from '../game/constants.js';

export const lobbiesRouter = Router();

const clampInt = (v, min, max, fallback) => {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

lobbiesRouter.get('/config', (_req, res) => {
  res.json({ field: FIELD, palette: PALETTE, storage: storageMode() });
});

// List joinable lobbies (private ones are listed but locked).
lobbiesRouter.get('/', async (_req, res, next) => {
  try {
    const docs = await lobbyRepo.listPublic();
    res.json({ lobbies: docs.map((d) => d.toPublic()) });
  } catch (err) {
    next(err);
  }
});

lobbiesRouter.get('/:code', async (req, res, next) => {
  try {
    const lobby = await lobbyRepo.findByCode(req.params.code);
    if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
    return res.json({ lobby: lobby.toPublic() });
  } catch (err) {
    return next(err);
  }
});

// Create a lobby. The creator joins over the socket afterwards.
lobbiesRouter.post('/', async (req, res, next) => {
  try {
    const { name, hostName, password, goalLimit, timeLimit } = req.body || {};

    const lobbyName = String(name || '').trim();
    const host = String(hostName || '').trim();
    if (lobbyName.length < 2 || lobbyName.length > 24) {
      return res.status(400).json({ error: 'Lobby name must be 2-24 characters' });
    }
    if (host.length < 2 || host.length > 16) {
      return res.status(400).json({ error: 'Your name must be 2-16 characters' });
    }

    const pass = String(password || '');
    if (pass && (pass.length < 3 || pass.length > 32)) {
      return res.status(400).json({ error: 'Password must be 3-32 characters' });
    }

    const code = await generateUniqueCode();
    const lobby = await lobbyRepo.create({
      code,
      name: lobbyName,
      hostName: host,
      isPrivate: !!pass,
      passwordHash: pass ? await bcrypt.hash(pass, 10) : null,
      settings: {
        goalLimit: clampInt(goalLimit, 1, 21, 7),
        timeLimit: clampInt(timeLimit, 0, 3600, 180),
      },
      players: [],
    });

    return res.status(201).json({ lobby: lobby.toPublic(), code });
  } catch (err) {
    return next(err);
  }
});

// Pre-flight check used by the "join with code" form before opening the socket.
lobbiesRouter.post('/:code/verify', async (req, res, next) => {
  try {
    const lobby = await lobbyRepo.findByCode(req.params.code, true);
    if (!lobby) return res.status(404).json({ error: 'No lobby with that code' });
    if (lobby.status === 'playing') {
      return res.status(409).json({ error: 'That match already started' });
    }
    if (lobby.players.filter((p) => p.connected).length >= 2) {
      return res.status(409).json({ error: 'Lobby is full' });
    }
    if (lobby.isPrivate) {
      const password = String(req.body?.password || '');
      const ok = password && (await bcrypt.compare(password, lobby.passwordHash || ''));
      if (!ok) return res.status(401).json({ error: 'Wrong password' });
    }
    return res.json({ ok: true, lobby: lobby.toPublic() });
  } catch (err) {
    return next(err);
  }
});

lobbiesRouter.get('/history/recent', async (_req, res, next) => {
  try {
    res.json({ matches: await matchRepo.recent(10) });
  } catch (err) {
    next(err);
  }
});
