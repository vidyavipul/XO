/// <reference path="../node_modules/nakama-runtime/index.d.ts" />
// tic_tac_toe.ts

const MATCH_MODULE_NAME = 'tic_tac_toe_match';
const TICK_RATE = 10;
const TURN_SECONDS = 30;
const HISTORY_LIMIT = 20;
const STORAGE_COLLECTION_HISTORY = 'ttt_history';
const STORAGE_COLLECTION_H2H = 'ttt_h2h';
const STORAGE_KEY_HISTORY = 'recent';

interface State {
    board: (string | null)[];
    marks: { [userID: string]: string };
    turn: string | null;
    winner: string | null;
    presences: { [userID: string]: nkruntime.Presence };
    usernames: { [userID: string]: string };
    playerOrder: string[];
    round: number;
    turnDurationSec: number;
    turnDeadlineTick: number;
    nextTimerBroadcastTick: number;
    statusMessage: string;
    rematchVotes: { [userID: string]: boolean };
    h2h: HeadToHeadScore;
    moveLog: MatchMove[];
}

interface MatchMove {
    position: number;
    mark: 'X' | 'O';
    playerDisplayName: string;
}

interface HeadToHeadScore {
    wins: { [userID: string]: number };
    draws: number;
    totalGames: number;
}

interface HistoryItem {
    at: number;
    result: 'win' | 'loss' | 'draw';
    yourMark: 'X' | 'O';
    opponentId: string;
    opponentDisplayName: string;
    moves: MatchMove[];
}

interface HistoryValue {
    games: HistoryItem[];
    updatedAt: number;
}

enum OpCode {
    MOVE = 1,
    STATE_UPDATE = 2,
    GAME_OVER = 3,
    REMATCH = 4
}

const matchInit: nkruntime.MatchInitFunction<State> = (ctx, logger, nk, params) => {
    return {
        state: {
            board: Array(9).fill(null),
            marks: {},
            turn: null,
            winner: null,
            presences: {},
            usernames: {},
            playerOrder: [],
            round: 0,
            turnDurationSec: TURN_SECONDS,
            turnDeadlineTick: 0,
            nextTimerBroadcastTick: TICK_RATE,
            statusMessage: 'Waiting for players...',
            rematchVotes: {},
            h2h: {
                wins: {},
                draws: 0,
                totalGames: 0
            },
            moveLog: []
        },
        tickRate: TICK_RATE,
        label: 'tic-tac-toe'
    };
};

const matchJoinAttempt: nkruntime.MatchJoinAttemptFunction<State> = (ctx, logger, nk, dispatcher, tick, state, presence, metadata) => {
    if (Object.keys(state.presences).length >= 2) {
        return { state, accept: false, rejectMessage: 'Match full' };
    }
    return { state, accept: true };
};

const matchJoin: nkruntime.MatchJoinFunction<State> = (ctx, logger, nk, dispatcher, tick, state, presences) => {
    presences.forEach(p => {
        state.presences[p.userId] = p;

        let displayName = '';
        try {
            const account = nk.accountGetId(p.userId);
            displayName = (account && account.user && account.user.displayName) ? account.user.displayName.trim() : '';
        } catch (_error) {
            displayName = '';
        }

        state.usernames[p.userId] = displayName || p.username || p.userId.slice(0, 8);
        if (state.playerOrder.indexOf(p.userId) === -1) {
            state.playerOrder.push(p.userId);
        }
    });

    syncPlayerOrderAndMarks(state);

    if (state.playerOrder.length === 2) {
        loadHeadToHead(state, nk, logger);
        if (!state.turn && !state.winner) {
            startRound(state, tick, state.playerOrder[0], 'Match ready. X starts.');
        }
    } else {
        state.statusMessage = 'Waiting for second player...';
    }

    broadcastState(dispatcher, OpCode.STATE_UPDATE, state, tick);

    return { state };
};

const matchLeave: nkruntime.MatchLeaveFunction<State> = (ctx, logger, nk, dispatcher, tick, state, presences) => {
    const hadTwoPlayers = state.playerOrder.length === 2;
    const leavingIds: string[] = [];
    const leavingNames: { [userID: string]: string } = {};
    presences.forEach(p => {
        leavingIds.push(p.userId);
        leavingNames[p.userId] = state.usernames[p.userId] || p.username || p.userId.slice(0, 8);
        delete state.presences[p.userId];
        delete state.usernames[p.userId];
        delete state.marks[p.userId];
        delete state.rematchVotes[p.userId];
        state.playerOrder = state.playerOrder.filter(id => id !== p.userId);
    });

    if (Object.keys(state.presences).length < 1) {
        return null;
    }

    // If one player leaves during an active round, count it as a forfeit win for the remaining player.
    if (hadTwoPlayers && state.playerOrder.length === 1 && !state.winner && state.round > 0) {
        const remainingPlayer = state.playerOrder[0];
        const leftPlayer = leavingIds.length > 0 ? leavingIds[0] : '';
        const leftPlayerName = leavingNames[leftPlayer] || (leftPlayer ? leftPlayer.slice(0, 8) : 'Opponent');
        if (remainingPlayer) {
            state.winner = remainingPlayer;
            state.turn = null;
            state.turnDeadlineTick = 0;
            state.statusMessage = `${leftPlayerName} forfeited, you get a win.`;
            updateHeadToHeadOnResult(state, remainingPlayer);
            persistResult(state, nk, logger);
        }
    }

    // If someone leaves after a round is already over, do not award points.
    if (hadTwoPlayers && state.playerOrder.length === 1 && !!state.winner) {
        const leftPlayer = leavingIds.length > 0 ? leavingIds[0] : '';
        const leftPlayerName = leavingNames[leftPlayer] || (leftPlayer ? leftPlayer.slice(0, 8) : 'Opponent');
        state.statusMessage = `${leftPlayerName} left the match. Find a new opponent or go home.`;
    }

    if (state.playerOrder.length < 2) {
        state.turn = null;
        state.turnDeadlineTick = 0;
        state.statusMessage = state.statusMessage || 'Opponent left. Returning to home...';
        state.rematchVotes = {};
        state.board = Array(9).fill(null);
        state.moveLog = [];
    }

    syncPlayerOrderAndMarks(state);
    broadcastState(dispatcher, OpCode.STATE_UPDATE, state, tick);

    return { state };
};

const matchLoop: nkruntime.MatchLoopFunction<State> = (ctx, logger, nk, dispatcher, tick, state, messages) => {
    let broadcastOp: OpCode | null = null;

    if (!state.winner && state.turn && state.turnDeadlineTick > 0 && tick >= state.turnDeadlineTick) {
        const timedOutPlayer = state.turn;
        const nextTurn = getOpponentId(state, timedOutPlayer);
        if (nextTurn) {
            state.turn = nextTurn;
            state.turnDeadlineTick = tick + (state.turnDurationSec * TICK_RATE);
            state.nextTimerBroadcastTick = tick + TICK_RATE;
            state.statusMessage = `${getUsername(state, timedOutPlayer)} timed out. ${getUsername(state, nextTurn)} turn now.`;
            broadcastOp = OpCode.STATE_UPDATE;
        }
    }

    messages.forEach(m => {
        const userID = m.sender.userId;
        const opCode = m.opCode as OpCode;

        if (opCode === OpCode.REMATCH) {
            if (!state.winner) {
                return;
            }

            state.rematchVotes[userID] = true;
            state.statusMessage = `${getUsername(state, userID)} wants a rematch.`;

            if (state.playerOrder.length === 2 && hasBothRematchVotes(state)) {
                const starterIndex = state.round % 2;
                const nextStarter = state.playerOrder[starterIndex] || state.playerOrder[0];
                startRound(state, tick, nextStarter, `Round ${state.round + 1} started. ${state.usernames[nextStarter]} goes first.`);
            }

            broadcastOp = OpCode.STATE_UPDATE;
            return;
        }

        if (state.winner) {
            return;
        }

        if (opCode !== OpCode.MOVE) {
            return;
        }

        if (userID !== state.turn) {
            return;
        }

        let position = -1;
        try {
            const data = JSON.parse(nk.binaryToString(m.data));
            position = Number(data.position);
        } catch (_e) {
            return;
        }

        if (position < 0 || position > 8 || state.board[position] !== null) {
            return;
        }

        const mark = state.marks[userID];
        if (!mark) {
            return;
        }

        state.board[position] = mark;
        state.moveLog.push({
            position,
            mark: mark as 'X' | 'O',
            playerDisplayName: getUsername(state, userID)
        });
        const winnerMark = checkWinner(state.board);

        if (winnerMark) {
            if (winnerMark === 'draw') {
                state.winner = 'draw';
                state.statusMessage = 'Round ended in a draw.';
            } else {
                state.winner = userID;
                state.statusMessage = `${getUsername(state, userID)} won the round.`;
            }
            state.turn = null;
            state.turnDeadlineTick = 0;
            state.rematchVotes = {};
            updateHeadToHeadOnResult(state, state.winner);
            persistResult(state, nk, logger);
            broadcastOp = OpCode.GAME_OVER;
            return;
        }

        const nextTurn = getOpponentId(state, userID);
        if (nextTurn) {
            state.turn = nextTurn;
            state.turnDeadlineTick = tick + (state.turnDurationSec * TICK_RATE);
            state.nextTimerBroadcastTick = tick + TICK_RATE;
            state.statusMessage = `${getUsername(state, nextTurn)} turn.`;
            broadcastOp = OpCode.STATE_UPDATE;
        }
    });

    if (!state.winner && state.turn && tick >= state.nextTimerBroadcastTick) {
        state.nextTimerBroadcastTick = tick + TICK_RATE;
        if (!broadcastOp) {
            broadcastOp = OpCode.STATE_UPDATE;
        }
    }

    if (broadcastOp) {
        broadcastState(dispatcher, broadcastOp, state, tick);
    }

    return { state };
};

const matchTerminate: nkruntime.MatchTerminateFunction<State> = (ctx, logger, nk, dispatcher, tick, state, graceSeconds) => {
    return { state };
};

const matchSignal: nkruntime.MatchSignalFunction<State> = (ctx, logger, nk, dispatcher, tick, state, data) => {
    return { state, result: data };
};

function checkWinner(board: (string | null)[]): 'X' | 'O' | 'draw' | null {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const a = line[0];
        const b = line[1];
        const c = line[2];
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a] as 'X' | 'O';
        }
    }

    if (board.every(cell => cell !== null)) {
        return 'draw';
    }

    return null;
}

function syncPlayerOrderAndMarks(state: State): void {
    state.playerOrder = state.playerOrder.filter(id => !!state.presences[id]);
    const presenceIds = Object.keys(state.presences);
    for (let i = 0; i < presenceIds.length; i++) {
        const userId = presenceIds[i];
        if (state.playerOrder.indexOf(userId) === -1) {
            state.playerOrder.push(userId);
        }
    }

    state.playerOrder = state.playerOrder.slice(0, 2);
    state.marks = {};
    if (state.playerOrder[0]) {
        state.marks[state.playerOrder[0]] = 'X';
    }
    if (state.playerOrder[1]) {
        state.marks[state.playerOrder[1]] = 'O';
    }
}

function startRound(state: State, tick: number, starterUserId: string, message: string): void {
    state.round += 1;
    state.board = Array(9).fill(null);
    state.winner = null;
    state.turn = starterUserId;
    state.turnDeadlineTick = tick + (state.turnDurationSec * TICK_RATE);
    state.nextTimerBroadcastTick = tick + TICK_RATE;
    state.statusMessage = message;
    state.rematchVotes = {};
    state.moveLog = [];
}

function getOpponentId(state: State, userId: string): string | null {
    for (let i = 0; i < state.playerOrder.length; i++) {
        if (state.playerOrder[i] !== userId) {
            return state.playerOrder[i];
        }
    }
    return null;
}

function hasBothRematchVotes(state: State): boolean {
    if (state.playerOrder.length < 2) {
        return false;
    }
    for (let i = 0; i < state.playerOrder.length; i++) {
        if (!state.rematchVotes[state.playerOrder[i]]) {
            return false;
        }
    }
    return true;
}

function getUsername(state: State, userId: string): string {
    return state.usernames[userId] || userId.slice(0, 8);
}

function getTurnRemainingSec(state: State, tick: number): number {
    if (!state.turn || state.turnDeadlineTick <= 0) {
        return 0;
    }
    const ticksLeft = state.turnDeadlineTick - tick;
    if (ticksLeft <= 0) {
        return 0;
    }
    return Math.ceil(ticksLeft / TICK_RATE);
}

function broadcastState(dispatcher: nkruntime.MatchDispatcher, opCode: OpCode, state: State, tick: number): void {
    dispatcher.broadcastMessage(opCode, JSON.stringify({
        board: state.board,
        marks: state.marks,
        turn: state.turn,
        winner: state.winner,
        usernames: state.usernames,
        playerOrder: state.playerOrder,
        h2h: state.h2h,
        round: state.round,
        turnDurationSec: state.turnDurationSec,
        turnRemainingSec: getTurnRemainingSec(state, tick),
        statusMessage: state.statusMessage,
        rematchVotes: state.rematchVotes
    }));
}

function getPairKey(userA: string, userB: string): string {
    return userA < userB ? `${userA}::${userB}` : `${userB}::${userA}`;
}

function loadHeadToHead(state: State, nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
    if (state.playerOrder.length < 2) {
        return;
    }

    const userA = state.playerOrder[0];
    const userB = state.playerOrder[1];
    const key = getPairKey(userA, userB);

    try {
        const objects = nk.storageRead([
            { collection: STORAGE_COLLECTION_H2H, key, userId: userA }
        ]);

        if (objects.length > 0 && objects[0].value) {
            const value = objects[0].value as any;
            state.h2h = {
                wins: value.wins || {},
                draws: Number(value.draws || 0),
                totalGames: Number(value.totalGames || 0)
            };
            return;
        }
    } catch (error) {
        logger.error('Failed to read H2H storage: %v', error);
    }

    state.h2h = {
        wins: {},
        draws: 0,
        totalGames: 0
    };
}

function updateHeadToHeadOnResult(state: State, winner: string | null): void {
    if (winner === 'draw') {
        state.h2h.draws += 1;
        state.h2h.totalGames += 1;
        return;
    }

    if (winner) {
        state.h2h.wins[winner] = (state.h2h.wins[winner] || 0) + 1;
        state.h2h.totalGames += 1;
    }
}

function persistResult(state: State, nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
    if (state.playerOrder.length < 2) {
        return;
    }

    const userA = state.playerOrder[0];
    const userB = state.playerOrder[1];
    const now = Date.now();
    const pairKey = getPairKey(userA, userB);

    try {
        const historyReads = nk.storageRead([
            { collection: STORAGE_COLLECTION_HISTORY, key: STORAGE_KEY_HISTORY, userId: userA },
            { collection: STORAGE_COLLECTION_HISTORY, key: STORAGE_KEY_HISTORY, userId: userB }
        ]);

        const userAHistory = buildNextHistory(
            findHistoryValue(historyReads, userA),
            {
                at: now,
                result: state.winner === 'draw' ? 'draw' : (state.winner === userA ? 'win' : 'loss'),
                yourMark: (state.marks[userA] as 'X' | 'O') || 'X',
                opponentId: userB,
                opponentDisplayName: getUsername(state, userB),
                moves: cloneMoves(state.moveLog)
            }
        );

        const userBHistory = buildNextHistory(
            findHistoryValue(historyReads, userB),
            {
                at: now,
                result: state.winner === 'draw' ? 'draw' : (state.winner === userB ? 'win' : 'loss'),
                yourMark: (state.marks[userB] as 'X' | 'O') || 'O',
                opponentId: userA,
                opponentDisplayName: getUsername(state, userA),
                moves: cloneMoves(state.moveLog)
            }
        );

        const h2hValue = {
            wins: state.h2h.wins,
            draws: state.h2h.draws,
            totalGames: state.h2h.totalGames,
            updatedAt: now,
            players: [userA, userB]
        };

        nk.storageWrite([
            {
                collection: STORAGE_COLLECTION_HISTORY,
                key: STORAGE_KEY_HISTORY,
                userId: userA,
                permissionRead: 1,
                permissionWrite: 0,
                value: userAHistory
            },
            {
                collection: STORAGE_COLLECTION_HISTORY,
                key: STORAGE_KEY_HISTORY,
                userId: userB,
                permissionRead: 1,
                permissionWrite: 0,
                value: userBHistory
            },
            {
                collection: STORAGE_COLLECTION_H2H,
                key: pairKey,
                userId: userA,
                permissionRead: 1,
                permissionWrite: 0,
                value: h2hValue
            },
            {
                collection: STORAGE_COLLECTION_H2H,
                key: pairKey,
                userId: userB,
                permissionRead: 1,
                permissionWrite: 0,
                value: h2hValue
            }
        ]);
    } catch (error) {
        logger.error('Failed to persist game result: %v', error);
    }
}

function findHistoryValue(objects: nkruntime.StorageObject[], userId: string): HistoryValue {
    for (let i = 0; i < objects.length; i++) {
        if (objects[i].userId === userId && objects[i].value) {
            const value = objects[i].value as any;
            return {
                games: Array.isArray(value.games) ? value.games : [],
                updatedAt: Number(value.updatedAt || 0)
            };
        }
    }

    return { games: [], updatedAt: 0 };
}

function buildNextHistory(existing: HistoryValue, newEntry: HistoryItem): HistoryValue {
    const nextGames = [newEntry].concat(existing.games || []).slice(0, HISTORY_LIMIT);
    return {
        games: nextGames,
        updatedAt: Date.now()
    };
}

function cloneMoves(moves: MatchMove[]): MatchMove[] {
    return (moves || []).map(move => ({
        position: Number(move.position),
        mark: move.mark,
        playerDisplayName: move.playerDisplayName
    }));
}
