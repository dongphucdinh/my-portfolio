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
            onStatus: (status, detail) => {
                showOnlineBanner(detail, false);
            },
            onError: (msg) => {
                showOnlineBanner(msg, true);
                ui.showToast(msg, true);
            },
            onLobbyUpdate: (lobby) => {
                renderOnlineLobby(lobby);
            },
            onGameState: (snapshot) => {
                engine.importState(snapshot);
                enterGameArena();
                renderGame();
            },
            onHostAction: (peerPlayerId, action) => {
                handleHostReceivedAction(peerPlayerId, action);
            },
            onPeerDroppedInGame: (slotId, slotName) => {
                if (!engine.getState()) return;
                const p = engine.getPlayer(slotId);
                if (p) {
                    p.connected = false;
                    p.isBot = true;
                    engine._addLog(`${slotName} đã mất kết nối — Bot AI tự động tiếp quản!`, 'system');
                    network.broadcastGameState(engine.exportState());
                    renderGame();
                    scheduleBotTurnIfNeeded();
                }
            },
            onHostDisconnected: () => {
                if (!document.getElementById('screen-game').classList.contains('hidden')) {
                    ui.showToast('Chủ phòng đã thoát!', true);
                    exitToLobby();
                } else {
                    renderOnlineLobby(null);
                }
            },
            onChatMessage: (msg) => {
                ui.appendChatMessage(msg);
            }
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
            if (b2) b2.textContent = sound.muted ? '🔇' : '🔊';
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
            const addBotBtn = document.getElementById('btn-online-add-bot');
            const hostCtrl = document.getElementById('online-host-controls');
            const clientCtrl = document.getElementById('online-client-controls');
            const startBtn = document.getElementById('btn-start-online');

            addBotBtn?.classList.toggle('hidden', !isHost || lobby.slots.length >= 4);
            hostCtrl?.classList.toggle('hidden', !isHost);
            clientCtrl?.classList.toggle('hidden', isHost);
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
                btn.addEventListener('click', () => {
                    network.removeBotFromLobby(btn.dataset.rmbot);
                });
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
            const startingCash = Number(document.getElementById('local-starting-cash').value) || 1500;
            const freeParkingJackpot = Boolean(document.getElementById('local-free-parking').checked);

            appState.mode = 'local';
            engine.initGame(players, { startingCash, freeParkingJackpot });
            ui.clearChat();
            ui.resetVisualTracking(engine.getState());
            enterGameArena();
            renderGame();
            scheduleBotTurnIfNeeded();
        });

        // Online Room Actions
        document.getElementById('btn-create-room')?.addEventListener('click', async () => {
            const name = document.getElementById('online-name').value.trim() || 'Chủ phòng';
            const startingCash = Number(document.getElementById('online-starting-cash').value) || 1500;
            const freeParkingJackpot = Boolean(document.getElementById('online-free-parking').checked);

            showOnlineBanner('Đang khởi tạo phòng P2P...');
            try {
                await network.createRoom(
                    { name, avatar: appState.onlineAvatar },
                    { startingCash, freeParkingJackpot }
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

        document.getElementById('btn-online-add-bot')?.addEventListener('click', () => {
            network.addBotToLobby();
        });

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
            scheduleBotTurnIfNeeded();
        });

        function leaveOnlineLobby() {
            network.disconnect();
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
        }

        function exitToLobby() {
            clearTimeout(appState.botTimer);
            appState.botTimer = null;
            network.disconnect();
            appState.mode = 'local';
            ui.resetVisualTracking(null);
            showOnlineBanner('');
            renderOnlineLobby(null);
            document.getElementById('screen-game').classList.add('hidden');
            document.getElementById('screen-lobby').classList.remove('hidden');
        }

        function getRequiredActorId(state) {
            if (!state) return null;
            if (state.phase === 'AUCTION' && state.auction) {
                return state.auction.participants[state.auction.activeIndex] || null;
            }
            if (state.phase === 'DEBT_RESOLUTION' && state.pendingDebt) {
                return state.pendingDebt.debtorId;
            }
            if (state.phase === 'TRADE_OFFER' && state.trade) {
                return state.trade.toId;
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
                case 'PAY_JAIL_BAIL': res = engine.payJailBail(actorId); break;
                case 'USE_JAIL_CARD': res = engine.useJailCard(actorId); break;
                case 'BUY_PROPERTY': res = engine.buyProperty(actorId); break;
                case 'START_AUCTION': res = engine.startAuction(actorId); break;
                case 'AUCTION_BID': res = engine.placeAuctionBid(actorId, action.amount); break;
                case 'AUCTION_PASS': res = engine.passAuction(actorId); break;
                case 'CONFIRM_CARD': res = engine.confirmCard(actorId); break;
                case 'BUILD_HOUSE': res = engine.buildHouse(actorId, action.tileIndex); break;
                case 'SELL_HOUSE': res = engine.sellHouse(actorId, action.tileIndex); break;
                case 'MORTGAGE': res = engine.mortgageProperty(actorId, action.tileIndex); break;
                case 'UNMORTGAGE': res = engine.unmortgageProperty(actorId, action.tileIndex); break;
                case 'RESOLVE_DEBT': res = { ok: engine.resolveDebtIfPaid(actorId) }; break;
                case 'DECLARE_BANKRUPTCY': res = engine.declareBankruptcy(actorId); break;
                case 'PROPOSE_TRADE': res = engine.proposeTrade(actorId, action.payload); break;
                case 'ACCEPT_TRADE': res = engine.acceptTrade(actorId); break;
                case 'REJECT_TRADE': res = engine.rejectTrade(actorId); break;
                case 'END_TURN': res = engine.endTurn(actorId); break;
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

        function resolveActorForUserAction(state, action) {
            if (action.type === 'REJECT_TRADE' && state.trade) {
                if (appState.mode === 'local') return state.trade.toId;
                return network.localPlayerId;
            }
            if (action.type === 'ACCEPT_TRADE' && state.trade) return state.trade.toId;
            if (action.type === 'AUCTION_BID' || action.type === 'AUCTION_PASS') return engine.getAuctionActiveBidderId();
            if (action.type === 'RESOLVE_DEBT' || action.type === 'DECLARE_BANKRUPTCY') return state.pendingDebt?.debtorId;
            return engine.getCurrentPlayer()?.id;
        }

        function dispatchUserAction(action) {
            const state = engine.getState();
            if (!state) return;

            if (appState.mode === 'online-client') {
                network.sendAction(action);
                return;
            }

            const actorId = resolveActorForUserAction(state, action);
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

            // Authorization check
            if (action.type === 'REJECT_TRADE' && state.trade) {
                if (peerPlayerId !== state.trade.toId && peerPlayerId !== state.trade.fromId) return;
            } else if (action.type === 'ACCEPT_TRADE' && state.trade) {
                if (peerPlayerId !== state.trade.toId) return;
            } else if (action.type === 'AUCTION_BID' || action.type === 'AUCTION_PASS') {
                if (peerPlayerId !== engine.getAuctionActiveBidderId()) return;
            } else if (action.type === 'RESOLVE_DEBT' || action.type === 'DECLARE_BANKRUPTCY') {
                if (peerPlayerId !== state.pendingDebt?.debtorId) return;
            } else {
                const current = engine.getCurrentPlayer();
                if (!current || peerPlayerId !== current.id) return;
            }

            executeEngineAction(peerPlayerId, action);
        }

        function scheduleBotTurnIfNeeded() {
            clearTimeout(appState.botTimer);
            appState.botTimer = null;
            if (appState.mode === 'online-client') return;
            const state = engine.getState();
            if (!state || state.phase === 'GAME_OVER') return;

            const actorId = getRequiredActorId(state);
            const actor = engine.getPlayer(actorId);
            if (!actor || actor.bankrupt || !actor.isBot) return;

            const delay = (state.phase === 'AUCTION' || state.phase === 'DEBT_RESOLUTION') ? 450 : 750;
            appState.botTimer = setTimeout(() => {
                const curState = engine.getState();
                if (!curState || curState.phase === 'GAME_OVER') return;
                const action = chooseAction(engine, actor.id);
                if (action) {
                    executeEngineAction(actor.id, action);
                }
            }, delay);
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
        document.getElementById('btn-open-manage')?.addEventListener('click', () => ui.openManageModal());
        document.getElementById('btn-open-trade')?.addEventListener('click', () => ui.openTradeModal());
        document.getElementById('online-room-chip')?.addEventListener('click', async () => {
            if (!network.roomCode) return;
            try {
                await navigator.clipboard.writeText(network.roomCode);
                ui.showToast(`Đã copy mã phòng: ${network.roomCode}`);
            } catch (_) {}
        });

        // Chat
        document.getElementById('chat-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const inp = document.getElementById('chat-input');
            const text = inp.value.trim();
            if (!text) return;
            network.sendChat(text, { avatar: appState.onlineAvatar });
            inp.value = '';
        });

        document.querySelectorAll('.emoji-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                network.sendChat(btn.dataset.emoji, { avatar: appState.onlineAvatar });
            });
        });

        // Mobile tabs
        document.querySelectorAll('.mobile-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.mtab;
                document.querySelectorAll('.mobile-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('[data-mpane]').forEach(p => {
                    p.classList.toggle('active-mobile-pane', p.dataset.mpane === target);
                });
            });
        });

        // Check ?room=CODE in URL
        const params = new URLSearchParams(window.location.search);
        const roomParam = params.get('room');
        if (roomParam) {
            const clean = roomParam.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
            if (clean) {
                document.querySelector('.mode-tab[data-mode="online"]')?.click();
                const joinInput = document.getElementById('join-room-code');
                if (joinInput) joinInput.value = clean;
            }
        }

        updateSoundLabels();
        renderLocalSlots();
        renderOnlineAvatarPicker();
    });
})(window);
