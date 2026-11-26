(function (global) {
    'use strict';

    const Data = typeof module !== 'undefined' && module.exports
        ? require('./data.js')
        : global.CoTyPhu;

    const {
        DEFAULT_CONFIG,
        PLAYER_COLORS,
        COLOR_GROUPS,
        STATION_TILES,
        UTILITY_TILES,
        BOARD_TILES,
        CHANCE_CARDS,
        CHEST_CARDS,
        formatMoney
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
                inJail: false,
                jailTurns: 0,
                jailCards: 0,
                bankrupt: false,
                connected: cfg.connected !== undefined ? Boolean(cfg.connected) : true
            }));

            const properties = {};
            for (const tile of BOARD_TILES) {
                if (tile.type === 'property' || tile.type === 'station' || tile.type === 'utility') {
                    properties[tile.index] = {
                        ownerId: null,
                        houses: 0,
                        mortgaged: false
                    };
                }
            }

            this.state = {
                config,
                players,
                properties,
                currentPlayerIndex: 0,
                phase: 'ROLL',
                dice: [1, 1],
                doublesCount: 0,
                canRollAgain: false,
                pendingTile: null,
                pendingCard: null,
                pendingDebt: null,
                auction: null,
                trade: null,
                freeParkingPot: 0,
                chanceDeck: shuffle(CHANCE_CARDS.map((_, i) => i), this.rng),
                chestDeck: shuffle(CHEST_CARDS.map((_, i) => i), this.rng),
                turnNumber: 1,
                logs: [],
                winnerId: null,
                eventSeq: 0,
                lastEvent: null
            };

            this._addLog(`Ván đấu bắt đầu! Mỗi người có ${formatMoney(config.startingCash)}. Lượt của ${players[0].name}.`, 'system');
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

        ownsColorGroup(playerId, groupId) {
            const grp = COLOR_GROUPS[groupId];
            if (!grp) return false;
            return grp.tiles.every(idx => {
                const prop = this.state.properties[idx];
                return prop && prop.ownerId === playerId;
            });
        }

        getOwnedTileIndices(playerId) {
            return Object.keys(this.state.properties)
                .map(Number)
                .filter(idx => this.state.properties[idx].ownerId === playerId);
        }

        groupHasHouses(groupId) {
            const grp = COLOR_GROUPS[groupId];
            if (!grp) return false;
            return grp.tiles.some(idx => (this.state.properties[idx]?.houses || 0) > 0);
        }

        groupHasMortgaged(groupId) {
            const grp = COLOR_GROUPS[groupId];
            if (!grp) return false;
            return grp.tiles.some(idx => Boolean(this.state.properties[idx]?.mortgaged));
        }

        canBuildOn(playerId, tileIndex) {
            const tile = BOARD_TILES[tileIndex];
            const prop = this.state.properties[tileIndex];
            const player = this.getPlayer(playerId);
            if (!tile || tile.type !== 'property' || !prop || !player || player.bankrupt) return false;
            if (prop.ownerId !== playerId || prop.mortgaged) return false;
            if (!this.ownsColorGroup(playerId, tile.group)) return false;
            if (this.groupHasMortgaged(tile.group)) return false;
            if (prop.houses >= 5) return false;
            if (player.cash < tile.houseCost) return false;
            const minHouses = Math.min(...COLOR_GROUPS[tile.group].tiles.map(i => this.state.properties[i].houses));
            return prop.houses === minHouses;
        }

        canSellOn(playerId, tileIndex) {
            const tile = BOARD_TILES[tileIndex];
            const prop = this.state.properties[tileIndex];
            const player = this.getPlayer(playerId);
            if (!tile || tile.type !== 'property' || !prop || !player || player.bankrupt) return false;
            if (prop.ownerId !== playerId || prop.houses <= 0) return false;
            const maxHouses = Math.max(...COLOR_GROUPS[tile.group].tiles.map(i => this.state.properties[i].houses));
            return prop.houses === maxHouses;
        }

        canMortgage(playerId, tileIndex) {
            const tile = BOARD_TILES[tileIndex];
            const prop = this.state.properties[tileIndex];
            const player = this.getPlayer(playerId);
            if (!tile || !prop || !player || player.bankrupt) return false;
            if (prop.ownerId !== playerId || prop.mortgaged) return false;
            if (tile.type === 'property' && this.groupHasHouses(tile.group)) return false;
            return true;
        }

        getUnmortgageCost(tileIndex) {
            const tile = BOARD_TILES[tileIndex];
            if (!tile || !tile.price) return 0;
            return Math.ceil((tile.price / 2) * 1.1);
        }

        canUnmortgage(playerId, tileIndex) {
            const prop = this.state.properties[tileIndex];
            const player = this.getPlayer(playerId);
            if (!prop || !player || player.bankrupt) return false;
            if (prop.ownerId !== playerId || !prop.mortgaged) return false;
            return player.cash >= this.getUnmortgageCost(tileIndex);
        }

        calculateRent(tileIndex, diceSum = 7, multiplierOverride = null) {
            const tile = BOARD_TILES[tileIndex];
            const prop = this.state.properties[tileIndex];
            if (!tile || !prop || !prop.ownerId || prop.mortgaged) return 0;

            if (tile.type === 'property') {
                if (prop.houses > 0) {
                    return tile.rent[prop.houses];
                }
                const hasMonopoly = this.ownsColorGroup(prop.ownerId, tile.group);
                return hasMonopoly ? tile.rent[0] * 2 : tile.rent[0];
            }

            if (tile.type === 'station') {
                const count = STATION_TILES.filter(idx => {
                    const st = this.state.properties[idx];
                    return st && st.ownerId === prop.ownerId && !st.mortgaged;
                }).length;
                const base = 25 * Math.pow(2, Math.max(0, count - 1));
                return multiplierOverride ? base * multiplierOverride : base;
            }

            if (tile.type === 'utility') {
                if (multiplierOverride) {
                    return diceSum * multiplierOverride;
                }
                const count = UTILITY_TILES.filter(idx => {
                    const ut = this.state.properties[idx];
                    return ut && ut.ownerId === prop.ownerId && !ut.mortgaged;
                }).length;
                return diceSum * (count >= 2 ? 10 : 4);
            }

            return 0;
        }

        getNetWorth(playerId) {
            const player = this.getPlayer(playerId);
            if (!player || player.bankrupt) return 0;
            let total = player.cash;
            for (const idx of this.getOwnedTileIndices(playerId)) {
                const tile = BOARD_TILES[idx];
                const prop = this.state.properties[idx];
                total += prop.mortgaged ? Math.floor(tile.price / 2) : tile.price;
                if (tile.type === 'property' && prop.houses > 0) {
                    total += prop.houses * tile.houseCost;
                }
            }
            return total;
        }

        getLiquidationValue(playerId) {
            const player = this.getPlayer(playerId);
            if (!player || player.bankrupt) return 0;
            let total = 0;
            for (const idx of this.getOwnedTileIndices(playerId)) {
                const tile = BOARD_TILES[idx];
                const prop = this.state.properties[idx];
                if (tile.type === 'property' && prop.houses > 0) {
                    total += prop.houses * Math.floor(tile.houseCost / 2);
                }
                if (!prop.mortgaged) {
                    total += Math.floor(tile.price / 2);
                }
            }
            return total;
        }

        _isManagementAllowed(playerId) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId || current.bankrupt) return false;
            const p = this.state.phase;
            return p === 'ROLL' || p === 'END_TURN' || (p === 'DEBT_RESOLUTION' && this.state.pendingDebt?.debtorId === playerId);
        }

        payJailBail(playerId) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'ROLL') return this._fail('Chỉ có thể nộp tiền bảo lãnh trước khi tung xúc xắc.');
            if (!current.inJail) return this._fail('Bạn không ở trong tù.');
            const bail = this.state.config.jailBail;
            if (current.cash < bail) return this._fail('Không đủ tiền nộp bảo lãnh.');

            current.cash -= bail;
            if (this.state.config.freeParkingJackpot) {
                this.state.freeParkingPot += bail;
            }
            current.inJail = false;
            current.jailTurns = 0;
            this._addLog(`${current.name} nộp ${formatMoney(bail)} tiền bảo lãnh để ra tù.`, 'jail');
            return this._ok(this._emitEvent('bail', {
                playerId,
                cashDeltas: { [playerId]: -bail },
                message: `${current.name} đã nộp ${formatMoney(bail)} ra tù`
            }));
        }

        useJailCard(playerId) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'ROLL') return this._fail('Chỉ có thể dùng thẻ trước khi tung xúc xắc.');
            if (!current.inJail) return this._fail('Bạn không ở trong tù.');
            if (current.jailCards <= 0) return this._fail('Bạn không có thẻ Miễn Tù.');

            current.jailCards -= 1;
            current.inJail = false;
            current.jailTurns = 0;
            this._addLog(`${current.name} sử dụng Thẻ Miễn Tù và được tự do!`, 'jail');
            return this._ok(this._emitEvent('jail_card', {
                playerId,
                message: `${current.name} dùng Thẻ Miễn Tù!`
            }));
        }

        rollDice(playerId, forcedDice = null) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'ROLL') return this._fail('Không thể tung xúc xắc lúc này.');
            if (current.bankrupt) return this._fail('Người chơi đã phá sản.');

            const d1 = forcedDice ? forcedDice[0] : this._rollDie();
            const d2 = forcedDice ? forcedDice[1] : this._rollDie();
            const sum = d1 + d2;
            const isDoubles = d1 === d2;
            this.state.dice = [d1, d2];

            // Handle in-jail rolls
            if (current.inJail) {
                if (isDoubles) {
                    current.inJail = false;
                    current.jailTurns = 0;
                    this.state.doublesCount = 0;
                    this.state.canRollAgain = false;
                    this._addLog(`${current.name} tung được đôi ${d1}-${d2} và thoát khỏi Nhà Tù!`, 'jail');
                    return this._moveAndResolve(current, sum, { d1, d2 }, true);
                }

                current.jailTurns += 1;
                if (current.jailTurns >= 3) {
                    const bail = this.state.config.jailBail;
                    this._addLog(`${current.name} đã hết 3 lượt trong tù (${d1}+${d2}), bắt buộc nộp ${formatMoney(bail)} để ra tù và đi ${sum} bước.`, 'jail');
                    current.inJail = false;
                    current.jailTurns = 0;
                    this.state.doublesCount = 0;
                    this.state.canRollAgain = false;

                    if (current.cash < bail) {
                        // Move first, or demand bail via debt? Standard Monopoly: pay bail first, then move.
                        // Set pending debt; once resolved, player ends turn or proceeds cleanly.
                        // To keep flow linear: move after debt or resolve bail via debt then move.
                        // Even cleaner: store moveSteps on pendingDebt? No, if cash < bail, resolve bail debt, then finish at END_TURN.
                        this.state.pendingDebt = {
                            debtorId: current.id,
                            creditorId: null,
                            amount: bail,
                            reason: 'Tiền bảo lãnh bắt buộc sau 3 lượt ở tù',
                            prevPhase: 'END_TURN',
                            addToPot: Boolean(this.state.config.freeParkingJackpot)
                        };
                        this.state.phase = 'DEBT_RESOLUTION';
                        return this._ok(this._emitEvent('debt', {
                            playerId: current.id,
                            dice: [d1, d2],
                            message: `${current.name} thiếu tiền nộp bảo lãnh ${formatMoney(bail)}`
                        }));
                    }

                    current.cash -= bail;
                    if (this.state.config.freeParkingJackpot) {
                        this.state.freeParkingPot += bail;
                    }
                    return this._moveAndResolve(current, sum, { d1, d2 }, true, { [current.id]: -bail });
                }

                this.state.canRollAgain = false;
                this.state.doublesCount = 0;
                this.state.phase = 'END_TURN';
                this._addLog(`${current.name} tung ${d1}+${d2} trong tù (lần ${current.jailTurns}/3), chưa ra tù.`, 'jail');
                return this._ok(this._emitEvent('roll_jail_stay', {
                    playerId: current.id,
                    dice: [d1, d2],
                    message: `${current.name} tung ${d1}+${d2}, vẫn ở trong tù (${current.jailTurns}/3)`
                }));
            }

            // Normal roll
            if (isDoubles) {
                this.state.doublesCount += 1;
                if (this.state.doublesCount >= 3) {
                    this._sendToJail(current);
                    this.state.phase = 'END_TURN';
                    this._addLog(`${current.name} tung đôi lần thứ 3 liên tiếp (${d1}-${d2})! Bị đưa thẳng vào Nhà Tù.`, 'jail');
                    return this._ok(this._emitEvent('go_to_jail', {
                        playerId: current.id,
                        dice: [d1, d2],
                        toPos: 10,
                        message: `${current.name} tung 3 lần đôi liên tiếp -> Vào Tù!`
                    }));
                }
                this.state.canRollAgain = true;
            } else {
                this.state.doublesCount = 0;
                this.state.canRollAgain = false;
            }

            this._addLog(`${current.name} tung được ${d1} + ${d2} = ${sum}${isDoubles ? ' (Đôi - được đi thêm!)' : ''}.`, 'roll');
            return this._moveAndResolve(current, sum, { d1, d2 }, false);
        }

        _moveAndResolve(player, steps, diceObj, fromJailExit = false, initialCashDeltas = {}) {
            const fromPos = player.position;
            const rawTarget = fromPos + steps;
            const passedGo = rawTarget >= 40;
            const toPos = rawTarget % 40;
            const cashDeltas = Object.assign({}, initialCashDeltas);

            player.position = toPos;
            if (passedGo) {
                const salary = this.state.config.goSalary;
                player.cash += salary;
                cashDeltas[player.id] = (cashDeltas[player.id] || 0) + salary;
                this._addLog(`${player.name} đi qua Khởi Hành, nhận ${formatMoney(salary)}.`, 'cash');
            }

            const eventBase = {
                playerId: player.id,
                fromPos,
                toPos,
                dice: [diceObj.d1, diceObj.d2],
                passedGo,
                fromJailExit,
                cashDeltas
            };

            return this._resolveLanding(player, toPos, diceObj.d1 + diceObj.d2, eventBase);
        }

        _sendToJail(player) {
            player.position = 10;
            player.inJail = true;
            player.jailTurns = 0;
            this.state.doublesCount = 0;
            this.state.canRollAgain = false;
        }

        _nextPhaseAfterResolution() {
            return this.state.canRollAgain ? 'ROLL' : 'END_TURN';
        }

        _chargeOrEnterDebt(debtor, creditorId, amount, reason, addToPot = false, eventExtra = {}) {
            if (debtor.cash >= amount) {
                debtor.cash -= amount;
                const deltas = Object.assign({}, eventExtra.cashDeltas || {});
                deltas[debtor.id] = (deltas[debtor.id] || 0) - amount;
                if (creditorId) {
                    const creditor = this.getPlayer(creditorId);
                    if (creditor) {
                        creditor.cash += amount;
                        deltas[creditor.id] = (deltas[creditor.id] || 0) + amount;
                    }
                } else if (addToPot) {
                    this.state.freeParkingPot += amount;
                }
                this.state.phase = this._nextPhaseAfterResolution();
                return this._ok(this._emitEvent(eventExtra.type || 'pay', Object.assign({}, eventExtra, {
                    cashDeltas: deltas
                })));
            }

            this.state.pendingDebt = {
                debtorId: debtor.id,
                creditorId,
                amount,
                reason,
                prevPhase: this._nextPhaseAfterResolution(),
                addToPot: Boolean(addToPot)
            };
            this.state.phase = 'DEBT_RESOLUTION';
            this._addLog(`${debtor.name} chưa đủ ${formatMoney(amount)} (${reason}). Cần thế chấp hoặc bán nhà!`, 'warning');
            return this._ok(this._emitEvent('debt', Object.assign({}, eventExtra, {
                debtAmount: amount,
                message: `${debtor.name} cần xoay ${formatMoney(amount)} để trả nợ`
            })));
        }

        _resolveLanding(player, tileIndex, diceSum, eventBase = {}, rentMultiplierOverride = null) {
            const tile = BOARD_TILES[tileIndex];
            const prop = this.state.properties[tileIndex];

            if (tile.type === 'go' || tile.type === 'jail') {
                this.state.phase = this._nextPhaseAfterResolution();
                const msg = tile.type === 'go'
                    ? `${player.name} dừng tại ô Khởi Hành`
                    : `${player.name} ghé thăm Nhà Tù`;
                return this._ok(this._emitEvent('move', Object.assign({}, eventBase, { message: msg })));
            }

            if (tile.type === 'free_parking') {
                const deltas = Object.assign({}, eventBase.cashDeltas || {});
                let msg = `${player.name} dừng tại Đỗ Xe Miễn Phí`;
                if (this.state.config.freeParkingJackpot && this.state.freeParkingPot > 0) {
                    const pot = this.state.freeParkingPot;
                    player.cash += pot;
                    this.state.freeParkingPot = 0;
                    deltas[player.id] = (deltas[player.id] || 0) + pot;
                    this._addLog(`${player.name} nhận toàn bộ Quỹ Đỗ Xe Miễn Phí: ${formatMoney(pot)}!`, 'cash');
                    msg = `${player.name} trúng Quỹ Đỗ Xe ${formatMoney(pot)}!`;
                }
                this.state.phase = this._nextPhaseAfterResolution();
                return this._ok(this._emitEvent('free_parking', Object.assign({}, eventBase, { cashDeltas: deltas, message: msg })));
            }

            if (tile.type === 'go_to_jail') {
                this._sendToJail(player);
                this.state.phase = 'END_TURN';
                this._addLog(`${player.name} đi vào ô Vào Tù và bị giam giữ!`, 'jail');
                return this._ok(this._emitEvent('go_to_jail', Object.assign({}, eventBase, {
                    toPos: 10,
                    message: `${player.name} vào Nhà Tù!`
                })));
            }

            if (tile.type === 'tax') {
                this._addLog(`${player.name} phải nộp ${tile.name}: ${formatMoney(tile.amount)}.`, 'tax');
                return this._chargeOrEnterDebt(
                    player,
                    null,
                    tile.amount,
                    tile.name,
                    this.state.config.freeParkingJackpot,
                    Object.assign({}, eventBase, {
                        type: 'tax',
                        message: `${player.name} nộp ${tile.name} ${formatMoney(tile.amount)}`
                    })
                );
            }

            if (tile.type === 'chance' || tile.type === 'chest') {
                const deckKey = tile.type === 'chance' ? 'chanceDeck' : 'chestDeck';
                const sourceList = tile.type === 'chance' ? CHANCE_CARDS : CHEST_CARDS;
                if (this.state[deckKey].length === 0) {
                    this.state[deckKey] = shuffle(sourceList.map((_, i) => i), this.rng);
                }
                const cardIdx = this.state[deckKey].shift();
                const card = sourceList[cardIdx];
                this.state.pendingCard = { deck: tile.type, card: clone(card) };
                this.state.phase = 'CARD_MODAL';
                this._addLog(`${player.name} rút thẻ ${tile.type === 'chance' ? 'Cơ Hội' : 'Khí Vận'}: "${card.title}".`, 'card');
                return this._ok(this._emitEvent('draw_card', Object.assign({}, eventBase, {
                    deck: tile.type,
                    card,
                    message: `${player.name} rút thẻ: ${card.title}`
                })));
            }

            // Property / Station / Utility
            if (prop) {
                if (!prop.ownerId) {
                    this.state.pendingTile = tileIndex;
                    this.state.phase = 'BUY_DECISION';
                    return this._ok(this._emitEvent('land_unowned', Object.assign({}, eventBase, {
                        tileIndex,
                        message: `${player.name} dừng tại ${tile.name} (${formatMoney(tile.price)})`
                    })));
                }

                if (prop.ownerId === player.id) {
                    this.state.phase = this._nextPhaseAfterResolution();
                    return this._ok(this._emitEvent('land_own', Object.assign({}, eventBase, {
                        message: `${player.name} thăm lại đất nhà: ${tile.name}`
                    })));
                }

                const owner = this.getPlayer(prop.ownerId);
                if (prop.mortgaged) {
                    this.state.phase = this._nextPhaseAfterResolution();
                    this._addLog(`${player.name} vào ${tile.name} (đang thế chấp — miễn tiền thuê).`, 'info');
                    return this._ok(this._emitEvent('land_mortgaged', Object.assign({}, eventBase, {
                        message: `${tile.name} đang thế chấp — miễn phí`
                    })));
                }

                const rent = this.calculateRent(tileIndex, diceSum, rentMultiplierOverride);
                this._addLog(`${player.name} trả ${formatMoney(rent)} tiền thuê ${tile.name} cho ${owner.name}.`, 'rent');
                return this._chargeOrEnterDebt(
                    player,
                    owner.id,
                    rent,
                    `Tiền thuê ${tile.name} trả cho ${owner.name}`,
                    false,
                    Object.assign({}, eventBase, {
                        type: 'rent',
                        ownerId: owner.id,
                        rent,
                        message: `${player.name} trả ${owner.name} ${formatMoney(rent)}`
                    })
                );
            }

            this.state.phase = this._nextPhaseAfterResolution();
            return this._ok(this._emitEvent('move', eventBase));
        }

        confirmCard(playerId) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'CARD_MODAL' || !this.state.pendingCard) {
                return this._fail('Không có thẻ nào cần xác nhận.');
            }

            const { deck, card } = this.state.pendingCard;
            this.state.pendingCard = null;
            const fromPos = current.position;

            switch (card.action) {
                case 'collect': {
                    current.cash += card.amount;
                    this.state.phase = this._nextPhaseAfterResolution();
                    this._addLog(`${current.name} nhận ${formatMoney(card.amount)} từ thẻ "${card.title}".`, 'cash');
                    return this._ok(this._emitEvent('card_resolved', {
                        playerId: current.id,
                        cashDeltas: { [current.id]: card.amount },
                        message: `${current.name} +${formatMoney(card.amount)}`
                    }));
                }

                case 'pay': {
                    this._addLog(`${current.name} phải trả ${formatMoney(card.amount)} (${card.title}).`, 'tax');
                    return this._chargeOrEnterDebt(
                        current,
                        null,
                        card.amount,
                        card.title,
                        this.state.config.freeParkingJackpot,
                        { type: 'card_pay', playerId: current.id, message: `${current.name} -${formatMoney(card.amount)}` }
                    );
                }

                case 'go_to_jail': {
                    this._sendToJail(current);
                    this.state.phase = 'END_TURN';
                    this._addLog(`${current.name} bị đưa vào Nhà Tù theo thẻ "${card.title}"!`, 'jail');
                    return this._ok(this._emitEvent('go_to_jail', {
                        playerId: current.id,
                        fromPos,
                        toPos: 10,
                        message: `${current.name} vào Nhà Tù!`
                    }));
                }

                case 'jail_free_card': {
                    current.jailCards += 1;
                    this.state.phase = this._nextPhaseAfterResolution();
                    this._addLog(`${current.name} nhận được 1 Thẻ Miễn Tù!`, 'card');
                    return this._ok(this._emitEvent('card_resolved', {
                        playerId: current.id,
                        message: `${current.name} nhận Thẻ Miễn Tù!`
                    }));
                }

                case 'move_to': {
                    const target = card.target;
                    const steps = (target - fromPos + 40) % 40;
                    const diceSum = this.state.dice[0] + this.state.dice[1];
                    if (steps === 0 && target === 0) {
                        // Already on GO, award GO bonus explicitly
                        current.cash += this.state.config.goSalary;
                        this.state.phase = this._nextPhaseAfterResolution();
                        return this._ok(this._emitEvent('card_resolved', {
                            playerId: current.id,
                            cashDeltas: { [current.id]: this.state.config.goSalary },
                            message: `${current.name} +${formatMoney(this.state.config.goSalary)}`
                        }));
                    }
                    const passedGo = target < fromPos;
                    current.position = target;
                    const deltas = {};
                    if (passedGo) {
                        current.cash += this.state.config.goSalary;
                        deltas[current.id] = this.state.config.goSalary;
                        this._addLog(`${current.name} đi qua Khởi Hành, nhận ${formatMoney(this.state.config.goSalary)}.`, 'cash');
                    }
                    return this._resolveLanding(current, target, diceSum, {
                        playerId: current.id,
                        fromPos,
                        toPos: target,
                        passedGo,
                        cashDeltas: deltas
                    });
                }

                case 'move_back': {
                    const target = (fromPos - card.steps + 40) % 40;
                    current.position = target;
                    const diceSum = this.state.dice[0] + this.state.dice[1];
                    this._addLog(`${current.name} lùi ${card.steps} ô về ${BOARD_TILES[target].name}.`, 'card');
                    return this._resolveLanding(current, target, diceSum, {
                        playerId: current.id,
                        fromPos,
                        toPos: target
                    });
                }

                case 'nearest_station': {
                    let best = STATION_TILES.find(s => s > fromPos);
                    let passedGo = false;
                    if (best === undefined) {
                        best = STATION_TILES[0];
                        passedGo = true;
                    }
                    current.position = best;
                    const deltas = {};
                    if (passedGo) {
                        current.cash += this.state.config.goSalary;
                        deltas[current.id] = this.state.config.goSalary;
                        this._addLog(`${current.name} đi qua Khởi Hành, nhận ${formatMoney(this.state.config.goSalary)}.`, 'cash');
                    }
                    this._addLog(`${current.name} tiến tới ${BOARD_TILES[best].name}.`, 'card');
                    return this._resolveLanding(
                        current,
                        best,
                        this.state.dice[0] + this.state.dice[1],
                        { playerId: current.id, fromPos, toPos: best, passedGo, cashDeltas: deltas },
                        card.multiplier || 2
                    );
                }

                case 'nearest_utility': {
                    let best = UTILITY_TILES.find(u => u > fromPos);
                    let passedGo = false;
                    if (best === undefined) {
                        best = UTILITY_TILES[0];
                        passedGo = true;
                    }
                    current.position = best;
                    const deltas = {};
                    if (passedGo) {
                        current.cash += this.state.config.goSalary;
                        deltas[current.id] = this.state.config.goSalary;
                        this._addLog(`${current.name} đi qua Khởi Hành, nhận ${formatMoney(this.state.config.goSalary)}.`, 'cash');
                    }
                    const prop = this.state.properties[best];
                    let specialDice = this.state.dice[0] + this.state.dice[1];
                    if (prop && prop.ownerId && prop.ownerId !== current.id && !prop.mortgaged) {
                        const d1 = this._rollDie();
                        const d2 = this._rollDie();
                        this.state.dice = [d1, d2];
                        specialDice = d1 + d2;
                        this._addLog(`${current.name} tung xúc xắc đặc biệt cho ${BOARD_TILES[best].name}: ${d1}+${d2}=${specialDice}.`, 'card');
                    }
                    return this._resolveLanding(
                        current,
                        best,
                        specialDice,
                        { playerId: current.id, fromPos, toPos: best, passedGo, cashDeltas: deltas },
                        card.multiplier || 10
                    );
                }

                case 'repairs': {
                    let houseCount = 0;
                    let hotelCount = 0;
                    for (const idx of this.getOwnedTileIndices(current.id)) {
                        const h = this.state.properties[idx].houses || 0;
                        if (h === 5) hotelCount += 1;
                        else houseCount += h;
                    }
                    const total = houseCount * card.perHouse + hotelCount * card.perHotel;
                    if (total === 0) {
                        this.state.phase = this._nextPhaseAfterResolution();
                        this._addLog(`${current.name} chưa có nhà/khách sạn nên không mất phí tu sửa.`, 'card');
                        return this._ok(this._emitEvent('card_resolved', {
                            playerId: current.id,
                            message: `${current.name} không có nhà để sửa (0k)`
                        }));
                    }
                    this._addLog(`${current.name} đóng phí tu sửa (${houseCount} nhà, ${hotelCount} khách sạn): ${formatMoney(total)}.`, 'tax');
                    return this._chargeOrEnterDebt(
                        current,
                        null,
                        total,
                        card.title,
                        this.state.config.freeParkingJackpot,
                        { type: 'card_pay', playerId: current.id, message: `${current.name} -${formatMoney(total)}` }
                    );
                }

                case 'collect_all': {
                    const others = this.getActivePlayers().filter(p => p.id !== current.id);
                    let totalCollected = 0;
                    const deltas = {};
                    for (const other of others) {
                        const paid = Math.min(other.cash, card.amount);
                        other.cash -= paid;
                        totalCollected += paid;
                        if (paid > 0) deltas[other.id] = -paid;
                    }
                    current.cash += totalCollected;
                    deltas[current.id] = totalCollected;
                    this.state.phase = this._nextPhaseAfterResolution();
                    this._addLog(`${current.name} nhận tổng cộng ${formatMoney(totalCollected)} từ mọi người (${card.title}).`, 'cash');
                    return this._ok(this._emitEvent('card_resolved', {
                        playerId: current.id,
                        cashDeltas: deltas,
                        message: `${current.name} +${formatMoney(totalCollected)}`
                    }));
                }

                case 'pay_all': {
                    const others = this.getActivePlayers().filter(p => p.id !== current.id);
                    const totalNeeded = others.length * card.amount;
                    if (current.cash >= totalNeeded) {
                        current.cash -= totalNeeded;
                        const deltas = { [current.id]: -totalNeeded };
                        for (const other of others) {
                            other.cash += card.amount;
                            deltas[other.id] = card.amount;
                        }
                        this.state.phase = this._nextPhaseAfterResolution();
                        this._addLog(`${current.name} trả mỗi người ${formatMoney(card.amount)} (tổng ${formatMoney(totalNeeded)}).`, 'rent');
                        return this._ok(this._emitEvent('card_resolved', {
                            playerId: current.id,
                            cashDeltas: deltas,
                            message: `${current.name} chia ${formatMoney(totalNeeded)}`
                        }));
                    }
                    this.state.pendingDebt = {
                        debtorId: current.id,
                        creditorId: null,
                        multiCreditorIds: others.map(o => o.id),
                        perCreditorAmount: card.amount,
                        amount: totalNeeded,
                        reason: card.title,
                        prevPhase: this._nextPhaseAfterResolution(),
                        addToPot: false
                    };
                    this.state.phase = 'DEBT_RESOLUTION';
                    this._addLog(`${current.name} thiếu tiền chi trả ${formatMoney(totalNeeded)} cho mọi người!`, 'warning');
                    return this._ok(this._emitEvent('debt', {
                        playerId: current.id,
                        deck,
                        message: `${current.name} cần xoay ${formatMoney(totalNeeded)}`
                    }));
                }

                default: {
                    this.state.phase = this._nextPhaseAfterResolution();
                    return this._ok();
                }
            }
        }

        buyProperty(playerId) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'BUY_DECISION' || this.state.pendingTile === null) {
                return this._fail('Không có lô đất đang chờ mua.');
            }
            const tileIndex = this.state.pendingTile;
            const tile = BOARD_TILES[tileIndex];
            const prop = this.state.properties[tileIndex];
            if (!tile || !prop || prop.ownerId) return this._fail('Ô đất này không thể mua.');
            if (current.cash < tile.price) return this._fail('Bạn không đủ tiền mua lô đất này.');

            current.cash -= tile.price;
            prop.ownerId = current.id;
            this.state.pendingTile = null;
            this.state.phase = this._nextPhaseAfterResolution();
            this._addLog(`${current.name} đã mua ${tile.name} với giá ${formatMoney(tile.price)}.`, 'buy');
            return this._ok(this._emitEvent('buy', {
                playerId: current.id,
                tileIndex,
                cashDeltas: { [current.id]: -tile.price },
                message: `${current.name} mua ${tile.name}!`
            }));
        }

        startAuction(playerId) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'BUY_DECISION' || this.state.pendingTile === null) {
                return this._fail('Không có lô đất đang chờ đấu giá.');
            }

            const tileIndex = this.state.pendingTile;
            const tile = BOARD_TILES[tileIndex];
            this.state.pendingTile = null;

            const activePlayers = this.state.players;
            const participants = [];
            for (let offset = 1; offset <= activePlayers.length; offset++) {
                const p = activePlayers[(this.state.currentPlayerIndex + offset) % activePlayers.length];
                if (!p.bankrupt) participants.push(p.id);
            }

            this.state.auction = {
                tileIndex,
                highestBid: 0,
                highestBidderId: null,
                participants,
                activeIndex: 0,
                passedIds: []
            };
            this.state.phase = 'AUCTION';
            this._addLog(`${current.name} mở đấu giá ${tile.name} (giá gốc ${formatMoney(tile.price)})!`, 'auction');
            return this._ok(this._emitEvent('auction_start', {
                playerId: current.id,
                tileIndex,
                message: `Đấu giá ${tile.name}`
            }));
        }

        getAuctionActiveBidderId() {
            const auc = this.state.auction;
            if (!auc) return null;
            return auc.participants[auc.activeIndex] || null;
        }

        _advanceAuctionTurn() {
            const auc = this.state.auction;
            const remaining = auc.participants.filter(id => !auc.passedIds.includes(id));
            if (remaining.length === 0) {
                const tile = BOARD_TILES[auc.tileIndex];
                this.state.auction = null;
                this.state.phase = this._nextPhaseAfterResolution();
                this._addLog(`Không ai trả giá, ${tile.name} vẫn thuộc về ngân hàng.`, 'auction');
                return this._ok(this._emitEvent('auction_end', {
                    tileIndex: tile.index,
                    winnerId: null,
                    message: `Đấu giá ${tile.name} không có người mua`
                }));
            }

            if (remaining.length === 1 && auc.highestBidderId === remaining[0]) {
                return this._finalizeAuctionWinner();
            }

            const n = auc.participants.length;
            for (let step = 1; step <= n; step++) {
                const nextIdx = (auc.activeIndex + step) % n;
                if (!auc.passedIds.includes(auc.participants[nextIdx])) {
                    auc.activeIndex = nextIdx;
                    break;
                }
            }
            return this._ok(this._emitEvent('auction_turn', {
                tileIndex: auc.tileIndex,
                bidderId: this.getAuctionActiveBidderId(),
                highestBid: auc.highestBid
            }));
        }

        _finalizeAuctionWinner() {
            const auc = this.state.auction;
            const winner = this.getPlayer(auc.highestBidderId);
            const tile = BOARD_TILES[auc.tileIndex];
            const prop = this.state.properties[auc.tileIndex];
            const price = auc.highestBid;

            winner.cash -= price;
            prop.ownerId = winner.id;
            this.state.auction = null;
            this.state.phase = this._nextPhaseAfterResolution();
            this._addLog(`${winner.name} thắng đấu giá ${tile.name} với giá ${formatMoney(price)}!`, 'auction');
            return this._ok(this._emitEvent('auction_end', {
                tileIndex: tile.index,
                winnerId: winner.id,
                price,
                cashDeltas: { [winner.id]: -price },
                message: `${winner.name} thắng đấu giá ${tile.name} (${formatMoney(price)})`
            }));
        }

        placeAuctionBid(playerId, amount) {
            if (this.state.phase !== 'AUCTION' || !this.state.auction) {
                return this._fail('Không trong phiên đấu giá.');
            }
            const auc = this.state.auction;
            if (this.getAuctionActiveBidderId() !== playerId) {
                return this._fail('Chưa tới lượt bạn trả giá.');
            }
            const bidder = this.getPlayer(playerId);
            const bid = Math.floor(Number(amount));
            if (!Number.isFinite(bid) || bid <= auc.highestBid) {
                return this._fail(`Giá đấu phải cao hơn ${formatMoney(auc.highestBid)}.`);
            }
            if (bid > bidder.cash) {
                return this._fail('Bạn không đủ tiền mặt để đặt mức giá này.');
            }

            auc.highestBid = bid;
            auc.highestBidderId = playerId;
            this._addLog(`${bidder.name} trả giá ${formatMoney(bid)} cho ${BOARD_TILES[auc.tileIndex].name}.`, 'auction');

            const remaining = auc.participants.filter(id => !auc.passedIds.includes(id));
            if (remaining.length === 1) {
                return this._finalizeAuctionWinner();
            }
            return this._advanceAuctionTurn();
        }

        passAuction(playerId) {
            if (this.state.phase !== 'AUCTION' || !this.state.auction) {
                return this._fail('Không trong phiên đấu giá.');
            }
            const auc = this.state.auction;
            if (this.getAuctionActiveBidderId() !== playerId) {
                return this._fail('Chưa tới lượt bạn.');
            }
            const player = this.getPlayer(playerId);
            if (!auc.passedIds.includes(playerId)) {
                auc.passedIds.push(playerId);
            }
            this._addLog(`${player.name} bỏ qua lượt đấu giá.`, 'auction');
            return this._advanceAuctionTurn();
        }

        buildHouse(playerId, tileIndex) {
            if (!this._isManagementAllowed(playerId)) {
                return this._fail('Không thể xây nhà trong pha hiện tại.');
            }
            if (!this.canBuildOn(playerId, tileIndex)) {
                return this._fail('Chưa đủ điều kiện xây nhà (cần sở hữu đủ bộ màu, không thế chấp, và xây đều).');
            }
            const player = this.getPlayer(playerId);
            const tile = BOARD_TILES[tileIndex];
            const prop = this.state.properties[tileIndex];

            player.cash -= tile.houseCost;
            prop.houses += 1;
            const label = prop.houses === 5 ? 'Khách Sạn' : `Nhà cấp ${prop.houses}`;
            this._addLog(`${player.name} xây ${label} tại ${tile.name} (-${formatMoney(tile.houseCost)}).`, 'build');
            return this._ok(this._emitEvent('build', {
                playerId,
                tileIndex,
                houses: prop.houses,
                cashDeltas: { [playerId]: -tile.houseCost },
                message: `${player.name} xây ${label} ở ${tile.name}`
            }));
        }

        sellHouse(playerId, tileIndex) {
            if (!this._isManagementAllowed(playerId)) {
                return this._fail('Không thể bán nhà lúc này.');
            }
            if (!this.canSellOn(playerId, tileIndex)) {
                return this._fail('Phải bán nhà đều từ lô nhiều nhà nhất.');
            }
            const player = this.getPlayer(playerId);
            const tile = BOARD_TILES[tileIndex];
            const prop = this.state.properties[tileIndex];
            const refund = Math.floor(tile.houseCost / 2);

            prop.houses -= 1;
            player.cash += refund;
            this._addLog(`${player.name} bán 1 nhà tại ${tile.name}, thu về ${formatMoney(refund)}.`, 'cash');
            const evt = this._emitEvent('sell_house', {
                playerId,
                tileIndex,
                cashDeltas: { [playerId]: refund },
                message: `${player.name} bán nhà ở ${tile.name} (+${formatMoney(refund)})`
            });
            this.resolveDebtIfPaid(playerId);
            return this._ok(evt);
        }

        mortgageProperty(playerId, tileIndex) {
            if (!this._isManagementAllowed(playerId)) {
                return this._fail('Không thể thế chấp lúc này.');
            }
            if (!this.canMortgage(playerId, tileIndex)) {
                return this._fail('Không thể thế chấp lô đất này (cần bán hết nhà trong cùng bộ màu trước).');
            }
            const player = this.getPlayer(playerId);
            const tile = BOARD_TILES[tileIndex];
            const prop = this.state.properties[tileIndex];
            const value = Math.floor(tile.price / 2);

            prop.mortgaged = true;
            player.cash += value;
            this._addLog(`${player.name} thế chấp ${tile.name}, nhận ${formatMoney(value)}.`, 'cash');
            const evt = this._emitEvent('mortgage', {
                playerId,
                tileIndex,
                cashDeltas: { [playerId]: value },
                message: `${player.name} thế chấp ${tile.name} (+${formatMoney(value)})`
            });
            this.resolveDebtIfPaid(playerId);
            return this._ok(evt);
        }

        unmortgageProperty(playerId, tileIndex) {
            if (!this._isManagementAllowed(playerId)) {
                return this._fail('Không thể chuộc đất lúc này.');
            }
            if (!this.canUnmortgage(playerId, tileIndex)) {
                return this._fail('Không đủ tiền chuộc hoặc lô đất chưa thế chấp.');
            }
            const player = this.getPlayer(playerId);
            const tile = BOARD_TILES[tileIndex];
            const prop = this.state.properties[tileIndex];
            const cost = this.getUnmortgageCost(tileIndex);

            player.cash -= cost;
            prop.mortgaged = false;
            this._addLog(`${player.name} chuộc lại ${tile.name} với giá ${formatMoney(cost)}.`, 'buy');
            return this._ok(this._emitEvent('unmortgage', {
                playerId,
                tileIndex,
                cashDeltas: { [playerId]: -cost },
                message: `${player.name} chuộc ${tile.name}`
            }));
        }

        resolveDebtIfPaid(playerId) {
            if (this.state.phase !== 'DEBT_RESOLUTION' || !this.state.pendingDebt) {
                return false;
            }
            const debt = this.state.pendingDebt;
            if (debt.debtorId !== playerId) return false;
            const debtor = this.getPlayer(playerId);
            if (!debtor || debtor.cash < debt.amount) return false;

            debtor.cash -= debt.amount;
            const deltas = { [debtor.id]: -debt.amount };

            if (debt.multiCreditorIds && debt.multiCreditorIds.length > 0) {
                for (const cid of debt.multiCreditorIds) {
                    const c = this.getPlayer(cid);
                    if (c && !c.bankrupt) {
                        c.cash += debt.perCreditorAmount;
                        deltas[c.id] = debt.perCreditorAmount;
                    }
                }
            } else if (debt.creditorId) {
                const creditor = this.getPlayer(debt.creditorId);
                if (creditor && !creditor.bankrupt) {
                    creditor.cash += debt.amount;
                    deltas[creditor.id] = debt.amount;
                }
            } else if (debt.addToPot) {
                this.state.freeParkingPot += debt.amount;
            }

            this.state.pendingDebt = null;
            this.state.phase = debt.prevPhase || this._nextPhaseAfterResolution();
            this._addLog(`${debtor.name} đã thanh toán đủ khoản nợ ${formatMoney(debt.amount)}!`, 'cash');
            this._emitEvent('debt_paid', {
                playerId: debtor.id,
                cashDeltas: deltas,
                message: `${debtor.name} đã trả nợ ${formatMoney(debt.amount)}`
            });
            return true;
        }

        declareBankruptcy(playerId) {
            if (this.state.phase !== 'DEBT_RESOLUTION' || !this.state.pendingDebt) {
                return this._fail('Không ở trạng thái giải quyết nợ.');
            }
            const debt = this.state.pendingDebt;
            if (debt.debtorId !== playerId) {
                return this._fail('Không phải khoản nợ của bạn.');
            }
            const debtor = this.getPlayer(playerId);
            const creditor = debt.creditorId ? this.getPlayer(debt.creditorId) : null;

            // Liquidate all houses first
            let houseCash = 0;
            for (const idx of this.getOwnedTileIndices(debtor.id)) {
                const tile = BOARD_TILES[idx];
                const prop = this.state.properties[idx];
                if (tile.type === 'property' && prop.houses > 0) {
                    houseCash += prop.houses * Math.floor(tile.houseCost / 2);
                    prop.houses = 0;
                }
            }
            const totalCash = debtor.cash + houseCash;
            debtor.cash = 0;

            if (creditor && !creditor.bankrupt) {
                creditor.cash += totalCash;
                creditor.jailCards += debtor.jailCards;
                for (const idx of this.getOwnedTileIndices(debtor.id)) {
                    this.state.properties[idx].ownerId = creditor.id;
                }
                this._addLog(`${debtor.name} tuyên bố PHÁ SẢN! Toàn bộ tài sản được chuyển cho ${creditor.name}.`, 'bankrupt');
            } else {
                if (debt.multiCreditorIds && debt.multiCreditorIds.length > 0 && totalCash > 0) {
                    const share = Math.floor(totalCash / debt.multiCreditorIds.length);
                    for (const cid of debt.multiCreditorIds) {
                        const c = this.getPlayer(cid);
                        if (c && !c.bankrupt) c.cash += share;
                    }
                }
                for (const idx of this.getOwnedTileIndices(debtor.id)) {
                    const prop = this.state.properties[idx];
                    prop.ownerId = null;
                    prop.houses = 0;
                    prop.mortgaged = false;
                }
                this._addLog(`${debtor.name} tuyên bố PHÁ SẢN! Đất đai được trả về ngân hàng.`, 'bankrupt');
            }

            debtor.jailCards = 0;
            debtor.bankrupt = true;
            debtor.inJail = false;
            this.state.pendingDebt = null;
            this.state.canRollAgain = false;
            this.state.doublesCount = 0;

            const survivors = this.getActivePlayers();
            if (survivors.length <= 1) {
                this.state.winnerId = survivors[0] ? survivors[0].id : null;
                this.state.phase = 'GAME_OVER';
                if (survivors[0]) {
                    this._addLog(`CHÚC MỪNG ${survivors[0].name} trở thành TỶ PHÚ DUY NHẤT và giành chiến thắng!`, 'win');
                }
                return this._ok(this._emitEvent('game_over', {
                    winnerId: this.state.winnerId,
                    bankruptId: debtor.id,
                    message: `${survivors[0]?.name || ''} chiến thắng!`
                }));
            }

            // Advance turn cleanly to next surviving player
            this._advanceTurnIndex();
            this.state.phase = 'ROLL';
            const nextPlayer = this.getCurrentPlayer();
            this._addLog(`Lượt tiếp theo thuộc về ${nextPlayer.name}.`, 'system');
            return this._ok(this._emitEvent('bankrupt', {
                bankruptId: debtor.id,
                nextPlayerId: nextPlayer.id,
                message: `${debtor.name} đã phá sản!`
            }));
        }

        proposeTrade(playerId, payload) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Chỉ người đang tới lượt mới được đề nghị giao dịch.');
            if (this.state.phase !== 'ROLL' && this.state.phase !== 'END_TURN') {
                return this._fail('Không thể mở giao dịch trong pha hiện tại.');
            }
            const target = this.getPlayer(payload.toId);
            if (!target || target.bankrupt || target.id === playerId) {
                return this._fail('Đối tác giao dịch không hợp lệ.');
            }

            const offerCash = Math.max(0, Math.floor(Number(payload.offerCash) || 0));
            const requestCash = Math.max(0, Math.floor(Number(payload.requestCash) || 0));
            const offerJailCards = Math.max(0, Math.floor(Number(payload.offerJailCards) || 0));
            const requestJailCards = Math.max(0, Math.floor(Number(payload.requestJailCards) || 0));
            const offerProps = Array.isArray(payload.offerProps) ? [...new Set(payload.offerProps.map(Number))] : [];
            const requestProps = Array.isArray(payload.requestProps) ? [...new Set(payload.requestProps.map(Number))] : [];

            const hasAnything = offerCash > 0 || requestCash > 0 || offerJailCards > 0 || requestJailCards > 0 || offerProps.length > 0 || requestProps.length > 0;
            if (!hasAnything) return this._fail('Giao dịch phải có ít nhất một tài sản hoặc tiền mặt.');

            if (current.cash < offerCash || current.jailCards < offerJailCards) {
                return this._fail('Bạn không có đủ tiền mặt hoặc thẻ Miễn Tù để đề nghị.');
            }
            if (target.cash < requestCash || target.jailCards < requestJailCards) {
                return this._fail(`${target.name} không đủ tiền mặt hoặc thẻ Miễn Tù.`);
            }

            for (const idx of offerProps) {
                const prop = this.state.properties[idx];
                const tile = BOARD_TILES[idx];
                if (!prop || prop.ownerId !== current.id) return this._fail(`Bạn không sở hữu ${tile?.name || idx}.`);
                if (tile.type === 'property' && this.groupHasHouses(tile.group)) {
                    return this._fail(`Phải bán hết nhà trong bộ màu của ${tile.name} trước khi giao dịch.`);
                }
            }

            for (const idx of requestProps) {
                const prop = this.state.properties[idx];
                const tile = BOARD_TILES[idx];
                if (!prop || prop.ownerId !== target.id) return this._fail(`${target.name} không sở hữu ${tile?.name || idx}.`);
                if (tile.type === 'property' && this.groupHasHouses(tile.group)) {
                    return this._fail(`Phải bán hết nhà trong bộ màu của ${tile.name} trước khi giao dịch.`);
                }
            }

            this.state.trade = {
                fromId: current.id,
                toId: target.id,
                offerCash,
                offerProps,
                offerJailCards,
                requestCash,
                requestProps,
                requestJailCards,
                returnPhase: this.state.phase
            };
            this.state.phase = 'TRADE_OFFER';
            this._addLog(`${current.name} gửi đề nghị giao dịch tới ${target.name}.`, 'trade');
            return this._ok(this._emitEvent('trade_offer', {
                fromId: current.id,
                toId: target.id,
                message: `${current.name} mời ${target.name} giao dịch`
            }));
        }

        acceptTrade(playerId) {
            if (this.state.phase !== 'TRADE_OFFER' || !this.state.trade) {
                return this._fail('Không có giao dịch nào đang chờ.');
            }
            const t = this.state.trade;
            if (t.toId !== playerId) return this._fail('Chỉ người nhận đề nghị mới có thể chấp nhận.');

            const from = this.getPlayer(t.fromId);
            const to = this.getPlayer(t.toId);
            if (!from || !to || from.cash < t.offerCash || to.cash < t.requestCash) {
                this.state.trade = null;
                this.state.phase = t.returnPhase;
                return this._fail('Giao dịch không còn hợp lệ do thiếu tiền.');
            }

            from.cash = from.cash - t.offerCash + t.requestCash;
            to.cash = to.cash - t.requestCash + t.offerCash;
            from.jailCards = from.jailCards - t.offerJailCards + t.requestJailCards;
            to.jailCards = to.jailCards - t.requestJailCards + t.offerJailCards;

            for (const idx of t.offerProps) {
                this.state.properties[idx].ownerId = to.id;
            }
            for (const idx of t.requestProps) {
                this.state.properties[idx].ownerId = from.id;
            }

            this.state.trade = null;
            this.state.phase = t.returnPhase;
            this._addLog(`${to.name} ĐỒNG Ý giao dịch với ${from.name}!`, 'trade');
            return this._ok(this._emitEvent('trade_accepted', {
                fromId: from.id,
                toId: to.id,
                message: `${to.name} chấp nhận giao dịch!`
            }));
        }

        rejectTrade(playerId) {
            if (this.state.phase !== 'TRADE_OFFER' || !this.state.trade) {
                return this._fail('Không có giao dịch nào đang chờ.');
            }
            const t = this.state.trade;
            if (t.toId !== playerId && t.fromId !== playerId) {
                return this._fail('Bạn không liên quan tới giao dịch này.');
            }
            const actor = this.getPlayer(playerId);
            this.state.trade = null;
            this.state.phase = t.returnPhase;
            this._addLog(`${actor.name} đã từ chối/hủy giao dịch.`, 'trade');
            return this._ok(this._emitEvent('trade_rejected', {
                playerId,
                message: `${actor.name} từ chối giao dịch`
            }));
        }

        _advanceTurnIndex() {
            const n = this.state.players.length;
            for (let step = 1; step <= n; step++) {
                const idx = (this.state.currentPlayerIndex + step) % n;
                if (!this.state.players[idx].bankrupt) {
                    this.state.currentPlayerIndex = idx;
                    this.state.turnNumber += 1;
                    break;
                }
            }
        }

        endTurn(playerId) {
            const current = this.getCurrentPlayer();
            if (!current || current.id !== playerId) return this._fail('Không phải lượt của bạn.');
            if (this.state.phase !== 'END_TURN') return this._fail('Chưa thể kết thúc lượt ngay bây giờ.');

            this.state.doublesCount = 0;
            this.state.canRollAgain = false;
            this._advanceTurnIndex();
            this.state.phase = 'ROLL';
            const nextPlayer = this.getCurrentPlayer();
            this._addLog(`Tới lượt của ${nextPlayer.name}.`, 'system');
            return this._ok(this._emitEvent('turn_change', {
                playerId: nextPlayer.id,
                message: `Lượt của ${nextPlayer.name}`
            }));
        }
    }

    const api = { GameEngine };
    global.CoTyPhu = Object.assign(global.CoTyPhu || {}, api);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
