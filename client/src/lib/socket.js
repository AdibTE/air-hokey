import { io } from 'socket.io-client';

// Same-origin: in dev Vite proxies /socket.io to the API server, so this works
// from the sandbox preview host, localhost, or a LAN IP without any config.
export const socket = io('/', {
  autoConnect: true,
  // Prefer websocket immediately — polling feels laggy on remote hosts.
  transports: ['websocket'],
  upgrade: false,
  rememberUpgrade: true,
});

export const api = {
  async get(path) {
    const res = await fetch(`/api${path}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },
  async post(path, body) {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },
};
