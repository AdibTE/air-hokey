import { memoryLobbies, memoryMatches } from './memoryStore.js';

/** Always in-memory — no database required (Render-friendly). */
export function storageMode() {
  return 'memory';
}

export const lobbyRepo = {
  async create(data) {
    return memoryLobbies.create(data);
  },
  /** @param {boolean} [_withSecret] password hash is always on the in-memory doc */
  async findByCode(code, _withSecret = false) {
    const normalized = String(code || '').toUpperCase().trim();
    if (!normalized) return null;
    return memoryLobbies.findByCode(normalized);
  },
  async listPublic() {
    return memoryLobbies.listPublic();
  },
  async deleteByCode(code) {
    const normalized = String(code || '').toUpperCase().trim();
    return memoryLobbies.deleteByCode(normalized);
  },
  async exists(code) {
    const normalized = String(code || '').toUpperCase().trim();
    if (!normalized) return false;
    return memoryLobbies.exists(normalized);
  },
  async save(doc) {
    if (!doc) return null;
    doc.lastActiveAt = new Date();
    return doc.save();
  },
};

export const matchRepo = {
  async create(data) {
    return memoryMatches.create(data);
  },
  async recent(limit = 10) {
    return memoryMatches.recent(limit);
  },
};
