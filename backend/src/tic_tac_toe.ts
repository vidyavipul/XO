/// <reference path="../node_modules/nakama-runtime/index.d.ts" />
// tic_tac_toe.ts

export const MATCH_MODULE_NAME = 'tic_tac_toe_match';

export interface State {
    board: (string | null)[];
    marks: { [userID: string]: string }; // user_id -> 'X' or 'O'
    turn: string | null; // user_id of the player whose turn it is
    winner: string | null; // user_id or 'draw'
    presences: { [userID: string]: nkruntime.Presence };
}

export enum OpCode {
    MOVE = 1,
    STATE_UPDATE = 2,
    GAME_OVER = 3
}

export const matchInit: nkruntime.MatchInitFunction<State> = (ctx, logger, nk, params) => {
    return {
        state: {
            board: Array(9).fill(null),
            marks: {},
            turn: null,
            winner: null,
            presences: {}
        },
        tickRate: 10, // 10 ticks per second
        label: 'tic-tac-toe'
    };
};

export const matchJoinAttempt: nkruntime.MatchJoinAttemptFunction<State> = (ctx, logger, nk, dispatcher, tick, state, presence, metadata) => {
    if (Object.keys(state.presences).length >= 2) {
        return { state, accept: false, rejectMessage: 'Match full' };
    }
    return { state, accept: true };
};

export const matchJoin: nkruntime.MatchJoinFunction<State> = (ctx, logger, nk, dispatcher, tick, state, presences) => {
    presences.forEach(p => {
        state.presences[p.userId] = p;
        
        // Assign marks (X or O)
        if (Object.keys(state.marks).length === 0) {
            state.marks[p.userId] = 'X';
            state.turn = p.userId; // X goes first
        } else if (Object.keys(state.marks).length === 1) {
            state.marks[p.userId] = 'O';
        }
    });

    // Broadcast state update to everyone
    dispatcher.broadcastMessage(OpCode.STATE_UPDATE, JSON.stringify(state));

    return { state };
};

export const matchLeave: nkruntime.MatchLeaveFunction<State> = (ctx, logger, nk, dispatcher, tick, state, presences) => {
    presences.forEach(p => {
        delete state.presences[p.userId];
    });
    
    // If someone leaves, maybe end the game or wait. 
    // For simplicity, we'll just keep the state but maybe mark as game over if no one is left.
    if (Object.keys(state.presences).length < 1) {
        return null; // End match if everyone left
    }

    return { state };
};

export const matchLoop: nkruntime.MatchLoopFunction<State> = (ctx, logger, nk, dispatcher, tick, state, messages) => {
    messages.forEach(m => {
        if (state.winner) return; // Ignore messages if game is over

        const userID = m.sender.userId;
        const opCode = m.opCode;

        if (opCode === OpCode.MOVE) {
            if (userID !== state.turn) {
                // Not this player's turn
                return;
            }

            const data = JSON.parse(nk.binaryToString(m.data));
            const position = data.position; // 0-8

            if (state.board[position] !== null) {
                // Position already taken
                return;
            }

            // Apply move
            const mark = state.marks[userID];
            state.board[position] = mark;

            // Check for winner
            const winner = checkWinner(state.board);
            if (winner) {
                if (winner === 'draw') {
                    state.winner = 'draw';
                } else {
                    state.winner = userID; // Current player won
                }
                dispatcher.broadcastMessage(OpCode.GAME_OVER, JSON.stringify(state));
            } else {
                // Switch turn
                const players = Object.keys(state.presences);
                state.turn = players.find(id => id !== userID) || userID;
                dispatcher.broadcastMessage(OpCode.STATE_UPDATE, JSON.stringify(state));
            }
        }
    });

    return { state };
};

export const matchTerminate: nkruntime.MatchTerminateFunction<State> = (ctx, logger, nk, dispatcher, tick, state, graceSeconds) => {
    return { state };
};

export const matchSignal: nkruntime.MatchSignalFunction<State> = (ctx, logger, nk, dispatcher, tick, state, data) => {
    return { state, result: data };
};

function checkWinner(board: (string | null)[]): string | null {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
        [0, 4, 8], [2, 4, 6]             // Diagonals
    ];

    for (let line of lines) {
        const [a, b, c] = line;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }

    if (board.every(cell => cell !== null)) {
        return 'draw';
    }

    return null;
}
