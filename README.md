# XO Arena

Modern multiplayer XO built with a server-authoritative backend and a responsive React UI.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Nakama](https://img.shields.io/badge/Nakama-1A1A1A?style=for-the-badge&logo=serverless&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![CockroachDB](https://img.shields.io/badge/CockroachDB-6933FF?style=for-the-badge&logo=cockroachlabs&logoColor=white)

## Why XO Arena
- Authoritative 1v1 gameplay (all moves validated on server)
- 30-second turn timer with automatic turn skip
- Persistent head-to-head score for player pairs
- Persistent play history per player
- Profile support (`username`, `display_name`)
- Infinite rematch loop inside the same match

## Architecture
```text
React (Vite) frontend
				|
				| WebSocket + REST via nakama-js
				v
Nakama (authoritative match runtime)
				|
				v
CockroachDB (accounts + storage objects)
```

## Stack
| Layer | Tech |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend Runtime | Nakama JavaScript runtime (TypeScript source) |
| Database | CockroachDB |
| Local Orchestration | Docker Compose |
| Realtime/API Client | `@heroiclabs/nakama-js` |

## Repository Layout
```text
backend/             # Nakama runtime TypeScript source
backend/build/       # Compiled runtime bundle (main.js)
frontend/            # React application
data/                # Nakama local config and mounted runtime data
docker-compose.yml   # Local infra (Nakama + CockroachDB)
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

### 2. Build backend runtime
```bash
cd ../backend
npm run build
```

### 3. Start backend services
```bash
cd ..
docker compose up -d
```

### 4. Start frontend
```bash
cd frontend
npm run dev -- --host 0.0.0.0 --port 5173
```

## Local URLs
- App: `http://localhost:5173`
- Nakama API: `http://localhost:7350`
- Nakama Console: `http://localhost:7351`
- Console credentials: `admin` / `password` (local only)

## Development Commands

### Rebuild backend after runtime changes
```bash
cd backend
npm run build
cd ..
docker compose restart nakama
```

### Check service status
```bash
docker compose ps
curl -I http://localhost:7350
curl -I http://localhost:7351
```

### Stop everything
```bash
docker compose down
```

## Data Model
- Account Profile: Nakama account user fields (`username`, `display_name`)
- Match History: Nakama storage collection `ttt_history` with key `recent`
- Head-to-Head Score: Nakama storage collection `ttt_h2h`

## Runtime Notes
- Backend is compiled into `backend/build/main.js`
- `backend/build` is mounted into Nakama modules path at runtime
- Match logic runs server-side (not client-trusted)

## Troubleshooting
- Login/auth issues:
	- Verify Nakama is running: `docker compose ps`
	- Verify API health: `curl -I http://localhost:7350`
- Runtime code changes not visible:
	- Rebuild backend and restart Nakama
- Docker image/tag pull issues:
	- Pull latest images and rerun `docker compose up -d`
