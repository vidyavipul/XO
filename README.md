# Nakama Tic-Tac-Toe Project

This project is a multiplayer Tic-Tac-Toe game built using **Nakama** as the game server and **React** for the user interface.

## Tech Stack
- **Game Server:** Nakama (running in Docker)
- **Server Language:** TypeScript (compiled to JavaScript)
- **Frontend Framework:** React (using Vite)
- **API Client:** @heroiclabs/nakama-js

## Project Structure
- `/backend`: Contains the server-authoritative logic.
- `/frontend`: Contains the React application.
- `/data`: Configuration for the Nakama server.
- `docker-compose.yml`: Used to start Nakama and the database.

## How to Get Started

### 1. Requirements
- Node.js & npm
- Docker & Docker Compose (Wait, Docker is not yet available in this environment? I will check!)

### 2. Building the Backend
1. Go to the `backend` folder.
2. Run `npm install` and then `npm run build`.
3. This creates a `build/main.js` file which Nakama will use.

### 3. Running the Server 
Currently, we are setting up the Docker environment. Once ready, you will run:
```bash
docker-compose up
```
This will start Nakama at `http://localhost:7350` and the Console at `http://localhost:7351`.

### 4. Running the Frontend
1. Go to the `frontend` folder.
2. Run `npm install` and then `npm run dev`.
3. Open the URL shown in the terminal.

## Game Logic (Server-Authoritative)
All moves are validated on the server. If a player tries to move out of turn or in a filled spot, the server rejects it. The server also detects the winner and broadcasts the final state to both players.
