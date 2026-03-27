/// <reference path="../node_modules/nakama-runtime/index.d.ts" />
// main.ts

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

    logger.info('XO module loaded, match and matchmaker registered.');
}

// Global variable that Nakama looks for
// @ts-ignore
globalThis.InitModule = InitModule;
