# XO Arena

Fast-paced multiplayer XO with a server-authoritative Nakama backend, modern React UI, and persistent player data.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Nakama](https://img.shields.io/badge/Nakama-111111?style=for-the-badge)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![CockroachDB](https://img.shields.io/badge/CockroachDB-6933FF?style=for-the-badge&logo=cockroachlabs&logoColor=white)

## Highlights

- Authoritative 1v1 gameplay with server-validated moves
- Dedicated new-user onboarding page (required username + display name)
- Matchmaking flow with queue timer and cancel action
- 30-second turn timer with auto-skip
- Round-based rematch loop inside same match session
- Forfeit handling when a player leaves mid-match
- Forfeit message uses player display name
- Persistent head-to-head counters
- Persistent recent match history
- Match replay list with move-by-move trail
- Match detail expands inline below each selected recent match
- Settings page with profile + history tabs
- User-scoped clear history action
- Post-round opponent leave does not award bonus points

## System

```text
React (Vite) UI
      |
      | nakama-js (REST + WebSocket)
      v
Nakama authoritative runtime (TypeScript -> JS)
      |
      v
CockroachDB storage
```

## Quick Start

### 1) Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2) Build runtime

```bash
cd ../backend
npm run build
```

### 3) Start services

```bash
cd ..
docker compose up -d
```

### 4) Start frontend

```bash
cd frontend
npm run dev -- --host 0.0.0.0 --port 5173
```

## Local Endpoints

- App: http://localhost:5173
- Nakama API: http://localhost:7350
- Nakama Console: http://localhost:7351

## Dev Workflow

### Runtime change cycle

```bash
cd backend
npm run build
cd ..
docker compose restart nakama
```

### Build checks

```bash
cd backend && npm run build
cd ../frontend && npm run build
```

## Data Stored

- Profile: Nakama account username + display name
- Recent matches: storage collection `ttt_history`, key `recent`
- Head-to-head stats: storage collection `ttt_h2h`

## Notes

- Backend runtime source is in `backend/src`
- Runtime output is loaded into Nakama from `backend/build/main.js`
- Backend logic is server authoritative (client is not trusted for outcomes)

## Free Hosting (Public Link + Global Play)

To let anyone play from anywhere with a shareable link, use this free-tier setup:

1. Frontend on Cloudflare Pages (free)
2. Nakama backend on Fly.io (free credits/trial)
3. Postgres on Neon free tier (Nakama-compatible)

### Deploy Plan

1) Deploy Database (Neon)
- Create a Neon Postgres project
- Copy the connection string
- Ensure SSL mode is enabled

2) Deploy Nakama (Fly.io)
- Create a Fly app from this repository
- Use your Nakama Docker setup
- Set environment variables:
      - database address (Neon URL)
      - socket server key
      - runtime http key
      - console username/password
- Expose ports 7350 (API) and 7349 if needed

3) Deploy Frontend (Cloudflare Pages)
- Build command: `npm run build`
- Output dir: `dist`
- Set API host env to your Fly Nakama URL

4) CORS and host config
- In Nakama config, allow your frontend domain
- In frontend, point client host to deployed Nakama endpoint

### Matchmaking Across Regions

- Any two users with the frontend link can match as long as both hit the same Nakama deployment.
- For smooth global play:
      - keep Nakama in a central region with low average latency for your audience
      - upgrade to multi-region later if needed (paid tier)

