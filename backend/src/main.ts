/// <reference path="../node_modules/nakama-runtime/index.d.ts" />
// main.ts

const RPC_HISTORY_COLLECTION = 'ttt_history';
const RPC_HISTORY_KEY = 'recent';

const rpcClearHistory: nkruntime.RpcFunction = (ctx, logger, nk, payload) => {
    if (!ctx.userId) {
        throw Error('User not authenticated');
    }

    nk.storageWrite([
        {
            collection: RPC_HISTORY_COLLECTION,
            key: RPC_HISTORY_KEY,
            userId: ctx.userId,
            permissionRead: 1,
            permissionWrite: 0,
            value: {
                games: [],
                updatedAt: Date.now()
            }
        }
    ]);

    return JSON.stringify({ ok: true });
};

function matchmakerMatched(
    context: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    matches: nkruntime.MatchmakerResult[]
): string {
    logger.info('Matchmaker matched: %v', matches);
    return nk.matchCreate('tic_tac_toe', {});
}

const InitModule: nkruntime.InitModule =
        function(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {
    
    // 1. Register the Tic-Tac-Toe match handler
    initializer.registerMatch('tic_tac_toe', {
        matchInit,
        matchJoinAttempt,
        matchJoin,
        matchLeave,
        matchLoop,
        matchTerminate,
        matchSignal
    });

    // 2. Register the matchmaker matched hook
    // When the matchmaker finds enough players, this hook is triggered.
    initializer.registerMatchmakerMatched(matchmakerMatched);

    // 3. User-scoped history reset. Keeps object in database but clears this user's games array.
    initializer.registerRpc('clear_history', rpcClearHistory);

    logger.info('XO module loaded, match, matchmaker, and clear_history RPC registered.');
}

// Global variable that Nakama looks for
// @ts-ignore
globalThis.InitModule = InitModule;
