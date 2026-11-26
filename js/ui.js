(function (global) {
    'use strict';

    const { BOARD_TILES, COLOR_GROUPS, RESORT_TILES, Art, formatMoney, formatShortMoney } = global.CoTyPhu;

    const DIE_FACE_ANGLES = {
        1: [0, 0],
        2: [0, -90],
        3: [-90, 0],
        4: [90, 0],
        5: [0, 90],
        6: [0, 180]
    };

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getTileGridPos(index) {
        if (index === 0) return { col: 9, row: 9, side: 'corner', corner: true };
        if (index >= 1 && index <= 7) return { col: 9 - index, row: 9, side: 'bottom', corner: false };
        if (index === 8) return { col: 1, row: 9, side: 'corner', corner: true };
        if (index >= 9 && index <= 15) return { col: 1, row: 17 - index, side: 'left', corner: false };
        if (index === 16) return { col: 1, row: 1, side: 'corner', corner: true };
        if (index >= 17 && index <= 23) return { col: index - 15, row: 1, side: 'top', corner: false };
        if (index === 24) return { col: 9, row: 1, side: 'corner', corner: true };
        return { col: 9, row: index - 23, side: 'right', corner: false };
    }

    function hexToRgba(hex, alpha) {
        const clean = String(hex || '#10b981').replace('#', '');
        const num = parseInt(clean.length === 3
            ? clean.split('').map(c => c + c).join('')
            : clean, 16);
        const r = (num >> 16) & 0xff;
        const g = (num >> 8) & 0xff;
        const b = num & 0xff;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function formatTimer(seconds) {
        if (seconds === null || seconds === undefined) return '∞';
        const s = Math.max(0, Math.floor(seconds));
        const m = Math.floor(s / 60);
        const rem = s % 60;
        return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
    }

    class GameUI {
        constructor(sound, handlers) {
            this.sound = sound;
            this.handlers = handlers;
            this.tileEls = new Map();
            this.displayedPositions = {};
            this.lastEventSeq = 0;
            this.hopTimer = null;
            this.diceRollTimer = null;
            this.isDiceRolling = false;
            this.diceSpinCycles = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
            this.activeModal = null;
            this.minimizedPhaseKey = null;
            this.buySelectedLevel = 0;
            this.upgradeSelectedLevel = 1;
            this.deedPreviewTier = null;
            this.sellSelectedSet = new Set();
            this.chanceSwapDraft = { ownTile: null, targetTile: null, recipientId: null };
            this._buildTableProps();
            this._buildBoardSkeleton();
            this._initDicePips();
        }

        _buildTableProps() {
            const layer = document.getElementById('table-props-layer');
            if (!layer || !Art) return;
            layer.innerHTML = `
                <div class="table-prop prop-cash">${Art.tablePropSvg('cash')}</div>
                <div class="table-prop prop-cards">${Art.tablePropSvg('cards')}</div>
                <div class="table-prop prop-coins-bronze">${Art.tablePropSvg('coins_bronze')}</div>
                <div class="table-prop prop-coins-gold">${Art.tablePropSvg('coins_gold')}</div>
            `;
        }

        _initDicePips() {
            const pipsHtml = Array.from({ length: 9 }, () => '<span class="pip"></span>').join('');
            for (const id of ['dice-1', 'dice-2']) {
                const el = document.getElementById(id);
                if (!el) continue;
                el.innerHTML = [1, 2, 3, 4, 5, 6]
                    .map(f => `<div class="die-face face-${f}" data-face="${f}">${pipsHtml}</div>`)
                    .join('');
            }
            this._setDiceStatic([1, 1]);
        }

        _setDiceStatic(diceArr = [1, 1]) {
            for (let i = 0; i < 2; i++) {
                const cube = document.getElementById(`dice-${i + 1}`);
                if (!cube) continue;
                const val = Number(diceArr[i]) || 1;
                const [bx, by] = DIE_FACE_ANGLES[val] || [0, 0];
                const cyc = this.diceSpinCycles[i];
                cube.style.transition = 'none';
                cube.dataset.val = String(val);
                cube.style.transform = `rotateX(${cyc.x + bx}deg) rotateY(${cyc.y + by}deg)`;
            }
        }

        _buildBoardSkeleton() {
            const board = document.getElementById('board');
            if (!board) return;
            const center = document.getElementById('board-center');

            for (const tile of BOARD_TILES) {
                const pos = getTileGridPos(tile.index);
                const el = document.createElement('div');
                el.className = `tile tile-${tile.type} ${pos.corner ? 'is-corner' : 'side-' + pos.side}`;
                el.dataset.index = String(tile.index);
                el.style.gridColumn = String(pos.col);
                el.style.gridRow = String(pos.row);

                let colorBarHtml = '';
                if (tile.type === 'city') {
                    const grp = COLOR_GROUPS[tile.group];
                    colorBarHtml = `<div class="tile-color-bar" style="background:${grp.color}"></div>`;
                }

                let centerIconHtml = '';
                if (tile.type === 'chance' && Art) centerIconHtml = Art.chanceWheelSvg();
                else if (tile.type === 'resort' && Art) centerIconHtml = Art.resortTileSvg();
                else if (tile.type === 'tax' && Art) centerIconHtml = Art.taxTileSvg();

                const priceHtml = tile.price ? `<div class="tile-price">${formatShortMoney(tile.price)}</div>` : '';
                const cornerArtHtml = pos.corner && Art ? Art.cornerLandmarkSvg(tile.type) : '';

                el.innerHTML = `
                    <div class="tile-surface">
                        ${colorBarHtml}
                        ${centerIconHtml}
                        <div class="tile-name">${escapeHtml(tile.shortName || tile.name)}</div>
                        ${priceHtml}
                    </div>
                    <div class="tile-3d-stage">
                        <div class="upright-3d">
                            ${cornerArtHtml}
                            <div class="tile-status-badges"></div>
                            <div class="tile-building-slot"></div>
                            <div class="tile-tokens"></div>
                        </div>
                    </div>
                `;

                el.addEventListener('click', () => {
                    const st = this._lastEngine?.getState();
                    const cur = this._lastEngine?.getCurrentPlayer();
                    if (st && st.phase === 'WORLD_TOUR_PICK' && cur && this._lastCtx?.canAct(cur.id) && tile.index !== 24) {
                        this.handlers.onAction({ type: 'FLY_WORLD_TOUR', tileIndex: tile.index });
                        return;
                    }
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
            setTimeout(() => toast.remove(), 3200);
        }

        _spawnFloatDelta(delta) {
            const layer = document.getElementById('float-fx-layer');
            if (!layer || !delta) return;
            const el = document.createElement('div');
            el.className = `float-delta ${delta > 0 ? 'plus' : 'minus'}`;
            el.textContent = `${delta > 0 ? '+' : ''}${formatShortMoney(delta)}`;
            layer.appendChild(el);
            setTimeout(() => el.remove(), 1400);
        }

        resetVisualTracking(state) {
            if (this.hopTimer) {
                clearTimeout(this.hopTimer);
                this.hopTimer = null;
            }
            if (this.diceRollTimer) {
                clearTimeout(this.diceRollTimer);
                this.diceRollTimer = null;
            }
            this.isDiceRolling = false;
            for (const id of ['die-slot-1', 'die-slot-2']) {
                document.getElementById(id)?.classList.remove('rolling', 'double-glow');
            }
            const fxLayer = document.getElementById('dice-impact-fx');
            if (fxLayer) fxLayer.innerHTML = '';
            const totalBadge = document.getElementById('dice-total-badge');
            if (totalBadge) {
                totalBadge.classList.remove('rolling', 'land-pop', 'is-double');
                const d = state?.dice || [1, 1];
                totalBadge.textContent = String((Number(d[0]) || 1) + (Number(d[1]) || 1));
            }
            this._setDiceStatic(state?.dice || [1, 1]);

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
            this.buySelectedLevel = 0;
            this.upgradeSelectedLevel = 1;
            this.deedPreviewTier = null;
            this.sellSelectedSet.clear();
            this.closeModal();
        }

        _getPhaseKey(state) {
            return `${state.turnNumber}_${state.phase}_${state.pendingTile}_${state.pendingCard?.id || ''}_${state.pendingRepurchase?.tileIndex || ''}_${state.pendingChanceTarget?.action || ''}_${state.pendingDebt?.amount || ''}`;
        }

        render(engine, ctx) {
            const state = engine.getState();
            if (!state) return;

            this._lastEngine = engine;
            this._lastCtx = ctx;

            const evt = state.lastEvent;
            const isNewEvent = evt && evt.seq > this.lastEventSeq;

            if (!isNewEvent && (this.isDiceRolling || this.hopTimer)) {
                this._renderPlayers(engine, ctx);
                this._renderLogs(state);
                this.updateTimerDisplay(state.remainingSeconds);
                this._renderUtilityBar(ctx);
                return;
            }

            if (isNewEvent) {
                if (this.hopTimer) {
                    clearTimeout(this.hopTimer);
                    this.hopTimer = null;
                }
                if (this.diceRollTimer) {
                    clearTimeout(this.diceRollTimer);
                    this.diceRollTimer = null;
                }
                if (this.isDiceRolling) {
                    this.isDiceRolling = false;
                    for (const id of ['die-slot-1', 'die-slot-2']) {
                        document.getElementById(id)?.classList.remove('rolling');
                    }
                    this._setDiceStatic(state.dice);
                }

                this.lastEventSeq = evt.seq;
                this.buySelectedLevel = 0;
                this.upgradeSelectedLevel = (state.properties[state.pendingTile]?.level || 0) + 1;
                this.deedPreviewTier = null;
                this.sellSelectedSet.clear();
                this.chanceSwapDraft = { ownTile: null, targetTile: null, recipientId: null };
            }

            const shouldHop = isNewEvent && evt && evt.playerId &&
                typeof evt.fromPos === 'number' && typeof evt.toPos === 'number' &&
                evt.fromPos !== evt.toPos && evt.type !== 'go_to_island';

            if (isNewEvent && evt.dice) {
                for (const p of state.players) {
                    if (p.id === evt.playerId && typeof evt.fromPos === 'number') {
                        this.displayedPositions[p.id] = evt.fromPos;
                    } else {
                        this.displayedPositions[p.id] = p.position;
                    }
                }
                const isDouble = Number(evt.dice[0]) === Number(evt.dice[1]);
                this._playDiceRollAnimation(evt.dice, isDouble, () => {
                    const latestEngine = this._lastEngine || engine;
                    const latestCtx = this._lastCtx || ctx;
                    const latestState = latestEngine.getState();
                    this._renderCenter(latestEngine, latestCtx);
                    if (shouldHop) {
                        this._animateHop(latestEngine, latestCtx, evt.playerId, evt.fromPos, evt.toPos, () => {
                            this._handlePostLandingFX(evt, this._lastCtx || latestCtx);
                        });
                    } else {
                        if (latestState) {
                            for (const p of latestState.players) {
                                this.displayedPositions[p.id] = p.position;
                            }
                        }
                        this._handlePostLandingFX(evt, latestCtx);
                        this._renderBoardTiles(latestEngine, latestCtx);
                        this._renderPhaseOrCustomModal(latestEngine, latestCtx);
                    }
                });

                this._renderBoardTiles(engine, ctx);
                this._renderCenter(engine, ctx);
                this._renderPlayers(engine, ctx);
                this._renderLogs(state);
                this._renderUtilityBar(ctx);
                return;
            }

            if (isNewEvent) {
                this._handleEventFX(evt, ctx);
            }

            if (shouldHop) {
                this._animateHop(engine, ctx, evt.playerId, evt.fromPos, evt.toPos);
            } else {
                for (const p of state.players) {
                    this.displayedPositions[p.id] = p.position;
                }
                this._renderBoardTiles(engine, ctx);
                this._renderPhaseOrCustomModal(engine, ctx);
            }

            this._renderCenter(engine, ctx);
            this._renderPlayers(engine, ctx);
            this._renderLogs(state);
            this._renderUtilityBar(ctx);
        }

        updateTimerDisplay(seconds) {
            const badge = document.getElementById('match-timer-badge');
            if (badge) badge.textContent = formatTimer(seconds);
        }

        _spawnDiceImpactFX(isDouble) {
            const layer = document.getElementById('dice-impact-fx');
            if (!layer) return;
            layer.innerHTML = '';

            const wave = document.createElement('div');
            wave.className = `dice-shockwave ${isDouble ? 'is-double' : ''}`;
            layer.appendChild(wave);

            const palette = isDouble
                ? ['#fde047', '#f59e0b', '#ffffff', '#fb923c']
                : ['#38bdf8', '#7dd3fc', '#ffffff', '#fde047'];

            for (let i = 0; i < 8; i++) {
                const spark = document.createElement('span');
                spark.className = 'dice-spark';
                const angle = (Math.PI * 2 * i) / 8 + (isDouble ? 0.2 : 0);
                const dist = (isDouble ? 44 : 34) + (i % 2) * 10;
                spark.style.setProperty('--tx', `${Math.round(Math.cos(angle) * dist)}px`);
                spark.style.setProperty('--ty', `${Math.round(Math.sin(angle) * dist)}px`);
                spark.style.background = palette[i % palette.length];
                spark.style.boxShadow = `0 0 8px ${palette[i % palette.length]}`;
                layer.appendChild(spark);
            }

            setTimeout(() => {
                if (layer) layer.innerHTML = '';
            }, 650);
        }

        _playDiceRollAnimation(diceArr, isDouble, onLanded) {
            if (this.diceRollTimer) {
                clearTimeout(this.diceRollTimer);
                this.diceRollTimer = null;
            }
            this.isDiceRolling = true;
            this.sound.dice();

            const totalBadge = document.getElementById('dice-total-badge');
            const doubleSplash = document.getElementById('double-splash');
            if (totalBadge) {
                totalBadge.textContent = '🎲';
                totalBadge.classList.remove('land-pop', 'is-double');
                totalBadge.classList.add('rolling');
            }
            if (doubleSplash) {
                doubleSplash.classList.add('hidden');
            }

            const spinDeltas = [
                { x: 720, y: 720 },
                { x: 1080, y: -720 }
            ];

            for (let i = 0; i < 2; i++) {
                const slot = document.getElementById(`die-slot-${i + 1}`);
                const cube = document.getElementById(`dice-${i + 1}`);
                if (slot) {
                    slot.classList.remove('rolling', 'double-glow');
                    void slot.offsetWidth;
                    slot.classList.add('rolling');
                }
                if (cube) {
                    void cube.offsetWidth;
                    const val = Number(diceArr[i]) || 1;
                    const [bx, by] = DIE_FACE_ANGLES[val] || [0, 0];
                    this.diceSpinCycles[i].x += spinDeltas[i].x;
                    this.diceSpinCycles[i].y += spinDeltas[i].y;
                    const dur = i === 0 ? '0.64s' : '0.68s';
                    cube.style.transition = `transform ${dur} cubic-bezier(0.16, 0.88, 0.28, 1)`;
                    cube.dataset.val = String(val);
                    cube.style.transform = `rotateX(${this.diceSpinCycles[i].x + bx}deg) rotateY(${this.diceSpinCycles[i].y + by}deg)`;
                }
            }

            this.diceRollTimer = setTimeout(() => {
                this.diceRollTimer = null;
                this.isDiceRolling = false;

                for (let i = 0; i < 2; i++) {
                    const slot = document.getElementById(`die-slot-${i + 1}`);
                    if (slot) {
                        slot.classList.remove('rolling');
                        slot.classList.toggle('double-glow', Boolean(isDouble));
                    }
                }

                this.sound.diceLand(isDouble);
                this._spawnDiceImpactFX(isDouble);

                if (totalBadge) {
                    totalBadge.classList.remove('rolling');
                    totalBadge.textContent = String((Number(diceArr[0]) || 0) + (Number(diceArr[1]) || 0));
                    totalBadge.classList.toggle('is-double', Boolean(isDouble));
                    void totalBadge.offsetWidth;
                    totalBadge.classList.add('land-pop');
                }

                if (typeof onLanded === 'function') {
                    onLanded();
                }
            }, 690);
        }

        _handleEventFX(evt, ctx) {
            this._handlePostLandingFX(evt, ctx);
        }

        _handlePostLandingFX(evt, ctx) {
            if (!evt) return;
            if (evt.type === 'buy' || evt.type === 'repurchase') this.sound.buy();
            else if (evt.type === 'upgrade' || evt.type === 'championship_hold' || evt.type === 'festival_add') this.sound.build();
            else if (evt.type === 'go_to_island') this.sound.jail();
            else if (evt.type === 'draw_chance' || evt.type === 'shield_add') this.sound.card();
            else if (evt.type === 'game_over') this.sound.win();

            if (evt.cashDeltas) {
                const viewerId = ctx?.localPlayerId || evt.playerId;
                const delta = evt.cashDeltas[viewerId] ?? evt.cashDeltas[evt.playerId];
                if (delta) {
                    this._spawnFloatDelta(delta);
                    if (delta > 0) this.sound.cash();
                    else this.sound.pay();
                }
            }
        }

        _animateHop(engine, ctx, playerId, fromPos, toPos, onDone = null) {
            const state = engine.getState();
            for (const p of state.players) {
                if (p.id !== playerId) this.displayedPositions[p.id] = p.position;
            }

            const steps = (toPos - fromPos + 32) % 32;
            let currentStep = 0;
            const stepDelay = steps > 10 ? 32 : 70;

            const tick = () => {
                currentStep += 1;
                this.displayedPositions[playerId] = (fromPos + currentStep) % 32;
                this.sound.step();
                this._renderBoardTiles(this._lastEngine || engine, this._lastCtx || ctx);
                if (currentStep < steps) {
                    this.hopTimer = setTimeout(tick, stepDelay);
                } else {
                    this.hopTimer = null;
                    if (typeof onDone === 'function') {
                        onDone();
                    }
                    this._renderPhaseOrCustomModal(this._lastEngine || engine, this._lastCtx || ctx);
                }
            };
            this.displayedPositions[playerId] = fromPos;
            this._renderBoardTiles(engine, ctx);
            this.hopTimer = setTimeout(tick, 90);
        }

        _renderBoardTiles(engine, ctx) {
            const state = engine.getState();
            const current = engine.getCurrentPlayer();
            const activePos = current && !current.bankrupt ? this.displayedPositions[current.id] : -1;
            const isFlyMode = state.phase === 'WORLD_TOUR_PICK' && current && ctx.canAct(current.id);

            for (const tile of BOARD_TILES) {
                const el = this.tileEls.get(tile.index);
                if (!el) continue;

                el.classList.toggle('active-landed', tile.index === activePos);
                el.classList.toggle('fly-target', Boolean(isFlyMode && tile.index !== 24));

                const prop = state.properties[tile.index];
                const surface = el.querySelector('.tile-surface');
                const priceEl = el.querySelector('.tile-price');
                const bldgSlot = el.querySelector('.tile-building-slot');
                const statusSlot = el.querySelector('.tile-status-badges');

                if (prop) {
                    el.classList.toggle('outage', prop.outageTurns > 0);
                    const owner = prop.ownerId ? engine.getPlayer(prop.ownerId) : null;

                    if (surface) {
                        surface.style.background = owner ? hexToRgba(owner.color, 0.24) : '';
                    }
                    if (priceEl) {
                        if (owner) {
                            priceEl.textContent = formatShortMoney(engine.calculateRent(tile.index));
                            priceEl.style.color = '#0f172a';
                        } else {
                            priceEl.textContent = formatShortMoney(tile.price);
                        }
                    }
                    if (bldgSlot) {
                        if (owner && Art) {
                            if (tile.type === 'resort') {
                                bldgSlot.innerHTML = Art.miniBoardBuildingSvg(0, owner.color);
                            } else {
                                bldgSlot.innerHTML = Art.miniBoardBuildingSvg(prop.level, owner.color);
                            }
                        } else {
                            bldgSlot.innerHTML = '';
                        }
                    }
                    if (statusSlot && Art) {
                        const badges = [];
                        if (prop.shielded) badges.push(Art.shieldBadgeSvg());
                        if (prop.festival) badges.push(Art.festivalBadgeSvg());
                        if (state.championshipTile === tile.index) badges.push(Art.trophyBadgeSvg(state.championshipMult));
                        if (prop.outageTurns > 0) badges.push(Art.powerOutageBadgeSvg());
                        statusSlot.innerHTML = badges.join('');
                    }
                }

                const tokensEl = el.querySelector('.tile-tokens');
                if (tokensEl) {
                    const here = state.players.filter(p => !p.bankrupt && this.displayedPositions[p.id] === tile.index);
                    tokensEl.innerHTML = here.map(p => {
                        const isActive = current && current.id === p.id;
                        let bubble = '';
                        if (isActive && p.isBot && state.phase !== 'GAME_OVER') {
                            bubble = `<span class="speech-bubble">Đang suy nghĩ...</span>`;
                        }
                        return `<span class="token-standee ${isActive ? 'is-active' : ''} ${p.inIsland ? 'in-jail' : ''}" style="background:${p.color}" title="${escapeHtml(p.name)}">${p.avatar}${bubble}</span>`;
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

            this.updateTimerDisplay(state.remainingSeconds);

            const wtBanner = document.getElementById('world-tour-banner');
            const showWtBanner = state.phase === 'WORLD_TOUR_PICK' && current && ctx.canAct(current.id);
            wtBanner?.classList.toggle('hidden', !showWtBanner);

            const d1 = document.getElementById('dice-1');
            const d2 = document.getElementById('dice-2');
            const totalBadge = document.getElementById('dice-total-badge');
            const doubleSplash = document.getElementById('double-splash');
            const showDoubleState = Boolean(state.wasDouble && (state.canRollAgain || state.lastEvent?.type === 'go_to_island'));

            if (!this.isDiceRolling) {
                if (d1?.dataset.val !== String(state.dice[0]) || d2?.dataset.val !== String(state.dice[1])) {
                    this._setDiceStatic(state.dice);
                }
                for (const id of ['die-slot-1', 'die-slot-2']) {
                    document.getElementById(id)?.classList.toggle('double-glow', showDoubleState);
                }
                if (totalBadge) {
                    totalBadge.classList.remove('rolling');
                    totalBadge.textContent = String(state.dice[0] + state.dice[1]);
                    totalBadge.classList.toggle('is-double', showDoubleState);
                }
                if (doubleSplash) {
                    doubleSplash.textContent = state.lastEvent?.type === 'go_to_island' ? 'DOUBLE ×3!' : 'DOUBLE!';
                    doubleSplash.classList.toggle('hidden', !showDoubleState);
                }
            } else {
                if (totalBadge) {
                    totalBadge.textContent = '🎲';
                    totalBadge.classList.remove('land-pop', 'is-double');
                    totalBadge.classList.add('rolling');
                }
                doubleSplash?.classList.add('hidden');
            }

            const ticker = document.getElementById('event-ticker');
            if (ticker) {
                ticker.textContent = state.lastEvent?.message || `Lượt của ${current?.name || ''}`;
            }

            const actionsEl = document.getElementById('center-actions');
            if (!actionsEl || !current) return;

            const canAct = ctx.canAct(current.id);
            const isPhaseModalMinimized = this.minimizedPhaseKey === this._getPhaseKey(state);

            if (this.isDiceRolling) {
                actionsEl.innerHTML = `<span class="waiting-pill">🎲 Đang tung xúc xắc...</span>`;
                return;
            }

            if (state.phase === 'ROLL') {
                if (!canAct) {
                    actionsEl.innerHTML = `<span class="waiting-pill">⏳ Đang chờ ${escapeHtml(current.name)} tung xúc xắc...</span>`;
                } else if (current.inIsland) {
                    const bail = state.config.islandBail;
                    actionsEl.innerHTML = `
                        <button type="button" class="btn btn-arcade-blue" data-act="ROLL_DICE">🎲 Tung đôi rời đảo (${current.islandTurns}/3)</button>
                        <button type="button" class="btn btn-accent btn-sm" data-act="PAY_JAIL_BAIL" ${current.cash < bail ? 'disabled' : ''}>💵 Nộp ${formatShortMoney(bail)}</button>
                        ${current.escapeCards > 0 ? '<button type="button" class="btn btn-primary btn-sm" data-act="USE_JAIL_CARD">🎟️ Thẻ Thoát Đảo</button>' : ''}
                    `;
                } else {
                    const label = state.canRollAgain ? '🎲 TUNG TIẾP (DOUBLE!)' : '🎲 ROLL / TUNG XÚC XẮC';
                    actionsEl.innerHTML = `<button type="button" id="btn-roll" class="btn btn-arcade-blue btn-lg" data-act="ROLL_DICE">${label}</button>`;
                }
            } else if (state.phase === 'WORLD_TOUR_PICK') {
                actionsEl.innerHTML = canAct
                    ? `<button type="button" class="btn btn-danger" data-act="CANCEL_WORLD_TOUR">Hủy bay • Tung xúc xắc</button>`
                    : `<span class="waiting-pill">✈️ ${escapeHtml(current.name)} đang chọn điểm bay...</span>`;
            } else if (isPhaseModalMinimized && ['BUY_DECISION', 'UPGRADE_DECISION', 'REPURCHASE_DECISION', 'CHAMPIONSHIP_PICK', 'CHANCE_MODAL', 'CHANCE_TARGET_PICK', 'SELL_DEBT'].includes(state.phase)) {
                actionsEl.innerHTML = `<button type="button" id="btn-reopen-phase" class="btn btn-arcade-blue">📋 Mở lại bảng lựa chọn</button>`;
            } else {
                actionsEl.innerHTML = `<span class="waiting-pill">📌 ${this._phaseLabel(state.phase)}</span>`;
            }

            actionsEl.querySelectorAll('[data-act]').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.handlers.onAction({ type: btn.dataset.act });
                });
            });

            document.getElementById('btn-reopen-phase')?.addEventListener('click', () => {
                this.minimizedPhaseKey = null;
                this._renderPhaseOrCustomModal(engine, ctx);
            });
        }

        _phaseLabel(phase) {
            switch (phase) {
                case 'BUY_DECISION': return 'Mua bất động sản';
                case 'UPGRADE_DECISION': return 'Nâng cấp thành phố';
                case 'REPURCHASE_DECISION': return 'Mua lại thành phố';
                case 'CHAMPIONSHIP_PICK': return 'Chọn nơi tổ chức Giải Vô Địch';
                case 'CHANCE_MODAL': return 'Thẻ Cơ Hội';
                case 'CHANCE_TARGET_PICK': return 'Chọn mục tiêu thẻ Cơ Hội';
                case 'SELL_DEBT': return 'Bán đất trả nợ';
                case 'GAME_OVER': return 'Kết thúc trận đấu';
                default: return phase;
            }
        }

        _renderPlayers(engine, ctx) {
            const state = engine.getState();
            const current = engine.getCurrentPlayer();

            for (let i = 0; i < 4; i++) {
                const container = document.getElementById(`corner-hud-${i}`);
                if (!container) continue;
                const p = state.players[i];
                if (!p) {
                    container.classList.add('hidden');
                    container.innerHTML = '';
                    continue;
                }

                container.classList.remove('hidden');
                const isActive = current && current.id === p.id && !p.bankrupt;
                container.classList.toggle('active', Boolean(isActive));
                container.classList.toggle('bankrupt', Boolean(p.bankrupt));

                const isLocal = ctx.mode !== 'local' && ctx.localPlayerId === p.id;
                const monos = engine.getMonopolyCount(p.id);
                const resorts = engine.getResortCount(p.id);

                const badges = [];
                if (isLocal) badges.push('BẠN');
                else if (p.isBot) badges.push('BOT');
                if (ctx.mode !== 'local' && !p.isBot && p.connected === false && !p.bankrupt) badges.push('MẤT MẠNG');
                else if (p.inIsland) badges.push('ĐẢO');

                container.innerHTML = `
                    <div class="hud-card-box">
                        <div class="hud-avatar-frame" style="background:${p.color}">
                            <span>${p.avatar}</span>
                            ${isActive ? '<span class="hud-crown-tag">LƯỢT</span>' : ''}
                            ${p.bankrupt ? '<span class="bankrupt-stamp">BANKRUPT</span>' : ''}
                        </div>
                        <div class="hud-info-col">
                            <div class="hud-ribbon-name" style="background:${p.color}">
                                <span>${escapeHtml(p.name)}</span>
                                ${badges.length ? `<span class="badge" style="background:rgba(0,0,0,0.24);color:#fff">${badges[0]}</span>` : ''}
                            </div>
                            <div class="hud-cash-row">
                                <div class="hud-cash-val">
                                    <span>${formatMoney(p.cash)}</span>
                                    ${Art ? Art.banknoteSvg(19) : ''}
                                </div>
                            </div>
                            <div class="hud-sub-meta">
                                <span>🎨 ${monos}/3 • 🏝️ ${resorts}/4</span>
                                <span>${p.escapeCards > 0 ? `🎟️×${p.escapeCards}` : ''}${p.readyToFly ? ' ✈️' : ''}</span>
                            </div>
                        </div>
                    </div>
                `;
            }
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
            const connPill = document.getElementById('conn-status-pill');
            const chatPanel = document.getElementById('chat-panel');
            const isOnline = ctx.mode === 'online-host' || ctx.mode === 'online-client';
            if (chip) {
                chip.classList.toggle('hidden', !isOnline || !ctx.roomCode);
                if (ctx.roomCode) chip.textContent = `🌐 Phòng: ${ctx.roomCode}`;
            }
            if (connPill) {
                connPill.classList.toggle('hidden', !isOnline);
            }
            if (chatPanel) chatPanel.classList.toggle('hidden', !isOnline);
        }

        appendChatMessage(msg) {
            const box = document.getElementById('chat-messages');
            if (!box) return;
            const row = document.createElement('div');
            row.className = 'chat-msg';
            row.innerHTML = `<strong style="color:${escapeHtml(msg.senderColor || '#fde047')}">${escapeHtml(msg.senderAvatar || '')} ${escapeHtml(msg.senderName)}:</strong> ${escapeHtml(msg.text)}`;
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
                this._renderDeedModal(engine, this.activeModal.tileIndex);
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
                case 'BUY_DECISION': this._renderBuyModal(engine, ctx); break;
                case 'UPGRADE_DECISION': this._renderUpgradeModal(engine, ctx); break;
                case 'REPURCHASE_DECISION': this._renderRepurchaseModal(engine, ctx); break;
                case 'CHAMPIONSHIP_PICK': this._renderChampionshipModal(engine, ctx); break;
                case 'CHANCE_MODAL': this._renderChanceModal(engine, ctx); break;
                case 'CHANCE_TARGET_PICK': this._renderChanceTargetModal(engine, ctx); break;
                case 'SELL_DEBT': this._renderSellDebtModal(engine, ctx); break;
                case 'GAME_OVER': this._renderVictoryModal(engine); break;
                default: this.closeModal(); break;
            }
        }

        _openBizCardModal(title, ribbonColor, bodyHtml, closeHandler, wide = false) {
            const root = document.getElementById('modal-root');
            if (!root) return;
            root.innerHTML = `
                <div class="modal-card biz-card ${wide ? 'wide' : ''}">
                    <div class="biz-ribbon" style="background:${ribbonColor}">
                        <span>${escapeHtml(title)}</span>
                        ${closeHandler ? '<button type="button" class="biz-close-x" id="modal-close-btn" aria-label="Đóng">✕</button>' : ''}
                    </div>
                    ${bodyHtml}
                </div>
            `;
            root.classList.remove('hidden');
            if (closeHandler) {
                document.getElementById('modal-close-btn')?.addEventListener('click', closeHandler);
            }
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

        _getRibbonColor(tile) {
            if (tile.type === 'city') return COLOR_GROUPS[tile.group].color;
            if (tile.type === 'resort') return '#0ea5e9';
            if (tile.type === 'tax') return '#dc2626';
            if (tile.type === 'chance') return '#f97316';
            return '#16a34a';
        }

        _buildCityTierCards(tile, checkedUpTo, lockedUpTo = -1) {
            const accent = COLOR_GROUPS[tile.group].color;
            const tiers = [
                { lvl: 0, label: 'Đất' },
                { lvl: 1, label: 'Nhà 1' },
                { lvl: 2, label: 'Nhà 2' },
                { lvl: 3, label: 'Nhà 3' }
            ];
            return `
                <div class="tier-cards-grid">
                    ${tiers.map(t => {
                        const isChecked = checkedUpTo >= t.lvl;
                        const isLocked = t.lvl <= lockedUpTo;
                        return `
                            <div class="tier-card ${checkedUpTo === t.lvl ? 'selected' : ''} ${isLocked ? 'locked' : ''}" data-tier="${t.lvl}">
                                ${Art ? Art.buildingCardSvg(t.lvl, accent) : ''}
                                <div class="tier-label-row">
                                    <span>${t.label}</span>
                                    <span class="tier-check ${isChecked ? 'checked' : ''}">${isChecked ? '✓' : ''}</span>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        // ==================== BUY MODAL ====================
        _renderBuyModal(engine, ctx) {
            const state = engine.getState();
            const tile = BOARD_TILES[state.pendingTile];
            const current = engine.getCurrentPlayer();
            if (!tile || !current) return;
            const canAct = ctx.canAct(current.id);

            let body = '';
            if (tile.type === 'resort') {
                const nextCount = engine.getResortCount(current.id) + 1;
                body = `
                    <div style="display:flex;justify-content:center;margin-bottom:10px">
                        <div class="tier-card selected" style="width:170px">
                            ${Art ? Art.resortCardSvg() : ''}
                            <div class="tier-label-row"><span>Khu Nghỉ Dưỡng</span><span class="tier-check checked">✓</span></div>
                        </div>
                    </div>
                    <table class="deed-table">
                        <tr><td>Sở hữu 1 Bãi biển</td><td>25 000</td></tr>
                        <tr><td>Sở hữu 2 Bãi biển</td><td>50 000</td></tr>
                        <tr><td>Sở hữu 3 Bãi biển</td><td>100 000</td></tr>
                        <tr><td>Sở hữu 4 Bãi biển</td><td>200 000 (THẮNG NGAY!)</td></tr>
                    </table>
                    <div class="rent-preview-line">
                        <span>Tiền thuê hiện tại (${nextCount} bãi biển):</span>
                        <strong>${formatMoney(tile.rent[nextCount - 1])}</strong>
                        ${Art ? Art.banknoteSvg(20) : ''}
                    </div>
                    <div class="modal-actions">
                        ${canAct ? `
                            <button type="button" class="btn btn-arcade-blue btn-lg btn-block" id="btn-buy-confirm" ${current.cash >= tile.price ? '' : 'disabled'}>
                                MUA VỚI GIÁ ${formatMoney(tile.price)} ${Art ? Art.banknoteSvg(20) : ''}
                            </button>
                            <button type="button" class="btn btn-secondary btn-sm" id="btn-buy-skip">Bỏ qua</button>
                        ` : `<span class="waiting-pill">⏳ Đang chờ ${escapeHtml(current.name)}...</span>`}
                    </div>
                    <div class="biz-subline">Khu nghỉ dưỡng không thể bị mua lại!</div>
                `;
            } else {
                const lvl = Math.min(Math.max(0, this.buySelectedLevel), 3);
                const cost = engine.getPurchaseCost(tile.index, lvl);
                const rentVal = tile.rent[lvl];
                const repurchaseVal = cost * 2;
                const canAfford = current.cash >= cost;

                body = `
                    ${this._buildCityTierCards(tile, lvl, 0)}
                    <div class="rent-preview-line">
                        <span>Tiền thuê:</span>
                        <strong>${formatMoney(rentVal)}</strong>
                        ${Art ? Art.banknoteSvg(20) : ''}
                    </div>
                    <div class="modal-actions">
                        ${canAct ? `
                            <button type="button" class="btn btn-arcade-blue btn-lg btn-block" id="btn-buy-confirm" ${canAfford ? '' : 'disabled'}>
                                MUA VỚI GIÁ ${formatMoney(cost)} ${Art ? Art.banknoteSvg(20) : ''}
                            </button>
                            <button type="button" class="btn btn-secondary btn-sm" id="btn-buy-skip">Bỏ qua</button>
                        ` : `<span class="waiting-pill">⏳ Đang chờ ${escapeHtml(current.name)}...</span>`}
                    </div>
                    <div class="biz-subline">
                        <span>Người chơi khác có thể mua lại với giá: <strong>${formatMoney(repurchaseVal)}</strong> ${Art ? Art.banknoteSvg(16) : ''}</span>
                    </div>
                `;
            }

            this._openBizCardModal(tile.name, this._getRibbonColor(tile), body, () => {
                if (canAct) this.handlers.onAction({ type: 'SKIP_BUY' });
                else this._minimizePhaseModal(state);
            });

            document.querySelectorAll('[data-tier]').forEach(card => {
                card.addEventListener('click', () => {
                    const clicked = Number(card.dataset.tier);
                    if (clicked === 0) this.buySelectedLevel = 0;
                    else if (clicked === this.buySelectedLevel) this.buySelectedLevel = clicked - 1;
                    else this.buySelectedLevel = clicked;
                    this._renderBuyModal(engine, ctx);
                });
            });

            document.getElementById('btn-buy-confirm')?.addEventListener('click', () => {
                this.handlers.onAction({ type: 'BUY_CITY', targetLevel: this.buySelectedLevel });
            });
            document.getElementById('btn-buy-skip')?.addEventListener('click', () => {
                this.handlers.onAction({ type: 'SKIP_BUY' });
            });
        }

        // ==================== UPGRADE MODAL ====================
        _renderUpgradeModal(engine, ctx) {
            const state = engine.getState();
            const tile = BOARD_TILES[state.pendingTile];
            const prop = state.properties[state.pendingTile];
            const current = engine.getCurrentPlayer();
            if (!tile || !prop || !current) return;
            const canAct = ctx.canAct(current.id);
            const accent = COLOR_GROUPS[tile.group].color;

            let body = '';
            if (prop.level === 3) {
                const cost = engine.getUpgradeCost(tile.index, 4);
                const canAfford = current.cash >= cost;
                body = `
                    <div style="display:flex;justify-content:center;margin-bottom:10px">
                        <div class="tier-card selected" style="width:165px">
                            ${Art ? Art.buildingCardSvg(4, accent) : ''}
                            <div class="tier-label-row"><span>KHÁCH SẠN</span><span class="tier-check checked">✓</span></div>
                        </div>
                    </div>
                    <div class="rent-preview-line">
                        <span>Tiền thuê Khách Sạn:</span>
                        <strong>${formatMoney(tile.rent[4])}</strong>
                        ${Art ? Art.banknoteSvg(20) : ''}
                    </div>
                    <div class="modal-actions">
                        ${canAct ? `
                            <button type="button" class="btn btn-arcade-blue btn-lg btn-block" id="btn-upg-confirm" ${canAfford ? '' : 'disabled'}>
                                XÂY KHÁCH SẠN ${formatMoney(cost)} ${Art ? Art.banknoteSvg(20) : ''}
                            </button>
                            <button type="button" class="btn btn-secondary btn-sm" id="btn-upg-skip">Để sau</button>
                        ` : `<span class="waiting-pill">⏳ Đang chờ ${escapeHtml(current.name)}...</span>`}
                    </div>
                    <div class="biz-subline">Khách sạn miễn nhiễm Động Đất và không thể bị mua lại!</div>
                `;
            } else {
                const target = Math.min(3, Math.max(prop.level + 1, this.upgradeSelectedLevel));
                this.upgradeSelectedLevel = target;
                const cost = engine.getUpgradeCost(tile.index, target);
                const canAfford = current.cash >= cost;
                const newRep = (engine.getTileInvestment(tile.index) + cost) * 2;

                body = `
                    ${this._buildCityTierCards(tile, target, prop.level)}
                    <div class="rent-preview-line">
                        <span>Tiền thuê mới:</span>
                        <strong>${formatMoney(tile.rent[target])}</strong>
                        ${Art ? Art.banknoteSvg(20) : ''}
                    </div>
                    <div class="modal-actions">
                        ${canAct ? `
                            <button type="button" class="btn btn-arcade-blue btn-lg btn-block" id="btn-upg-confirm" ${canAfford ? '' : 'disabled'}>
                                NÂNG CẤP GIÁ ${formatMoney(cost)} ${Art ? Art.banknoteSvg(20) : ''}
                            </button>
                            <button type="button" class="btn btn-secondary btn-sm" id="btn-upg-skip">Bỏ qua</button>
                        ` : `<span class="waiting-pill">⏳ Đang chờ ${escapeHtml(current.name)}...</span>`}
                    </div>
                    <div class="biz-subline">
                        <span>Giá mua lại mới: <strong>${formatMoney(newRep)}</strong> ${Art ? Art.banknoteSvg(16) : ''}</span>
                    </div>
                `;
            }

            this._openBizCardModal(`NÂNG CẤP: ${tile.name}`, this._getRibbonColor(tile), body, () => {
                if (canAct) this.handlers.onAction({ type: 'SKIP_UPGRADE' });
                else this._minimizePhaseModal(state);
            });

            document.querySelectorAll('[data-tier]').forEach(card => {
                card.addEventListener('click', () => {
                    const clicked = Number(card.dataset.tier);
                    if (clicked <= prop.level) return;
                    if (clicked === this.upgradeSelectedLevel && clicked > prop.level + 1) {
                        this.upgradeSelectedLevel = clicked - 1;
                    } else {
                        this.upgradeSelectedLevel = clicked;
                    }
                    this._renderUpgradeModal(engine, ctx);
                });
            });

            document.getElementById('btn-upg-confirm')?.addEventListener('click', () => {
                const lvl = prop.level === 3 ? 4 : this.upgradeSelectedLevel;
                this.handlers.onAction({ type: 'UPGRADE_CITY', targetLevel: lvl });
            });
            document.getElementById('btn-upg-skip')?.addEventListener('click', () => {
                this.handlers.onAction({ type: 'SKIP_UPGRADE' });
            });
        }

        // ==================== REPURCHASE MODAL ====================
        _renderRepurchaseModal(engine, ctx) {
            const state = engine.getState();
            const rep = state.pendingRepurchase;
            if (!rep) return;
            const tile = BOARD_TILES[rep.tileIndex];
            const prevOwner = engine.getPlayer(rep.prevOwnerId);
            const current = engine.getCurrentPlayer();
            const canAct = ctx.canAct(current.id);
            const remaining = current.cash - rep.cost;

            const body = `
                <p style="text-align:center;margin-bottom:10px">Thành phố này đang thuộc sở hữu của <strong style="color:${prevOwner?.color || '#0f172a'}">${escapeHtml(prevOwner?.name || '')}</strong>.</p>
                <div class="rent-preview-line">
                    <span>Mua lại thành phố với giá:</span>
                    <strong>${formatMoney(rep.cost)}</strong>
                    ${Art ? Art.banknoteSvg(20) : ''}
                </div>
                <div class="biz-subline" style="margin-bottom:12px">
                    <span>Số dư còn lại sau mua: <strong>${formatMoney(remaining)}</strong> ${Art ? Art.banknoteSvg(16) : ''}</span>
                </div>
                <div class="modal-actions">
                    ${canAct ? `
                        <button type="button" class="btn btn-danger" id="btn-rep-skip">HỦY</button>
                        <button type="button" class="btn btn-arcade-blue btn-lg" id="btn-rep-confirm">💰 MUA LẠI</button>
                    ` : `<span class="waiting-pill">⏳ Đang chờ ${escapeHtml(current.name)}...</span>`}
                </div>
            `;

            this._openBizCardModal(`MUA LẠI: ${tile.name}`, this._getRibbonColor(tile), body, () => {
                if (canAct) this.handlers.onAction({ type: 'SKIP_REPURCHASE' });
                else this._minimizePhaseModal(state);
            });

            document.getElementById('btn-rep-confirm')?.addEventListener('click', () => {
                this.handlers.onAction({ type: 'REPURCHASE_CITY' });
            });
            document.getElementById('btn-rep-skip')?.addEventListener('click', () => {
                this.handlers.onAction({ type: 'SKIP_REPURCHASE' });
            });
        }

        // ==================== WORLD CHAMPIONSHIPS MODAL ====================
        _renderChampionshipModal(engine, ctx) {
            const state = engine.getState();
            const current = engine.getCurrentPlayer();
            const canAct = ctx.canAct(current.id);
            const nextMult = Math.min(5, (state.championshipMult || 1) + 1);
            const owned = engine.getOwnedTileIndices(current.id);

            const body = `
                <p style="text-align:center;margin-bottom:8px;font-weight:700">Chọn 1 thành phố của bạn để đăng cai Giải Vô Địch (Tiền thuê nhân <strong>×${nextMult}</strong>):</p>
                <p style="text-align:center;margin-bottom:10px" class="muted-text">Phí tổ chức: <strong>${formatMoney(state.config.championshipCost)}</strong></p>
                ${canAct ? `
                    <div class="pick-grid">
                        ${owned.map(idx => {
                            const t = BOARD_TILES[idx];
                            const curRent = engine.calculateRent(idx);
                            return `
                                <button type="button" class="pick-btn" data-champ="${idx}">
                                    <span>📍 ${escapeHtml(t.name)}</span>
                                    <span style="color:#0284c7">${formatShortMoney(curRent)} → ×${nextMult}</span>
                                </button>
                            `;
                        }).join('')}
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary" id="btn-champ-skip">HỦY</button>
                    </div>
                ` : `<div class="modal-actions"><span class="waiting-pill">🏆 Đang chờ ${escapeHtml(current.name)} chọn...</span></div>`}
            `;

            this._openBizCardModal('WORLD CHAMPIONSHIPS', '#9333ea', body, () => {
                if (canAct) this.handlers.onAction({ type: 'SKIP_CHAMPIONSHIP' });
                else this._minimizePhaseModal(state);
            }, true);

            document.querySelectorAll('[data-champ]').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.handlers.onAction({ type: 'HOLD_CHAMPIONSHIP', tileIndex: Number(btn.dataset.champ) });
                });
            });
            document.getElementById('btn-champ-skip')?.addEventListener('click', () => {
                this.handlers.onAction({ type: 'SKIP_CHAMPIONSHIP' });
            });
        }

        // ==================== CHANCE & TARGET MODALS ====================
        _renderChanceModal(engine, ctx) {
            const state = engine.getState();
            const card = state.pendingCard;
            const current = engine.getCurrentPlayer();
            if (!card || !current) return;
            const canAct = ctx.canAct(current.id);

            const body = `
                <div class="card-draw-box">
                    <div class="card-emoji">🎡</div>
                    <h4>${escapeHtml(card.title)}</h4>
                    <p>${escapeHtml(card.text)}</p>
                </div>
                <div class="modal-actions">
                    ${canAct
                        ? `<button type="button" class="btn btn-arcade-blue btn-lg btn-block" id="btn-confirm-chance">Xác nhận &amp; Thực hiện</button>`
                        : `<span class="waiting-pill">⏳ Đang chờ ${escapeHtml(current.name)}...</span>`}
                </div>
            `;

            this._openBizCardModal('THẺ CƠ HỘI (CHANCE)', '#f97316', body, null);
            document.getElementById('btn-confirm-chance')?.addEventListener('click', () => {
                this.handlers.onAction({ type: 'CONFIRM_CHANCE' });
            });
        }

        _renderChanceTargetModal(engine, ctx) {
            const state = engine.getState();
            const tgt = state.pendingChanceTarget;
            const current = engine.getCurrentPlayer();
            if (!tgt || !current) return;
            const canAct = ctx.canAct(current.id);

            let title = 'CHỌN MỤC TIÊU';
            let body = '';

            if (!canAct) {
                body = `<div class="modal-actions"><span class="waiting-pill">⏳ ${escapeHtml(current.name)} đang chọn mục tiêu...</span></div>`;
            } else if (tgt.action === 'earthquake' || tgt.action === 'power_outage') {
                title = tgt.action === 'earthquake' ? '🌋 ĐỘNG ĐẤT — CHỌN ĐẤT ĐỐI THỦ' : '⚡ CÚP ĐIỆN — CHỌN ĐẤT ĐỐI THỦ';
                body = `
                    <div class="pick-grid">
                        ${tgt.validOppTiles.map(idx => {
                            const t = BOARD_TILES[idx];
                            const p = state.properties[idx];
                            const o = engine.getPlayer(p.ownerId);
                            return `
                                <button type="button" class="pick-btn" data-ctgt="${idx}">
                                    <span>${escapeHtml(t.name)} (${o?.avatar} ${escapeHtml(o?.name)})</span>
                                    <span>${p.shielded ? '🛡️' : formatShortMoney(engine.calculateRent(idx))}</span>
                                </button>
                            `;
                        }).join('')}
                    </div>
                `;
            } else if (tgt.action === 'shield' || tgt.action === 'festival') {
                title = tgt.action === 'shield' ? '🛡️ ĐẶT KHIÊN BẢO VỆ' : '🎉 TỔ CHỨC LỄ HỘI ×2';
                body = `
                    <div class="pick-grid">
                        ${tgt.validOwnTiles.map(idx => {
                            const t = BOARD_TILES[idx];
                            return `
                                <button type="button" class="pick-btn" data-ctgt="${idx}">
                                    <span>📍 ${escapeHtml(t.name)}</span>
                                    <span>${formatShortMoney(engine.calculateRent(idx))}</span>
                                </button>
                            `;
                        }).join('')}
                    </div>
                `;
            } else if (tgt.action === 'royal_gift') {
                title = '🎁 QUÀ HOÀNG GIA — CHỌN ĐẤT TẶNG';
                if (!this.chanceSwapDraft.ownTile) this.chanceSwapDraft.ownTile = tgt.validOwnTiles[0];
                if (!this.chanceSwapDraft.recipientId) this.chanceSwapDraft.recipientId = tgt.validRecipients[0];
                body = `
                    <p class="muted-text" style="margin-bottom:6px">1. Chọn thành phố của bạn:</p>
                    <div class="pick-grid">
                        ${tgt.validOwnTiles.map(idx => `
                            <button type="button" class="pick-btn ${this.chanceSwapDraft.ownTile === idx ? 'selected' : ''}" data-cown="${idx}">
                                <span>${escapeHtml(BOARD_TILES[idx].name)}</span>
                                <span>${formatShortMoney(engine.getTileInvestment(idx))}</span>
                            </button>
                        `).join('')}
                    </div>
                    <p class="muted-text" style="margin-bottom:6px">2. Chọn người nhận:</p>
                    <div class="pick-grid">
                        ${tgt.validRecipients.map(rid => {
                            const rec = engine.getPlayer(rid);
                            return `
                                <button type="button" class="pick-btn ${this.chanceSwapDraft.recipientId === rid ? 'selected' : ''}" data-crec="${rid}">
                                    <span>${rec.avatar} ${escapeHtml(rec.name)}</span>
                                </button>
                            `;
                        }).join('')}
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-arcade-blue" id="btn-confirm-gift">🎁 Tặng ngay</button>
                    </div>
                `;
            } else if (tgt.action === 'city_swap') {
                title = '🔄 HOÁN ĐỔI THÀNH PHỐ';
                if (!this.chanceSwapDraft.ownTile) this.chanceSwapDraft.ownTile = tgt.validOwnTiles[0];
                if (!this.chanceSwapDraft.targetTile) this.chanceSwapDraft.targetTile = tgt.validOppTiles[0];
                body = `
                    <p class="muted-text" style="margin-bottom:6px">1. Chọn thành phố của bạn:</p>
                    <div class="pick-grid">
                        ${tgt.validOwnTiles.map(idx => `
                            <button type="button" class="pick-btn ${this.chanceSwapDraft.ownTile === idx ? 'selected' : ''}" data-cown="${idx}">
                                <span>${escapeHtml(BOARD_TILES[idx].name)}</span>
                                <span>${formatShortMoney(engine.getTileInvestment(idx))}</span>
                            </button>
                        `).join('')}
                    </div>
                    <p class="muted-text" style="margin-bottom:6px">2. Chọn thành phố đối thủ:</p>
                    <div class="pick-grid">
                        ${tgt.validOppTiles.map(idx => {
                            const p = state.properties[idx];
                            const o = engine.getPlayer(p.ownerId);
                            return `
                                <button type="button" class="pick-btn ${this.chanceSwapDraft.targetTile === idx ? 'selected' : ''}" data-copp="${idx}">
                                    <span>${escapeHtml(BOARD_TILES[idx].name)} (${o?.avatar})</span>
                                    <span>${p.shielded ? '🛡️' : formatShortMoney(engine.getTileInvestment(idx))}</span>
                                </button>
                            `;
                        }).join('')}
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary" id="btn-skip-swap">Bỏ qua</button>
                        <button type="button" class="btn btn-arcade-blue" id="btn-confirm-swap">🔄 Hoán đổi</button>
                    </div>
                `;
            }

            this._openBizCardModal(title, '#f97316', body, null, true);

            document.querySelectorAll('[data-ctgt]').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.handlers.onAction({ type: 'PICK_CHANCE_TARGET', payload: { tileIndex: Number(btn.dataset.ctgt) } });
                });
            });
            document.querySelectorAll('[data-cown]').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.chanceSwapDraft.ownTile = Number(btn.dataset.cown);
                    this._renderChanceTargetModal(engine, ctx);
                });
            });
            document.querySelectorAll('[data-crec]').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.chanceSwapDraft.recipientId = btn.dataset.crec;
                    this._renderChanceTargetModal(engine, ctx);
                });
            });
            document.querySelectorAll('[data-copp]').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.chanceSwapDraft.targetTile = Number(btn.dataset.copp);
                    this._renderChanceTargetModal(engine, ctx);
                });
            });
            document.getElementById('btn-confirm-gift')?.addEventListener('click', () => {
                this.handlers.onAction({
                    type: 'PICK_CHANCE_TARGET',
                    payload: { ownTile: this.chanceSwapDraft.ownTile, recipientId: this.chanceSwapDraft.recipientId }
                });
            });
            document.getElementById('btn-confirm-swap')?.addEventListener('click', () => {
                this.handlers.onAction({
                    type: 'PICK_CHANCE_TARGET',
                    payload: { ownTile: this.chanceSwapDraft.ownTile, targetTile: this.chanceSwapDraft.targetTile }
                });
            });
            document.getElementById('btn-skip-swap')?.addEventListener('click', () => {
                this.handlers.onAction({ type: 'SKIP_CHANCE_TARGET' });
            });
        }

        // ==================== SELL DEBT MODAL ====================
        _renderSellDebtModal(engine, ctx) {
            const state = engine.getState();
            const debt = state.pendingDebt;
            if (!debt) return;
            const debtor = engine.getPlayer(debt.debtorId);
            const canAct = debtor && ctx.canAct(debtor.id);
            const needed = Math.max(0, debt.amount - debtor.cash);
            const owned = engine.getOwnedTileIndices(debtor.id);

            let selectedTotal = 0;
            for (const idx of this.sellSelectedSet) {
                if (state.properties[idx]?.ownerId === debtor.id) {
                    selectedTotal += engine.getSaleValue(idx);
                }
            }

            const body = `
                <p style="text-align:center;margin-bottom:6px"><strong>${escapeHtml(debtor.name)}</strong> cần thanh toán <strong>${formatMoney(debt.amount)}</strong> (${escapeHtml(debt.reason)}).</p>
                <p style="text-align:center;margin-bottom:10px">Còn thiếu: <strong style="color:#dc2626">${formatMoney(needed)}</strong> • Đã chọn bán: <strong style="color:#16a34a">${formatMoney(selectedTotal)}</strong></p>
                ${canAct ? `
                    <div class="sell-list">
                        ${owned.length > 0 ? owned.map(idx => {
                            const t = BOARD_TILES[idx];
                            const val = engine.getSaleValue(idx);
                            const checked = this.sellSelectedSet.has(idx) ? 'checked' : '';
                            return `
                                <label class="sell-row">
                                    <span><input type="checkbox" class="sell-check" value="${idx}" ${checked}> ${escapeHtml(t.name)}</span>
                                    <span style="color:#16a34a">+${formatMoney(val)}</span>
                                </label>
                            `;
                        }).join('') : '<p class="muted-text" style="text-align:center">Không còn tài sản để bán.</p>'}
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-danger btn-sm" id="btn-debt-bankrupt">🏳️ PHÁ SẢN</button>
                        <button type="button" class="btn btn-accent btn-sm" id="btn-debt-auto" ${owned.length === 0 ? 'disabled' : ''}>⚡ BÁN TỰ ĐỘNG</button>
                        <button type="button" class="btn btn-arcade-blue btn-sm" id="btn-debt-sell" ${this.sellSelectedSet.size === 0 ? 'disabled' : ''}>💰 BÁN ĐÃ CHỌN</button>
                    </div>
                ` : `<div class="modal-actions"><span class="waiting-pill">⏳ Đang chờ ${escapeHtml(debtor.name)} bán đất...</span></div>`}
            `;

            this._openBizCardModal('CHỌN THÀNH PHỐ ĐỂ BÁN', '#e11d48', body, () => this._minimizePhaseModal(state));

            document.querySelectorAll('.sell-check').forEach(chk => {
                chk.addEventListener('change', () => {
                    const idx = Number(chk.value);
                    if (chk.checked) this.sellSelectedSet.add(idx);
                    else this.sellSelectedSet.delete(idx);
                    this._renderSellDebtModal(engine, ctx);
                });
            });
            document.getElementById('btn-debt-sell')?.addEventListener('click', () => {
                this.handlers.onAction({ type: 'SELL_DEBT_PROPS', tileIndices: [...this.sellSelectedSet] });
            });
            document.getElementById('btn-debt-auto')?.addEventListener('click', () => {
                this.handlers.onAction({ type: 'AUTO_SELL_DEBT' });
            });
            document.getElementById('btn-debt-bankrupt')?.addEventListener('click', () => {
                this.handlers.onAction({ type: 'DECLARE_BANKRUPTCY' });
            });
        }

        // ==================== SỔ ĐỎ (INSPECT ANY TILE) ====================
        openDeedModal(tileIndex) {
            if (!this._lastEngine) return;
            this.deedPreviewTier = null;
            this.activeModal = { type: 'deed', tileIndex };
            this._renderDeedModal(this._lastEngine, tileIndex);
        }

        _renderDeedModal(engine, tileIndex) {
            const tile = BOARD_TILES[tileIndex];
            const state = engine.getState();
            const prop = state.properties[tileIndex];
            const owner = prop?.ownerId ? engine.getPlayer(prop.ownerId) : null;

            let body = '';
            if (prop) {
                body += owner
                    ? `<p style="text-align:center;margin-bottom:8px;font-weight:700">Chủ sở hữu: <span style="color:${owner.color}">${owner.avatar} ${escapeHtml(owner.name)}</span></p>`
                    : `<p style="text-align:center;margin-bottom:8px" class="muted-text">Chưa có chủ sở hữu • Giá: <strong>${formatMoney(tile.price)}</strong></p>`;
            }

            if (tile.type === 'city') {
                const tier = this.deedPreviewTier !== null ? this.deedPreviewTier : (prop?.level || 0);
                const rentVal = tile.rent[tier];
                body += this._buildCityTierCards(tile, tier, owner ? prop.level : -1);
                body += `
                    <div style="display:flex;justify-content:center;gap:6px;margin-bottom:6px">
                        <button type="button" class="btn btn-xs ${tier === 4 ? 'btn-arcade-blue' : 'btn-accent'}" data-dtier="4">🏨 Khách Sạn (${formatMoney(tile.rent[4])})</button>
                    </div>
                    <div class="rent-preview-line">
                        <span>Tiền thuê${tier === 4 ? ' Khách sạn' : ''}:</span>
                        <strong>${formatMoney(rentVal)}</strong>
                        ${Art ? Art.banknoteSvg(20) : ''}
                    </div>
                    <div class="biz-subline">
                        <span>Xây nhà: <strong>${formatMoney(tile.houseCost)}</strong> • Khách sạn: <strong>${formatMoney(tile.hotelCost)}</strong> • Bán lại: <strong>${formatMoney(engine.getSaleValue(tileIndex))}</strong></span>
                    </div>
                `;
            } else if (tile.type === 'resort') {
                body += `
                    <table class="deed-table">
                        <tr><td>Giá mua Khu nghỉ dưỡng</td><td>${formatMoney(tile.price)}</td></tr>
                        <tr><td>1 Bãi biển</td><td>25 000</td></tr>
                        <tr><td>2 Bãi biển</td><td>50 000</td></tr>
                        <tr><td>3 Bãi biển</td><td>100 000</td></tr>
                        <tr><td>4 Bãi biển</td><td>200 000 (THẮNG NGAY!)</td></tr>
                    </table>
                `;
            } else {
                body += `<p style="text-align:center;padding:12px 6px">${escapeHtml(tile.description || tile.name)}</p>`;
            }

            this._openBizCardModal(tile.name, this._getRibbonColor(tile), body, () => this.closeModal());

            document.querySelectorAll('[data-tier], [data-dtier]').forEach(el => {
                el.addEventListener('click', () => {
                    this.deedPreviewTier = Number(el.dataset.tier ?? el.dataset.dtier);
                    this._renderDeedModal(engine, tileIndex);
                });
            });
        }

        // ==================== VICTORY / RULES / EXIT ====================
        _renderVictoryModal(engine) {
            const state = engine.getState();
            const winner = engine.getPlayer(state.winnerId);
            const reasonMap = {
                RESORT_MONOPOLY: '🏝️ Độc chiếm toàn bộ 4 Bãi Biển!',
                TRIPLE_MONOPOLY: '🎨 Sở hữu 3 Bộ Màu Độc Quyền!',
                LINE_MONOPOLY: '📏 Chiếm trọn 1 Cạnh bàn cờ!',
                BANKRUPTCY: '💥 Tất cả đối thủ phá sản!',
                TIME_UP: '⏰ Hết thời gian thi đấu!'
            };
            const ranked = state.players.slice().sort((a, b) => {
                if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
                return engine.getNetWorth(b.id) - engine.getNetWorth(a.id);
            });

            const body = `
                <div style="text-align:center;margin-bottom:10px">
                    <div style="font-size:44px">👑</div>
                    <h2 style="color:#d97706;margin:4px 0">${escapeHtml(winner?.name || 'Nhà vô địch')}</h2>
                    <p style="font-weight:700;color:#0284c7">${reasonMap[state.winReason] || 'Chiến thắng!'}</p>
                </div>
                <div class="ranking-list">
                    ${ranked.map((p, i) => `
                        <div class="ranking-item">
                            <span>#${i + 1} ${p.avatar} <strong>${escapeHtml(p.name)}</strong></span>
                            <span>${p.bankrupt ? 'BANKRUPT' : formatMoney(engine.getNetWorth(p.id))}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn btn-arcade-blue btn-lg btn-block" id="btn-victory-lobby">🏠 Về Sảnh Chính</button>
                </div>
            `;

            this._openBizCardModal('VICTORY — CHIẾN THẮNG!', '#f59e0b', body, null);
            document.getElementById('btn-victory-lobby')?.addEventListener('click', () => {
                this.closeModal();
                this.handlers.onExitToLobby();
            });
        }

        openRulesModal() {
            this.activeModal = { type: 'rules' };
            const body = `
                <div class="rules-list">
                    <p>• <strong>5 Cách Chiến Thắng:</strong> (1) Tất cả đối thủ phá sản; (2) Sở hữu <strong>4 Bãi Biển</strong> (Bali, Cyprus, Dubai, Nice); (3) Đủ <strong>3 Bộ Màu</strong>; (4) Sở hữu trọn vẹn <strong>1 Cạnh bàn cờ</strong>; (5) Nhiều tài sản nhất khi hết giờ.</p>
                    <p>• <strong>Xây Nhà &amp; Khách Sạn:</strong> Khi mua đất mới có thể chọn xây ngay tới <strong>3 Nhà</strong>. Ở vòng sau khi dừng lại chính đất mình mới nâng lên <strong>Khách Sạn</strong>.</p>
                    <p>• <strong>Mua Lại (Repurchase):</strong> Khi vào đất đối thủ (chưa là Khách sạn &amp; không phải Bãi biển), sau khi trả tiền thuê bạn có thể trả <strong>gấp đôi giá trị</strong> để mua lại!</p>
                    <p>• <strong>World Championships:</strong> Đứng tại ô góc trên để tổ chức Giải Vô Địch (50 000) nhân tiền thuê <strong>×2..×5</strong> cho 1 thành phố của bạn.</p>
                    <p>• <strong>World Tour:</strong> Vào ô góc phải để lượt sau bay thẳng tới ô bất kỳ trên bàn cờ (phí 50 000).</p>
                    <p>• <strong>Đảo Hoang (Lost Island):</strong> Thoát đảo bằng cách tung Đôi, nộp 200 000, dùng Thẻ Thoát Đảo hoặc chờ đủ 3 lượt.</p>
                </div>
            `;
            this._openBizCardModal('LUẬT CHƠI CỜ TỶ PHÚ', '#16a34a', body, () => {
                this.closeModal();
                if (this._lastEngine) this._renderPhaseOrCustomModal(this._lastEngine, this._lastCtx);
            }, true);
        }

        openConfirmExitModal() {
            this.activeModal = { type: 'confirm_exit' };
            const body = `
                <p style="text-align:center;margin-bottom:14px" class="muted-text">Tiến trình ván đấu hiện tại sẽ kết thúc và bạn sẽ quay lại màn hình sảnh chính.</p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-secondary" id="btn-stay">Ở lại chơi tiếp</button>
                    <button type="button" class="btn btn-danger" id="btn-confirm-exit">Rời khỏi ván</button>
                </div>
            `;
            this._openBizCardModal('RỜI VÁN ĐẤU?', '#e11d48', body, () => {
                this.closeModal();
                if (this._lastEngine) this._renderPhaseOrCustomModal(this._lastEngine, this._lastCtx);
            });
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
