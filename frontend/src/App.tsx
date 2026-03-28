import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
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

type Screen = 'welcome' | 'home' | 'settings' | 'matchmaking' | 'game';
type SettingsTab = 'profile' | 'history';

interface HeadToHead {
    wins: Record<string, number>;
    draws: number;
    totalGames: number;
}

interface HistoryMove {
    position: number;
    mark: 'X' | 'O';
    playerDisplayName: string;
}

const normalizeHistoryMoves = (moves: unknown): HistoryMove[] => {
    if (!Array.isArray(moves)) {
        return [];
    }

    return moves
        .map((entry) => {
            const move = entry as Partial<HistoryMove>;
            const position = Number(move.position);
            const mark = move.mark === 'X' || move.mark === 'O' ? move.mark : null;
            if (!Number.isInteger(position) || position < 0 || position > 8 || !mark) {
                return null;
            }

            return {
                position,
                mark,
                playerDisplayName: (move.playerDisplayName || 'Player').toString()
            } as HistoryMove;
        })
        .filter((move): move is HistoryMove => !!move);
};

interface HistoryItem {
    at: number;
    result: 'win' | 'loss' | 'draw';
    yourMark: 'X' | 'O';
    opponentId: string;
    opponentDisplayName?: string;
    opponentUsername?: string;
    moves?: HistoryMove[];
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
    const [settingsTab, setSettingsTab] = useState<SettingsTab>('profile');
    const [session, setSession] = useState<Session | null>(null);
    const [socket, setSocket] = useState<Socket | null>(null);
    const [matchId, setMatchId] = useState<string | null>(null);
    const [matchTicket, setMatchTicket] = useState<string | null>(null);
    const [gameState, setGameState] = useState<GameState | null>(null);
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [selectedHistory, setSelectedHistory] = useState<HistoryItem | null>(null);
    const [account, setAccount] = useState<AccountState | null>(null);
    const [usernameInput, setUsernameInput] = useState('');
    const [displayNameInput, setDisplayNameInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [queueStartedAt, setQueueStartedAt] = useState<number | null>(null);
    const [queueElapsedSec, setQueueElapsedSec] = useState(0);
    const [timerDisplaySec, setTimerDisplaySec] = useState(0);
    const [toastMessage, setToastMessage] = useState('');
    const [toastVisible, setToastVisible] = useState(false);
    const [profileSaved, setProfileSaved] = useState(false);
    const [isOnboarding, setIsOnboarding] = useState(false);
    const [historyRefreshing, setHistoryRefreshing] = useState(false);
    const toastTimeoutRef = useRef<number | null>(null);
    const timerSyncRef = useRef<{ baseSec: number; syncedAt: number }>({ baseSec: 0, syncedAt: Date.now() });
    const seenTwoPlayerStateRef = useRef(false);

    const showToast = (message: string, durationMs = 2400) => {
        setToastMessage(message);
        setToastVisible(true);
        if (toastTimeoutRef.current) {
            window.clearTimeout(toastTimeoutRef.current);
        }
        toastTimeoutRef.current = window.setTimeout(() => {
            setToastVisible(false);
        }, durationMs);
    };

    const haptic = () => {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(20);
        }
    };

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
        return () => {
            if (toastTimeoutRef.current) {
                window.clearTimeout(toastTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!socket) {
            return;
        }

        socket.onmatchdata = (result) => {
            const data = JSON.parse(new TextDecoder().decode(result.data));
            if (result.op_code === OpCode.STATE_UPDATE || result.op_code === OpCode.GAME_OVER) {
                setGameState(data as GameState);

                const playerCount = Array.isArray(data.playerOrder) ? data.playerOrder.length : 0;
                if (playerCount >= 2) {
                    seenTwoPlayerStateRef.current = true;
                }

                if (screen === 'game' && seenTwoPlayerStateRef.current && playerCount < 2 && !matchTicket) {
                    setMatchId(null);
                    setGameState(null);
                    setScreen('home');
                    seenTwoPlayerStateRef.current = false;
                    showToast(data.statusMessage || 'Opponent left the match.', 2600);
                    return;
                }

                if (result.op_code === OpCode.GAME_OVER) {
                    showToast(data.statusMessage || 'Round finished.', 2600);
                    void loadHistory(session, false);
                }
            }
        };

        socket.onmatchmakermatched = (matched) => {
            showToast('Match found. Joining...', 1600);
            socket.joinMatch(matched.match_id).then((match) => {
                setMatchId(match.match_id);
                setMatchTicket(null);
                setQueueStartedAt(null);
                setQueueElapsedSec(0);
                seenTwoPlayerStateRef.current = false;
                setScreen('game');
                showToast('Match joined.', 1700);
            }).catch(() => {
                showToast('Could not join the match.', 2200);
            });
        };
    }, [socket, session, screen, matchTicket]);

    useEffect(() => {
        if (!queueStartedAt || screen !== 'matchmaking') {
            return;
        }

        const interval = setInterval(() => {
            setQueueElapsedSec(Math.max(0, Math.floor((Date.now() - queueStartedAt) / 1000)));
        }, 500);

        return () => clearInterval(interval);
    }, [queueStartedAt, screen]);

    useEffect(() => {
        if (!gameState) {
            setTimerDisplaySec(0);
            timerSyncRef.current = { baseSec: 0, syncedAt: Date.now() };
            return;
        }

        timerSyncRef.current = {
            baseSec: gameState.turnRemainingSec || 0,
            syncedAt: Date.now()
        };
        setTimerDisplaySec(gameState.turnRemainingSec || 0);
    }, [gameState?.turnRemainingSec, gameState?.turn, gameState?.winner]);

    useEffect(() => {
        if (!gameState || gameState.winner || !gameState.turn) {
            return;
        }

        const interval = setInterval(() => {
            const elapsed = (Date.now() - timerSyncRef.current.syncedAt) / 1000;
            const next = Math.max(0, timerSyncRef.current.baseSec - elapsed);
            setTimerDisplaySec(next);
        }, 80);

        return () => clearInterval(interval);
    }, [gameState?.turn, gameState?.winner, gameState?.turnDurationSec]);

    const loadProfile = async (activeSession: Session): Promise<boolean> => {
        const accountResponse = await client.getAccount(activeSession);
        setAccount(accountResponse);

        const username = (accountResponse.user?.username || '').trim();
        const displayName = (accountResponse.user?.display_name || '').trim();
        const missingProfile = !username || !displayName;

        if (missingProfile) {
            // New users must enter both fields manually.
            setUsernameInput('');
            setDisplayNameInput('');
        } else {
            setUsernameInput(username);
            setDisplayNameInput(displayName);
        }

        setIsOnboarding(missingProfile);
        if (missingProfile) {
            setProfileSaved(false);
            setScreen('welcome');
            showToast('Welcome to XO Arena. Complete your profile to continue.', 2800);
        }

        return missingProfile;
    };

    const loadHistory = async (activeSession: Session | null, showFeedback = true) => {
        if (!activeSession) {
            return;
        }

        if (showFeedback) {
            setHistoryRefreshing(true);
        }

        try {
            const response = await client.readStorageObjects(activeSession, {
                object_ids: [{
                    collection: STORAGE_COLLECTION_HISTORY,
                    key: STORAGE_KEY_HISTORY,
                    user_id: activeSession.user_id
                }]
            });

            const firstObject = response.objects?.[0];
            const value = firstObject?.value as { games?: HistoryItem[] } | undefined;
            const rawGames = Array.isArray(value?.games) ? (value?.games || []) : [];
            const normalizedGames = rawGames.map((game) => ({
                ...game,
                moves: normalizeHistoryMoves((game as any).moves)
            }));
            setHistory(normalizedGames);

            if (showFeedback) {
                haptic();
                showToast('History refreshed.', 1200);
            }
        } catch (error) {
            if (showFeedback) {
                const message = await formatAuthError(error);
                showToast(`Could not refresh history: ${message}`, 2200);
            }
        } finally {
            if (showFeedback) {
                setHistoryRefreshing(false);
            }
        }
    };

    const clearHistory = async () => {
        if (!session) {
            return;
        }

        setLoading(true);
        try {
            await client.rpc(session, 'clear_history', {});
            setHistory([]);
            setSelectedHistory(null);
            showToast('History cleared.', 1500);
            haptic();
        } catch (error) {
            const message = await formatAuthError(error);
            showToast(`Could not clear history: ${message}`, 2500);
        } finally {
            setLoading(false);
        }
    };

    const authenticate = async () => {
        setLoading(true);
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

            const missingProfile = await loadProfile(newSession);
            await loadHistory(newSession, false);

            if (!missingProfile) {
                setScreen('home');
                showToast('Connected', 2300);
            }
        } catch (error) {
            const message = await formatAuthError(error);
            showToast(`Login failed: ${message}`, 3000);
        } finally {
            setLoading(false);
        }
    };

    const updateProfile = async () => {
        if (!session) {
            return;
        }

        const trimmedUsername = usernameInput.trim();
        const trimmedDisplayName = displayNameInput.trim();
        if (!trimmedUsername || !trimmedDisplayName) {
            showToast('Username and display name are required.', 2200);
            return;
        }

        setLoading(true);
        try {
            await client.updateAccount(session, {
                username: trimmedUsername,
                display_name: trimmedDisplayName
            });
            const missingProfile = await loadProfile(session);
            setProfileSaved(true);
            showToast('Profile updated.', 1800);
            haptic();

            if (!missingProfile && isOnboarding) {
                setIsOnboarding(false);
                setScreen('home');
                showToast('Profile set. Welcome to the arena.', 2200);
            }
        } catch (error) {
            const message = await formatAuthError(error);
            showToast(`Profile update failed: ${message}`, 2600);
        } finally {
            setLoading(false);
        }
    };

    const findMatch = async () => {
        if (!socket) {
            return;
        }
        if (isOnboarding) {
            setScreen('welcome');
            showToast('Complete your profile before entering the arena.', 2200);
            return;
        }

        setLoading(true);
        try {
            const ticket = await socket.addMatchmaker('*', 2, 2);
            setMatchTicket(ticket.ticket);
            setQueueStartedAt(Date.now());
            setQueueElapsedSec(0);
            setScreen('matchmaking');
            showToast('Matchmaking started.', 1500);
        } catch {
            showToast('Matchmaking failed.', 2000);
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
            setQueueStartedAt(null);
            setQueueElapsedSec(0);
            setScreen('home');
            showToast('Queue canceled.', 1500);
        } catch {
            showToast('Unable to cancel queue.', 1800);
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
            showToast('Move could not be sent.', 1500);
        }
    };

    const requestRematch = async () => {
        if (!socket || !matchId || !gameState?.winner) {
            return;
        }

        try {
            await socket.sendMatchState(matchId, OpCode.REMATCH, JSON.stringify({ rematch: true }));
            showToast('Rematch requested.', 1500);
        } catch {
            showToast('Could not request rematch.', 1700);
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
        seenTwoPlayerStateRef.current = false;
        setScreen('home');
    };

    const openSettings = () => {
        if (!session) {
            showToast('Connect first to access settings.', 1800);
            return;
        }
        if (isOnboarding) {
            setScreen('welcome');
            showToast('Finish onboarding first.', 1800);
            return;
        }
        setSettingsTab('profile');
        setProfileSaved(false);
        setScreen('settings');
    };

    const backToHome = () => {
        if (isOnboarding) {
            setScreen('welcome');
            return;
        }
        setScreen('home');
    };

    const formatHistoryDate = (epochMs: number) => {
        const date = new Date(epochMs);
        return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
    };

    const turnProgress = gameState
        ? Math.max(0, Math.min(100, (timerDisplaySec / gameState.turnDurationSec) * 100))
        : 0;

    const buildBoardFromMoves = (moves: HistoryMove[] | undefined) => {
        const board: (string | null)[] = Array(9).fill(null);
        if (!moves) {
            return board;
        }

        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            if (move.position >= 0 && move.position <= 8) {
                board[move.position] = move.mark;
            }
        }
        return board;
    };

    const renderHome = () => (
        <div className="home-layout">
            <section className="hero-stage">
                <div className="hero-top-row">
                    <div className="hero-badge">XO ARENA</div>
                    {session && <button className="ghost" onClick={openSettings}>Settings</button>}
                </div>

                <h1>Play. Outthink. Repeat.</h1>

                <div className="hero-points">
                    <span>1V1 LIVE</span>
                    <span>30S TURN CLOCK</span>
                    <span>HEAD TO HEAD</span>
                </div>

                <div className="home-actions">
                    {!session ? (
                        <button onClick={authenticate} disabled={loading}>
                            {loading ? 'Connecting...' : 'Enter Arena'}
                        </button>
                    ) : (
                        <>
                            <button onClick={findMatch} disabled={loading || !!matchTicket}>Start Match</button>
                            {matchTicket && <button className="ghost" onClick={cancelMatchmaking}>Cancel Queue</button>}
                        </>
                    )}
                </div>
            </section>

            <section className="home-feed">
                <article className="history-panel">
                    <div className="feed-head">
                        <h2>Recent Matches</h2>
                        {session && <button className="ghost" onClick={() => loadHistory(session)}>{historyRefreshing ? 'Refreshing...' : 'Refresh'}</button>}
                    </div>
                    {!session ? (
                        <p className="muted">Connect to view your match trail.</p>
                    ) : history.length === 0 ? (
                        <p className="muted">No matches yet. Queue up and make the first one count.</p>
                    ) : (
                        <ul className="history-list">
                            {history.map((item, index) => (
                                <li key={`${item.at}-${index}`} onClick={() => setSelectedHistory(item)} className="history-item-clickable">
                                    <span className={`pill result-${item.result}`}>{item.result.toUpperCase()}</span>
                                    <strong>{item.opponentDisplayName || item.opponentUsername || 'Opponent'}</strong>
                                    <span className="muted">as {item.yourMark}</span>
                                    <span className="muted">{formatHistoryDate(item.at)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </article>

                {selectedHistory && (
                    <article className="history-detail">
                        <div className="feed-head">
                            <h3>Match Detail</h3>
                            <button className="ghost" onClick={() => setSelectedHistory(null)}>Close</button>
                        </div>
                        <p className="muted">vs {selectedHistory.opponentDisplayName || selectedHistory.opponentUsername || 'Opponent'}</p>
                        <p className="muted">Played as {selectedHistory.yourMark}</p>
                        {(selectedHistory.moves || []).length > 0 ? (
                            <>
                                <div className="mini-board">
                                    {buildBoardFromMoves(selectedHistory.moves).map((cell, idx) => (
                                        <div key={idx} className={`mini-cell ${cell ? 'filled' : ''}`}>{cell || ''}</div>
                                    ))}
                                </div>
                                <ul className="move-list">
                                    {(selectedHistory.moves || []).map((move, idx) => (
                                        <li key={`${move.position}-${idx}`}>#{idx + 1} {move.playerDisplayName} {'->'} {move.mark} on {move.position + 1}</li>
                                    ))}
                                </ul>
                            </>
                        ) : (
                            <p className="muted replay-empty">Replay data not available for this match.</p>
                        )}
                    </article>
                )}
            </section>
        </div>
    );

    const renderWelcome = () => (
        <div className="welcome-layout">
            <section className="welcome-card">
                <div className="hero-badge">XO ARENA</div>
                <h1>Welcome to XO Arena</h1>
                <p className="muted">Set up your identity to enter matchmaking.</p>

                <div className="stack welcome-form">
                    <label>
                        Username
                        <input
                            value={usernameInput}
                            onChange={(event) => setUsernameInput(event.target.value)}
                            placeholder="Enter username"
                        />
                    </label>
                    <label>
                        Display Name
                        <input
                            value={displayNameInput}
                            onChange={(event) => setDisplayNameInput(event.target.value)}
                            placeholder="Enter display name"
                        />
                    </label>
                    <button onClick={updateProfile} disabled={loading}>
                        {loading ? 'Saving...' : 'Save and Enter Arena'}
                    </button>
                </div>
            </section>
        </div>
    );

    const renderSettings = () => (
        <div className="settings-layout">
            <section className="settings-header">
                <button className="ghost" onClick={backToHome}>Back</button>
                <div>
                    <h2>Settings</h2>
                </div>
            </section>

            <section className="settings-tabs">
                <button className={settingsTab === 'profile' ? '' : 'ghost'} onClick={() => setSettingsTab('profile')}>Profile</button>
                <button className={settingsTab === 'history' ? '' : 'ghost'} onClick={() => setSettingsTab('history')}>History</button>
            </section>

            {settingsTab === 'profile' && (
                <section className="settings-panel">
                    {!session ? (
                        <div className="stack">
                            <p className="muted">Connect first to edit settings.</p>
                            <button onClick={authenticate} disabled={loading}>{loading ? 'Connecting...' : 'Connect to Server'}</button>
                        </div>
                    ) : profileSaved ? (
                        <div className="settings-success-row">
                            <p>Profile updated successfully.</p>
                            <div className="row">
                                <button className="ghost" onClick={() => setProfileSaved(false)}>Edit Again</button>
                                <button onClick={backToHome}>Done</button>
                            </div>
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
                                    placeholder="Name shown to opponents"
                                />
                            </label>
                            <div className="row">
                                <button onClick={updateProfile} disabled={loading}>Save Changes</button>
                                <button className="ghost" onClick={backToHome}>Done</button>
                            </div>
                        </div>
                    )}
                </section>
            )}

            {settingsTab === 'history' && (
                <section className="settings-panel">
                    <div className="row">
                        <button className="ghost" onClick={() => loadHistory(session)} disabled={!session || loading}>Refresh</button>
                        <button onClick={clearHistory} disabled={!session || loading}>Clear History</button>
                    </div>

                    {!session ? (
                        <p className="muted">Connect first to view your recent matches.</p>
                    ) : history.length === 0 ? (
                        <p className="muted">No recent matches yet.</p>
                    ) : (
                        <ul className="history-list settings-history-list">
                            {history.map((item, index) => (
                                <li key={`${item.at}-${index}`} onClick={() => setSelectedHistory(item)} className="history-item-clickable">
                                    <span className={`pill result-${item.result}`}>{item.result.toUpperCase()}</span>
                                    <strong>{item.opponentDisplayName || item.opponentUsername || 'Opponent'}</strong>
                                    <span className="muted">as {item.yourMark}</span>
                                    <span className="muted">{formatHistoryDate(item.at)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}
        </div>
    );

    const renderMatchmaking = () => (
        <div className="matchmaking-layout">
            <section className="matchmaking-card">
                <div className="queue-dot-wrap" aria-hidden="true">
                    <span className="queue-dot" />
                    <span className="queue-dot" />
                    <span className="queue-dot" />
                </div>
                <h2>Finding Opponent...</h2>
                <p className="queue-time">Queue time: <strong>{queueElapsedSec}s</strong></p>
                <div className="row queue-actions">
                    <button className="ghost" onClick={cancelMatchmaking}>Cancel Queue</button>
                    <button onClick={backToHome}>Home</button>
                </div>
            </section>
        </div>
    );

    const renderGame = () => (
        <div className="game-layout">
            <header className="game-top">
                <button className="ghost" onClick={goHome}>Home</button>
                <div>
                    <h2>Round {gameState?.round || 0}</h2>
                    <p className="muted">You ({selfName}) vs {opponentName || 'Waiting for Opponent'}</p>
                </div>
            </header>

            <div className="game-meta">
                <section className="scoreboard">
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

                <section className="timer-box">
                    <div className="timer-header">
                        <span>{isMyTurn ? `Your turn (${selfName})` : `${opponentName || 'Opponent'} turn`}</span>
                        <strong>{Math.max(0, Math.ceil(timerDisplaySec))}s</strong>
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

            <section className="board-wrap">
                <div className="board">
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
                </div>
            </section>

            {gameState?.winner && (
                <section className="rematch-box">
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
                        <button className="ghost" onClick={goHome}>Home</button>
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
            {toastVisible && <div className="toast">{toastMessage}</div>}
            <main>
                {screen === 'welcome' && renderWelcome()}
                {screen === 'home' && renderHome()}
                {screen === 'settings' && renderSettings()}
                {screen === 'matchmaking' && renderMatchmaking()}
                {screen === 'game' && gameState && renderGame()}
            </main>
        </div>
    );
}

export default App;
