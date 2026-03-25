import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { Client, Session, Socket } from '@heroiclabs/nakama-js';
import './index.css';

// Nakama Server Configuration
const SERVER_KEY = 'defaultkey';
const HOST = '127.0.0.1';
const PORT = '7350';
const USE_SSL = false;

enum OpCode {
    MOVE = 1,
    STATE_UPDATE = 2,
    GAME_OVER = 3
}

interface GameState {
    board: (string | null)[];
    marks: { [userID: string]: string };
    turn: string | null;
    winner: string | null;
}

function App() {
    const [client] = useState(new Client(SERVER_KEY, HOST, PORT, USE_SSL));
    const [session, setSession] = useState<Session | null>(null);
    const [socket, setSocket] = useState<Socket | null>(null);
    const [matchId, setMatchId] = useState<string | null>(null);
    const [gameState, setGameState] = useState<GameState | null>(null);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('Welcome to Nakama Tic-Tac-Toe');

    // Effect to handle socket messages
    useEffect(() => {
        if (!socket) return;

        socket.onmatchdata = (result) => {
            const data = JSON.parse(new TextDecoder().decode(result.data));
            console.log('Match Data Received:', result.op_code, data);

            if (result.op_code === OpCode.STATE_UPDATE || result.op_code === OpCode.GAME_OVER) {
                setGameState(data);
                if (result.op_code === OpCode.GAME_OVER) {
                    if (data.winner === 'draw') {
                        setStatus("It's a Draw!");
                    } else if (data.winner === session?.user_id) {
                        setStatus('You Won! 🎉');
                    } else {
                        setStatus('You Lost! 😢');
                    }
                } else {
                    if (data.turn === session?.user_id) {
                        setStatus("Your Turn");
                    } else {
                        setStatus("Opponent's Turn");
                    }
                }
            }
        };

        socket.onmatchmakermatched = (matched) => {
            console.log('Matched!', matched);
            setStatus('Match found! Joining...');
            socket.joinMatch(matched.match_id).then((match) => {
                setMatchId(match.match_id);
            });
        };

    }, [socket, session]);

    const authenticate = async () => {
        setLoading(true);
        setStatus('Authenticating...');
        try {
            // Use local storage for device ID
            let deviceId = localStorage.getItem('nakama-device-id');
            if (!deviceId) {
                deviceId = Math.random().toString(36).substring(2, 11);
                localStorage.setItem('nakama-device-id', deviceId);
            }

            const newSession = await client.authenticateDevice(deviceId, true);
            setSession(newSession);

            const newSocket = client.createSocket(USE_SSL, false);
            await newSocket.connect(newSession, true);
            setSocket(newSocket);
            
            setStatus('Logged in. Waiting for matchmaking...');
            setLoading(false);
        } catch (error) {
            console.error(error);
            setStatus('Login failed. Check console.');
            setLoading(false);
        }
    };

    const findMatch = async () => {
        if (!socket) return;
        setStatus('Searching for opponent...');
        setLoading(true);
        try {
            // Find a match with exactly 2 players
            await socket.addMatchmaker('*', 2, 2);
        } catch (error) {
            console.error(error);
            setStatus('Matchmaking failed.');
            setLoading(false);
        }
    };

    const makeMove = async (position: number) => {
        if (!socket || !matchId || !gameState || gameState.winner || gameState.turn !== session?.user_id) return;
        if (gameState.board[position] !== null) return;

        const moveData = { position };
        await socket.sendMatchState(matchId, OpCode.MOVE, JSON.stringify(moveData));
    };

    const reset = () => {
        window.location.reload();
    };

    return (
        <div className="game-container">
            <h1>Nakama Tic-Tac-Toe</h1>
            
            {!session ? (
                <button onClick={authenticate} disabled={loading}>
                    {loading ? 'Starting...' : 'Connect to Server'}
                </button>
            ) : !matchId ? (
                <div className="lobby">
                    <p className="status">{status}</p>
                    <button onClick={findMatch} disabled={loading}>Find Match</button>
                </div>
            ) : (
                <>
                    <p className="status">{status}</p>
                    <div className="board">
                        {gameState?.board.map((cell, index) => (
                            <div 
                                key={index} 
                                className={`cell ${cell?.toLowerCase() || ''}`}
                                onClick={() => makeMove(index)}
                            >
                                {cell}
                            </div>
                        ))}
                    </div>
                    {gameState?.winner && (
                        <button onClick={reset}>Play Again</button>
                    )}
                </>
            )}
            
            {session && <p style={{opacity: 0.5, fontSize: '0.8rem'}}>User ID: {session.user_id}</p>}
        </div>
    );
}

export default App;
