# Neon Air Hockey — Real-time 2-Player Game

A table air-hockey game for two players on **two different devices**, built with
**Express · React · Node · Socket.IO**.

No database required — lobbies and match history live in server memory
(fine for Render free tier and demos; data resets when the process restarts).

The server runs the physics; browsers only send paddle positions and render snapshots.
That means no player can cheat by hacking their client, and both screens always agree on the score.

---

## Features

| Feature | Where it lives |
|---|---|
| Create a lobby | `POST /api/lobbies` → `client/src/components/Home.jsx` |
| Password-protect a lobby | bcrypt hash on the lobby (never sent to the browser) |
| Browse the lobby list | live list over Socket.IO (`lobbies:list`), auto-refreshing |
| Join with a generated code | unique 6-char code (`nanoid`), verified before joining |
| Choose paddle colour | 8-colour palette; the opponent's colour is locked out |
| Set your display name | editable on the home screen *and* inside the lobby |
| Goals needed to win | 1–21, host-controlled, enforced server-side |
| Time limit | off / 1 / 2 / 3 / 5 / 10 min, enforced server-side |

Extras: host migration when the host leaves, forfeit-win on disconnect mid-match,
rematch, match history (in-memory), goal/countdown overlays, mouse + touch + keyboard
(WASD/arrows), mobile-friendly layout.

---

## Quick start (local)

Two terminals.

**1 — API server**

```bash
cd server
npm install
npm start                 # http://localhost:4000
```

**2 — React client**

```bash
cd client
npm install
npm run dev               # http://localhost:5173
```

Open <http://localhost:5173> in **two browser windows** (or two devices on the same network)
to play. One creates a lobby, the other joins with the code.

### Environment variables (`server/.env` — optional)

| Variable | Meaning |
|---|---|
| `PORT` | API port (default `4000`; Render sets this for you) |
| `CORS_ORIGIN` | Allowed browser origins, comma-separated, or `*` |

---

## Deploy on Render (no database)

1. Push this repo to GitHub.
2. On [Render](https://render.com): **New → Web Service** → connect the repo.
3. Settings:

| Setting | Value |
|---|---|
| **Runtime** | Node |
| **Build Command** | `npm run build` |
| **Start Command** | `npm start` |
| **Instance** | Free is fine |

4. Optional env var: `CORS_ORIGIN=*` (default) or your exact Render URL.

Render sets `PORT` automatically. After deploy, open your `https://….onrender.com` URL —
one service serves both the API and the built React app.

> Free instances sleep after idle time; the first request can take ~30–60s, and
> in-memory lobbies/history are cleared on every restart/sleep.

### Playing on two physical devices (local)

The Vite dev server listens on `0.0.0.0` and proxies `/api` + `/socket.io`,
so the second device uses your LAN address, e.g. `http://192.168.1.20:5173`.

---

## Production build (local)

```bash
npm run build             # from repo root: builds client + installs server deps
npm start                 # Express serves client/dist + API on one port
```

Then everything is on `http://localhost:4000`.

---

## How the multiplayer works

```
Browser A ──┐                        ┌── authoritative physics @60Hz
            ├── Socket.IO ── Node ───┤   collision, goals, clock
Browser B ──┘                        └── in-memory lobbies + match history
```

1. A client sends only `game:input { x, y }` — the *desired* paddle position.
2. The server clamps that to the player's own half, caps paddle speed, steps the puck
   with sub-stepping, and detects goals.
3. Every tick it broadcasts `game:state`; clients interpolate between snapshots.
4. On a win it emits `game:end` and stores a match record in memory.

### Project layout

```
package.json              Render build/start scripts (repo root)
server/
  src/index.js            Express + Socket.IO; serves client/dist in prod
  src/config/             env loading
  src/routes/lobbies.js   REST: create / list / verify / config / history
  src/game/engine.js      authoritative air-hockey simulation
  src/game/rooms.js       socket handlers
  src/repo/               in-memory storage
  test-e2e.mjs            end-to-end socket test
client/
  src/App.jsx             screen routing + socket wiring
  src/components/…        Home, LobbyRoom, Game, Rink
```

---

## Tests

```bash
# with the server running:
cd server && node test-e2e.mjs
```

---

## Controls

- **Mouse / touch** — move or drag anywhere on the rink; your paddle follows.
- **Keyboard** — arrow keys or WASD.

Your paddle is the one with the bright white ring.
