# XO Arena

Multiplayer XO (tic-tac-toe) with a server-authoritative Nakama backend and a modern React frontend.

## Highlights
- Authoritative 1v1 match flow (all moves validated on server)
- 30-second turn timer with automatic turn skip
- Persistent head-to-head score between two players
- Persistent play history per player
- Profile update support (username/display name)
- In-match rematch flow (play as many rounds as you want)

## Tech Stack
- Backend runtime: Nakama JavaScript runtime (TypeScript source)
- Frontend: React + Vite + TypeScript
- Database: CockroachDB (via Docker)
- Realtime/API client: `@heroiclabs/nakama-js`

## Project Structure
```text
backend/      # Nakama runtime code (TypeScript -> build/main.js)
frontend/     # React application
data/         # Nakama local config and runtime mount
docker-compose.yml
```

## Prerequisites
- Node.js 18+
- npm
- Docker Desktop (or Docker Engine + Compose)

## Quick Start

### 1. Install dependencies
```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Build backend runtime bundle
```bash
cd backend
npm run build
```

### 3. Start infrastructure
```bash
cd ..
docker compose up -d
```

### 4. Start frontend
```bash
cd frontend
npm run dev -- --host 0.0.0.0 --port 5173
```

Open:
- App: `http://localhost:5173`
- Nakama API: `http://localhost:7350`
- Nakama Console: `http://localhost:7351` (default `admin` / `password`)

## Development Workflow

### Rebuild backend after backend code changes
```bash
cd backend
npm run build
cd ..
docker compose restart nakama
```

### Stop services
```bash
docker compose down
```

## Data Storage Model
- Account profile: Nakama account user fields (`username`, `display_name`)
- Match history: Nakama storage collection `ttt_history`, key `recent`
- Head-to-head score: Nakama storage collection `ttt_h2h`

## Runtime Notes
- The backend compiles into a single runtime file: `backend/build/main.js`
- Nakama loads runtime modules from `/nakama/data/modules` (mounted from `backend/build`)

## Troubleshooting
- If frontend says login failed:
	- Ensure Nakama is running: `docker compose ps`
	- Verify API health: `curl -I http://localhost:7350`
- If Docker start fails for old image tags:
	- Pull latest images and rerun `docker compose up -d`
