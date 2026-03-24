/// <reference path="../node_modules/nakama-runtime/index.d.ts" />
// main.ts
import { matchInit, matchJoinAttempt, matchJoin, matchLeave, matchLoop, matchTerminate, matchSignal } from './tic_tac_toe';

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
    initializer.registerMatchmakerMatched((context: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, matches: nkruntime.MatchmakerResult[]) => {
        logger.info('Matchmaker matched: %v', matches);
        
        // Create a new match on the 'tic_tac_toe' module
        const matchId = nk.matchCreate('tic_tac_toe', { /* optional params */ });
        
        // Return the matchId to the matched players
        return matchId;
    });

    logger.info('Nakama Tic-Tac-Toe module loaded, match and matchmaker registered.');
}

// Global variable that Nakama looks for
// @ts-ignore
globalThis.InitModule = InitModule;
