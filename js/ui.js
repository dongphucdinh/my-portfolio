(function (global) {
    'use strict';

    const { BOARD_TILES, COLOR_GROUPS, formatMoney } = global.CoTyPhu;

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getTileGridPos(index) {
        if (index === 0) return { col: 11, row: 11, side: 'corner', corner: true };
        if (index >= 1 && index <= 9) return { col: 11 - index, row: 11, side: 'bottom', corner: false };
        if (index === 10) return { col: 1, row: 11, side: 'corner', corner: true };
        if (index >= 11 && index <= 19) return { col: 1, row: 21 - index, side: 'left', corner: false };
        if (index === 20) return { col: 1, row: 1, side: 'corner', corner: true };
        if (index >= 21 && index <= 29) return { col: index - 19, row: 1, side: 'top', corner: false };
        if (index === 30) return { col: 11, row: 1, side: 'corner', corner: true };
        return { col: 11, row: index - 29, side: 'right', corner: false };
    }

    class GameUI {
        constructor(sound, handlers) {
            this.sound = sound;
            this.handlers = handlers;
            this.tileEls = new Map();
            this.displayedPositions = {};
            this.lastEventSeq = 0;
            this.hopTimer = null;
            this.activeModal = null; // null | { type, tileIndex?, minimizedPhase? }
            this.minimizedPhaseKey = null;
            this.tradeDraft = null;
            this._buildBoardSkeleton();
            this._initDicePips();
        }

        _initDicePips() {
            for (const id of ['dice-1', 'dice-2']) {
                const el = document.getElementById(id);
                if (!el) continue;
                el.innerHTML = Array.from({ length: 9 }, () => '<span class="pip"></span>').join('');
            }
        }

        _buildBoardSkeleton() {
            const board = document.getElementById('board');
            if (!board) return;
            const center = document.getElementById('board-center');

            for (const tile of BOARD_TILES) {
                const pos = getTileGridPos(tile.index);
                const el = document.createElement('div');
                el.className = `tile ${pos.corner ? 'is-corner' : 'side-' + pos.side}`;
                el.dataset.index = String(tile.index);
                el.style.gridColumn = String(pos.col);
                el.style.gridRow = String(pos.row);

                let colorBarHtml = '';
                if (tile.type === 'property') {
                    const grp = COLOR_GROUPS[tile.group];
                    colorBarHtml = `<div class="tile-color-bar" style="background:${grp.color};color:${grp.textColor}"></div>`;
                }

                const iconHtml = tile.icon ? `<div class="tile-icon">${tile.icon}</div>` : '';
                const priceHtml = tile.price ? `<div class="tile-price">${formatMoney(tile.price)}</div>` :
                    (tile.amount ? `<div class="tile-price">-${formatMoney(tile.amount)}</div>` : '');

                el.innerHTML = `
                    ${colorBarHtml}
                    ${iconHtml}
                    <div class="tile-name">${escapeHtml(tile.shortName || tile.name)}</div>
                    ${priceHtml}
                    <div class="tile-owner-stripe hidden"></div>
                    <div class="tile-mortgage-tag hidden">THẾ CHẤP</div>
                    <div class="tile-tokens"></div>
                `;

                el.addEventListener('click', () => {
                    this.openDeedModal(tile.index);
                });

                board.insertBefore(el, center);
                this.tileEls.set(tile.index, el);
            }
        }

        showToast(msg, isError = false) {
            const container = document.getElementById('toast-container');
            if (!container) return;
            const toast = document.createElement('div');
            toast.className = `toast ${isError ? 'error' : ''}`;
            toast.textContent = msg;
            container.appendChild(toast);
            setTimeout(() => toast.remove(), 3400);
        }

        _spawnFloatDelta(delta) {
            const layer = document.getElementById('float-fx-layer');
            if (!layer || !delta) return;
            const el = document.createElement('div');
            el.className = `float-delta ${delta > 0 ? 'plus' : 'minus'}`;
            el.textContent = `${delta > 0 ? '+' : ''}${formatMoney(delta)}`;
            layer.appendChild(el);
            setTimeout(() => el.remove(), 1400);
        }

        resetVisualTracking(state) {
            if (this.hopTimer) {
                clearTimeout(this.hopTimer);
                this.hopTimer = null;
            }
            this.displayedPositions = {};
            if (state) {
                for (const p of state.players) {
                    this.displayedPositions[p.id] = p.position;
                }
                this.lastEventSeq = state.eventSeq || 0;
            } else {
                this.lastEventSeq = 0;
            }
            this.activeModal = null;
            this.minimizedPhaseKey = null;
            this.tradeDraft = null;
            this.closeModal();
        }

        _getPhaseKey(state) {
            return `${state.turnNumber}_${state.phase}_${state.pendingTile}_${state.pendingCard?.card?.id || ''}_${state.pendingDebt?.amount || ''}_${state.trade?.fromId || ''}`;
        }

        render(engine, ctx) {
            const state = engine.getState();
            if (!state) return;

            this._lastEngine = engine;
            this._lastCtx = ctx;

            const current = engine.getCurrentPlayer();
            const evt = state.lastEvent;
            const isNewEvent = evt && evt.seq > this.lastEventSeq;

            if (isNewEvent) {
                this.lastEventSeq = evt.seq;
                this._handleEventFX(evt, ctx);
            }

            // Animate hops if player moved forward
            const shouldHop = isNewEvent && evt && evt.playerId &&
                typeof evt.fromPos === 'number' && typeof evt.toPos === 'number' &&
                evt.fromPos !== evt.toPos && evt.type !== 'go_to_jail';

            if (this.hopTimer) {
                clearTimeout(this.hopTimer);
                this.hopTimer = null;
            }

            if (shouldHop) {
                this._animateHop(engine, ctx, evt.playerId, evt.fromPos, evt.toPos);
            } else {
                for (const p of state.players) {
                    this.displayedPositions[p.id] = p.position;
                }
                this._renderBoardTiles(engine);
                this._renderPhaseOrCustomModal(engine, ctx);
            }

            this._renderCenter(engine, ctx);
            this._renderPlayers(engine, ctx);
            this._renderLogs(state);
            this._renderUtilityBar(ctx);
        }

        _handleEventFX(evt, ctx) {
            if (evt.dice) {
                for (const id of ['dice-1', 'dice-2']) {
                    const die = document.getElementById(id);
                    if (die) {
                        die.classList.remove('rolling');
                        void die.offsetWidth;
                        die.classList.add('rolling');
                    }
                }
                this.sound.dice();
            }

            if (evt.type === 'buy' || evt.type === 'unmortgage') this.sound.buy();
            else if (evt.type === 'build') this.sound.build();
            else if (evt.type === 'go_to_jail') this.sound.jail();
            else if (evt.type === 'draw_card') this.sound.card();
            else if (evt.type === 'auction_start' || evt.type === 'auction_end') this.sound.auction();
            else if (evt.type === 'game_over') this.sound.win();

            if (evt.cashDeltas) {
                const viewerId = ctx.localPlayerId || evt.playerId;
                const delta = evt.cashDeltas[viewerId] ?? evt.cashDeltas[evt.playerId];
                if (delta) {
                    this._spawnFloatDelta(delta);
                    if (!evt.dice) {
                        if (delta > 0) this.sound.cash();
                        else this.sound.pay();
                    }
                }
            }
        }

        _animateHop(engine, ctx, playerId, fromPos, toPos) {
            const state = engine.getState();
            for (const p of state.players) {
                if (p.id !== playerId) this.displayedPositions[p.id] = p.position;
            }

            const steps = (toPos - fromPos + 40) % 40;
            let currentStep = 0;
            const stepDelay = steps > 12 ? 32 : 70;

            const tick = () => {
                currentStep += 1;
                this.displayedPositions[playerId] = (fromPos + currentStep) % 40;
                this.sound.step();
                this._renderBoardTiles(engine);
                if (currentStep < steps) {
                    this.hopTimer = setTimeout(tick, stepDelay);
                } else {
                    this.hopTimer = null;
                    this._renderPhaseOrCustomModal(engine, ctx);
                }
            };
            this.displayedPositions[playerId] = fromPos;
            this._renderBoardTiles(engine);
            this.hopTimer = setTimeout(tick, 90);
        }

        _renderBoardTiles(engine) {
            const state = engine.getState();
            const current = engine.getCurrentPlayer();
            const activePos = current && !current.bankrupt ? this.displayedPositions[current.id] : -1;

            for (const tile of BOARD_TILES) {
                const el = this.tileEls.get(tile.index);
                if (!el) continue;

                el.classList.toggle('active-landed', tile.index === activePos);

                const prop = state.properties[tile.index];
                const stripe = el.querySelector('.tile-owner-stripe');
                const mortTag = el.querySelector('.tile-mortgage-tag');
                const colorBar = el.querySelector('.tile-color-bar');

                if (prop) {
                    el.classList.toggle('mortgaged', Boolean(prop.mortgaged));
                    if (mortTag) mortTag.classList.toggle('hidden', !prop.mortgaged);
                    if (stripe) {
                        if (prop.ownerId) {
                            const owner = engine.getPlayer(prop.ownerId);
                            stripe.classList.remove('hidden');
                            stripe.style.background = owner ? owner.color : '#fff';
                        } else {
                            stripe.classList.add('hidden');
                        }
                    }
                    if (colorBar) {
                        if (prop.houses === 5) colorBar.textContent = '🏨';
                        else if (prop.houses > 0) colorBar.textContent = '🏠'.repeat(prop.houses);
                        else colorBar.textContent = '';
                    }
                }

                // Tokens on this tile
                const tokensEl = el.querySelector('.tile-tokens');
                if (tokensEl) {
                    const here = state.players.filter(p => !p.bankrupt && this.displayedPositions[p.id] === tile.index);
                    tokensEl.innerHTML = here.map(p => {
                        const isActive = current && current.id === p.id;
                        return `<span class="token-pin ${isActive ? 'is-active' : ''} ${p.inJail ? 'in-jail' : ''}" style="background:${p.color}" title="${escapeHtml(p.name)}">${p.avatar}</span>`;
                    }).join('');
                }
            }
        }

        _renderCenter(engine, ctx) {
            const state = engine.getState();
            const current = engine.getCurrentPlayer();

            const turnBadge = document.getElementById('turn-badge');
            if (turnBadge && current) {
                turnBadge.textContent = `Lượt #${state.turnNumber} • ${current.avatar} ${current.name}`;
            }

            const potPill = document.getElementById('pot-pill') || document.getElementById('free-parking-pill');
            const potAmt = document.getElementById('pot-amount');
            if (potPill && potAmt) {
                const showPot = state.config.freeParkingJackpot || state.freeParkingPot > 0;
                potPill.classList.toggle('hidden', !showPot);
                potAmt.textContent = formatMoney(state.freeParkingPot);
            }

            const d1 = document.getElementById('dice-1');
            const d2 = document.getElementById('dice-2');
            if (d1) d1.dataset.val = String(state.dice[0]);
            if (d2) d2.dataset.val = String(state.dice[1]);

            const ticker = document.getElementById('event-ticker');
            if (ticker) {
                ticker.textContent = state.lastEvent?.message || `Lượt của ${current?.name || ''}`;
            }

            const actionsEl = document.getElementById('center-actions');
            if (!actionsEl || !current) return;

            const canAct = ctx.canAct(current.id);
            const isPhaseModalMinimized = this.minimizedPhaseKey === this._getPhaseKey(state);

            if (state.phase === 'ROLL') {
                if (!canAct) {
                    actionsEl.innerHTML = `<span class="waiting-pill">⏳ Đang chờ ${escapeHtml(current.name)} tung xúc xắc...</span>`;
                } else if (current.inJail) {
                    const bail = state.config.jailBail;
                    actionsEl.innerHTML = `
                        <button type="button" class="btn btn-primary" data-act="ROLL_DICE">🎲 Tung đôi ra tù (${current.jailTurns}/3)</button>
                        <button type="button" class="btn btn-accent btn-sm" data-act="PAY_JAIL_BAIL" ${current.cash < bail ? 'disabled' : ''}>💵 Nộp ${formatMoney(bail)}</button>
                        ${current.jailCards > 0 ? '<button type="button" class="btn btn-secondary btn-sm" data-act="USE_JAIL_CARD">🎟️ Dùng thẻ Miễn Tù</button>' : ''}
                    `;
                } else {
                    const label = state.canRollAgain ? '🎲 Tung tiếp (Được đôi!)' : '🎲 Tung Xúc Xắc';
                    actionsEl.innerHTML = `<button type="button" id="btn-roll" class="btn btn-primary btn-lg" data-act="ROLL_DICE">${label}</button>`;
                }
            } else if (state.phase === 'END_TURN') {
                if (canAct) {
                    actionsEl.innerHTML = `<button type="button" id="btn-end-turn" class="btn btn-accent btn-lg" data-act="END_TURN">⏭️ Kết Thúc Lượt</button>`;
                } else {
                    actionsEl.innerHTML = `<span class="waiting-pill">⏳ ${escapeHtml(current.name)} đang hoàn tất lượt...</span>`;
                }
            } else if (isPhaseModalMinimized && ['BUY_DECISION', 'AUCTION', 'CARD_MODAL', 'DEBT_RESOLUTION', 'TRADE_OFFER'].includes(state.phase)) {
                actionsEl.innerHTML = `<button type="button" id="btn-reopen-phase" class="btn btn-primary">📋 Mở lại bảng lựa chọn</button>`;
            } else {
                actionsEl.innerHTML = `<span class="waiting-pill">📌 Đang xử lý: ${this._phaseLabel(state.phase)}</span>`;
            }

            actionsEl.querySelectorAll('[data-act]').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.handlers.onAction({ type: btn.dataset.act });
                });
            });

            const reopenBtn = document.getElementById('btn-reopen-phase');
            if (reopenBtn) {
                reopenBtn.addEventListener('click', () => {
                    this.minimizedPhaseKey = null;
                    this._renderPhaseOrCustomModal(engine, ctx);
                });
            }
        }

        _phaseLabel(phase) {
            switch (phase) {
                case 'BUY_DECISION': return 'Quyết định mua đất';
                case 'AUCTION': return 'Đấu giá công khai';
                case 'CARD_MODAL': return 'Rút thẻ sự kiện';
                case 'DEBT_RESOLUTION': return 'Thanh toán nợ';
                case 'TRADE_OFFER': return 'Đề nghị giao dịch';
                case 'GAME_OVER': return 'Kết thúc ván đấu';
                default: return phase;
            }
        }

        _renderPlayers(engine, ctx) {
            const list = document.getElementById('players-list');
            if (!list) return;
            const state = engine.getState();
            const current = engine.getCurrentPlayer();

            list.innerHTML = state.players.map(p => {
                const isActive = current && current.id === p.id && !p.bankrupt;
                const isLocal = ctx.mode !== 'local' && ctx.localPlayerId === p.id;
                const owned = engine.getOwnedTileIndices(p.id);
                const worth = engine.getNetWorth(p.id);

                const badges = [];
                if (isLocal) badges.push('<span class="badge badge-you">Bạn</span>');
                if (p.isBot) badges.push('<span class="badge badge-bot">Bot AI</span>');
                if (!p.connected) badges.push('<span class="badge badge-jail">Mất kết nối</span>');
                if (p.inJail) badges.push('<span class="badge badge-jail">Trong tù</span>');
                if (p.jailCards > 0) badges.push(`<span class="badge">🎟️×${p.jailCards}</span>`);
                if (p.bankrupt) badges.push('<span class="badge badge-jail">Phá sản</span>');

                const swatches = owned.map(idx => {
                    const tile = BOARD_TILES[idx];
                    const prop = state.properties[idx];
                    const col = tile.group ? COLOR_GROUPS[tile.group].color : (tile.type === 'station' ? '#334155' : '#0284c7');
                    return `<span class="swatch-dot ${prop.mortgaged ? 'mort' : ''}" style="background:${col}" title="${escapeHtml(tile.name)}"></span>`;
                }).join('');

                return `
                    <div class="player-hud ${isActive ? 'active' : ''} ${p.bankrupt ? 'bankrupt' : ''}">
                        <div class="hud-row">
                            <div class="hud-identity">
                                <div class="hud-avatar" style="background:${p.color}">${p.avatar}</div>
                                <div class="hud-name-wrap">
                                    <div class="hud-name">${escapeHtml(p.name)}</div>
                                    <div class="hud-badges">${badges.join('')}</div>
                                </div>
                            </div>
                            <div class="hud-money">
                                <div class="hud-cash">${formatMoney(p.cash)}</div>
                                <div class="hud-worth">TS: ${formatMoney(worth)}</div>
                            </div>
                        </div>
                        ${swatches ? `<div class="hud-swatches">${swatches}</div>` : ''}
                    </div>
                `;
            }).join('');

            // Enable/disable Manage and Trade shortcuts
            const manageBtn = document.getElementById('btn-open-manage');
            const tradeBtn = document.getElementById('btn-open-trade');
            const canManage = current && ctx.canAct(current.id) &&
                (state.phase === 'ROLL' || state.phase === 'END_TURN' || state.phase === 'DEBT_RESOLUTION');
            const canTrade = current && ctx.canAct(current.id) &&
                (state.phase === 'ROLL' || state.phase === 'END_TURN') &&
                engine.getActivePlayers().length >= 2;
            if (manageBtn) manageBtn.disabled = !canManage;
            if (tradeBtn) tradeBtn.disabled = !canTrade;
        }

        _renderLogs(state) {
            const logEl = document.getElementById('game-log');
            if (!logEl) return;
            logEl.innerHTML = state.logs.map(item => `
                <div class="log-item ${escapeHtml(item.kind || 'info')}">
                    <strong>[L${item.turn}]</strong> ${escapeHtml(item.text)}
                </div>
            `).join('');
        }

        _renderUtilityBar(ctx) {
            const chip = document.getElementById('online-room-chip');
            const chatPanel = document.getElementById('chat-panel');
            const isOnline = ctx.mode === 'online-host' || ctx.mode === 'online-client';
            if (chip) {
                chip.classList.toggle('hidden', !isOnline || !ctx.roomCode);
                if (ctx.roomCode) chip.textContent = `🌐 Phòng: ${ctx.roomCode}`;
            }
            if (chatPanel) {
                chatPanel.classList.toggle('hidden', !isOnline);
            }
        }

        appendChatMessage(msg) {
            const box = document.getElementById('chat-messages');
            if (!box) return;
            const row = document.createElement('div');
            row.className = 'chat-msg';
            row.innerHTML = `<strong style="color:${escapeHtml(msg.senderColor || '#34d399')}">${escapeHtml(msg.senderAvatar || '')} ${escapeHtml(msg.senderName)}:</strong> ${escapeHtml(msg.text)}`;
            box.appendChild(row);
            box.scrollTop = box.scrollHeight;
        }

        clearChat() {
            const box = document.getElementById('chat-messages');
            if (box) box.innerHTML = '';
        }

        _renderPhaseOrCustomModal(engine, ctx) {
            const state = engine.getState();
            const phaseKey = this._getPhaseKey(state);

            if (this.activeModal && this.activeModal.type === 'deed') {
                this._renderDeedModal(engine, ctx, this.activeModal.tileIndex);
                return;
            }
            if (this.activeModal && this.activeModal.type === 'manage') {
                this._renderManageModal(engine, ctx);
                return;
            }
            if (this.activeModal && this.activeModal.type === 'trade') {
                this._renderTradeModal(engine, ctx);
                return;
            }
            if (this.activeModal && (this.activeModal.type === 'rules' || this.activeModal.type === 'confirm_exit')) {
                return;
            }

            if (this.minimizedPhaseKey === phaseKey) {
                this.closeModal();
                return;
            }

            switch (state.phase) {
                case 'BUY_DECISION':
                    this._renderBuyModal(engine, ctx);
                    break;
                case 'AUCTION':
                    this._renderAuctionModal(engine, ctx);
                    break;
                case 'CARD_MODAL':
                    this._renderCardModal(engine, ctx);
                    break;
                case 'DEBT_RESOLUTION':
                    this._renderDebtModal(engine, ctx);
                    break;
                case 'TRADE_OFFER':
                    this._renderTradeOfferModal(engine, ctx);
                    break;
                case 'GAME_OVER':
                    this._renderVictoryModal(engine);
                    break;
                default:
                    this.closeModal();
                    break;
            }
        }

        _openModalHtml(html, wide = false) {
            const root = document.getElementById('modal-root');
            if (!root) return;
            root.innerHTML = `<div class="modal-card ${wide ? 'wide' : ''}">${html}</div>`;
            root.classList.remove('hidden');
        }

        closeModal() {
            const root = document.getElementById('modal-root');
            if (!root) return;
            root.classList.add('hidden');
            root.innerHTML = '';
            this.activeModal = null;
        }

        _minimizePhaseModal(state) {
            this.minimizedPhaseKey = this._getPhaseKey(state);
            this.closeModal();
            this._renderCenter(this._lastEngine, this._lastCtx);
        }

        _buildDeedTableHtml(tile) {
            if (tile.type === 'property') {
                return `
                    <table class="deed-table">
                        <tr><td>Giá mua đất</td><td>${formatMoney(tile.price)}</td></tr>
                        <tr><td>Tiền thuê cơ bản (×2 nếu đủ bộ màu)</td><td>${formatMoney(tile.rent[0])}</td></tr>
                        <tr><td>Có 1 Nhà 🏠</td><td>${formatMoney(tile.rent[1])}</td></tr>
                        <tr><td>Có 2 Nhà 🏠🏠</td><td>${formatMoney(tile.rent[2])}</td></tr>
                        <tr><td>Có 3 Nhà 🏠🏠🏠</td><td>${formatMoney(tile.rent[3])}</td></tr>
                        <tr><td>Có 4 Nhà 🏠🏠🏠🏠</td><td>${formatMoney(tile.rent[4])}</td></tr>
                        <tr><td>Có Khách Sạn 🏨</td><td>${formatMoney(tile.rent[5])}</td></tr>
                        <tr><td>Chi phí xây 1 Nhà / Khách sạn</td><td>${formatMoney(tile.houseCost)}</td></tr>
                        <tr><td>Giá trị thế chấp</td><td>${formatMoney(Math.floor(tile.price / 2))}</td></tr>
                    </table>
                `;
            }
            if (tile.type === 'station') {
                return `
                    <table class="deed-table">
                        <tr><td>Giá mua Nhà Ga</td><td>${formatMoney(tile.price)}</td></tr>
                        <tr><td>Sở hữu 1 Nhà Ga</td><td>25k</td></tr>
                        <tr><td>Sở hữu 2 Nhà Ga</td><td>50k</td></tr>
                        <tr><td>Sở hữu 3 Nhà Ga</td><td>100k</td></tr>
                        <tr><td>Sở hữu 4 Nhà Ga</td><td>200k</td></tr>
                        <tr><td>Giá trị thế chấp</td><td>${formatMoney(Math.floor(tile.price / 2))}</td></tr>
                    </table>
                `;
            }
            if (tile.type === 'utility') {
                return `
                    <table class="deed-table">
                        <tr><td>Giá mua Công Ty</td><td>${formatMoney(tile.price)}</td></tr>
                        <tr><td>Sở hữu 1 Công Ty</td><td>4 × tổng xúc xắc</td></tr>
                        <tr><td>Sở hữu 2 Công Ty</td><td>10 × tổng xúc xắc</td></tr>
                        <tr><td>Giá trị thế chấp</td><td>${formatMoney(Math.floor(tile.price / 2))}</td></tr>
                    </table>
                `;
            }
            return `<p class="muted-text">${escapeHtml(tile.description || tile.name)}</p>`;
        }

        _getDeedHeaderStyle(tile) {
            if (tile.type === 'property') {
                const grp = COLOR_GROUPS[tile.group];
                return `background:${grp.color};color:${grp.textColor}`;
            }
            if (tile.type === 'station') return 'background:#1e293b;color:#f8fafc';
            if (tile.type === 'utility') return 'background:#0369a1;color:#f0f9ff';
            return 'background:#065f46;color:#ecfdf5';
        }

        openDeedModal(tileIndex) {
            if (!this._lastEngine) return;
            this.activeModal = { type: 'deed', tileIndex };
            this._renderDeedModal(this._lastEngine, this._lastCtx, tileIndex);
        }

        _renderDeedModal(engine, ctx, tileIndex) {
            const tile = BOARD_TILES[tileIndex];
            const state = engine.getState();
            const prop = state.properties[tileIndex];
            const owner = prop?.ownerId ? engine.getPlayer(prop.ownerId) : null;
            const current = engine.getCurrentPlayer();
            const canManage = owner && current && owner.id === current.id && ctx.canAct(owner.id) &&
                (state.phase === 'ROLL' || state.phase === 'END_TURN' || state.phase === 'DEBT_RESOLUTION');

            let ownerStatus = '';
            if (prop) {
                ownerStatus = owner
                    ? `<p style="margin-bottom:10px">Chủ sở hữu: <strong style="color:${owner.color}">${owner.avatar} ${escapeHtml(owner.name)}</strong> ${prop.mortgaged ? '(Đang thế chấp)' : ''}</p>`
                    : `<p style="margin-bottom:10px" class="muted-text">Trạng thái: Chưa có chủ sở hữu</p>`;
            }

            let quickBtns = '';
            if (canManage) {
                const buildOk = engine.canBuildOn(owner.id, tileIndex);
                const sellOk = engine.canSellOn(owner.id, tileIndex);
                const mortOk = engine.canMortgage(owner.id, tileIndex);
                const unmortOk = engine.canUnmortgage(owner.id, tileIndex);
                quickBtns = `
                    <div class="modal-actions" style="justify-content:flex-start;margin-bottom:8px">
                        ${tile.type === 'property' ? `<button type="button" class="btn btn-primary btn-sm" data-mact="BUILD_HOUSE" ${buildOk ? '' : 'disabled'}>🏠 Xây nhà (-${formatMoney(tile.houseCost)})</button>` : ''}
                        ${tile.type === 'property' && prop.houses > 0 ? `<button type="button" class="btn btn-secondary btn-sm" data-mact="SELL_HOUSE" ${sellOk ? '' : 'disabled'}>Bán nhà (+${formatMoney(Math.floor(tile.houseCost / 2))})</button>` : ''}
                        ${!prop.mortgaged ? `<button type="button" class="btn btn-accent btn-sm" data-mact="MORTGAGE" ${mortOk ? '' : 'disabled'}>Thế chấp (+${formatMoney(Math.floor(tile.price / 2))})</button>` : ''}
                        ${prop.mortgaged ? `<button type="button" class="btn btn-primary btn-sm" data-mact="UNMORTGAGE" ${unmortOk ? '' : 'disabled'}>Chuộc lại (-${formatMoney(engine.getUnmortgageCost(tileIndex))})</button>` : ''}
                    </div>
                `;
            }

            this._openModalHtml(`
                <div class="modal-header">
                    <h3>📜 Thông tin ô bàn cờ (#${tile.index})</h3>
                    <button type="button" class="btn btn-ghost btn-xs" id="modal-close-btn">✕ Đóng</button>
                </div>
                <div class="deed-banner" style="${this._getDeedHeaderStyle(tile)}">
                    <h4>${tile.icon ? tile.icon + ' ' : ''}${escapeHtml(tile.name)}</h4>
                </div>
                ${ownerStatus}
                ${this._buildDeedTableHtml(tile)}
                ${quickBtns}
            `);

            document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
            document.querySelectorAll('[data-mact]').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.handlers.onAction({ type: btn.dataset.mact, tileIndex });
                });
            });
        }

        _renderBuyModal(engine, ctx) {
            const state = engine.getState();
            const tile = BOARD_TILES[state.pendingTile];
            const current = engine.getCurrentPlayer();
            if (!tile || !current) return;
            const canAct = ctx.canAct(current.id);
            const canAfford = current.cash >= tile.price;

            this._openModalHtml(`
                <div class="modal-header">
                    <h3>🏷️ Cơ hội mua bất động sản</h3>
                    <button type="button" class="btn btn-ghost btn-xs" id="modal-minimize-btn">👀 Xem bàn cờ</button>
                </div>
                <div class="deed-banner" style="${this._getDeedHeaderStyle(tile)}">
                    <h4>${tile.icon ? tile.icon + ' ' : ''}${escapeHtml(tile.name)}</h4>
                </div>
                ${this._buildDeedTableHtml(tile)}
                <p><strong>${escapeHtml(current.name)}</strong> đang có <strong>${formatMoney(current.cash)}</strong>.</p>
                <div class="modal-actions">
                    ${canAct ? `
                        <button type="button" class="btn btn-secondary" data-act="START_AUCTION">🔨 Đưa ra Đấu Giá</button>
                        <button type="button" class="btn btn-primary" data-act="BUY_PROPERTY" ${canAfford ? '' : 'disabled'}>✅ Mua ngay (${formatMoney(tile.price)})</button>
                    ` : `<span class="waiting-pill">⏳ Đang chờ ${escapeHtml(current.name)} quyết định...</span>`}
                </div>
            `);

            document.getElementById('modal-minimize-btn')?.addEventListener('click', () => this._minimizePhaseModal(state));
            document.querySelectorAll('[data-act]').forEach(btn => {
                btn.addEventListener('click', () => this.handlers.onAction({ type: btn.dataset.act }));
            });
        }

        _renderAuctionModal(engine, ctx) {
            const state = engine.getState();
            const auc = state.auction;
            if (!auc) return;
            const tile = BOARD_TILES[auc.tileIndex];
            const activeId = engine.getAuctionActiveBidderId();
            const activeBidder = engine.getPlayer(activeId);
            const highestBidder = auc.highestBidderId ? engine.getPlayer(auc.highestBidderId) : null;
            const canAct = activeBidder && ctx.canAct(activeBidder.id);

            const minBid = auc.highestBid === 0 ? 10 : auc.highestBid + 10;

            this._openModalHtml(`
                <div class="modal-header">
                    <h3>🔨 Đấu giá công khai</h3>
                    <button type="button" class="btn btn-ghost btn-xs" id="modal-minimize-btn">👀 Xem bàn cờ</button>
                </div>
                <div class="deed-banner" style="${this._getDeedHeaderStyle(tile)}">
                    <h4>${escapeHtml(tile.name)} (Giá gốc: ${formatMoney(tile.price)})</h4>
                </div>
                <div style="background:rgba(0,0,0,0.28);padding:12px;border-radius:12px;margin-bottom:12px;text-align:center">
                    <div class="muted-text">Giá cao nhất hiện tại</div>
                    <div style="font-size:28px;font-weight:800;color:#fbbf24">${formatMoney(auc.highestBid)}</div>
                    <div>${highestBidder ? `Người giữ giá: <strong>${highestBidder.avatar} ${escapeHtml(highestBidder.name)}</strong>` : 'Chưa có ai trả giá'}</div>
                </div>
                <p style="margin-bottom:10px">Lượt trả giá: <strong style="color:${activeBidder?.color || '#fff'}">${activeBidder?.avatar} ${escapeHtml(activeBidder?.name || '')}</strong> (Tiền mặt: ${formatMoney(activeBidder?.cash || 0)})</p>
                <div class="modal-actions">
                    ${canAct ? `
                        <button type="button" class="btn btn-danger btn-sm" data-auc="pass">Bỏ qua</button>
                        <button type="button" class="btn btn-primary btn-sm" data-auc="${minBid}" ${activeBidder.cash < minBid ? 'disabled' : ''}>Trả ${formatMoney(minBid)}</button>
                        <button type="button" class="btn btn-primary btn-sm" data-auc="${auc.highestBid + 50}" ${activeBidder.cash < auc.highestBid + 50 ? 'disabled' : ''}>+${formatMoney(50)} (${formatMoney(auc.highestBid + 50)})</button>
                        <button type="button" class="btn btn-accent btn-sm" data-auc="${auc.highestBid + 100}" ${activeBidder.cash < auc.highestBid + 100 ? 'disabled' : ''}>+${formatMoney(100)} (${formatMoney(auc.highestBid + 100)})</button>
                    ` : `<span class="waiting-pill">⏳ Đang chờ ${escapeHtml(activeBidder?.name || '')} trả giá...</span>`}
                </div>
            `);

            document.getElementById('modal-minimize-btn')?.addEventListener('click', () => this._minimizePhaseModal(state));
            document.querySelectorAll('[data-auc]').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (btn.dataset.auc === 'pass') this.handlers.onAction({ type: 'AUCTION_PASS' });
                    else this.handlers.onAction({ type: 'AUCTION_BID', amount: Number(btn.dataset.auc) });
                });
            });
        }

        _renderCardModal(engine, ctx) {
            const state = engine.getState();
            const pending = state.pendingCard;
            const current = engine.getCurrentPlayer();
            if (!pending || !current) return;
            const canAct = ctx.canAct(current.id);
            const isChance = pending.deck === 'chance';

            this._openModalHtml(`
                <div class="modal-header">
                    <h3>${isChance ? '❓ Thẻ Cơ Hội' : '🎁 Thẻ Khí Vận'}</h3>
                </div>
                <div class="card-draw-box ${isChance ? 'chance' : 'chest'}">
                    <div class="card-emoji">${isChance ? '❓' : '🎁'}</div>
                    <h4>${escapeHtml(pending.card.title)}</h4>
                    <p>${escapeHtml(pending.card.text)}</p>
                </div>
                <div class="modal-actions">
                    ${canAct
                        ? `<button type="button" class="btn btn-primary btn-block" id="btn-confirm-card">Xác nhận &amp; Thực hiện</button>`
                        : `<span class="waiting-pill">⏳ Đang chờ ${escapeHtml(current.name)} xác nhận...</span>`}
                </div>
            `);

            document.getElementById('btn-confirm-card')?.addEventListener('click', () => {
                this.handlers.onAction({ type: 'CONFIRM_CARD' });
            });
        }

        _renderDebtModal(engine, ctx) {
            const state = engine.getState();
            const debt = state.pendingDebt;
            if (!debt) return;
            const debtor = engine.getPlayer(debt.debtorId);
            const canAct = debtor && ctx.canAct(debtor.id);
            const shortage = Math.max(0, debt.amount - debtor.cash);

            this._openModalHtml(`
                <div class="modal-header">
                    <h3>⚠️ Thanh toán khoản nợ</h3>
                    <button type="button" class="btn btn-ghost btn-xs" id="modal-minimize-btn">👀 Xem bàn cờ</button>
                </div>
                <p style="margin-bottom:8px"><strong>${escapeHtml(debtor.name)}</strong> cần thanh toán <strong>${formatMoney(debt.amount)}</strong> (${escapeHtml(debt.reason)}).</p>
                <p style="margin-bottom:14px">Tiền mặt hiện có: <strong>${formatMoney(debtor.cash)}</strong> • Còn thiếu: <strong style="color:#f87171">${formatMoney(shortage)}</strong></p>
                <div class="modal-actions">
                    ${canAct ? `
                        <button type="button" class="btn btn-secondary" id="btn-debt-manage">🏘️ Bán nhà / Thế chấp đất</button>
                        ${shortage === 0 ? `<button type="button" class="btn btn-primary" id="btn-debt-pay">✅ Trả nợ ngay</button>` : ''}
                        <button type="button" class="btn btn-danger" id="btn-debt-bankrupt">🏳️ Tuyên bố Phá Sản</button>
                    ` : `<span class="waiting-pill">⏳ Đang chờ ${escapeHtml(debtor.name)} xoay tiền...</span>`}
                </div>
            `);

            document.getElementById('modal-minimize-btn')?.addEventListener('click', () => this._minimizePhaseModal(state));
            document.getElementById('btn-debt-manage')?.addEventListener('click', () => this.openManageModal());
            document.getElementById('btn-debt-pay')?.addEventListener('click', () => this.handlers.onAction({ type: 'RESOLVE_DEBT' }));
            document.getElementById('btn-debt-bankrupt')?.addEventListener('click', () => this.handlers.onAction({ type: 'DECLARE_BANKRUPTCY' }));
        }

        openManageModal() {
            if (!this._lastEngine) return;
            this.activeModal = { type: 'manage' };
            this._renderManageModal(this._lastEngine, this._lastCtx);
        }

        _renderManageModal(engine, ctx) {
            const state = engine.getState();
            const player = engine.getCurrentPlayer();
            if (!player || !ctx.canAct(player.id)) {
                this.closeModal();
                return;
            }
            const owned = engine.getOwnedTileIndices(player.id);
            const groupedHtml = [];

            const renderTileRow = (idx) => {
                const tile = BOARD_TILES[idx];
                const prop = state.properties[idx];
                const canB = engine.canBuildOn(player.id, idx);
                const canS = engine.canSellOn(player.id, idx);
                const canM = engine.canMortgage(player.id, idx);
                const canU = engine.canUnmortgage(player.id, idx);
                const houseLabel = prop.houses === 5 ? '🏨' : (prop.houses > 0 ? '🏠'.repeat(prop.houses) : '');
                return `
                    <div class="manage-item">
                        <div>
                            <strong>${escapeHtml(tile.name)}</strong> ${houseLabel}
                            ${prop.mortgaged ? '<span class="badge badge-jail">Thế chấp</span>' : ''}
                        </div>
                        <div class="manage-btns">
                            ${tile.type === 'property' ? `<button type="button" class="btn btn-primary btn-xs" data-mg="BUILD_HOUSE" data-idx="${idx}" ${canB ? '' : 'disabled'}>+Nhà (${formatMoney(tile.houseCost)})</button>` : ''}
                            ${tile.type === 'property' && prop.houses > 0 ? `<button type="button" class="btn btn-secondary btn-xs" data-mg="SELL_HOUSE" data-idx="${idx}" ${canS ? '' : 'disabled'}>-Nhà (+${formatMoney(Math.floor(tile.houseCost / 2))})</button>` : ''}
                            ${!prop.mortgaged ? `<button type="button" class="btn btn-accent btn-xs" data-mg="MORTGAGE" data-idx="${idx}" ${canM ? '' : 'disabled'}>Thế chấp (+${formatMoney(Math.floor(tile.price / 2))})</button>` : ''}
                            ${prop.mortgaged ? `<button type="button" class="btn btn-primary btn-xs" data-mg="UNMORTGAGE" data-idx="${idx}" ${canU ? '' : 'disabled'}>Chuộc (-${formatMoney(engine.getUnmortgageCost(idx))})</button>` : ''}
                        </div>
                    </div>
                `;
            };

            for (const grp of Object.values(COLOR_GROUPS)) {
                const mine = grp.tiles.filter(i => state.properties[i].ownerId === player.id);
                if (mine.length === 0) continue;
                const full = engine.ownsColorGroup(player.id, grp.id);
                groupedHtml.push(`
                    <div class="manage-group">
                        <span class="manage-group-title" style="background:${grp.color};color:${grp.textColor}">
                            ${escapeHtml(grp.name)} ${full ? '★ Đủ bộ' : `(${mine.length}/${grp.tiles.length})`}
                        </span>
                        ${mine.map(renderTileRow).join('')}
                    </div>
                `);
            }

            const specials = owned.filter(i => BOARD_TILES[i].type !== 'property');
            if (specials.length > 0) {
                groupedHtml.push(`
                    <div class="manage-group">
                        <span class="manage-group-title" style="background:#334155;color:#fff">Nhà Ga &amp; Công Ty Dịch Vụ</span>
                        ${specials.map(renderTileRow).join('')}
                    </div>
                `);
            }

            this._openModalHtml(`
                <div class="modal-header">
                    <h3>🏘️ Quản lý Tài Sản — ${formatMoney(player.cash)}</h3>
                    <button type="button" class="btn btn-ghost btn-xs" id="modal-close-btn">✕ Đóng</button>
                </div>
                ${groupedHtml.length > 0 ? groupedHtml.join('') : '<p class="muted-text">Bạn chưa sở hữu bất động sản nào.</p>'}
            `, true);

            document.getElementById('modal-close-btn')?.addEventListener('click', () => {
                this.closeModal();
                this._renderPhaseOrCustomModal(engine, ctx);
            });
            document.querySelectorAll('[data-mg]').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.handlers.onAction({ type: btn.dataset.mg, tileIndex: Number(btn.dataset.idx) });
                });
            });
        }

        openTradeModal() {
            if (!this._lastEngine) return;
            const engine = this._lastEngine;
            const current = engine.getCurrentPlayer();
            const partners = engine.getActivePlayers().filter(p => p.id !== current.id);
            if (partners.length === 0) return;

            this.tradeDraft = {
                toId: partners[0].id,
                offerCash: 0,
                requestCash: 0,
                offerProps: [],
                requestProps: [],
                offerJailCards: 0,
                requestJailCards: 0
            };
            this.activeModal = { type: 'trade' };
            this._renderTradeModal(engine, this._lastCtx);
        }

        _renderTradeModal(engine, ctx) {
            const current = engine.getCurrentPlayer();
            const partners = engine.getActivePlayers().filter(p => p.id !== current.id);
            if (!current || partners.length === 0 || !ctx.canAct(current.id)) {
                this.closeModal();
                return;
            }
            if (!this.tradeDraft || !partners.some(p => p.id === this.tradeDraft.toId)) {
                this.tradeDraft = {
                    toId: partners[0].id,
                    offerCash: 0,
                    requestCash: 0,
                    offerProps: [],
                    requestProps: [],
                    offerJailCards: 0,
                    requestJailCards: 0
                };
            }
            const target = engine.getPlayer(this.tradeDraft.toId);

            const buildPropChecks = (ownerId, selectedArr, side) => {
                const indices = engine.getOwnedTileIndices(ownerId);
                if (indices.length === 0) return '<p class="muted-text">Không có đất.</p>';
                return indices.map(idx => {
                    const tile = BOARD_TILES[idx];
                    const hasBuilt = tile.type === 'property' && engine.groupHasHouses(tile.group);
                    const checked = selectedArr.includes(idx) ? 'checked' : '';
                    return `
                        <label class="trade-prop-check ${hasBuilt ? 'disabled' : ''}">
                            <input type="checkbox" data-trside="${side}" value="${idx}" ${checked} ${hasBuilt ? 'disabled' : ''}>
                            <span>${escapeHtml(tile.name)} (${formatMoney(tile.price)})${hasBuilt ? ' [Có nhà]' : ''}</span>
                        </label>
                    `;
                }).join('');
            };

            this._openModalHtml(`
                <div class="modal-header">
                    <h3>🤝 Đề nghị Giao Dịch</h3>
                    <button type="button" class="btn btn-ghost btn-xs" id="modal-close-btn">✕ Đóng</button>
                </div>
                <label class="field-stack" style="margin-bottom:12px">
                    <span>Chọn người giao dịch cùng</span>
                    <select id="trade-partner-select">
                        ${partners.map(p => `<option value="${p.id}" ${p.id === target.id ? 'selected' : ''}>${p.avatar} ${escapeHtml(p.name)} (${formatMoney(p.cash)})</option>`).join('')}
                    </select>
                </label>
                <div class="trade-grid">
                    <div class="trade-col">
                        <strong>Bạn đưa (${formatMoney(current.cash)})</strong>
                        <label class="field-stack">
                            <span>Tiền mặt (k)</span>
                            <input type="number" id="trade-offer-cash" min="0" max="${current.cash}" step="10" value="${this.tradeDraft.offerCash}">
                        </label>
                        ${current.jailCards > 0 ? `
                            <label class="field-stack">
                                <span>Thẻ Miễn Tù (có ${current.jailCards})</span>
                                <input type="number" id="trade-offer-jail" min="0" max="${current.jailCards}" value="${this.tradeDraft.offerJailCards}">
                            </label>` : ''}
                        <div class="trade-props-list">${buildPropChecks(current.id, this.tradeDraft.offerProps, 'offer')}</div>
                    </div>
                    <div class="trade-col">
                        <strong>Bạn nhận từ ${escapeHtml(target.name)}</strong>
                        <label class="field-stack">
                            <span>Tiền mặt (k)</span>
                            <input type="number" id="trade-req-cash" min="0" max="${target.cash}" step="10" value="${this.tradeDraft.requestCash}">
                        </label>
                        ${target.jailCards > 0 ? `
                            <label class="field-stack">
                                <span>Thẻ Miễn Tù (có ${target.jailCards})</span>
                                <input type="number" id="trade-req-jail" min="0" max="${target.jailCards}" value="${this.tradeDraft.requestJailCards}">
                            </label>` : ''}
                        <div class="trade-props-list">${buildPropChecks(target.id, this.tradeDraft.requestProps, 'req')}</div>
                    </div>
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" id="btn-trade-cancel">Hủy</button>
                    <button type="button" class="btn btn-primary" id="btn-trade-send">📨 Gửi đề nghị</button>
                </div>
            `, true);

            const syncDraftInputs = () => {
                this.tradeDraft.offerCash = Math.max(0, Number(document.getElementById('trade-offer-cash')?.value || 0));
                this.tradeDraft.requestCash = Math.max(0, Number(document.getElementById('trade-req-cash')?.value || 0));
                this.tradeDraft.offerJailCards = Math.max(0, Number(document.getElementById('trade-offer-jail')?.value || 0));
                this.tradeDraft.requestJailCards = Math.max(0, Number(document.getElementById('trade-req-jail')?.value || 0));
                this.tradeDraft.offerProps = [...document.querySelectorAll('[data-trside="offer"]:checked')].map(c => Number(c.value));
                this.tradeDraft.requestProps = [...document.querySelectorAll('[data-trside="req"]:checked')].map(c => Number(c.value));
            };

            document.getElementById('trade-partner-select')?.addEventListener('change', (e) => {
                syncDraftInputs();
                this.tradeDraft.toId = e.target.value;
                this.tradeDraft.requestProps = [];
                this.tradeDraft.requestCash = 0;
                this.tradeDraft.requestJailCards = 0;
                this._renderTradeModal(engine, ctx);
            });

            document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
            document.getElementById('btn-trade-cancel')?.addEventListener('click', () => this.closeModal());
            document.getElementById('btn-trade-send')?.addEventListener('click', () => {
                syncDraftInputs();
                const payload = Object.assign({}, this.tradeDraft);
                this.closeModal();
                this.handlers.onAction({ type: 'PROPOSE_TRADE', payload });
            });
        }

        _renderTradeOfferModal(engine, ctx) {
            const state = engine.getState();
            const t = state.trade;
            if (!t) return;
            const from = engine.getPlayer(t.fromId);
            const to = engine.getPlayer(t.toId);
            const canDecide = ctx.canAct(to.id);
            const canCancel = ctx.canAct(from.id);

            const formatBundle = (cash, props, jailCards) => {
                const items = [];
                if (cash > 0) items.push(`💵 ${formatMoney(cash)}`);
                if (jailCards > 0) items.push(`🎟️ ${jailCards} Thẻ Miễn Tù`);
                for (const idx of props) items.push(`📍 ${BOARD_TILES[idx].name}`);
                return items.length ? items.map(i => `<div>${escapeHtml(i)}</div>`).join('') : '<div class="muted-text">Không có gì</div>';
            };

            this._openModalHtml(`
                <div class="modal-header">
                    <h3>🤝 Đề nghị giao dịch đang chờ</h3>
                </div>
                <p style="margin-bottom:12px"><strong>${escapeHtml(from.name)}</strong> gửi đề nghị tới <strong>${escapeHtml(to.name)}</strong>:</p>
                <div class="trade-grid">
                    <div class="trade-col">
                        <strong>${escapeHtml(from.name)} đưa:</strong>
                        ${formatBundle(t.offerCash, t.offerProps, t.offerJailCards)}
                    </div>
                    <div class="trade-col">
                        <strong>${escapeHtml(to.name)} đưa:</strong>
                        ${formatBundle(t.requestCash, t.requestProps, t.requestJailCards)}
                    </div>
                </div>
                <div class="modal-actions">
                    ${canDecide ? `
                        <button type="button" class="btn btn-danger" data-act="REJECT_TRADE">❌ Từ chối</button>
                        <button type="button" class="btn btn-primary" data-act="ACCEPT_TRADE">✅ Đồng ý giao dịch</button>
                    ` : (canCancel
                        ? `<button type="button" class="btn btn-secondary" data-act="REJECT_TRADE">Hủy đề nghị</button>`
                        : `<span class="waiting-pill">⏳ Đang chờ ${escapeHtml(to.name)} trả lời...</span>`)}
                </div>
            `, true);

            document.querySelectorAll('[data-act]').forEach(btn => {
                btn.addEventListener('click', () => this.handlers.onAction({ type: btn.dataset.act }));
            });
        }

        _renderVictoryModal(engine) {
            const state = engine.getState();
            const winner = engine.getPlayer(state.winnerId);
            const ranked = state.players.slice().sort((a, b) => {
                if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
                return engine.getNetWorth(b.id) - engine.getNetWorth(a.id);
            });

            this._openModalHtml(`
                <div class="modal-header">
                    <h3>🏆 KẾT THÚC VÁN ĐẤU</h3>
                </div>
                <div style="text-align:center;margin-bottom:14px">
                    <div style="font-size:48px">👑</div>
                    <h2 style="color:#fbbf24;margin:6px 0">${escapeHtml(winner?.name || 'Nhà vô địch')}</h2>
                    <p class="muted-text">Trở thành Tỷ Phú duy nhất sau ${state.turnNumber} lượt!</p>
                </div>
                <div class="ranking-list">
                    ${ranked.map((p, i) => `
                        <div class="ranking-item">
                            <span>#${i + 1} ${p.avatar} <strong>${escapeHtml(p.name)}</strong></span>
                            <span>${p.bankrupt ? 'Phá sản' : formatMoney(engine.getNetWorth(p.id))}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn btn-primary btn-block" id="btn-victory-lobby">🏠 Về Sảnh Chính</button>
                </div>
            `);

            document.getElementById('btn-victory-lobby')?.addEventListener('click', () => {
                this.closeModal();
                this.handlers.onExitToLobby();
            });
        }

        openRulesModal() {
            this.activeModal = { type: 'rules' };
            this._openModalHtml(`
                <div class="modal-header">
                    <h3>📖 Luật chơi Cờ Tỷ Phú Việt Nam</h3>
                    <button type="button" class="btn btn-ghost btn-xs" id="modal-close-btn">✕ Đóng</button>
                </div>
                <div class="rules-list">
                    <p>• <strong>Mục tiêu:</strong> Mua đất, thu tiền thuê và khiến tất cả đối thủ phá sản để trở thành Tỷ Phú duy nhất.</p>
                    <p>• <strong>Đi qua Khởi Hành:</strong> Nhận <strong>200k</strong> mỗi vòng đi qua hoặc dừng lại ô Khởi Hành.</p>
                    <p>• <strong>Độc quyền &amp; Xây nhà:</strong> Khi sở hữu đủ tất cả ô cùng màu, tiền thuê đất trống tăng <strong>×2</strong>. Bạn có thể xây tối đa 4 Nhà (🏠) rồi nâng lên Khách Sạn (🏨), tuân thủ quy tắc <strong>xây đều và bán đều</strong> trong cùng nhóm màu.</p>
                    <p>• <strong>Đấu giá:</strong> Nếu dừng tại ô chưa có chủ mà không mua ngay, mọi người chơi sẽ tham gia đấu giá công khai.</p>
                    <p>• <strong>Nhà Tù:</strong> Vào tù nếu đi vào ô Vào Tù, rút thẻ vào tù hoặc tung đôi <strong>3 lần liên tiếp</strong>. Có thể nộp 50k, dùng thẻ Miễn Tù hoặc tung đôi trong tối đa 3 lượt để thoát.</p>
                    <p>• <strong>Thế chấp:</strong> Có thể thế chấp đất trống để lấy 50% giá trị. Chuộc lại mất giá thế chấp + 10% lãi.</p>
                    <p>• <strong>Chơi Online P2P:</strong> Tạo phòng lấy mã 6 ký tự (hoặc copy link mời) để bạn bè vào chơi cùng trực tiếp trên trình duyệt qua WebRTC.</p>
                </div>
            `, true);
            document.getElementById('modal-close-btn')?.addEventListener('click', () => {
                this.closeModal();
                if (this._lastEngine) this._renderPhaseOrCustomModal(this._lastEngine, this._lastCtx);
            });
        }

        openConfirmExitModal() {
            this.activeModal = { type: 'confirm_exit' };
            this._openModalHtml(`
                <div class="modal-header">
                    <h3>🚪 Rời ván đấu hiện tại?</h3>
                </div>
                <p class="muted-text" style="margin-bottom:14px">Tiến trình ván đấu hiện tại sẽ kết thúc và bạn sẽ quay lại màn hình sảnh chính.</p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" id="btn-stay">Ở lại chơi tiếp</button>
                    <button type="button" class="btn btn-danger" id="btn-confirm-exit">Rời khỏi ván</button>
                </div>
            `);
            document.getElementById('btn-stay')?.addEventListener('click', () => {
                this.closeModal();
                if (this._lastEngine) this._renderPhaseOrCustomModal(this._lastEngine, this._lastCtx);
            });
            document.getElementById('btn-confirm-exit')?.addEventListener('click', () => {
                this.closeModal();
                this.handlers.onExitToLobby();
            });
        }
    }

    global.CoTyPhu = Object.assign(global.CoTyPhu || {}, { GameUI });
})(window);
