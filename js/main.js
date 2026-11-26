(function (global) {
    'use strict';

    const {
        AVATARS,
        PLAYER_COLORS,
        SoundFX,
        GameEngine,
        chooseAction,
        NetworkManager,
        GameUI
    } = global.CoTyPhu;

    document.addEventListener('DOMContentLoaded', () => {
        const sound = new SoundFX();
        const engine = new GameEngine();

        const appState = {
            mode: 'local', // 'local' | 'online-host' | 'online-client'
            botTimer: null,
            disconnectBotTimer: null,
            matchTimer: null,
            localSlots: [
                { name: 'Bạn', avatar: AVATARS[0], isBot: false },
                { name: 'Bot Minh', avatar: AVATARS[1], isBot: true },
                { name: 'Bot Lan', avatar: AVATARS[2], isBot: true },
                { name: 'Bot Hùng', avatar: AVATARS[3], isBot: true }
            ],
            onlineAvatar: AVATARS[0]
        };

        const ui = new GameUI(sound, {
            onAction: (action) => dispatchUserAction(action),
            onExitToLobby: () => exitToLobby()
        });

        const network = new NetworkManager({
            onStatus: (_, detail) => showOnlineBanner(detail, false),
            onError: (msg) => {
                showOnlineBanner(msg, true);
                ui.showToast(msg, true);
            },
            onConnectionState: (isOnline) => {
                const pill = document.getElementById('conn-status-pill');
                if (!pill) return;
                pill.textContent = isOnline ? '🟢 Online' : '🟡 Đang nối lại...';
                pill.classList.toggle('reconnecting', !isOnline);
            },
            onLobbyUpdate: (lobby) => renderOnlineLobby(lobby),
            onGameState: (snapshot) => {
                if (network.roomCode) {
                    appState.mode = network.role === 'host' ? 'online-host' : 'online-client';
                }
                const wasHidden = document.getElementById('screen-game').classList.contains('hidden');
                engine.importState(snapshot);
                if (wasHidden) {
                    ui.resetVisualTracking(engine.getState());
                    enterGameArena();
                    if (appState.mode === 'online-host') {
                        startMatchTimerLoop();
                        scheduleBotTurnIfNeeded();
                    }
                }
                renderGame();
            },
            onHostAction: (peerPlayerId, action) => handleHostReceivedAction(peerPlayerId, action),
            onRoleChanged: (newRole) => {
                if (newRole === 'host') {
                    appState.mode = 'online-host';
                    ui.showToast('👑 Bạn đã trở thành Chủ phòng mới!');
                    if (engine.getState()) {
                        engine._addLog('👑 Chủ phòng mới đã tiếp quản điều phối trận đấu.', 'system');
                        network.broadcastGameState(engine.exportState());
                        renderGame();
                        startMatchTimerLoop();
                        scheduleBotTurnIfNeeded();
                    }
                }
            },
            onSlotConnectionChange: (slotId, isConnected, slotName) => {
                if (!engine.getState()) return;
                const p = engine.getPlayer(slotId);
                if (!p) return;
                p.connected = isConnected;
                if (isConnected) {
                    clearTimeout(appState.disconnectBotTimer);
                    appState.disconnectBotTimer = null;
                }
                if (appState.mode === 'online-host') {
                    engine._addLog(
                        isConnected
                            ? `🔄 ${slotName} đã kết nối lại vào trận!`
                            : `📡 ${slotName} tạm mất kết nối (chờ 12s để kết nối lại)...`,
                        'system'
                    );
                    network.broadcastGameState(engine.exportState());
                    scheduleBotTurnIfNeeded();
                }
                renderGame();
            },
            onHostDisconnected: () => {
                if (!document.getElementById('screen-game').classList.contains('hidden')) {
                    ui.showToast('Phòng đã đóng!', true);
                    exitToLobby();
                } else {
                    renderOnlineLobby(null);
                }
            },
            onChatMessage: (msg) => ui.appendChatMessage(msg)
        });

        function showOnlineBanner(msg, isError = false) {
            const banner = document.getElementById('online-status-banner');
            if (!banner) return;
            if (!msg) {
                banner.classList.add('hidden');
                return;
            }
            banner.textContent = msg;
            banner.className = `status-banner ${isError ? 'error' : ''}`;
        }

        function updateSoundLabels() {
            const label = sound.muted ? '🔇 Âm thanh: Tắt' : '🔊 Âm thanh: Bật';
            const b1 = document.getElementById('btn-lobby-sound');
            const b2 = document.getElementById('btn-sound');
            if (b1) b1.textContent = label;
            const b2Span = b2?.querySelector('span');
            if (b2Span) b2Span.textContent = sound.muted ? '🔇' : '🔊';
            else if (b2) b2.textContent = sound.muted ? '🔇' : '🔊';
        }

        // --- LOBBY SETUP ---
        function renderLocalSlots() {
            const container = document.getElementById('local-players-editor');
            if (!container) return;
            container.innerHTML = appState.localSlots.map((slot, idx) => `
                <div class="player-slot-card" style="border-left: 4px solid ${PLAYER_COLORS[idx % PLAYER_COLORS.length]}">
                    <div class="slot-top">
                        <button type="button" class="avatar-cycle-btn" data-cycle="${idx}" title="Đổi biểu tượng">${slot.avatar}</button>
                        <input type="text" class="slot-name-input" data-name="${idx}" maxlength="18" value="${slot.name.replace(/"/g, '&quot;')}">
                        ${appState.localSlots.length > 2 ? `<button type="button" class="btn btn-danger btn-xs" data-remove="${idx}" title="Xóa">✕</button>` : ''}
                    </div>
                    <div class="slot-bottom">
                        <span class="muted-text">Vị trí #${idx + 1}</span>
                        <div class="bot-toggle-group">
                            <button type="button" class="bot-toggle-btn ${!slot.isBot ? 'active' : ''}" data-bot="${idx}:0">Người</button>
                            <button type="button" class="bot-toggle-btn ${slot.isBot ? 'active' : ''}" data-bot="${idx}:1">Bot AI</button>
                        </div>
                    </div>
                </div>
            `).join('');

            const addBtn = document.getElementById('btn-add-local-player');
            if (addBtn) addBtn.disabled = appState.localSlots.length >= 4;

            container.querySelectorAll('[data-cycle]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.cycle);
                    const cur = AVATARS.indexOf(appState.localSlots[idx].avatar);
                    appState.localSlots[idx].avatar = AVATARS[(cur + 1) % AVATARS.length];
                    renderLocalSlots();
                });
            });

            container.querySelectorAll('[data-name]').forEach(inp => {
                inp.addEventListener('input', () => {
                    appState.localSlots[Number(inp.dataset.name)].name = inp.value;
                });
            });

            container.querySelectorAll('[data-remove]').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (appState.localSlots.length <= 2) return;
                    appState.localSlots.splice(Number(btn.dataset.remove), 1);
                    renderLocalSlots();
                });
            });

            container.querySelectorAll('[data-bot]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const [idx, val] = btn.dataset.bot.split(':').map(Number);
                    appState.localSlots[idx].isBot = val === 1;
                    renderLocalSlots();
                });
            });
        }

        function renderOnlineAvatarPicker() {
            const box = document.getElementById('online-avatar-picker');
            if (!box) return;
            box.innerHTML = AVATARS.map(a => `
                <button type="button" class="avatar-option ${a === appState.onlineAvatar ? 'selected' : ''}" data-ava="${a}">${a}</button>
            `).join('');
            box.querySelectorAll('[data-ava]').forEach(btn => {
                btn.addEventListener('click', () => {
                    appState.onlineAvatar = btn.dataset.ava;
                    renderOnlineAvatarPicker();
                });
            });
        }

        function renderOnlineLobby(lobby) {
            const entryView = document.getElementById('online-entry-view');
            const roomPanel = document.getElementById('online-room-panel');
            if (!lobby) {
                entryView?.classList.remove('hidden');
                roomPanel?.classList.add('hidden');
                return;
            }
            entryView?.classList.add('hidden');
            roomPanel?.classList.remove('hidden');

            document.getElementById('room-code-display').textContent = lobby.roomCode;
            document.getElementById('online-slot-count').textContent = String(lobby.slots.length);

            const isHost = network.role === 'host';
            document.getElementById('btn-online-add-bot')?.classList.toggle('hidden', !isHost || lobby.slots.length >= 4);
            document.getElementById('online-host-controls')?.classList.toggle('hidden', !isHost);
            document.getElementById('online-client-controls')?.classList.toggle('hidden', isHost);
            const startBtn = document.getElementById('btn-start-online');
            if (startBtn) startBtn.disabled = lobby.slots.length < 2;

            const listEl = document.getElementById('online-slots-list');
            listEl.innerHTML = lobby.slots.map(s => {
                const badges = [];
                if (s.isHost) badges.push('<span class="badge badge-host">Chủ phòng</span>');
                if (s.isBot) badges.push('<span class="badge badge-bot">Bot AI</span>');
                if (s.id === network.localPlayerId) badges.push('<span class="badge badge-you">Bạn</span>');
                const safeName = s.name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                return `
                    <div class="online-slot-item" style="border-left-color:${s.color}">
                        <div class="online-slot-meta">
                            <span class="ava">${s.avatar}</span>
                            <div>
                                <div><strong>${safeName}</strong></div>
                                <div>${badges.join(' ')}</div>
                            </div>
                        </div>
                        ${isHost && s.isBot ? `<button type="button" class="btn btn-danger btn-xs" data-rmbot="${s.id}">Xóa</button>` : ''}
                    </div>
                `;
            }).join('');

            listEl.querySelectorAll('[data-rmbot]').forEach(btn => {
                btn.addEventListener('click', () => network.removeBotFromLobby(btn.dataset.rmbot));
            });
        }

        // Mode Tabs
        document.querySelectorAll('.mode-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.mode-tab').forEach(t => {
                    t.classList.remove('active');
                    t.setAttribute('aria-selected', 'false');
                });
                document.querySelectorAll('.mode-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                tab.setAttribute('aria-selected', 'true');
                document.getElementById(`panel-${tab.dataset.mode}`)?.classList.add('active');
            });
        });

        // Presets
        document.querySelectorAll('[data-preset]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.preset === '1v3') {
                    appState.localSlots = [
                        { name: 'Bạn', avatar: AVATARS[0], isBot: false },
                        { name: 'Bot Minh', avatar: AVATARS[1], isBot: true },
                        { name: 'Bot Lan', avatar: AVATARS[2], isBot: true },
                        { name: 'Bot Hùng', avatar: AVATARS[3], isBot: true }
                    ];
                } else {
                    appState.localSlots = [
                        { name: 'Người chơi 1', avatar: AVATARS[0], isBot: false },
                        { name: 'Người chơi 2', avatar: AVATARS[1], isBot: false }
                    ];
                }
                renderLocalSlots();
            });
        });

        document.getElementById('btn-add-local-player')?.addEventListener('click', () => {
            if (appState.localSlots.length >= 4) return;
            const n = appState.localSlots.length + 1;
            appState.localSlots.push({
                name: `Người chơi ${n}`,
                avatar: AVATARS[(n - 1) % AVATARS.length],
                isBot: true
            });
            renderLocalSlots();
        });

        // Start Local Game
        document.getElementById('btn-start-local')?.addEventListener('click', () => {
            const players = appState.localSlots.map((s, idx) => ({
                id: `p${idx + 1}`,
                name: s.name.trim() || `Người chơi ${idx + 1}`,
                avatar: s.avatar,
                color: PLAYER_COLORS[idx % PLAYER_COLORS.length],
                isBot: s.isBot,
                connected: true
            }));
            const startingCash = Number(document.getElementById('local-starting-cash').value) || 2000000;
            const matchMinutes = Number(document.getElementById('local-match-minutes').value);

            appState.mode = 'local';
            engine.initGame(players, { startingCash, matchMinutes });
            ui.clearChat();
            ui.resetVisualTracking(engine.getState());
            enterGameArena();
            renderGame();
            startMatchTimerLoop();
            scheduleBotTurnIfNeeded();
        });

        // Online Room Actions
        document.getElementById('btn-create-room')?.addEventListener('click', async () => {
            const name = document.getElementById('online-name').value.trim() || 'Chủ phòng';
            const startingCash = Number(document.getElementById('online-starting-cash').value) || 2000000;
            const matchMinutes = Number(document.getElementById('online-match-minutes').value);

            showOnlineBanner('Đang khởi tạo phòng P2P...');
            try {
                await network.createRoom(
                    { name, avatar: appState.onlineAvatar },
                    { startingCash, matchMinutes }
                );
                appState.mode = 'online-host';
                ui.showToast(`Đã mở phòng ${network.roomCode}!`);
            } catch (err) {
                showOnlineBanner(err.message, true);
                ui.showToast(err.message, true);
            }
        });

        document.getElementById('btn-join-room')?.addEventListener('click', async () => {
            const code = document.getElementById('join-room-code').value;
            const name = document.getElementById('online-name').value.trim() || 'Khách';
            showOnlineBanner('Đang kết nối tới chủ phòng...');
            try {
                await network.joinRoom(code, { name, avatar: appState.onlineAvatar });
                appState.mode = 'online-client';
                ui.showToast(`Đã vào phòng ${network.roomCode}!`);
            } catch (err) {
                showOnlineBanner(err.message, true);
                ui.showToast(err.message, true);
            }
        });

        document.getElementById('btn-copy-code')?.addEventListener('click', async () => {
            if (!network.roomCode) return;
            try {
                await navigator.clipboard.writeText(network.roomCode);
                ui.showToast(`Đã sao chép mã phòng: ${network.roomCode}`);
            } catch (_) {
                ui.showToast(`Mã phòng: ${network.roomCode}`);
            }
        });

        document.getElementById('btn-copy-link')?.addEventListener('click', async () => {
            const url = network.getShareUrl();
            if (!url) return;
            try {
                await navigator.clipboard.writeText(url);
                ui.showToast('Đã sao chép link mời bạn bè!');
            } catch (_) {
                ui.showToast(url);
            }
        });

        document.getElementById('btn-online-add-bot')?.addEventListener('click', () => network.addBotToLobby());

        document.getElementById('btn-start-online')?.addEventListener('click', () => {
            if (network.role !== 'host' || !network.lobby || network.lobby.slots.length < 2) return;
            const players = network.lobby.slots.map(s => ({
                id: s.id,
                name: s.name,
                avatar: s.avatar,
                color: s.color,
                isBot: s.isBot,
                connected: s.connected
            }));
            engine.initGame(players, network.lobby.config);
            ui.clearChat();
            ui.resetVisualTracking(engine.getState());
            network.markGameStarted(engine.exportState());
            enterGameArena();
            renderGame();
            startMatchTimerLoop();
            scheduleBotTurnIfNeeded();
        });

        function leaveOnlineLobby() {
            network.disconnect(true);
            appState.mode = 'local';
            showOnlineBanner('');
            renderOnlineLobby(null);
        }

        document.getElementById('btn-leave-room')?.addEventListener('click', leaveOnlineLobby);
        document.getElementById('btn-leave-room-client')?.addEventListener('click', leaveOnlineLobby);

        // --- ARENA & GAME LOOP ---
        function enterGameArena() {
            document.getElementById('screen-lobby').classList.add('hidden');
            document.getElementById('screen-game').classList.remove('hidden');
            const feed = document.getElementById('left-feed-dock');
            if (feed) {
                feed.classList.toggle('collapsed', window.innerWidth <= 920);
            }
        }

        function exitToLobby() {
            clearTimeout(appState.botTimer);
            clearTimeout(appState.disconnectBotTimer);
            clearInterval(appState.matchTimer);
            appState.botTimer = null;
            appState.disconnectBotTimer = null;
            appState.matchTimer = null;
            network.disconnect(true);
            appState.mode = 'local';
            ui.resetVisualTracking(null);
            showOnlineBanner('');
            renderOnlineLobby(null);
            document.getElementById('screen-game').classList.add('hidden');
            document.getElementById('screen-lobby').classList.remove('hidden');
        }

        function startMatchTimerLoop() {
            clearInterval(appState.matchTimer);
            appState.matchTimer = null;
            if (appState.mode === 'online-client') return;
            const st = engine.getState();
            if (!st || st.remainingSeconds === null) return;

            appState.matchTimer = setInterval(() => {
                const cur = engine.getState();
                if (!cur || cur.phase === 'GAME_OVER' || cur.remainingSeconds === null) {
                    clearInterval(appState.matchTimer);
                    appState.matchTimer = null;
                    return;
                }
                cur.remainingSeconds = Math.max(0, cur.remainingSeconds - 1);
                ui.updateTimerDisplay(cur.remainingSeconds);

                if (cur.remainingSeconds === 0) {
                    clearInterval(appState.matchTimer);
                    appState.matchTimer = null;
                    engine.endByTimer();
                    if (appState.mode === 'online-host') {
                        network.broadcastGameState(engine.exportState());
                    }
                    renderGame();
                } else if (appState.mode === 'online-host' && cur.remainingSeconds % 15 === 0) {
                    network.broadcastGameState(engine.exportState());
                }
            }, 1000);
        }

        function getRequiredActorId(state) {
            if (!state) return null;
            if (state.phase === 'SELL_DEBT' && state.pendingDebt) {
                return state.pendingDebt.debtorId;
            }
            return engine.getCurrentPlayer()?.id || null;
        }

        function buildUiContext() {
            return {
                mode: appState.mode,
                roomCode: network.roomCode,
                localPlayerId: network.localPlayerId,
                canAct: (targetPlayerId) => {
                    const p = engine.getPlayer(targetPlayerId);
                    if (!p || p.bankrupt || p.isBot) return false;
                    if (appState.mode === 'local') return true;
                    return network.localPlayerId === targetPlayerId;
                }
            };
        }

        function renderGame() {
            if (!engine.getState()) return;
            ui.render(engine, buildUiContext());
        }

        function executeEngineAction(actorId, action) {
            if (!engine.getState()) return { ok: false, error: 'Chưa khởi tạo ván đấu.' };
            let res;
            switch (action.type) {
                case 'ROLL_DICE': res = engine.rollDice(actorId); break;
                case 'PAY_JAIL_BAIL': res = engine.payIslandBail(actorId); break;
                case 'USE_JAIL_CARD': res = engine.useEscapeCard(actorId); break;
                case 'FLY_WORLD_TOUR': res = engine.flyWorldTour(actorId, action.tileIndex); break;
                case 'CANCEL_WORLD_TOUR': res = engine.cancelWorldTour(actorId); break;
                case 'BUY_CITY': res = engine.buyCity(actorId, action.targetLevel); break;
                case 'SKIP_BUY': res = engine.skipBuy(actorId); break;
                case 'UPGRADE_CITY': res = engine.upgradeCity(actorId, action.targetLevel); break;
                case 'SKIP_UPGRADE': res = engine.skipUpgrade(actorId); break;
                case 'REPURCHASE_CITY': res = engine.repurchaseCity(actorId); break;
                case 'SKIP_REPURCHASE': res = engine.skipRepurchase(actorId); break;
                case 'HOLD_CHAMPIONSHIP': res = engine.holdChampionship(actorId, action.tileIndex); break;
                case 'SKIP_CHAMPIONSHIP': res = engine.skipChampionship(actorId); break;
                case 'CONFIRM_CHANCE': res = engine.confirmChance(actorId); break;
                case 'PICK_CHANCE_TARGET': res = engine.pickChanceTarget(actorId, action.payload); break;
                case 'SKIP_CHANCE_TARGET': res = engine.skipChanceTarget(actorId); break;
                case 'SELL_DEBT_PROPS': res = engine.sellPropertiesForDebt(actorId, action.tileIndices); break;
                case 'AUTO_SELL_DEBT': res = engine.autoSellForDebt(actorId); break;
                case 'DECLARE_BANKRUPTCY': res = engine.declareBankruptcy(actorId); break;
                default: res = { ok: false, error: 'Hành động không hợp lệ.' };
            }

            if (res && res.ok) {
                if (appState.mode === 'online-host') {
                    network.broadcastGameState(engine.exportState());
                }
                renderGame();
                scheduleBotTurnIfNeeded();
            } else if (res && res.error) {
                if (appState.mode === 'local' || actorId === network.localPlayerId) {
                    ui.showToast(res.error, true);
                }
            }
            return res;
        }

        function dispatchUserAction(action) {
            const state = engine.getState();
            if (!state) return;

            if (appState.mode === 'online-client') {
                network.sendAction(action);
                return;
            }

            const actorId = getRequiredActorId(state);
            if (!actorId) return;
            const actor = engine.getPlayer(actorId);
            if (!actor || actor.isBot) return;
            if (appState.mode === 'online-host' && actorId !== network.localPlayerId) {
                ui.showToast('Chưa tới lượt bạn!', true);
                return;
            }
            executeEngineAction(actorId, action);
        }

        function handleHostReceivedAction(peerPlayerId, action) {
            if (appState.mode !== 'online-host') return;
            const state = engine.getState();
            if (!state || !action || !action.type) return;

            const requiredId = getRequiredActorId(state);
            if (!requiredId || peerPlayerId !== requiredId) return;

            executeEngineAction(peerPlayerId, action);
        }

        function scheduleBotTurnIfNeeded() {
            clearTimeout(appState.botTimer);
            clearTimeout(appState.disconnectBotTimer);
            appState.botTimer = null;
            appState.disconnectBotTimer = null;
            if (appState.mode === 'online-client') return;
            const state = engine.getState();
            if (!state || state.phase === 'GAME_OVER') return;

            const actorId = getRequiredActorId(state);
            const actor = engine.getPlayer(actorId);
            if (!actor || actor.bankrupt) return;

            if (actor.isBot) {
                const delay = state.phase === 'SELL_DEBT' ? 500 : 800;
                appState.botTimer = setTimeout(() => {
                    const curState = engine.getState();
                    if (!curState || curState.phase === 'GAME_OVER') return;
                    const action = chooseAction(engine, actor.id);
                    if (action) {
                        executeEngineAction(actor.id, action);
                    }
                }, delay);
            } else if (appState.mode === 'online-host' && actor.connected === false) {
                appState.disconnectBotTimer = setTimeout(() => {
                    const curState = engine.getState();
                    const curActor = engine.getPlayer(actor.id);
                    if (!curState || curState.phase === 'GAME_OVER' || !curActor || curActor.connected !== false) return;
                    const action = chooseAction(engine, actor.id);
                    if (action) {
                        engine._addLog(`🤖 Bot đi hộ ${curActor.name} vì mất kết nối quá 12s.`, 'system');
                        executeEngineAction(actor.id, action);
                    }
                }, 12000);
            }
        }

        // --- TOOLBAR & CHAT LISTENERS ---
        document.getElementById('btn-lobby-sound')?.addEventListener('click', () => {
            sound.toggleMute();
            updateSoundLabels();
        });
        document.getElementById('btn-sound')?.addEventListener('click', () => {
            sound.toggleMute();
            updateSoundLabels();
        });
        document.getElementById('btn-lobby-rules')?.addEventListener('click', () => ui.openRulesModal());
        document.getElementById('btn-rules')?.addEventListener('click', () => ui.openRulesModal());
        document.getElementById('btn-exit-game')?.addEventListener('click', () => ui.openConfirmExitModal());
        document.getElementById('btn-cancel-world-tour')?.addEventListener('click', () => dispatchUserAction({ type: 'CANCEL_WORLD_TOUR' }));

        document.getElementById('online-room-chip')?.addEventListener('click', async () => {
            if (!network.roomCode) return;
            try {
                await navigator.clipboard.writeText(network.roomCode);
                ui.showToast(`Đã copy mã phòng: ${network.roomCode}`);
            } catch (_) {}
        });

        document.getElementById('chat-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const inp = document.getElementById('chat-input');
            const text = inp.value.trim();
            if (!text) return;
            network.sendChat(text, { avatar: appState.onlineAvatar });
            inp.value = '';
        });

        document.querySelectorAll('.emoji-btn').forEach(btn => {
            btn.addEventListener('click', () => network.sendChat(btn.dataset.emoji, { avatar: appState.onlineAvatar }));
        });

        document.getElementById('btn-toggle-iso')?.addEventListener('click', () => {
            const cam = document.getElementById('iso-camera');
            const isFlat = cam?.classList.toggle('flat-mode');
            ui.showToast(isFlat ? 'Đã chuyển sang góc nhìn 2D phẳng' : 'Đã chuyển sang góc nhìn 3D Isometric');
        });
        document.getElementById('btn-toggle-feed')?.addEventListener('click', () => {
            document.getElementById('left-feed-dock')?.classList.toggle('collapsed');
        });

        updateSoundLabels();
        renderLocalSlots();
        renderOnlineAvatarPicker();

        // Check ?room=CODE in URL & Auto-rejoin previous session on F5
        const params = new URLSearchParams(window.location.search);
        const roomParam = params.get('room');
        const cleanRoomParam = roomParam
            ? roomParam.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
            : '';

        let savedSessionCode = null;
        try {
            const rawSess = localStorage.getItem('cotyphu_session');
            if (rawSess) savedSessionCode = JSON.parse(rawSess)?.roomCode || null;
        } catch (_) {}

        if (cleanRoomParam && cleanRoomParam !== savedSessionCode) {
            document.querySelector('.mode-tab[data-mode="online"]')?.click();
            const joinInput = document.getElementById('join-room-code');
            if (joinInput) joinInput.value = cleanRoomParam;
        } else {
            network.tryAutoRejoin().then(res => {
                if (!res || !res.rejoined) return;
                appState.mode = network.role === 'host' ? 'online-host' : 'online-client';
                document.querySelector('.mode-tab[data-mode="online"]')?.click();
                if (!res.started) {
                    renderOnlineLobby(network.lobby);
                    ui.showToast(`🔄 Đã tự động kết nối lại phòng ${res.roomCode}!`);
                } else {
                    if (engine.getState()) {
                        renderGame();
                        if (appState.mode === 'online-host') {
                            startMatchTimerLoop();
                            scheduleBotTurnIfNeeded();
                        }
                    }
                    ui.showToast(`🔄 Đã tự động vào lại trận ${res.roomCode}!`);
                }
            });
        }
    });
})(window);
