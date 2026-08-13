import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';

import { env } from './config/env.js';
import { lobbiesRouter } from './routes/lobbies.js';
import { registerSocketHandlers } from './game/rooms.js';
import { storageMode } from './repo/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const corsOrigin = env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((s) => s.trim());

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '64kb' }));

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, storage: storageMode(), uptime: process.uptime() })
);
app.use('/api/lobbies', lobbiesRouter);

// Serve the built React app in production (single-service deploy on Render).
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'], credentials: true },
  pingInterval: 10000,
  pingTimeout: 20000,
});

registerSocketHandlers(io);

server.listen(env.port, '0.0.0.0', () => {
  console.log(`[server] listening on http://0.0.0.0:${env.port} (storage: ${storageMode()})`);
});
