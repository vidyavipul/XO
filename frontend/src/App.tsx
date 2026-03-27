import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Client, Session, Socket } from '@heroiclabs/nakama-js';
import './index.css';

const SERVER_KEY = 'defaultkey';
const HOST = window.location.hostname || '127.0.0.1';
const PORT = '7350';
const USE_SSL = false;
const STORAGE_COLLECTION_HISTORY = 'ttt_history';
const STORAGE_KEY_HISTORY = 'recent';

enum OpCode {
    MOVE = 1,
    STATE_UPDATE = 2,
    GAME_OVER = 3,
    REMATCH = 4
}

type Screen = 'home' | 'game';

interface HeadToHead {
    wins: Record<string, number>;
    draws: number;
    totalGames: number;
}

interface HistoryItem {
    at: number;
    result: 'win' | 'loss' | 'draw';
    yourMark: 'X' | 'O';
    opponentId: string;
    opponentDisplayName?: string;
    opponentUsername?: string;
}

interface AccountState {
    user?: {
        username?: string;
        display_name?: string;
    };
}

interface GameState {
    board: (string | null)[];
    marks: { [userID: string]: string };
    turn: string | null;
    winner: string | null;
    usernames: Record<string, string>;
    playerOrder: string[];
    h2h: HeadToHead;
    round: number;
    turnDurationSec: number;
    turnRemainingSec: number;
    statusMessage: string;
    rematchVotes: Record<string, boolean>;
}

function App() {
    const [client] = useState(new Client(SERVER_KEY, HOST, PORT, USE_SSL));
    const [screen, setScreen] = useState<Screen>('home');
    const [session, setSession] = useState<Session | null>(null);
    const [socket, setSocket] = useState<Socket | null>(null);
    const [matchId, setMatchId] = useState<string | null>(null);
    const [matchTicket, setMatchTicket] = useState<string | null>(null);
    const [gameState, setGameState] = useState<GameState | null>(null);
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [account, setAccount] = useState<AccountState | null>(null);
    const [usernameInput, setUsernameInput] = useState('');
    const [displayNameInput, setDisplayNameInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('Welcome to XO Arena');

    const formatAuthError = async (error: unknown): Promise<string> => {
        if (error instanceof Response) {
            try {
                const bodyText = await error.text();
                return `HTTP ${error.status}: ${bodyText || error.statusText}`;
            } catch {
                return `HTTP ${error.status}: ${error.statusText}`;
            }
        }

        if (error instanceof Error) {
            return error.message;
        }

        return String(error);
    };

    const generateDeviceId = (): string => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 16)}`;
    };

    const selfId = session?.user_id || '';

    const opponentId = useMemo(() => {
        if (!gameState || !selfId) {
            return '';
        }
        for (let i = 0; i < gameState.playerOrder.length; i++) {
            if (gameState.playerOrder[i] !== selfId) {
                return gameState.playerOrder[i];
            }
        }
        return '';
    }, [gameState, selfId]);

    const selfName = gameState?.usernames?.[selfId] || account?.user?.display_name || account?.user?.username || 'You';
    const opponentName = gameState?.usernames?.[opponentId] || 'Opponent';

    const selfWins = gameState?.h2h?.wins?.[selfId] || 0;
    const opponentWins = gameState?.h2h?.wins?.[opponentId] || 0;
    const drawCount = gameState?.h2h?.draws || 0;
    const myMark = gameState?.marks?.[selfId] || '-';
    const opponentMark = opponentId ? (gameState?.marks?.[opponentId] || '-') : '-';

    const isMyTurn = !!gameState && gameState.turn === selfId;
    const canPlay = !!gameState && !!matchId && !gameState.winner && isMyTurn;

    const rematchVotes = gameState?.rematchVotes || {};
    const myVotedRematch = !!rematchVotes[selfId];
    const opponentVotedRematch = opponentId ? !!rematchVotes[opponentId] : false;

    useEffect(() => {
        if (!socket) {
            return;
        }

        socket.onmatchdata = (result) => {
            const data = JSON.parse(new TextDecoder().decode(result.data));
            if (result.op_code === OpCode.STATE_UPDATE || result.op_code === OpCode.GAME_OVER) {
                setGameState(data as GameState);
                if (data.statusMessage) {
                    setStatus(data.statusMessage);
                }
                if (result.op_code === OpCode.GAME_OVER) {
                    void loadHistory(session);
                }
            }
        };

        socket.onmatchmakermatched = (matched) => {
            setStatus('Match found. Joining...');
            socket.joinMatch(matched.match_id).then((match) => {
                setMatchId(match.match_id);
                setMatchTicket(null);
                setScreen('game');
                setStatus('Match joined. Good luck.');
            }).catch(() => {
                setStatus('Could not join the match. Please retry.');
            });
        };
    }, [socket, session]);

    const loadProfile = async (activeSession: Session) => {
        const accountResponse = await client.getAccount(activeSession);
        setAccount(accountResponse);
        setUsernameInput(accountResponse.user?.username || '');
        setDisplayNameInput(accountResponse.user?.display_name || '');
    };

    const loadHistory = async (activeSession: Session | null) => {
        if (!activeSession) {
            return;
        }

        const response = await client.readStorageObjects(activeSession, {
            object_ids: [{
                collection: STORAGE_COLLECTION_HISTORY,
                key: STORAGE_KEY_HISTORY,
                user_id: activeSession.user_id
            }]
        });

        const firstObject = response.objects?.[0];
        const value = firstObject?.value as { games?: HistoryItem[] } | undefined;
        setHistory(Array.isArray(value?.games) ? (value?.games || []) : []);
    };

    const authenticate = async () => {
        setLoading(true);
        setStatus('Authenticating...');
        try {
            let deviceId = localStorage.getItem('nakama-device-id');
            if (!deviceId || deviceId.length < 10) {
                deviceId = generateDeviceId();
                localStorage.setItem('nakama-device-id', deviceId);
            }

            const newSession = await client.authenticateDevice(deviceId, true);
            setSession(newSession);

            const newSocket = client.createSocket(USE_SSL, false);
            await newSocket.connect(newSession, true);
            setSocket(newSocket);

            await loadProfile(newSession);
            await loadHistory(newSession);

            setStatus('Connected. Update profile or find a match.');
        } catch (error) {
            const message = await formatAuthError(error);
            setStatus(`Login failed: ${message}`);
        } finally {
            setLoading(false);
        }
    };

    const updateProfile = async () => {
        if (!session) {
            return;
        }

        setLoading(true);
        setStatus('Saving profile...');
        try {
            await client.updateAccount(session, {
                username: usernameInput.trim() || undefined,
                display_name: displayNameInput.trim() || undefined
            });
            await loadProfile(session);
            setStatus('Profile updated.');
        } catch (error) {
            const message = await formatAuthError(error);
            setStatus(`Profile update failed: ${message}`);
        } finally {
            setLoading(false);
        }
    };

    const findMatch = async () => {
        if (!socket) {
            return;
        }

        setLoading(true);
        setStatus('Searching for opponent...');
        try {
            const ticket = await socket.addMatchmaker('*', 2, 2);
            setMatchTicket(ticket.ticket);
            setStatus('Matchmaking active. Waiting for another player...');
        } catch {
            setStatus('Matchmaking failed.');
        } finally {
            setLoading(false);
        }
    };

    const cancelMatchmaking = async () => {
        if (!socket || !matchTicket) {
            return;
        }

        try {
            await socket.removeMatchmaker(matchTicket);
            setMatchTicket(null);
            setStatus('Matchmaking canceled.');
        } catch {
            setStatus('Unable to cancel matchmaking.');
        }
    };

    const makeMove = async (position: number) => {
        if (!socket || !matchId || !gameState || !canPlay) {
            return;
        }
        if (gameState.board[position] !== null) {
            return;
        }

        try {
            await socket.sendMatchState(matchId, OpCode.MOVE, JSON.stringify({ position }));
        } catch {
            setStatus('Move could not be sent.');
        }
    };

    const requestRematch = async () => {
        if (!socket || !matchId || !gameState?.winner) {
            return;
        }

        try {
            await socket.sendMatchState(matchId, OpCode.REMATCH, JSON.stringify({ rematch: true }));
            setStatus('Rematch requested. Waiting for opponent...');
        } catch {
            setStatus('Could not request rematch.');
        }
    };

    const goHome = async () => {
        if (socket && matchId) {
            try {
                await socket.leaveMatch(matchId);
            } catch {
                // no-op
            }
        }

        setMatchId(null);
        setGameState(null);
        setScreen('home');
        setStatus('Back to home.');
    };

    const formatHistoryDate = (epochMs: number) => {
        const date = new Date(epochMs);
        return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
    };

    const turnProgress = gameState
        ? Math.max(0, Math.min(100, (gameState.turnRemainingSec / gameState.turnDurationSec) * 100))
        : 0;

    const renderHome = () => (
        <div className="home-layout">
            <section className="hero-card glass">
                <div className="hero-badge">Realtime Multiplayer</div>
                <h1>XO Arena</h1>
                <p>
                    Play stylish, server-authoritative XO duels with turn timers, head-to-head rivalry tracking,
                    instant rematches, and a polished competitive lobby experience.
                </p>
                <p className="status-pill">{status}</p>
                <div className="hero-points">
                    <span>30s Turn Timer</span>
                    <span>Live Rival Score</span>
                    <span>Persistent History</span>
                </div>
            </section>

            <section className="panel-grid">
                <article className="panel glass">
                    <h2>Profile</h2>
                    {!session ? (
                        <div className="stack">
                            <button onClick={authenticate} disabled={loading}>
                                {loading ? 'Connecting...' : 'Connect to Server'}
                            </button>
                            <p className="muted">Target: {HOST}:{PORT}</p>
                        </div>
                    ) : (
                        <div className="stack">
                            <label>
                                Username
                                <input
                                    value={usernameInput}
                                    onChange={(event) => setUsernameInput(event.target.value)}
                                    placeholder="Choose a unique username"
                                />
                            </label>
                            <label>
                                Display Name
                                <input
                                    value={displayNameInput}
                                    onChange={(event) => setDisplayNameInput(event.target.value)}
                                    placeholder="Name shown in profile"
                                />
                            </label>
                            <div className="row">
                                <button onClick={updateProfile} disabled={loading}>Save Profile</button>
                                <button onClick={findMatch} disabled={loading || !!matchTicket}>Find Match</button>
                            </div>
                            {matchTicket && (
                                <div className="row">
                                    <span className="muted">Searching for opponent...</span>
                                    <button className="secondary" onClick={cancelMatchmaking}>Cancel</button>
                                </div>
                            )}
                            <p className="muted">Active profile: {displayNameInput.trim() || usernameInput.trim() || 'Unnamed player'}</p>
                        </div>
                    )}
                </article>

                <article className="panel glass">
                    <h2>Play History</h2>
                    {!session ? (
                        <p className="muted">Connect to load your history.</p>
                    ) : history.length === 0 ? (
                        <p className="muted">No games yet. Play your first match.</p>
                    ) : (
                        <ul className="history-list">
                            {history.map((item, index) => (
                                <li key={`${item.at}-${index}`}>
                                    <span className={`pill result-${item.result}`}>{item.result.toUpperCase()}</span>
                                    <strong>vs {item.opponentDisplayName || item.opponentUsername || 'Opponent'}</strong>
                                    <span className="muted">as {item.yourMark}</span>
                                    <span className="muted">{formatHistoryDate(item.at)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </article>

                <article className="panel glass tips-panel">
                    <h2>Quick Start</h2>
                    <ul className="tips-list">
                        <li>Set your display name in Profile.</li>
                        <li>Press Find Match from both players.</li>
                        <li>Watch your mark (X/O) before opening move.</li>
                        <li>Both players can click Play Again for endless rounds.</li>
                    </ul>
                </article>
            </section>
        </div>
    );

    const renderGame = () => (
        <div className="game-layout">
            <header className="game-top glass">
                <button className="secondary" onClick={goHome}>Home</button>
                <div>
                    <h2>Round {gameState?.round || 0}</h2>
                    <p className="muted">You ({selfName}) vs {opponentName || 'Waiting for Opponent'}</p>
                </div>
                <button className="secondary" onClick={() => loadHistory(session)} disabled={!session}>Refresh History</button>
            </header>

            <div className="game-meta">
                <section className="scoreboard glass">
                    <div className="score-card">
                        <span>{selfName}</span>
                        <strong>{selfWins}</strong>
                        <small>Wins</small>
                    </div>
                    <div className="score-card center">
                        <span>Draws</span>
                        <strong>{drawCount}</strong>
                        <small>Total {gameState?.h2h?.totalGames || 0}</small>
                    </div>
                    <div className="score-card">
                        <span>{opponentName}</span>
                        <strong>{opponentWins}</strong>
                        <small>Wins</small>
                    </div>
                </section>

                <section className="timer-box glass">
                    <div className="timer-header">
                        <span>{isMyTurn ? `Your turn (${selfName})` : `${opponentName || 'Opponent'} turn`}</span>
                        <strong>{gameState?.turnRemainingSec || 0}s</strong>
                    </div>
                    <div className="mark-line">
                        <span>Your Mark: <strong>{myMark}</strong></span>
                        <span>Opponent Mark: <strong>{opponentMark}</strong></span>
                    </div>
                    <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${turnProgress}%` }} />
                    </div>
                    {!gameState?.winner && <p className="muted">If timer reaches 0, turn is skipped automatically.</p>}
                </section>
            </div>

            <section className="board glass">
                {gameState?.board.map((cell, index) => (
                    <button
                        key={index}
                        className={`cell ${cell?.toLowerCase() || ''}`}
                        onClick={() => makeMove(index)}
                        disabled={!canPlay || !!cell}
                    >
                        {cell || ''}
                    </button>
                ))}
            </section>

            {gameState?.winner && (
                <section className="rematch-box glass">
                    <p>
                        {gameState.winner === 'draw'
                            ? 'This round ended in a draw.'
                            : gameState.winner === selfId
                                ? 'You won this round.'
                                : `${opponentName} won this round.`}
                    </p>
                    <p className="muted">Both players click Play Again to continue.</p>
                    <div className="row">
                        <button onClick={requestRematch} disabled={myVotedRematch}>Play Again</button>
                        <button className="secondary" onClick={goHome}>Home</button>
                    </div>
                    <p className="muted">You: {myVotedRematch ? 'Ready' : 'Waiting'} | Opponent: {opponentVotedRematch ? 'Ready' : 'Waiting'}</p>
                </section>
            )}
        </div>
    );

    return (
        <div className="app-shell">
            <div className="bg-orb orb-a" />
            <div className="bg-orb orb-b" />
            <div className="noise-layer" />
            <main>
                {screen === 'home' && renderHome()}
                {screen === 'game' && gameState && renderGame()}
            </main>
        </div>
    );
}

export default App;
