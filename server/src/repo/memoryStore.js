/**
 * In-memory store for lobbies and match history.
 * No database — ideal for Render free tier / demos.
 * Data is lost when the process restarts (including sleep on free plans).
 */

const lobbies = new Map();
const matches = [];
const MAX_MATCH_HISTORY = 50;

function publicView(doc) {
  return {
    code: doc.code,
    name: doc.name,
    hostName: doc.hostName,
    isPrivate: doc.isPrivate,
    settings: { goalLimit: doc.settings.goalLimit, timeLimit: doc.settings.timeLimit },
    playerCount: doc.players.filter((p) => p.connected).length,
    status: doc.status,
    createdAt: doc.createdAt,
  };
}

function wrap(raw) {
  raw.toPublic = () => publicView(raw);
  raw.save = async () => {
    raw.updatedAt = new Date();
    lobbies.set(raw.code, raw);
    return raw;
  };
  return raw;
}

export const memoryLobbies = {
  async create(data) {
    const now = new Date();
    const doc = wrap({
      code: data.code,
      name: data.name,
      hostName: data.hostName,
      isPrivate: !!data.isPrivate,
      passwordHash: data.passwordHash || null,
      settings: { goalLimit: 7, timeLimit: 180, ...(data.settings || {}) },
      players: data.players || [],
      status: 'waiting',
      lastActiveAt: now,
      createdAt: now,
      updatedAt: now,
    });
    lobbies.set(doc.code, doc);
    return doc;
  },
  async findByCode(code) {
    return lobbies.get(String(code).toUpperCase()) || null;
  },
  async listPublic() {
    return [...lobbies.values()]
      .filter((l) => l.status !== 'finished')
      .sort((a, b) => b.createdAt - a.createdAt);
  },
  async deleteByCode(code) {
    lobbies.delete(String(code).toUpperCase());
  },
  async exists(code) {
    return lobbies.has(String(code).toUpperCase());
  },
};

export const memoryMatches = {
  async create(data) {
    const doc = { ...data, _id: String(matches.length + 1), createdAt: new Date() };
    matches.push(doc);
    if (matches.length > MAX_MATCH_HISTORY) matches.splice(0, matches.length - MAX_MATCH_HISTORY);
    return doc;
  },
  async recent(limit = 10) {
    return matches.slice(-limit).reverse();
  },
};
