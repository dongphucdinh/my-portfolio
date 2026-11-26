(function (global) {
    'use strict';

    const Data = typeof module !== 'undefined' && module.exports
        ? require('./data.js')
        : global.CoTyPhu;

    const {
        DEFAULT_CONFIG,
        PLAYER_COLORS,
        COLOR_GROUPS,
        RESORT_TILES,
        BOARD_SIDES,
        BOARD_TILES,
        CHANCE_CARDS,
        formatMoney,
        formatShortMoney
    } = Data;

    function clone(val) {
        return JSON.parse(JSON.stringify(val));
    }

    function shuffle(arr, rng = Math.random) {
        const copy = arr.slice();
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const tmp = copy[i];
            copy[i] = copy[j];
            copy[j] = tmp;
        }
        return copy;
    }

    class GameEngine {
        constructor(options = {}) {
            this.rng = typeof options.rng === 'function' ? options.rng : Math.random;
            this.state = null;
            if (options.players) {
                this.initGame(options.players, options.config);
            }
        }

        initGame(playerConfigs, configOverrides = {}) {
            const config = Object.assign({}, DEFAULT_CONFIG, configOverrides);
            if (!Array.isArray(playerConfigs) || playerConfigs.length < 2 || playerConfigs.length > 4) {
                throw new Error('Cần từ 2 đến 4 người chơi.');
            }

            const players = playerConfigs.map((cfg, idx) => ({
                id: cfg.id || `p${idx + 1}`,
                name: (cfg.name || `Người chơi ${idx + 1}`).trim(),
                avatar: cfg.avatar || '🎩',
                color: cfg.color || PLAYER_COLORS[idx % PLAYER_COLORS.length],
                isBot: Boolean(cfg.isBot),
                cash: config.startingCash,
                position: 0,
                inIsland: false,
                islandTurns: 0,
                escapeCards: 0,
                readyToFly: false,
                bankrupt: false,
                connected: cfg.connected !== undefined ? Boolean(cfg.connected) : true
            }));

            const properties = {};
            const cityIndices = [];
            for (const tile of BOARD_TILES) {
                if (tile.type === 'city' || tile.type === 'resort') {
                    properties[tile.index] = {
                        ownerId: null,
                        level: 0,
                        shielded: false,
                        festival: false,
                        outageTurns: 0
                    };
                    if (tile.type === 'city') cityIndices.push(tile.index);
                }
            }

            // Pick 2 random cities to start with Festival x2 (matching Business Tour)
            const festCities = shuffle(cityIndices, this.rng).slice(0, 2);
            for (const fIdx of festCities) {
                properties[fIdx].festival = true;
            }

            this.state = {
                config,
                players,
                properties,
                championshipTile: null,
                championshipMult: 1,
                currentPlayerIndex: 0,
                phase: 'ROLL',
                dice: [1, 1],
                doublesCount: 0,
                canRollAgain: false,
                wasDouble: false,
                pendingTile: null,
                pendingCard: null,
                pendingChanceTarget: null,
                pendingRepurchase: null,
                pendingDebt: null,
                chanceDeck: shuffle(CHANCE_CARDS.map((_, i) => i), this.rng),
                turnNumber: 1,
                remainingSeconds: config.matchMinutes > 0 ? config.matchMinutes * 60 : null,
                logs: [],
                winnerId: null,
                winReason: null,
                eventSeq: 0,
                lastEvent: null
            };

            const festNames = festCities.map(i => BOARD_TILES[i].name).join(', ');
            this._addLog(`Ván đấu bắt đầu! Mỗi người có ${formatMoney(config.startingCash)}. Lễ hội (×2): ${festNames}.`, 'system');
            return this.exportState();
        }

        exportState() {
            return clone(this.state);
        }

        importState(snapshot) {
            this.state = clone(snapshot);
            return this.state;
        }

        getState() {
            return this.state;
        }

        getCurrentPlayer() {
            if (!this.state) return null;
            return this.state.players[this.state.currentPlayerIndex] || null;
        }

        getPlayer(playerId) {
            if (!this.state) return null;
            return this.state.players.find(p => p.id === playerId) || null;
        }

        getActivePlayers() {
            if (!this.state) return [];
            return this.state.players.filter(p => !p.bankrupt);
        }

        _addLog(text, kind = 'info') {
            this.state.logs.unshift({
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                turn: this.state.turnNumber,
                text,
                kind
            });
            if (this.state.logs.length > 80) {
                this.state.logs.length = 80;
            }
        }

        _emitEvent(type, extra = {}) {
            this.state.eventSeq += 1;
            const evt = Object.assign({ seq: this.state.eventSeq, type }, extra);
            this.state.lastEvent = evt;
            return evt;
        }

        _fail(error) {
            return { ok: false, error };
        }

        _ok(event = null) {
            return { ok: true, event: event || this.state.lastEvent };
        }

        _rollDie() {
            return Math.floor(this.rng() * 6) + 1;
        }

        // ==================== VALUATION & RENT ====================

        getTileInvestmentAtLevel(tileIndex, level = 0) {
            const tile = BOARD_TILES[tileIndex];
            if (!tile) return 0;
            if (tile.type === 'resort') return tile.price;
            if (tile.type !== 'city') return 0;
            const houses = Math.min(Math.max(0, level), 3);
            const hotel = level >= 4 ? tile.hotelCost : 0;
            return tile.price + houses * tile.houseCost + hotel;
        }

        getTileInvestment(tileIndex) {
            const prop = this.state.properties[tileIndex];
            if (!prop) return 0;
            return this.getTileInvestmentAtLevel(tileIndex, prop.level);
        }

        getPurchaseCost(tileIndex, targetLevel = 0) {
            const tile = BOARD_TILES[tileIndex];
            if (!tile) return 0;
            if (tile.type === 'resort') return tile.price;
            const capped = Math.min(Math.max(0, targetLevel), 3);
            return this.getTileInvestmentAtLevel(tileIndex, capped);
        }

        getUpgradeCost(tileIndex, targetLevel) {
            const prop = this.state.properties[tileIndex];
            if (!prop) return 0;
            if (targetLevel <= prop.level || targetLevel > 4) return 0;
            return this.getTileInvestmentAtLevel(tileIndex, targetLevel) - this.getTileInvestmentAtLevel(tileIndex, prop.level);
        }

        getRepurchaseCost(tileIndex) {
            const tile = BOARD_TILES[tileIndex];
            const prop = this.state.properties[tileIndex];
            if (!tile || tile.type !== 'city' || !prop || !prop.ownerId || prop.level >= 4) return 0;
            return 2 * this.getTileInvestment(tileIndex);
        }

        getSaleValue(tileIndex) {
            return Math.floor(this.getTileInvestment(tileIndex) * 0.5);
        }

        ownsColorGroup(playerId, groupId) {
            const grp = COLOR_GROUPS[groupId];
            if (!grp) return false;
            return grp.tiles.every(idx => this.state.properties[idx]?.ownerId === playerId);
        }

        getMonopolyCount(playerId) {
            return Object.keys(COLOR_GROUPS).filter(gid => this.ownsColorGroup(playerId, gid)).length;
        }

        getResortCount(playerId) {
            return RESORT_TILES.filter(idx => this.state.properties[idx]?.ownerId === playerId).length;
        }

        hasLineMonopoly(playerId) {
            return BOARD_SIDES.some(side => side.every(idx => this.state.properties[idx]?.ownerId === playerId));
        }

        getOwnedTileIndices(playerId) {
            return Object.keys(this.state.properties)
                .map(Number)
                .filter(idx => this.state.properties[idx].ownerId === playerId);
        }

        calculateRent(tileIndex) {
            const tile = BOARD_TILES[tileIndex];
            const prop = this.state.properties[tileIndex];
            if (!tile || !prop || !prop.ownerId || prop.outageTurns > 0) return 0;

            const champMult = this.state.championshipTile === tileIndex ? this.state.championshipMult : 1;

            if (tile.type === 'resort') {
                const count = this.getResortCount(prop.ownerId);
                const base = tile.rent[Math.max(0, count - 1)] || tile.rent[0];
                return base * champMult;
            }

            if (tile.type === 'city') {
                const base = tile.rent[prop.level] || tile.rent[0];
                const monoMult = this.ownsColorGroup(prop.ownerId, tile.group) ? 2 : 1;
                const festMult = prop.festival ? 2 : 1;
                return base * monoMult * festMult * champMult;
            }

            return 0;
        }

        getTotalPropertyValue(playerId) {
            let total = 0;
            for (const idx of this.getOwnedTileIndices(playerId)) {
                total += this.getTileInvestment(idx);
            }
            return total;
        }

        getLiquidationValue(playerId) {
            let total = 0;
            for (const idx of this.getOwnedTileIndices(playerId)) {
                total += this.getSaleValue(idx);
            }
            return total;
        }

        getNetWorth(playerId) {
            const player = this.getPlayer(playerId);
            if (!player || player.bankrupt) return 0;
            return player.cash + this.getTotalPropertyValue(playerId);
        }

        _checkInstantWin(playerId) {
            const player = this.getPlayer(playerId);
            if (!player || player.bankrupt) return false;

            let reason = null;
            let label = '';
            if (this.getResortCount(playerId) >= 4) {
                reason = 'RESORT_MONOPOLY';
                label = 'Độc chiếm toàn bộ 4 Bãi Biển (Resort Monopoly)!';
            } else if (this.getMonopolyCount(playerId) >= 3) {
                reason = 'TRIPLE_MONOPOLY';
                label = 'Sở hữu 3 Bộ Màu Độc Quyền (Triple Monopoly)!';
            } else if (this.hasLineMonopoly(playerId)) {
                reason = 'LINE_MONOPOLY';
                label = 'Sở hữu trọn vẹn 1 Cạnh bàn cờ (Line Monopoly)!';
            }

            if (!reason) return false;

            this.state.winnerId = playerId;
            this.state.winReason = reason;
            this.state.phase = 'GAME_OVER';
            this.state.canRollAgain = false;
            this.state.pendingTile = null;
            this.state.pendingRepurchase = null;
            this.state.pendingCard = null;
            this.state.pendingChanceTarget = null;
            this._addLog(`🏆 ${player.name} CHIẾN THẮNG NGAY LẬP TỨC: ${label}`, 'win');
            this._emitEvent('game_over', {
                winnerId: playerId,
                winReason: reason,
                message: `🏆 ${player.name}: ${label}`
            });
            return true;
        }

        // ==================== TURN ADVANCEMENT ====================

        _finishCurrentStepOrAdvanceTurn() {
            if (this.state.phase === 'GAME_OVER') return;
            this.state.pendingTile = null;
            this.state.pendingCard = null;
            this.state.pendingChanceTarget = null;
            this.state.pendingRepurchase = null;

            const current = this.getCurrentPlayer();
            if (current && !current.bankrupt && this.state.canRollAgain && !current.inIsland && !current.readyToFly) {
                this.state.phase = 'ROLL';
                return;
            }
            this._advanceToNextPlayer();
        }

        _advanceToNextPlayer() {
            if (this.state.phase === 'GAME_OVER') return;
            this.state.doublesCount = 0;
            this.state.canRollAgain = false;
            this.state.wasDouble = false;

            const n = this.state.players.length;
            for (let step = 1; step <= n; step++) {
                const idx = (this.state.currentPlayerIndex + step) % n;
                if (!this.state.players[idx].bankrupt) {
                    this.state.currentPlayerIndex = idx;
                    this.state.turnNumber += 1;
                    break;
                }
            }

            const nextPlayer = this.getCurrentPlayer();
            if (!nextPlayer) return;

            // Tick down outageTurns on properties owned by the starting player
            for (const prop of Object.values(this.state.properties)) {
                if (prop.ownerId === nextPlayer.id && prop.outageTurns > 0) {
                    prop.outageTurns -= 1;
                }
            }

            if (nextPlayer.readyToFly && !nextPlayer.inIsland) {
                this.state.phase = 'WORLD_TOUR_PICK';
                this._addLog(`✈️ ${nextPlayer.name} có thể chọn bay tới ô bất kỳ (phí ${formatShortMoney(this.state.config.worldTourCost)}).`, 'system');
            } else {
                this.state.phase = 'ROLL';
                this._addLog(`Tới lượt của ${nextPlayer.name}.`, 'system');
            }
        }

        _sendToIsland(player) {
            player.position = 8;
            player.inIsland = true;
            player.islandTurns = 0;
            player.readyToFly = false;
            this.state.doublesCount = 0;
            this.state.canRollAgain = false;
            this.state.wasDouble = false;
        }

        // ==================== LOST ISLAND ACTIONS ====================

        payIslandBail(playerId) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'ROLL') return this._fail('Chỉ có thể nộp phạt trước khi tung xúc xắc.');
            if (!current.inIsland) return this._fail('Bạn không ở Đảo Hoang.');
            const bail = this.state.config.islandBail;
            if (current.cash < bail) return this._fail(`Không đủ ${formatMoney(bail)} để rời đảo.`);

            current.cash -= bail;
            current.inIsland = false;
            current.islandTurns = 0;
            this._addLog(`${current.name} nộp ${formatMoney(bail)} rời khỏi Đảo Hoang!`, 'jail');
            return this._ok(this._emitEvent('bail', {
                playerId,
                cashDeltas: { [playerId]: -bail },
                message: `${current.name} nộp ${formatShortMoney(bail)} rời Đảo Hoang`
            }));
        }

        useEscapeCard(playerId) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'ROLL') return this._fail('Chỉ có thể dùng thẻ trước khi tung xúc xắc.');
            if (!current.inIsland) return this._fail('Bạn không ở Đảo Hoang.');
            if (current.escapeCards <= 0) return this._fail('Bạn không có Thẻ Thoát Đảo.');

            current.escapeCards -= 1;
            current.inIsland = false;
            current.islandTurns = 0;
            this._addLog(`${current.name} dùng Thẻ Thoát Đảo và tự do!`, 'jail');
            return this._ok(this._emitEvent('escape_card', {
                playerId,
                message: `${current.name} dùng Thẻ Thoát Đảo!`
            }));
        }

        // ==================== WORLD TOUR FLIGHT ====================

        flyWorldTour(playerId, targetTileIndex) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'WORLD_TOUR_PICK') return this._fail('Bạn không ở trạng thái bay World Tour.');

            const idx = Number(targetTileIndex);
            const tile = BOARD_TILES[idx];
            if (!tile || idx === 24) return this._fail('Vui lòng chọn điểm đến hợp lệ khác ô World Tour.');

            const cost = this.state.config.worldTourCost;
            if (current.cash < cost) return this._fail(`Bạn cần ${formatMoney(cost)} để mua vé máy bay.`);

            const fromPos = current.position;
            current.cash -= cost;
            current.readyToFly = false;
            current.position = idx;

            const deltas = { [current.id]: -cost };
            const passedStart = idx < 24; // clockwise from 24 past 0
            if (passedStart) {
                current.cash += this.state.config.startSalary;
                deltas[current.id] += this.state.config.startSalary;
                this._addLog(`✈️ ${current.name} bay qua START, nhận +${formatShortMoney(this.state.config.startSalary)}!`, 'cash');
            }

            this._addLog(`✈️ ${current.name} trả ${formatShortMoney(cost)} bay thẳng tới ${tile.name}!`, 'roll');
            return this._resolveLanding(current, idx, {
                playerId: current.id,
                fromPos,
                toPos: idx,
                passedStart,
                cashDeltas: deltas
            });
        }

        cancelWorldTour(playerId) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'WORLD_TOUR_PICK') return this._fail('Không thể hủy lúc này.');

            current.readyToFly = false;
            this.state.phase = 'ROLL';
            this._addLog(`${current.name} hủy chuyến bay để tung xúc xắc bình thường.`, 'info');
            return this._ok(this._emitEvent('world_tour_cancel', {
                playerId,
                message: `${current.name} chọn tung xúc xắc`
            }));
        }

        // ==================== DICE ROLLING ====================

        rollDice(playerId, forcedDice = null) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'ROLL') return this._fail('Không thể tung xúc xắc lúc này.');
            if (current.bankrupt) return this._fail('Người chơi đã phá sản.');

            const d1 = forcedDice ? forcedDice[0] : this._rollDie();
            const d2 = forcedDice ? forcedDice[1] : this._rollDie();
            const sum = d1 + d2;
            const isDouble = d1 === d2;
            this.state.dice = [d1, d2];
            this.state.wasDouble = isDouble;

            if (current.inIsland) {
                if (isDouble) {
                    current.inIsland = false;
                    current.islandTurns = 0;
                    this.state.doublesCount = 0;
                    this.state.canRollAgain = false;
                    this._addLog(`${current.name} tung ĐÔI ${d1}-${d2} và thoát khỏi Đảo Hoang!`, 'jail');
                    return this._moveAndResolve(current, sum, [d1, d2]);
                }

                current.islandTurns += 1;
                if (current.islandTurns >= 3) {
                    const bail = this.state.config.islandBail;
                    current.inIsland = false;
                    current.islandTurns = 0;
                    this.state.doublesCount = 0;
                    this.state.canRollAgain = false;
                    if (current.cash >= bail) {
                        current.cash -= bail;
                        this._addLog(`${current.name} hết 3 lượt trên Đảo Hoang, nộp ${formatShortMoney(bail)} và đi ${sum} bước.`, 'jail');
                        return this._moveAndResolve(current, sum, [d1, d2], { [current.id]: -bail });
                    }
                    this._addLog(`${current.name} hết 3 lượt trên Đảo Hoang nhưng thiếu ${formatMoney(bail)}!`, 'warning');
                    this.state.pendingDebt = {
                        debtorId: current.id,
                        creditorId: null,
                        amount: bail,
                        reason: 'Phí rời Đảo Hoang sau 3 lượt',
                        nextActionAfterPaid: { type: 'ISLAND_FREED_MOVE', steps: sum }
                    };
                    this.state.phase = 'SELL_DEBT';
                    return this._ok(this._emitEvent('debt', {
                        playerId: current.id,
                        dice: [d1, d2],
                        message: `${current.name} cần bán đất để nộp ${formatShortMoney(bail)}`
                    }));
                }

                this.state.canRollAgain = false;
                this._addLog(`${current.name} tung ${d1}+${d2}, vẫn kẹt trên Đảo Hoang (${current.islandTurns}/3).`, 'jail');
                const evt = this._emitEvent('island_stay', {
                    playerId: current.id,
                    dice: [d1, d2],
                    message: `${current.name} tung ${d1}+${d2}, kẹt trên Đảo (${current.islandTurns}/3)`
                });
                this._advanceToNextPlayer();
                return this._ok(evt);
            }

            // Normal roll
            if (isDouble) {
                this.state.doublesCount += 1;
                if (this.state.doublesCount >= 3) {
                    const fromPos = current.position;
                    this._sendToIsland(current);
                    this._addLog(`DOUBLE x3! ${current.name} tung 3 lần đôi liên tiếp (${d1}-${d2}) -> Ra Đảo Hoang!`, 'jail');
                    const evt = this._emitEvent('go_to_island', {
                        playerId: current.id,
                        fromPos,
                        toPos: 8,
                        dice: [d1, d2],
                        isDouble: true,
                        message: `DOUBLE ×3! ${current.name} ra Đảo Hoang!`
                    });
                    this._advanceToNextPlayer();
                    return this._ok(evt);
                }
                this.state.canRollAgain = true;
            } else {
                this.state.doublesCount = 0;
                this.state.canRollAgain = false;
            }

            this._addLog(`${current.name} tung ${d1} + ${d2} = ${sum}${isDouble ? ' (DOUBLE — đi thêm lượt!)' : ''}.`, 'roll');
            return this._moveAndResolve(current, sum, [d1, d2]);
        }

        _moveAndResolve(player, steps, diceArr, initialCashDeltas = {}) {
            const fromPos = player.position;
            const rawTarget = fromPos + steps;
            const passedStart = rawTarget >= 32;
            const toPos = rawTarget % 32;
            const cashDeltas = Object.assign({}, initialCashDeltas);

            player.position = toPos;
            if (passedStart) {
                const salary = this.state.config.startSalary;
                player.cash += salary;
                cashDeltas[player.id] = (cashDeltas[player.id] || 0) + salary;
                this._addLog(`${player.name} qua START, nhận +${formatShortMoney(salary)}!`, 'cash');
            }

            return this._resolveLanding(player, toPos, {
                playerId: player.id,
                fromPos,
                toPos,
                dice: diceArr,
                isDouble: this.state.wasDouble,
                passedStart,
                cashDeltas
            });
        }

        // ==================== LANDING RESOLUTION ====================

        _chargeOrSellDebt(debtor, creditorId, amount, reason, nextActionAfterPaid, eventExtra = {}) {
            if (debtor.cash >= amount) {
                debtor.cash -= amount;
                const deltas = Object.assign({}, eventExtra.cashDeltas || {});
                deltas[debtor.id] = (deltas[debtor.id] || 0) - amount;
                if (creditorId) {
                    const creditor = this.getPlayer(creditorId);
                    if (creditor && !creditor.bankrupt) {
                        creditor.cash += amount;
                        deltas[creditor.id] = (deltas[creditor.id] || 0) + amount;
                    }
                }
                const evt = this._emitEvent(eventExtra.type || 'pay', Object.assign({}, eventExtra, { cashDeltas: deltas }));
                this._executeNextActionAfterPaid(debtor, nextActionAfterPaid);
                return this._ok(evt);
            }

            this.state.pendingDebt = {
                debtorId: debtor.id,
                creditorId,
                amount,
                reason,
                nextActionAfterPaid
            };
            this.state.phase = 'SELL_DEBT';
            this._addLog(`${debtor.name} thiếu tiền trả ${formatShortMoney(amount)} (${reason}) — cần bán đất!`, 'warning');
            return this._ok(this._emitEvent('debt', Object.assign({}, eventExtra, {
                debtAmount: amount,
                message: `${debtor.name} thiếu tiền (${formatShortMoney(amount)})!`
            })));
        }

        _executeNextActionAfterPaid(player, nextAction) {
            if (this.state.phase === 'GAME_OVER') return;
            if (!nextAction) {
                this._finishCurrentStepOrAdvanceTurn();
                return;
            }

            if (nextAction.type === 'ISLAND_FREED_MOVE') {
                this._moveAndResolve(player, nextAction.steps, this.state.dice);
                return;
            }

            if (nextAction.type === 'CHECK_REPURCHASE') {
                const tileIndex = nextAction.tileIndex;
                const tile = BOARD_TILES[tileIndex];
                const prop = this.state.properties[tileIndex];
                const repCost = this.getRepurchaseCost(tileIndex);
                if (tile && tile.type === 'city' && prop && prop.ownerId && prop.ownerId !== player.id && prop.level < 4 && player.cash >= repCost) {
                    this.state.pendingRepurchase = {
                        tileIndex,
                        cost: repCost,
                        prevOwnerId: prop.ownerId
                    };
                    this.state.phase = 'REPURCHASE_DECISION';
                    return;
                }
            }

            this._finishCurrentStepOrAdvanceTurn();
        }

        _resolveLanding(player, tileIndex, eventBase = {}) {
            const tile = BOARD_TILES[tileIndex];
            const prop = this.state.properties[tileIndex];

            if (tile.type === 'start') {
                const evt = this._emitEvent('move', Object.assign({}, eventBase, { message: `${player.name} dừng tại START!` }));
                this._finishCurrentStepOrAdvanceTurn();
                return this._ok(evt);
            }

            if (tile.type === 'lost_island') {
                this._sendToIsland(player);
                this._addLog(`${player.name} dạt vào Đảo Hoang!`, 'jail');
                const evt = this._emitEvent('go_to_island', Object.assign({}, eventBase, {
                    toPos: 8,
                    message: `${player.name} bị kẹt ở Đảo Hoang!`
                }));
                this._advanceToNextPlayer();
                return this._ok(evt);
            }

            if (tile.type === 'world_tour') {
                player.readyToFly = true;
                this.state.canRollAgain = false;
                this._addLog(`✈️ ${player.name} tới World Tour — sẵn sàng bay ở lượt kế tiếp!`, 'info');
                const evt = this._emitEvent('world_tour_land', Object.assign({}, eventBase, {
                    message: `${player.name} chuẩn bị bay World Tour!`
                }));
                this._advanceToNextPlayer();
                return this._ok(evt);
            }

            if (tile.type === 'championship') {
                const owned = this.getOwnedTileIndices(player.id);
                if (owned.length > 0 && player.cash >= this.state.config.championshipCost) {
                    this.state.phase = 'CHAMPIONSHIP_PICK';
                    this._addLog(`🏆 ${player.name} vào World Championships! Chọn thành phố để nhân tiền thuê.`, 'cash');
                    return this._ok(this._emitEvent('championship_pick', Object.assign({}, eventBase, {
                        message: `${player.name} tổ chức Giải Vô Địch!`
                    })));
                }
                this._addLog(`${player.name} ghé World Championships nhưng chưa đủ điều kiện tổ chức.`, 'info');
                const evt = this._emitEvent('move', Object.assign({}, eventBase, { message: `${player.name} ghé Giải Vô Địch` }));
                this._finishCurrentStepOrAdvanceTurn();
                return this._ok(evt);
            }

            if (tile.type === 'tax') {
                const totalVal = this.getTotalPropertyValue(player.id);
                const tax = Math.floor(totalVal * (tile.rate || 0.1));
                if (tax <= 0) {
                    this._addLog(`${player.name} vào ô Thuế nhưng chưa có bất động sản (0).`, 'info');
                    const evt = this._emitEvent('tax_free', Object.assign({}, eventBase, { message: `${player.name} không có đất để đóng thuế` }));
                    this._finishCurrentStepOrAdvanceTurn();
                    return this._ok(evt);
                }
                this._addLog(`${player.name} phải nộp Thuế 10%: ${formatShortMoney(tax)}.`, 'tax');
                return this._chargeOrSellDebt(
                    player,
                    null,
                    tax,
                    'Thuế tài sản 10%',
                    null,
                    Object.assign({}, eventBase, {
                        type: 'tax',
                        message: `${player.name} nộp Thuế ${formatShortMoney(tax)}`
                    })
                );
            }

            if (tile.type === 'chance') {
                if (this.state.chanceDeck.length === 0) {
                    this.state.chanceDeck = shuffle(CHANCE_CARDS.map((_, i) => i), this.rng);
                }
                const cardIdx = this.state.chanceDeck.shift();
                const card = CHANCE_CARDS[cardIdx];
                this.state.pendingCard = clone(card);
                this.state.phase = 'CHANCE_MODAL';
                this._addLog(`${player.name} rút thẻ Cơ Hội: "${card.title}".`, 'card');
                return this._ok(this._emitEvent('draw_chance', Object.assign({}, eventBase, {
                    card,
                    message: `${player.name}: ${card.title}`
                })));
            }

            // City or Resort
            if (prop) {
                if (!prop.ownerId) {
                    if (player.cash >= tile.price) {
                        this.state.pendingTile = tileIndex;
                        this.state.phase = 'BUY_DECISION';
                        return this._ok(this._emitEvent('land_unowned', Object.assign({}, eventBase, {
                            tileIndex,
                            message: `${player.name} dừng tại ${tile.name} (${formatShortMoney(tile.price)})`
                        })));
                    }
                    this._addLog(`${player.name} dừng tại ${tile.name} nhưng không đủ ${formatShortMoney(tile.price)}.`, 'info');
                    const evt = this._emitEvent('move', Object.assign({}, eventBase, { message: `${player.name} thiếu tiền mua ${tile.name}` }));
                    this._finishCurrentStepOrAdvanceTurn();
                    return this._ok(evt);
                }

                if (prop.ownerId === player.id) {
                    if (tile.type === 'city' && prop.level < 4) {
                        const minNextCost = this.getUpgradeCost(tileIndex, prop.level + 1);
                        if (player.cash >= minNextCost) {
                            this.state.pendingTile = tileIndex;
                            this.state.phase = 'UPGRADE_DECISION';
                            return this._ok(this._emitEvent('land_own_upgrade', Object.assign({}, eventBase, {
                                tileIndex,
                                message: `${player.name} có thể nâng cấp ${tile.name}!`
                            })));
                        }
                    }
                    const evt = this._emitEvent('land_own', Object.assign({}, eventBase, { message: `${player.name} thăm ${tile.name}` }));
                    this._finishCurrentStepOrAdvanceTurn();
                    return this._ok(evt);
                }

                // Opponent-owned property
                const owner = this.getPlayer(prop.ownerId);
                if (prop.outageTurns > 0) {
                    this._addLog(`${player.name} vào ${tile.name} đang Cúp Điện — miễn phí thuê!`, 'info');
                    const evt = this._emitEvent('land_outage', Object.assign({}, eventBase, { message: `${tile.name} cúp điện — 0₫` }));
                    this._executeNextActionAfterPaid(player, { type: 'CHECK_REPURCHASE', tileIndex });
                    return this._ok(evt);
                }

                const rent = this.calculateRent(tileIndex);
                this._addLog(`${player.name} trả ${formatShortMoney(rent)} tiền thuê ${tile.name} cho ${owner.name}.`, 'rent');
                return this._chargeOrSellDebt(
                    player,
                    owner.id,
                    rent,
                    `Tiền thuê ${tile.name} trả ${owner.name}`,
                    { type: 'CHECK_REPURCHASE', tileIndex },
                    Object.assign({}, eventBase, {
                        type: 'rent',
                        ownerId: owner.id,
                        rent,
                        message: `${player.name} trả ${owner.name} ${formatShortMoney(rent)}`
                    })
                );
            }

            this._finishCurrentStepOrAdvanceTurn();
            return this._ok(this._emitEvent('move', eventBase));
        }

        // ==================== BUY / UPGRADE / REPURCHASE / CHAMPIONSHIP ====================

        buyCity(playerId, targetLevel = 0) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'BUY_DECISION' || this.state.pendingTile === null) {
                return this._fail('Không có thành phố đang chờ mua.');
            }
            const tileIndex = this.state.pendingTile;
            const tile = BOARD_TILES[tileIndex];
            const prop = this.state.properties[tileIndex];
            if (!tile || !prop || prop.ownerId) return this._fail('Ô này đã có chủ.');

            const level = tile.type === 'resort' ? 0 : Math.min(Math.max(0, Number(targetLevel) || 0), 3);
            const cost = this.getPurchaseCost(tileIndex, level);
            if (current.cash < cost) return this._fail('Bạn không đủ tiền.');

            current.cash -= cost;
            prop.ownerId = current.id;
            prop.level = level;

            const lvlText = tile.type === 'resort' ? 'Khu nghỉ dưỡng' : (level === 0 ? 'Đất' : `Đất + ${level} Nhà`);
            this._addLog(`${current.name} mua ${tile.name} (${lvlText}) với giá ${formatShortMoney(cost)}.`, 'buy');
            const evt = this._emitEvent('buy', {
                playerId: current.id,
                tileIndex,
                level,
                cashDeltas: { [current.id]: -cost },
                message: `${current.name} mua ${tile.name}!`
            });

            if (!this._checkInstantWin(current.id)) {
                this._finishCurrentStepOrAdvanceTurn();
            }
            return this._ok(evt);
        }

        skipBuy(playerId) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'BUY_DECISION') return this._fail('Không trong bước mua.');
            const tile = BOARD_TILES[this.state.pendingTile];
            this._addLog(`${current.name} bỏ qua mua ${tile?.name || ''}.`, 'info');
            const evt = this._emitEvent('skip_buy', { playerId, message: `${current.name} bỏ qua ${tile?.name || ''}` });
            this._finishCurrentStepOrAdvanceTurn();
            return this._ok(evt);
        }

        upgradeCity(playerId, targetLevel) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'UPGRADE_DECISION' || this.state.pendingTile === null) {
                return this._fail('Không có thành phố đang chờ nâng cấp.');
            }
            const tileIndex = this.state.pendingTile;
            const tile = BOARD_TILES[tileIndex];
            const prop = this.state.properties[tileIndex];
            if (!tile || tile.type !== 'city' || !prop || prop.ownerId !== current.id) {
                return this._fail('Thành phố không hợp lệ.');
            }

            const target = Number(targetLevel);
            if (prop.level === 3 && target !== 4) {
                return this._fail('Thành phố đã có 3 Nhà, chỉ có thể nâng lên Khách sạn.');
            }
            if (prop.level < 3 && (target <= prop.level || target > 3)) {
                return this._fail('Mức nâng cấp không hợp lệ.');
            }

            const cost = this.getUpgradeCost(tileIndex, target);
            if (current.cash < cost) return this._fail('Bạn không đủ tiền nâng cấp.');

            current.cash -= cost;
            prop.level = target;
            const label = target === 4 ? 'KHÁCH SẠN 🏨' : `Nhà ${target}`;
            this._addLog(`${current.name} nâng cấp ${tile.name} lên ${label} (-${formatShortMoney(cost)}).`, 'build');
            const evt = this._emitEvent('upgrade', {
                playerId: current.id,
                tileIndex,
                level: target,
                cashDeltas: { [current.id]: -cost },
                message: `${current.name} xây ${label} ở ${tile.name}!`
            });
            this._finishCurrentStepOrAdvanceTurn();
            return this._ok(evt);
        }

        skipUpgrade(playerId) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'UPGRADE_DECISION') return this._fail('Không trong bước nâng cấp.');
            this._finishCurrentStepOrAdvanceTurn();
            return this._ok();
        }

        repurchaseCity(playerId) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'REPURCHASE_DECISION' || !this.state.pendingRepurchase) {
                return this._fail('Không có thành phố để mua lại.');
            }
            const { tileIndex, cost, prevOwnerId } = this.state.pendingRepurchase;
            const tile = BOARD_TILES[tileIndex];
            const prop = this.state.properties[tileIndex];
            const prevOwner = this.getPlayer(prevOwnerId);
            if (!prop || prop.ownerId !== prevOwnerId || prop.level >= 4 || tile.type !== 'city') {
                return this._fail('Không thể mua lại thành phố này.');
            }
            if (current.cash < cost) return this._fail('Bạn không đủ tiền mua lại.');

            current.cash -= cost;
            if (prevOwner && !prevOwner.bankrupt) prevOwner.cash += cost;
            prop.ownerId = current.id;
            prop.shielded = false;
            this.state.pendingRepurchase = null;

            this._addLog(`💰 ${current.name} MUA LẠI ${tile.name} từ ${prevOwner?.name || ''} với giá ${formatShortMoney(cost)}!`, 'buy');
            const evt = this._emitEvent('repurchase', {
                playerId: current.id,
                tileIndex,
                cashDeltas: { [current.id]: -cost, ...(prevOwner ? { [prevOwner.id]: cost } : {}) },
                message: `${current.name} mua lại ${tile.name}!`
            });

            if (this._checkInstantWin(current.id)) {
                return this._ok(evt);
            }

            if (prop.level < 4 && current.cash >= this.getUpgradeCost(tileIndex, prop.level + 1)) {
                this.state.pendingTile = tileIndex;
                this.state.phase = 'UPGRADE_DECISION';
                return this._ok(evt);
            }

            this._finishCurrentStepOrAdvanceTurn();
            return this._ok(evt);
        }

        skipRepurchase(playerId) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'REPURCHASE_DECISION') return this._fail('Không trong bước mua lại.');
            this._finishCurrentStepOrAdvanceTurn();
            return this._ok();
        }

        holdChampionship(playerId, tileIndex) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'CHAMPIONSHIP_PICK') return this._fail('Không trong bước Giải Vô Địch.');
            const idx = Number(tileIndex);
            const prop = this.state.properties[idx];
            const tile = BOARD_TILES[idx];
            if (!prop || prop.ownerId !== current.id) return this._fail('Bạn phải chọn thành phố hoặc khu nghỉ dưỡng của mình.');

            const cost = this.state.config.championshipCost;
            if (current.cash < cost) return this._fail(`Không đủ ${formatMoney(cost)}.`);

            current.cash -= cost;
            this.state.championshipTile = idx;
            this.state.championshipMult = Math.min(5, (this.state.championshipMult || 1) + 1);

            this._addLog(`🏆 ${current.name} tổ chức Giải Vô Địch tại ${tile.name} (Tiền thuê ×${this.state.championshipMult})!`, 'cash');
            const evt = this._emitEvent('championship_hold', {
                playerId: current.id,
                tileIndex: idx,
                mult: this.state.championshipMult,
                cashDeltas: { [current.id]: -cost },
                message: `🏆 ${tile.name} nhận Giải Vô Địch ×${this.state.championshipMult}!`
            });
            this._finishCurrentStepOrAdvanceTurn();
            return this._ok(evt);
        }

        skipChampionship(playerId) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'CHAMPIONSHIP_PICK') return this._fail('Không trong bước Giải Vô Địch.');
            this._finishCurrentStepOrAdvanceTurn();
            return this._ok();
        }

        // ==================== CHANCE CARDS ====================

        confirmChance(playerId) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'CHANCE_MODAL' || !this.state.pendingCard) {
                return this._fail('Không có thẻ Cơ Hội đang chờ.');
            }

            const card = this.state.pendingCard;
            this.state.pendingCard = null;
            const fromPos = current.position;

            switch (card.action) {
                case 'escape_card': {
                    current.escapeCards += 1;
                    this._addLog(`${current.name} nhận 1 Thẻ Thoát Đảo!`, 'card');
                    const evt = this._emitEvent('chance_resolved', { playerId: current.id, message: `${current.name} nhận Thẻ Thoát Đảo` });
                    this._finishCurrentStepOrAdvanceTurn();
                    return this._ok(evt);
                }

                case 'jackpot': {
                    current.cash += card.amount;
                    this._addLog(`${current.name} trúng số nhận +${formatShortMoney(card.amount)}!`, 'cash');
                    const evt = this._emitEvent('chance_resolved', {
                        playerId: current.id,
                        cashDeltas: { [current.id]: card.amount },
                        message: `${current.name} +${formatShortMoney(card.amount)}!`
                    });
                    this._finishCurrentStepOrAdvanceTurn();
                    return this._ok(evt);
                }

                case 'birthday': {
                    const others = this.getActivePlayers().filter(p => p.id !== current.id);
                    let sum = 0;
                    const deltas = {};
                    for (const o of others) {
                        const paid = Math.min(o.cash, card.amount);
                        o.cash -= paid;
                        sum += paid;
                        if (paid > 0) deltas[o.id] = -paid;
                    }
                    current.cash += sum;
                    deltas[current.id] = sum;
                    this._addLog(`🎂 Mọi người chúc mừng sinh nhật ${current.name} (+${formatShortMoney(sum)})!`, 'cash');
                    const evt = this._emitEvent('chance_resolved', {
                        playerId: current.id,
                        cashDeltas: deltas,
                        message: `${current.name} +${formatShortMoney(sum)} quà sinh nhật!`
                    });
                    this._finishCurrentStepOrAdvanceTurn();
                    return this._ok(evt);
                }

                case 'tax_audit': {
                    const amt = Math.max(100000, Math.floor(this.getTotalPropertyValue(current.id) * 0.1));
                    this._addLog(`${current.name} bị kiểm tra thuế: ${formatShortMoney(amt)}.`, 'tax');
                    return this._chargeOrSellDebt(current, null, amt, 'Kiểm tra thuế đặc biệt', null, {
                        type: 'tax',
                        playerId: current.id,
                        message: `${current.name} nộp ${formatShortMoney(amt)}`
                    });
                }

                case 'go_lost_island': {
                    this._sendToIsland(current);
                    this._addLog(`${current.name} bị thẻ Cơ Hội đưa ra Đảo Hoang!`, 'jail');
                    const evt = this._emitEvent('go_to_island', {
                        playerId: current.id,
                        fromPos,
                        toPos: 8,
                        message: `${current.name} ra Đảo Hoang!`
                    });
                    this._advanceToNextPlayer();
                    return this._ok(evt);
                }

                case 'go_start': {
                    current.position = 0;
                    const sal = this.state.config.startSalary;
                    current.cash += sal;
                    this._addLog(`${current.name} tiến thẳng về START, nhận +${formatShortMoney(sal)}!`, 'cash');
                    const evt = this._emitEvent('chance_resolved', {
                        playerId: current.id,
                        fromPos,
                        toPos: 0,
                        cashDeltas: { [current.id]: sal },
                        message: `${current.name} về START (+${formatShortMoney(sal)})`
                    });
                    this._finishCurrentStepOrAdvanceTurn();
                    return this._ok(evt);
                }

                case 'go_world_tour': {
                    const passed = 24 < fromPos;
                    current.position = 24;
                    const deltas = {};
                    if (passed) {
                        current.cash += this.state.config.startSalary;
                        deltas[current.id] = this.state.config.startSalary;
                    }
                    return this._resolveLanding(current, 24, {
                        playerId: current.id,
                        fromPos,
                        toPos: 24,
                        passedStart: passed,
                        cashDeltas: deltas
                    });
                }

                case 'go_championship': {
                    const passed = 16 < fromPos;
                    current.position = 16;
                    const deltas = {};
                    if (passed) {
                        current.cash += this.state.config.startSalary;
                        deltas[current.id] = this.state.config.startSalary;
                    }
                    return this._resolveLanding(current, 16, {
                        playerId: current.id,
                        fromPos,
                        toPos: 16,
                        passedStart: passed,
                        cashDeltas: deltas
                    });
                }

                case 'earthquake': {
                    const validOppTiles = Object.keys(this.state.properties).map(Number).filter(idx => {
                        const tile = BOARD_TILES[idx];
                        const prop = this.state.properties[idx];
                        return tile.type === 'city' && prop.ownerId && prop.ownerId !== current.id && prop.level < 4;
                    });
                    if (validOppTiles.length === 0) {
                        this._addLog('Động Đất không tìm thấy thành phố mục tiêu phù hợp.', 'info');
                        this._finishCurrentStepOrAdvanceTurn();
                        return this._ok();
                    }
                    this.state.pendingChanceTarget = { action: 'earthquake', validOppTiles };
                    this.state.phase = 'CHANCE_TARGET_PICK';
                    return this._ok(this._emitEvent('chance_target', { playerId: current.id, message: 'Chọn thành phố đối thủ để phá hủy!' }));
                }

                case 'power_outage': {
                    const validOppTiles = Object.keys(this.state.properties).map(Number).filter(idx => {
                        const prop = this.state.properties[idx];
                        return prop.ownerId && prop.ownerId !== current.id && prop.outageTurns === 0;
                    });
                    if (validOppTiles.length === 0) {
                        this._addLog('Cúp Điện không tìm thấy ô mục tiêu phù hợp.', 'info');
                        this._finishCurrentStepOrAdvanceTurn();
                        return this._ok();
                    }
                    this.state.pendingChanceTarget = { action: 'power_outage', validOppTiles };
                    this.state.phase = 'CHANCE_TARGET_PICK';
                    return this._ok(this._emitEvent('chance_target', { playerId: current.id, message: 'Chọn bất động sản đối thủ để cắt điện!' }));
                }

                case 'shield': {
                    const validOwnTiles = this.getOwnedTileIndices(current.id).filter(idx => !this.state.properties[idx].shielded);
                    if (validOwnTiles.length === 0) {
                        this._addLog(`${current.name} chưa có thành phố chưa gắn Khiên.`, 'info');
                        this._finishCurrentStepOrAdvanceTurn();
                        return this._ok();
                    }
                    this.state.pendingChanceTarget = { action: 'shield', validOwnTiles };
                    this.state.phase = 'CHANCE_TARGET_PICK';
                    return this._ok(this._emitEvent('chance_target', { playerId: current.id, message: 'Chọn thành phố của bạn để đặt Khiên!' }));
                }

                case 'festival': {
                    const validOwnTiles = this.getOwnedTileIndices(current.id).filter(idx =>
                        BOARD_TILES[idx].type === 'city' && !this.state.properties[idx].festival
                    );
                    if (validOwnTiles.length === 0) {
                        this._addLog(`${current.name} không có thành phố mới để tổ chức Lễ Hội.`, 'info');
                        this._finishCurrentStepOrAdvanceTurn();
                        return this._ok();
                    }
                    this.state.pendingChanceTarget = { action: 'festival', validOwnTiles };
                    this.state.phase = 'CHANCE_TARGET_PICK';
                    return this._ok(this._emitEvent('chance_target', { playerId: current.id, message: 'Chọn thành phố để tổ chức Lễ Hội ×2!' }));
                }

                case 'royal_gift': {
                    const validOwnTiles = this.getOwnedTileIndices(current.id).filter(idx => BOARD_TILES[idx].type === 'city');
                    const validRecipients = this.getActivePlayers().filter(p => p.id !== current.id).map(p => p.id);
                    if (validOwnTiles.length === 0 || validRecipients.length === 0) {
                        this._addLog(`${current.name} không có thành phố để tặng Quà Hoàng Gia.`, 'info');
                        this._finishCurrentStepOrAdvanceTurn();
                        return this._ok();
                    }
                    this.state.pendingChanceTarget = { action: 'royal_gift', validOwnTiles, validRecipients };
                    this.state.phase = 'CHANCE_TARGET_PICK';
                    return this._ok(this._emitEvent('chance_target', { playerId: current.id, message: 'Chọn thành phố của bạn để tặng đối thủ!' }));
                }

                case 'city_swap': {
                    const validOwnTiles = this.getOwnedTileIndices(current.id).filter(idx =>
                        BOARD_TILES[idx].type === 'city' && this.state.properties[idx].level < 4
                    );
                    const validOppTiles = Object.keys(this.state.properties).map(Number).filter(idx => {
                        const prop = this.state.properties[idx];
                        return BOARD_TILES[idx].type === 'city' && prop.ownerId && prop.ownerId !== current.id && prop.level < 4;
                    });
                    if (validOwnTiles.length === 0 || validOppTiles.length === 0) {
                        this._addLog('Không đủ thành phố hợp lệ hai bên để hoán đổi.', 'info');
                        this._finishCurrentStepOrAdvanceTurn();
                        return this._ok();
                    }
                    this.state.pendingChanceTarget = { action: 'city_swap', validOwnTiles, validOppTiles };
                    this.state.phase = 'CHANCE_TARGET_PICK';
                    return this._ok(this._emitEvent('chance_target', { playerId: current.id, message: 'Chọn cặp thành phố để hoán đổi!' }));
                }

                default: {
                    this._finishCurrentStepOrAdvanceTurn();
                    return this._ok();
                }
            }
        }

        pickChanceTarget(playerId, payload = {}) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'CHANCE_TARGET_PICK' || !this.state.pendingChanceTarget) {
                return this._fail('Không trong bước chọn mục tiêu Cơ Hội.');
            }

            const tgt = this.state.pendingChanceTarget;
            let evt = null;

            switch (tgt.action) {
                case 'earthquake': {
                    const idx = Number(payload.tileIndex);
                    if (!tgt.validOppTiles.includes(idx)) return this._fail('Thành phố không hợp lệ.');
                    const prop = this.state.properties[idx];
                    const tile = BOARD_TILES[idx];
                    if (prop.shielded) {
                        prop.shielded = false;
                        this._addLog(`🛡️ Khiên Bảo Vệ tại ${tile.name} đã chặn đứng Động Đất!`, 'card');
                        evt = this._emitEvent('shield_block', { tileIndex: idx, message: `🛡️ Khiên đã chặn Động Đất ở ${tile.name}!` });
                    } else {
                        prop.ownerId = null;
                        prop.level = 0;
                        prop.festival = false;
                        prop.outageTurns = 0;
                        if (this.state.championshipTile === idx) {
                            this.state.championshipTile = null;
                            this.state.championshipMult = 1;
                        }
                        this._addLog(`🌋 ĐỘNG ĐẤT san phẳng ${tile.name}! Đất trở về vô chủ.`, 'card');
                        evt = this._emitEvent('earthquake', { tileIndex: idx, message: `🌋 Động Đất phá hủy ${tile.name}!` });
                    }
                    break;
                }

                case 'power_outage': {
                    const idx = Number(payload.tileIndex);
                    if (!tgt.validOppTiles.includes(idx)) return this._fail('Mục tiêu không hợp lệ.');
                    const prop = this.state.properties[idx];
                    const tile = BOARD_TILES[idx];
                    if (prop.shielded) {
                        prop.shielded = false;
                        this._addLog(`🛡️ Khiên Bảo Vệ tại ${tile.name} đã chặn Cúp Điện!`, 'card');
                        evt = this._emitEvent('shield_block', { tileIndex: idx, message: `🛡️ Khiên đã chặn Cúp Điện ở ${tile.name}!` });
                    } else {
                        prop.outageTurns = 2;
                        this._addLog(`⚡ ${tile.name} bị CÚP ĐIỆN 2 vòng (tiền thuê = 0)!`, 'card');
                        evt = this._emitEvent('power_outage', { tileIndex: idx, message: `⚡ ${tile.name} cúp điện 2 vòng!` });
                    }
                    break;
                }

                case 'shield': {
                    const idx = Number(payload.tileIndex);
                    if (!tgt.validOwnTiles.includes(idx)) return this._fail('Ô không hợp lệ.');
                    this.state.properties[idx].shielded = true;
                    const tile = BOARD_TILES[idx];
                    this._addLog(`🛡️ ${current.name} đặt Khiên Bảo Vệ tại ${tile.name}.`, 'card');
                    evt = this._emitEvent('shield_add', { tileIndex: idx, message: `🛡️ Đặt Khiên tại ${tile.name}!` });
                    break;
                }

                case 'festival': {
                    const idx = Number(payload.tileIndex);
                    if (!tgt.validOwnTiles.includes(idx)) return this._fail('Thành phố không hợp lệ.');
                    this.state.properties[idx].festival = true;
                    const tile = BOARD_TILES[idx];
                    this._addLog(`🎉 ${current.name} mở Lễ Hội ×2 tiền thuê tại ${tile.name}!`, 'cash');
                    evt = this._emitEvent('festival_add', { tileIndex: idx, message: `🎉 Lễ Hội ×2 tại ${tile.name}!` });
                    break;
                }

                case 'royal_gift': {
                    const idx = Number(payload.ownTile ?? payload.tileIndex);
                    const recId = payload.recipientId;
                    if (!tgt.validOwnTiles.includes(idx) || !tgt.validRecipients.includes(recId)) {
                        return this._fail('Vui lòng chọn thành phố và người nhận hợp lệ.');
                    }
                    const rec = this.getPlayer(recId);
                    this.state.properties[idx].ownerId = recId;
                    const tile = BOARD_TILES[idx];
                    this._addLog(`🎁 ${current.name} tặng ${tile.name} cho ${rec.name} (Quà Hoàng Gia).`, 'card');
                    evt = this._emitEvent('royal_gift', { tileIndex: idx, message: `🎁 ${current.name} tặng ${tile.name} cho ${rec.name}` });
                    if (this._checkInstantWin(recId)) return this._ok(evt);
                    break;
                }

                case 'city_swap': {
                    const ownIdx = Number(payload.ownTile);
                    const oppIdx = Number(payload.targetTile);
                    if (!tgt.validOwnTiles.includes(ownIdx) || !tgt.validOppTiles.includes(oppIdx)) {
                        return this._fail('Vui lòng chọn 1 thành phố của bạn và 1 thành phố của đối thủ.');
                    }
                    const oppProp = this.state.properties[oppIdx];
                    const ownProp = this.state.properties[ownIdx];
                    const oppTile = BOARD_TILES[oppIdx];
                    const ownTile = BOARD_TILES[ownIdx];

                    if (oppProp.shielded) {
                        oppProp.shielded = false;
                        this._addLog(`🛡️ Khiên Bảo Vệ tại ${oppTile.name} đã chặn Hoán Đổi Đất!`, 'card');
                        evt = this._emitEvent('shield_block', { tileIndex: oppIdx, message: `🛡️ Khiên chặn Đổi Đất tại ${oppTile.name}!` });
                    } else {
                        const oppId = oppProp.ownerId;
                        oppProp.ownerId = current.id;
                        ownProp.ownerId = oppId;
                        this._addLog(`🔄 ${current.name} hoán đổi ${ownTile.name} lấy ${oppTile.name}!`, 'card');
                        evt = this._emitEvent('city_swap', { message: `🔄 Đổi ${ownTile.name} ⇄ ${oppTile.name}!` });
                        if (this._checkInstantWin(current.id) || this._checkInstantWin(oppId)) {
                            return this._ok(evt);
                        }
                    }
                    break;
                }

                default:
                    return this._fail('Loại thẻ không hợp lệ.');
            }

            this.state.pendingChanceTarget = null;
            this._finishCurrentStepOrAdvanceTurn();
            return this._ok(evt);
        }

        skipChanceTarget(playerId) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'CHANCE_TARGET_PICK') return this._fail('Không trong bước chọn Cơ Hội.');
            this.state.pendingChanceTarget = null;
            this._finishCurrentStepOrAdvanceTurn();
            return this._ok();
        }

        // ==================== SELL DEBT & BANKRUPTCY ====================

        sellPropertiesForDebt(playerId, tileIndices) {
            if (this.state.phase !== 'SELL_DEBT' || !this.state.pendingDebt) {
                return this._fail('Không ở trạng thái bán đất trả nợ.');
            }
            const debt = this.state.pendingDebt;
            if (debt.debtorId !== playerId) return this._fail('Không phải khoản nợ của bạn.');
            if (!Array.isArray(tileIndices) || tileIndices.length === 0) {
                return this._fail('Hãy chọn ít nhất 1 thành phố để bán.');
            }

            const debtor = this.getPlayer(playerId);
            const unique = [...new Set(tileIndices.map(Number))];
            let gained = 0;

            for (const idx of unique) {
                const prop = this.state.properties[idx];
                if (!prop || prop.ownerId !== playerId) continue;
                const val = this.getSaleValue(idx);
                gained += val;
                prop.ownerId = null;
                prop.level = 0;
                prop.shielded = false;
                prop.outageTurns = 0;
                if (this.state.championshipTile === idx) {
                    this.state.championshipTile = null;
                    this.state.championshipMult = 1;
                }
                this._addLog(`${debtor.name} bán ${BOARD_TILES[idx].name} thu về ${formatShortMoney(val)}.`, 'cash');
            }

            debtor.cash += gained;
            return this._settleDebtIfReady(debtor);
        }

        autoSellForDebt(playerId) {
            if (this.state.phase !== 'SELL_DEBT' || !this.state.pendingDebt) {
                return this._fail('Không ở trạng thái bán đất trả nợ.');
            }
            const debt = this.state.pendingDebt;
            if (debt.debtorId !== playerId) return this._fail('Không phải khoản nợ của bạn.');
            const debtor = this.getPlayer(playerId);

            const owned = this.getOwnedTileIndices(playerId).sort((a, b) => {
                const ta = BOARD_TILES[a];
                const tb = BOARD_TILES[b];
                const ma = ta.group && this.ownsColorGroup(playerId, ta.group) ? 1 : 0;
                const mb = tb.group && this.ownsColorGroup(playerId, tb.group) ? 1 : 0;
                if (ma !== mb) return ma - mb;
                return this.getSaleValue(a) - this.getSaleValue(b);
            });

            const toSell = [];
            let projected = debtor.cash;
            for (const idx of owned) {
                if (projected >= debt.amount) break;
                toSell.push(idx);
                projected += this.getSaleValue(idx);
            }

            if (toSell.length === 0) {
                return this.declareBankruptcy(playerId);
            }
            return this.sellPropertiesForDebt(playerId, toSell);
        }

        _settleDebtIfReady(debtor) {
            const debt = this.state.pendingDebt;
            if (!debt || debtor.cash < debt.amount) {
                return this._ok(this._emitEvent('debt_partial', {
                    playerId: debtor.id,
                    message: `${debtor.name} vẫn còn thiếu ${formatShortMoney(debt.amount - debtor.cash)}`
                }));
            }

            debtor.cash -= debt.amount;
            const deltas = { [debtor.id]: -debt.amount };
            if (debt.creditorId) {
                const creditor = this.getPlayer(debt.creditorId);
                if (creditor && !creditor.bankrupt) {
                    creditor.cash += debt.amount;
                    deltas[creditor.id] = debt.amount;
                }
            }

            const nextAction = debt.nextActionAfterPaid;
            this.state.pendingDebt = null;
            this._addLog(`${debtor.name} đã trả đủ ${formatShortMoney(debt.amount)}!`, 'cash');
            const evt = this._emitEvent('debt_paid', {
                playerId: debtor.id,
                cashDeltas: deltas,
                message: `${debtor.name} đã thanh toán nợ!`
            });
            this._executeNextActionAfterPaid(debtor, nextAction);
            return this._ok(evt);
        }

        declareBankruptcy(playerId) {
            if (this.state.phase !== 'SELL_DEBT' || !this.state.pendingDebt) {
                return this._fail('Không ở trạng thái giải quyết nợ.');
            }
            const debt = this.state.pendingDebt;
            if (debt.debtorId !== playerId) return this._fail('Không phải khoản nợ của bạn.');

            const debtor = this.getPlayer(playerId);
            const creditor = debt.creditorId ? this.getPlayer(debt.creditorId) : null;

            const remainingCash = debtor.cash + this.getLiquidationValue(debtor.id);
            if (creditor && !creditor.bankrupt && remainingCash > 0) {
                creditor.cash += remainingCash;
            }

            for (const idx of this.getOwnedTileIndices(debtor.id)) {
                const prop = this.state.properties[idx];
                prop.ownerId = null;
                prop.level = 0;
                prop.shielded = false;
                prop.outageTurns = 0;
                if (this.state.championshipTile === idx) {
                    this.state.championshipTile = null;
                    this.state.championshipMult = 1;
                }
            }

            debtor.cash = 0;
            debtor.bankrupt = true;
            debtor.inIsland = false;
            debtor.readyToFly = false;
            debtor.escapeCards = 0;
            this.state.pendingDebt = null;
            this.state.canRollAgain = false;
            this.state.doublesCount = 0;
            this._addLog(`💥 ${debtor.name} PHÁ SẢN! Toàn bộ tài sản bị thu hồi.`, 'bankrupt');

            const survivors = this.getActivePlayers();
            if (survivors.length <= 1) {
                const win = survivors[0] || null;
                this.state.winnerId = win ? win.id : null;
                this.state.winReason = 'BANKRUPTCY';
                this.state.phase = 'GAME_OVER';
                if (win) this._addLog(`🏆 ${win.name} CHIẾN THẮNG — TẤT CẢ ĐỐI THỦ PHÁ SẢN!`, 'win');
                return this._ok(this._emitEvent('game_over', {
                    winnerId: this.state.winnerId,
                    winReason: 'BANKRUPTCY',
                    message: `🏆 ${win?.name || ''} chiến thắng!`
                }));
            }

            const evt = this._emitEvent('bankrupt', {
                bankruptId: debtor.id,
                message: `${debtor.name} đã PHÁ SẢN!`
            });
            this._advanceToNextPlayer();
            return this._ok(evt);
        }

        endByTimer() {
            if (!this.state || this.state.phase === 'GAME_OVER') return this._fail('Trận đã kết thúc.');
            const ranked = this.getActivePlayers().sort((a, b) => this.getNetWorth(b.id) - this.getNetWorth(a.id));
            const win = ranked[0] || null;
            this.state.remainingSeconds = 0;
            this.state.winnerId = win ? win.id : null;
            this.state.winReason = 'TIME_UP';
            this.state.phase = 'GAME_OVER';
            this.state.canRollAgain = false;
            this._addLog(`⏰ HẾT GIỜ! ${win?.name || ''} thắng với tổng tài sản ${formatMoney(win ? this.getNetWorth(win.id) : 0)}.`, 'win');
            return this._ok(this._emitEvent('game_over', {
                winnerId: this.state.winnerId,
                winReason: 'TIME_UP',
                message: `⏰ Hết giờ — ${win?.name || ''} thắng!`
            }));
        }
    }

    const api = { GameEngine };
    global.CoTyPhu = Object.assign(global.CoTyPhu || {}, api);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
