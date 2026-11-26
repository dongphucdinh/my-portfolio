(function (global) {
    'use strict';

    const Data = typeof module !== 'undefined' && module.exports
        ? require('./data.js')
        : global.CoTyPhu;

    const { BOARD_TILES, COLOR_GROUPS, RESORT_TILES, BOARD_SIDES } = Data;

    function wouldCompleteColorGroup(state, playerId, tileIndex) {
        const tile = BOARD_TILES[tileIndex];
        if (!tile || tile.type !== 'city') return false;
        return COLOR_GROUPS[tile.group].tiles.every(idx => idx === tileIndex || state.properties[idx].ownerId === playerId);
    }

    function wouldCompleteLine(state, playerId, tileIndex) {
        return BOARD_SIDES.some(side =>
            side.includes(tileIndex) &&
            side.every(idx => idx === tileIndex || state.properties[idx].ownerId === playerId)
        );
    }

    function wouldBlockOpponent(state, botId, tileIndex) {
        const tile = BOARD_TILES[tileIndex];
        if (!tile) return false;
        if (tile.type === 'resort') {
            const counts = {};
            for (const r of RESORT_TILES) {
                const oid = state.properties[r].ownerId;
                if (oid && oid !== botId) counts[oid] = (counts[oid] || 0) + 1;
            }
            return Object.values(counts).some(c => c >= 2);
        }
        if (tile.type === 'city') {
            const others = COLOR_GROUPS[tile.group].tiles.filter(i => i !== tileIndex);
            const owners = others.map(i => state.properties[i].ownerId).filter(Boolean);
            return owners.length === others.length && owners.every(id => id === owners[0] && id !== botId);
        }
        return false;
    }

    function countUnowned(state) {
        return Object.values(state.properties).filter(p => !p.ownerId).length;
    }

    function chooseAction(engine, botId) {
        const state = engine.getState();
        const bot = engine.getPlayer(botId);
        if (!state || !bot || bot.bankrupt) return null;

        switch (state.phase) {
            case 'ROLL': {
                if (engine.getCurrentPlayer()?.id !== botId) return null;
                if (bot.inIsland) {
                    if (bot.escapeCards > 0) return { type: 'USE_JAIL_CARD' };
                    if (countUnowned(state) > 8 && bot.cash >= 500000) return { type: 'PAY_JAIL_BAIL' };
                }
                return { type: 'ROLL_DICE' };
            }

            case 'WORLD_TOUR_PICK': {
                if (engine.getCurrentPlayer()?.id !== botId) return null;
                const cost = state.config.worldTourCost;
                if (bot.cash < cost + 150000) return { type: 'CANCEL_WORLD_TOUR' };

                // 1. Instant win via 4th Resort or Line/Triple Monopoly
                const candidates = Object.keys(state.properties).map(Number);
                for (const idx of candidates) {
                    const prop = state.properties[idx];
                    const tile = BOARD_TILES[idx];
                    if (prop.ownerId) continue;
                    const price = tile.price;
                    if (bot.cash < cost + price) continue;
                    if (tile.type === 'resort' && engine.getResortCount(botId) === 3) {
                        return { type: 'FLY_WORLD_TOUR', tileIndex: idx };
                    }
                    if (wouldCompleteLine(state, botId, idx)) {
                        return { type: 'FLY_WORLD_TOUR', tileIndex: idx };
                    }
                    if (wouldCompleteColorGroup(state, botId, idx) && engine.getMonopolyCount(botId) === 2) {
                        return { type: 'FLY_WORLD_TOUR', tileIndex: idx };
                    }
                }

                // 2. Own House-3 city to upgrade to Hotel
                const h3City = engine.getOwnedTileIndices(botId).find(idx => {
                    const t = BOARD_TILES[idx];
                    return t.type === 'city' && state.properties[idx].level === 3 && bot.cash >= cost + t.hotelCost + 100000;
                });
                if (h3City !== undefined) return { type: 'FLY_WORLD_TOUR', tileIndex: h3City };

                // 3. Best unowned high-value city or resort
                const unowned = candidates
                    .filter(idx => !state.properties[idx].ownerId && bot.cash >= cost + BOARD_TILES[idx].price + 100000)
                    .sort((a, b) => BOARD_TILES[b].price - BOARD_TILES[a].price);
                if (unowned.length > 0) return { type: 'FLY_WORLD_TOUR', tileIndex: unowned[0] };

                return { type: 'CANCEL_WORLD_TOUR' };
            }

            case 'BUY_DECISION': {
                if (engine.getCurrentPlayer()?.id !== botId) return null;
                const idx = state.pendingTile;
                const tile = BOARD_TILES[idx];
                if (!tile) return { type: 'SKIP_BUY' };

                if (tile.type === 'resort') {
                    const wantResort = engine.getResortCount(botId) >= 2 || wouldBlockOpponent(state, botId, idx) || bot.cash >= 550000;
                    return wantResort && bot.cash >= tile.price
                        ? { type: 'BUY_CITY', targetLevel: 0 }
                        : { type: 'SKIP_BUY' };
                }

                const important = wouldCompleteColorGroup(state, botId, idx) || wouldBlockOpponent(state, botId, idx) || wouldCompleteLine(state, botId, idx);
                const reserve = important ? 120000 : 300000;

                // Pick highest affordable level (up to 3) respecting reserve; fallback to 0 if affordable & important
                for (let lvl = 3; lvl >= 0; lvl--) {
                    const cost = engine.getPurchaseCost(idx, lvl);
                    if (bot.cash - cost >= reserve) {
                        return { type: 'BUY_CITY', targetLevel: lvl };
                    }
                }
                if (important && bot.cash >= tile.price) {
                    return { type: 'BUY_CITY', targetLevel: 0 };
                }
                return { type: 'SKIP_BUY' };
            }

            case 'UPGRADE_DECISION': {
                if (engine.getCurrentPlayer()?.id !== botId) return null;
                const idx = state.pendingTile;
                const prop = state.properties[idx];
                if (!prop) return { type: 'SKIP_UPGRADE' };

                if (prop.level === 3) {
                    const cost = engine.getUpgradeCost(idx, 4);
                    return bot.cash - cost >= 120000
                        ? { type: 'UPGRADE_CITY', targetLevel: 4 }
                        : { type: 'SKIP_UPGRADE' };
                }

                for (let lvl = 3; lvl > prop.level; lvl--) {
                    const cost = engine.getUpgradeCost(idx, lvl);
                    if (bot.cash - cost >= 150000) {
                        return { type: 'UPGRADE_CITY', targetLevel: lvl };
                    }
                }
                return { type: 'SKIP_UPGRADE' };
            }

            case 'REPURCHASE_DECISION': {
                if (engine.getCurrentPlayer()?.id !== botId) return null;
                const rep = state.pendingRepurchase;
                if (!rep) return { type: 'SKIP_REPURCHASE' };

                const idx = rep.tileIndex;
                const instantWin = wouldCompleteLine(state, botId, idx) ||
                    (wouldCompleteColorGroup(state, botId, idx) && engine.getMonopolyCount(botId) >= 2);
                const strategic = instantWin || wouldCompleteColorGroup(state, botId, idx) || wouldBlockOpponent(state, botId, idx);

                if (instantWin || (strategic && bot.cash - rep.cost >= 200000) || (bot.cash - rep.cost >= 650000)) {
                    return { type: 'REPURCHASE_CITY' };
                }
                return { type: 'SKIP_REPURCHASE' };
            }

            case 'CHAMPIONSHIP_PICK': {
                if (engine.getCurrentPlayer()?.id !== botId) return null;
                if (bot.cash < state.config.championshipCost + 80000) return { type: 'SKIP_CHAMPIONSHIP' };
                const owned = engine.getOwnedTileIndices(botId)
                    .sort((a, b) => engine.calculateRent(b) - engine.calculateRent(a));
                if (owned.length === 0) return { type: 'SKIP_CHAMPIONSHIP' };
                return { type: 'HOLD_CHAMPIONSHIP', tileIndex: owned[0] };
            }

            case 'CHANCE_MODAL': {
                if (engine.getCurrentPlayer()?.id !== botId) return null;
                return { type: 'CONFIRM_CHANCE' };
            }

            case 'CHANCE_TARGET_PICK': {
                if (engine.getCurrentPlayer()?.id !== botId) return null;
                const tgt = state.pendingChanceTarget;
                if (!tgt) return { type: 'SKIP_CHANCE_TARGET' };

                if (tgt.action === 'earthquake' || tgt.action === 'power_outage') {
                    const sorted = tgt.validOppTiles.slice().sort((a, b) => engine.calculateRent(b) - engine.calculateRent(a));
                    return { type: 'PICK_CHANCE_TARGET', payload: { tileIndex: sorted[0] } };
                }
                if (tgt.action === 'shield' || tgt.action === 'festival') {
                    const sorted = tgt.validOwnTiles.slice().sort((a, b) => engine.calculateRent(b) - engine.calculateRent(a));
                    return { type: 'PICK_CHANCE_TARGET', payload: { tileIndex: sorted[0] } };
                }
                if (tgt.action === 'royal_gift') {
                    const ownSorted = tgt.validOwnTiles.slice().sort((a, b) => engine.getTileInvestment(a) - engine.getTileInvestment(b));
                    const recSorted = tgt.validRecipients.slice().sort((a, b) => engine.getNetWorth(a) - engine.getNetWorth(b));
                    return { type: 'PICK_CHANCE_TARGET', payload: { ownTile: ownSorted[0], recipientId: recSorted[0] } };
                }
                if (tgt.action === 'city_swap') {
                    const ownSorted = tgt.validOwnTiles.slice().sort((a, b) => engine.getTileInvestment(a) - engine.getTileInvestment(b));
                    const oppSorted = tgt.validOppTiles.slice().sort((a, b) => engine.getTileInvestment(b) - engine.getTileInvestment(a));
                    if (engine.getTileInvestment(oppSorted[0]) > engine.getTileInvestment(ownSorted[0])) {
                        return { type: 'PICK_CHANCE_TARGET', payload: { ownTile: ownSorted[0], targetTile: oppSorted[0] } };
                    }
                    return { type: 'SKIP_CHANCE_TARGET' };
                }
                return { type: 'SKIP_CHANCE_TARGET' };
            }

            case 'SELL_DEBT': {
                const debt = state.pendingDebt;
                if (!debt || debt.debtorId !== botId) return null;
                if (bot.cash + engine.getLiquidationValue(botId) < debt.amount) {
                    return { type: 'DECLARE_BANKRUPTCY' };
                }
                return { type: 'AUTO_SELL_DEBT' };
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
