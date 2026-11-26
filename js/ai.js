(function (global) {
    'use strict';

    const Data = typeof module !== 'undefined' && module.exports
        ? require('./data.js')
        : global.CoTyPhu;

    const { BOARD_TILES, COLOR_GROUPS, STATION_TILES, UTILITY_TILES } = Data;

    const GROUP_PRIORITY = ['orange', 'red', 'yellow', 'pink', 'green', 'darkblue', 'lightblue', 'brown'];

    function wouldCompleteMonopoly(state, playerId, tileIndex) {
        const tile = BOARD_TILES[tileIndex];
        if (!tile) return false;
        if (tile.type === 'property') {
            const grp = COLOR_GROUPS[tile.group];
            return grp.tiles.every(idx => idx === tileIndex || state.properties[idx].ownerId === playerId);
        }
        if (tile.type === 'utility') {
            return UTILITY_TILES.every(idx => idx === tileIndex || state.properties[idx].ownerId === playerId);
        }
        if (tile.type === 'station') {
            const ownedCount = STATION_TILES.filter(idx => state.properties[idx].ownerId === playerId).length;
            return ownedCount >= 2;
        }
        return false;
    }

    function wouldBlockOpponentMonopoly(state, botId, tileIndex) {
        const tile = BOARD_TILES[tileIndex];
        if (!tile) return false;
        if (tile.type === 'property') {
            const grp = COLOR_GROUPS[tile.group];
            const otherTiles = grp.tiles.filter(idx => idx !== tileIndex);
            const owners = otherTiles.map(idx => state.properties[idx].ownerId).filter(Boolean);
            if (owners.length === otherTiles.length && owners.every(id => id === owners[0] && id !== botId)) {
                return true;
            }
        }
        if (tile.type === 'station') {
            const owners = {};
            for (const idx of STATION_TILES) {
                const oid = state.properties[idx].ownerId;
                if (oid && oid !== botId) owners[oid] = (owners[oid] || 0) + 1;
            }
            return Object.values(owners).some(c => c >= 2);
        }
        if (tile.type === 'utility') {
            return UTILITY_TILES.some(idx => {
                const oid = state.properties[idx].ownerId;
                return oid && oid !== botId;
            });
        }
        return false;
    }

    function countUnownedPurchasables(state) {
        return Object.values(state.properties).filter(p => !p.ownerId).length;
    }

    function estimatePropertyValue(state, tileIndex) {
        const tile = BOARD_TILES[tileIndex];
        const prop = state.properties[tileIndex];
        if (!tile || !tile.price) return 0;
        return Math.round(tile.price * (prop?.mortgaged ? 0.55 : 1.0));
    }

    function chooseAction(engine, botId) {
        const state = engine.getState();
        const bot = engine.getPlayer(botId);
        if (!state || !bot || bot.bankrupt) return null;

        switch (state.phase) {
            case 'ROLL': {
                if (engine.getCurrentPlayer()?.id !== botId) return null;
                if (bot.inJail) {
                    const earlyGame = countUnownedPurchasables(state) > 8;
                    if (earlyGame) {
                        if (bot.jailCards > 0) return { type: 'USE_JAIL_CARD' };
                        if (bot.cash >= 150) return { type: 'PAY_JAIL_BAIL' };
                    }
                }
                return { type: 'ROLL_DICE' };
            }

            case 'BUY_DECISION': {
                if (engine.getCurrentPlayer()?.id !== botId) return null;
                const tileIndex = state.pendingTile;
                const tile = BOARD_TILES[tileIndex];
                if (!tile) return { type: 'START_AUCTION' };

                if (bot.cash >= tile.price) {
                    const completes = wouldCompleteMonopoly(state, botId, tileIndex);
                    const blocks = wouldBlockOpponentMonopoly(state, botId, tileIndex);
                    if (completes || blocks || bot.cash - tile.price >= 160) {
                        return { type: 'BUY_PROPERTY' };
                    }
                }
                return { type: 'START_AUCTION' };
            }

            case 'AUCTION': {
                if (engine.getAuctionActiveBidderId() !== botId) return null;
                const auc = state.auction;
                const tile = BOARD_TILES[auc.tileIndex];
                const completes = wouldCompleteMonopoly(state, botId, auc.tileIndex);
                const blocks = wouldBlockOpponentMonopoly(state, botId, auc.tileIndex);

                let multiplier = 0.85;
                if (completes) multiplier = 1.35;
                else if (blocks) multiplier = 1.2;

                const cashCap = Math.max(0, bot.cash - 80);
                const maxBid = Math.min(cashCap, Math.floor(tile.price * multiplier));
                const nextBid = auc.highestBid === 0 ? 10 : auc.highestBid + 10;

                if (nextBid <= maxBid && nextBid <= bot.cash) {
                    return { type: 'AUCTION_BID', amount: nextBid };
                }
                return { type: 'AUCTION_PASS' };
            }

            case 'CARD_MODAL': {
                if (engine.getCurrentPlayer()?.id !== botId) return null;
                return { type: 'CONFIRM_CARD' };
            }

            case 'DEBT_RESOLUTION': {
                const debt = state.pendingDebt;
                if (!debt || debt.debtorId !== botId) return null;

                if (bot.cash >= debt.amount) {
                    return { type: 'RESOLVE_DEBT' };
                }

                // If even full liquidation cannot cover debt, declare bankruptcy cleanly
                if (bot.cash + engine.getLiquidationValue(botId) < debt.amount) {
                    return { type: 'DECLARE_BANKRUPTCY' };
                }

                const owned = engine.getOwnedTileIndices(botId);

                // 1. Sell houses evenly from lowest-cost groups first
                const sellable = owned
                    .filter(idx => engine.canSellOn(botId, idx))
                    .sort((a, b) => BOARD_TILES[a].houseCost - BOARD_TILES[b].houseCost);
                if (sellable.length > 0) {
                    return { type: 'SELL_HOUSE', tileIndex: sellable[0] };
                }

                // 2. Mortgage non-monopoly properties first, then monopoly ones
                const mortgageable = owned
                    .filter(idx => engine.canMortgage(botId, idx))
                    .sort((a, b) => {
                        const ta = BOARD_TILES[a];
                        const tb = BOARD_TILES[b];
                        const ma = ta.type === 'property' && engine.ownsColorGroup(botId, ta.group) ? 1 : 0;
                        const mb = tb.type === 'property' && engine.ownsColorGroup(botId, tb.group) ? 1 : 0;
                        if (ma !== mb) return ma - mb;
                        return ta.price - tb.price;
                    });
                if (mortgageable.length > 0) {
                    return { type: 'MORTGAGE', tileIndex: mortgageable[0] };
                }

                return { type: 'DECLARE_BANKRUPTCY' };
            }

            case 'TRADE_OFFER': {
                const trade = state.trade;
                if (!trade || trade.toId !== botId) return null;

                let incomingVal = trade.offerCash + trade.offerJailCards * 45;
                let outgoingVal = trade.requestCash + trade.requestJailCards * 45;

                for (const idx of trade.offerProps) {
                    incomingVal += estimatePropertyValue(state, idx);
                    if (wouldCompleteMonopoly(state, botId, idx)) incomingVal += 250;
                }
                for (const idx of trade.requestProps) {
                    outgoingVal += estimatePropertyValue(state, idx);
                    if (wouldCompleteMonopoly(state, trade.fromId, idx)) outgoingVal += 300;
                }

                const netDelta = incomingVal - outgoingVal;
                return netDelta >= -20 ? { type: 'ACCEPT_TRADE' } : { type: 'REJECT_TRADE' };
            }

            case 'END_TURN': {
                if (engine.getCurrentPlayer()?.id !== botId) return null;

                // Unmortgage if rich
                if (bot.cash > 450) {
                    const mortgaged = engine.getOwnedTileIndices(botId)
                        .filter(idx => engine.canUnmortgage(botId, idx))
                        .sort((a, b) => BOARD_TILES[b].price - BOARD_TILES[a].price);
                    if (mortgaged.length > 0) {
                        return { type: 'UNMORTGAGE', tileIndex: mortgaged[0] };
                    }
                }

                // Build houses evenly prioritizing best color sets while maintaining reserve
                const buildCandidates = [];
                for (const grpId of GROUP_PRIORITY) {
                    if (!engine.ownsColorGroup(botId, grpId)) continue;
                    for (const idx of COLOR_GROUPS[grpId].tiles) {
                        if (engine.canBuildOn(botId, idx) && bot.cash - BOARD_TILES[idx].houseCost >= 220) {
                            buildCandidates.push(idx);
                            break;
                        }
                    }
                    if (buildCandidates.length > 0) break;
                }
                if (buildCandidates.length > 0) {
                    return { type: 'BUILD_HOUSE', tileIndex: buildCandidates[0] };
                }

                return { type: 'END_TURN' };
            }

            default:
                return null;
        }
    }

    const api = { chooseAction };
    global.CoTyPhu = Object.assign(global.CoTyPhu || {}, api);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
