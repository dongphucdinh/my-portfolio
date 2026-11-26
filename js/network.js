(function (global) {
    'use strict';

    const Data = typeof module !== 'undefined' && module.exports
        ? require('./data.js')
        : global.CoTyPhu;

    const { AVATARS, PLAYER_COLORS, DEFAULT_CONFIG } = Data;

    const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const CLIENT_ID_KEY = 'cotyphu_client_id';
    const SESSION_KEY = 'cotyphu_session';
    const SESSION_MAX_AGE_MS = 3 * 60 * 60 * 1000;

    function generateRoomCode() {
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
        }
        return code;
    }

    function getOrCreateClientId() {
        try {
            if (typeof localStorage !== 'undefined') {
                let cid = localStorage.getItem(CLIENT_ID_KEY);
                if (!cid) {
                    cid = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
                    localStorage.setItem(CLIENT_ID_KEY, cid);
                }
                return cid;
            }
        } catch (_) {}
        return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
    }

    function saveSession(data) {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(SESSION_KEY, JSON.stringify(Object.assign({}, data, { ts: Date.now() })));
            }
        } catch (_) {}
    }

    function readSession() {
        try {
            if (typeof localStorage !== 'undefined') {
                const raw = localStorage.getItem(SESSION_KEY);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (!parsed || !parsed.roomCode || (Date.now() - (parsed.ts || 0)) > SESSION_MAX_AGE_MS) {
                    localStorage.removeItem(SESSION_KEY);
                    return null;
                }
                return parsed;
            }
        } catch (_) {}
        return null;
    }

    function clearSession() {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.removeItem(SESSION_KEY);
            }
        } catch (_) {}
    }

    function sortSlotsMapToArray(slotsMap) {
        if (!slotsMap || typeof slotsMap !== 'object') return [];
        const order = ['p1', 'p2', 'p3', 'p4'];
        return Object.keys(slotsMap)
            .sort((a, b) => {
                const ia = order.indexOf(a);
                const ib = order.indexOf(b);
                if (ia !== -1 && ib !== -1) return ia - ib;
                return a.localeCompare(b);
            })
            .map(k => slotsMap[k])
            .filter(Boolean);
    }

    class NetworkManager {
        constructor(callbacks = {}) {
            this.callbacks = callbacks;
            this.clientId = getOrCreateClientId();
            this.db = null;
            this.role = null; // 'host' | 'client' | null
            this.roomCode = null;
            this.localPlayerId = null;
            this.lobby = null;

            this._roomRef = null;
            this._actionsRef = null;
            this._chatRef = null;
            this._connRef = null;
            this._presenceRef = null;

            this._roomHandler = null;
            this._actionsHandler = null;
            this._chatHandler = null;
            this._connHandler = null;

            this._hostClaimTimer = null;
            this.lastSeenRev = 0;
            this.lastPushedRev = 0;
            this.seenChatIds = new Set();
            this.lastSlotConnected = {};
            this._isLeaving = false;
        }

        isAvailable() {
            const cfg = global.CoTyPhu?.FIREBASE_CONFIG;
            return Boolean(global.firebase && typeof global.firebase.database === 'function' && cfg && cfg.databaseURL);
        }

        _ensureDb() {
            if (!this.isAvailable()) {
                throw new Error('Firebase SDK hoặc FIREBASE_CONFIG chưa sẵn sàng.');
            }
            if (this.db) return this.db;
            const cfg = global.CoTyPhu.FIREBASE_CONFIG;
            if (!global.firebase.apps || global.firebase.apps.length === 0) {
                global.firebase.initializeApp(cfg);
            }
            this.db = global.firebase.database();
            return this.db;
        }

        getShareUrl() {
            if (!this.roomCode || typeof window === 'undefined') return '';
            const base = window.location.origin + window.location.pathname;
            return `${base}?room=${this.roomCode}`;
        }

        _emitStatus(status, detail = '') {
            if (this.callbacks.onStatus) this.callbacks.onStatus(status, detail);
        }

        _emitError(msg) {
            if (this.callbacks.onError) this.callbacks.onError(msg);
        }

        async createRoom(hostProfile, configOverrides = {}) {
            const db = this._ensureDb();
            await this.disconnect(true);
            this._isLeaving = false;

            const config = Object.assign({}, DEFAULT_CONFIG, configOverrides);
            const cleanName = (hostProfile?.name || 'Chủ phòng').trim().slice(0, 18) || 'Chủ phòng';
            const cleanAvatar = hostProfile?.avatar || AVATARS[0];

            let createdCode = null;
            for (let attempt = 0; attempt < 6; attempt++) {
                const candidate = generateRoomCode();
                const ref = db.ref(`rooms/${candidate}`);
                const payload = {
                    roomCode: candidate,
                    createdAt: global.firebase.database.ServerValue.TIMESTAMP,
                    updatedAt: global.firebase.database.ServerValue.TIMESTAMP,
                    hostClientId: this.clientId,
                    started: false,
                    config,
                    stateSeq: 0,
                    stateRev: 0,
                    slots: {
                        p1: {
                            id: 'p1',
                            clientId: this.clientId,
                            name: cleanName,
                            avatar: cleanAvatar,
                            color: PLAYER_COLORS[0],
                            isHost: true,
                            isBot: false,
                            connected: true,
                            joinedAt: Date.now()
                        }
                    }
                };

                const res = await ref.transaction(cur => {
                    if (cur !== null) return;
                    return payload;
                });
                if (res.committed) {
                    createdCode = candidate;
                    break;
                }
            }

            if (!createdCode) {
                throw new Error('Không thể tạo mã phòng mới, vui lòng thử lại.');
            }

            this.role = 'host';
            this.roomCode = createdCode;
            this.localPlayerId = 'p1';
            this.lastSeenRev = 0;
            this.lastPushedRev = 0;
            saveSession({ roomCode: createdCode, playerId: 'p1', name: cleanName, avatar: cleanAvatar });

            this._bindRoomListeners(createdCode);
            this._emitStatus('connected', `Đã mở phòng ${createdCode}`);
            return { roomCode: createdCode, shareUrl: this.getShareUrl(), lobby: this.lobby };
        }

        async joinRoom(rawCode, profile = {}) {
            const db = this._ensureDb();
            const cleanCode = String(rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (cleanCode.length !== 6) {
                throw new Error('Mã phòng phải gồm 6 ký tự.');
            }

            await this.disconnect(false);
            this._isLeaving = false;

            const roomRef = db.ref(`rooms/${cleanCode}`);
            const checkSnap = await roomRef.once('value');
            if (!checkSnap.exists()) {
                clearSession();
                throw new Error(`Không tìm thấy phòng "${cleanCode}".`);
            }

            const cleanName = (profile?.name || 'Khách').trim().slice(0, 18) || 'Khách';
            const cleanAvatar = profile?.avatar || AVATARS[1];
            let assignedSlotId = null;
            let abortReason = null;

            const txRes = await roomRef.transaction(room => {
                if (room === null) return null;
                const slots = Object.assign({}, room.slots || {});

                // 1. Check if this browser already owns a slot (F5 Rejoin!)
                const existingEntry = Object.entries(slots).find(([, s]) => s && s.clientId === this.clientId);
                if (existingEntry) {
                    assignedSlotId = existingEntry[0];
                    slots[assignedSlotId] = Object.assign({}, existingEntry[1], {
                        connected: true,
                        isBot: false,
                        ...(room.started ? {} : { name: cleanName, avatar: cleanAvatar })
                    });
                    room.slots = slots;
                    room.updatedAt = global.firebase.database.ServerValue.TIMESTAMP;
                    return room;
                }

                // 2. Reject brand-new joiners after match started
                if (room.started) {
                    abortReason = 'Ván đấu đã bắt đầu, không thể tham gia lúc này.';
                    return;
                }

                // 3. Find open slot or replace last Bot slot if full
                const keys = ['p1', 'p2', 'p3', 'p4'];
                let openKey = keys.find(k => !slots[k]);
                if (!openKey) {
                    const botKey = keys.slice().reverse().find(k => slots[k] && slots[k].isBot);
                    if (botKey) {
                        openKey = botKey;
                    } else {
                        abortReason = 'Phòng đã đủ tối đa 4 người chơi.';
                        return;
                    }
                }

                const colorIdx = keys.indexOf(openKey);
                assignedSlotId = openKey;
                slots[openKey] = {
                    id: openKey,
                    clientId: this.clientId,
                    name: cleanName,
                    avatar: cleanAvatar,
                    color: PLAYER_COLORS[colorIdx % PLAYER_COLORS.length],
                    isHost: room.hostClientId === this.clientId,
                    isBot: false,
                    connected: true,
                    joinedAt: Date.now()
                };
                room.slots = slots;
                room.updatedAt = global.firebase.database.ServerValue.TIMESTAMP;
                return room;
            });

            if (abortReason) {
                throw new Error(abortReason);
            }
            if (!txRes.committed || !assignedSlotId) {
                throw new Error('Không thể tham gia phòng, vui lòng thử lại.');
            }

            const finalRoom = txRes.snapshot.val();
            this.roomCode = cleanCode;
            this.localPlayerId = assignedSlotId;
            this.role = finalRoom.hostClientId === this.clientId ? 'host' : 'client';
            this.lastSeenRev = 0;
            this.lastPushedRev = 0;

            saveSession({
                roomCode: cleanCode,
                playerId: assignedSlotId,
                name: cleanName,
                avatar: cleanAvatar
            });

            this._bindRoomListeners(cleanCode);
            this._emitStatus('connected', `Đã vào phòng ${cleanCode}`);
            return { playerId: assignedSlotId, roomCode: cleanCode, started: Boolean(finalRoom.started), lobby: this.lobby };
        }

        async tryAutoRejoin() {
            const session = readSession();
            if (!session || !this.isAvailable()) return { rejoined: false };
            try {
                const db = this._ensureDb();
                const snap = await db.ref(`rooms/${session.roomCode}`).once('value');
                if (!snap.exists()) {
                    clearSession();
                    return { rejoined: false };
                }
                const room = snap.val();
                const slots = room.slots || {};
                const mine = Object.values(slots).find(s => s && s.clientId === this.clientId);
                if (!mine) {
                    clearSession();
                    return { rejoined: false };
                }
                if (room.started && room.gameStateJson) {
                    try {
                        const parsed = JSON.parse(room.gameStateJson);
                        if (parsed && parsed.phase === 'GAME_OVER') {
                            clearSession();
                            return { rejoined: false };
                        }
                    } catch (_) {}
                }
                const res = await this.joinRoom(session.roomCode, session);
                return { rejoined: true, started: res.started, roomCode: session.roomCode };
            } catch (_) {
                clearSession();
                return { rejoined: false };
            }
        }

        _bindRoomListeners(code) {
            const db = this.db;
            this.seenChatIds.clear();
            this.lastSlotConnected = {};

            // 1. Presence tracking
            this._presenceRef = db.ref(`rooms/${code}/slots/${this.localPlayerId}/connected`);
            this._connRef = db.ref('.info/connected');
            this._connHandler = (snap) => {
                const isOnline = Boolean(snap.val());
                if (this.callbacks.onConnectionState) {
                    this.callbacks.onConnectionState(isOnline);
                }
                if (isOnline && this._presenceRef && !this._isLeaving) {
                    this._presenceRef.onDisconnect().set(false).catch(() => {});
                    this._presenceRef.set(true).catch(() => {});
                }
            };
            this._connRef.on('value', this._connHandler);

            // 2. Room state listener
            this._roomRef = db.ref(`rooms/${code}`);
            this._roomHandler = (snap) => {
                if (!snap.exists()) {
                    if (!this._isLeaving) {
                        clearSession();
                        this._cleanupRefsOnly();
                        this._emitError('Phòng đã bị đóng.');
                        if (this.callbacks.onHostDisconnected) this.callbacks.onHostDisconnected();
                    }
                    return;
                }

                const room = snap.val();
                const sortedSlots = sortSlotsMapToArray(room.slots);
                this.lobby = {
                    roomCode: room.roomCode,
                    started: Boolean(room.started),
                    config: room.config || DEFAULT_CONFIG,
                    hostClientId: room.hostClientId,
                    slots: sortedSlots
                };

                // Check Host role updates / Host migration
                if (room.hostClientId === this.clientId) {
                    this._clearHostClaimTimer();
                    if (this.role !== 'host') {
                        this.role = 'host';
                        this.lastPushedRev = Math.max(this.lastPushedRev, Number(room.stateRev || 0));
                        this._attachActionsListener(code);
                        if (this.callbacks.onRoleChanged) this.callbacks.onRoleChanged('host');
                    } else if (!this._actionsRef) {
                        this._attachActionsListener(code);
                    }
                } else {
                    const hostSlot = sortedSlots.find(s => s.clientId === room.hostClientId);
                    if (hostSlot && hostSlot.connected === false) {
                        this._scheduleHostClaim(code, room.hostClientId, sortedSlots);
                    } else {
                        this._clearHostClaimTimer();
                    }
                }

                if (this.callbacks.onLobbyUpdate) {
                    this.callbacks.onLobbyUpdate(this.lobby);
                }

                // Track per-slot online status transitions during match
                if (room.started) {
                    for (const s of sortedSlots) {
                        if (s.isBot) continue;
                        const prev = this.lastSlotConnected[s.id];
                        if (prev !== undefined && prev !== s.connected) {
                            if (this.callbacks.onSlotConnectionChange) {
                                this.callbacks.onSlotConnectionChange(s.id, Boolean(s.connected), s.name);
                            }
                        }
                        this.lastSlotConnected[s.id] = Boolean(s.connected);
                    }
                }

                // Sync serialized gameStateJson
                const rev = Number(room.stateRev || 0);
                if (room.started && room.gameStateJson && rev !== this.lastSeenRev && rev !== this.lastPushedRev) {
                    this.lastSeenRev = rev;
                    try {
                        const parsed = JSON.parse(room.gameStateJson);
                        if (this.callbacks.onGameState) {
                            this.callbacks.onGameState(parsed, this.lobby);
                        }
                    } catch (err) {
                        this._emitError('Lỗi đọc dữ liệu trận đấu.');
                    }
                }
            };
            this._roomRef.on('value', this._roomHandler);

            // 3. Chat listener
            this._chatRef = db.ref(`rooms/${code}/chat`).limitToLast(40);
            this._chatHandler = (snap) => {
                if (this.seenChatIds.has(snap.key)) return;
                this.seenChatIds.add(snap.key);
                const msg = snap.val();
                if (msg && this.callbacks.onChatMessage) {
                    this.callbacks.onChatMessage(msg);
                }
            };
            this._chatRef.on('child_added', this._chatHandler);

            // 4. Actions listener (Host only)
            if (this.role === 'host') {
                this._attachActionsListener(code);
            }
        }

        _attachActionsListener(code) {
            if (this._actionsRef || !this.db) return;
            this._actionsRef = this.db.ref(`rooms/${code}/actions`);
            this._actionsHandler = (snap) => {
                const msg = snap.val();
                snap.ref.remove().catch(() => {});
                if (!msg || !this.lobby || this.role !== 'host') return;
                const slot = this.lobby.slots.find(s => s.id === msg.playerId);
                if (!slot || slot.clientId !== msg.clientId) return;
                if (this.callbacks.onHostAction) {
                    this.callbacks.onHostAction(msg.playerId, msg.action);
                }
            };
            this._actionsRef.on('child_added', this._actionsHandler);
        }

        _clearHostClaimTimer() {
            if (this._hostClaimTimer) {
                clearTimeout(this._hostClaimTimer);
                this._hostClaimTimer = null;
            }
        }

        _scheduleHostClaim(code, deadHostClientId, sortedSlots) {
            if (this._hostClaimTimer) return;
            const firstConnectedHuman = sortedSlots.find(s => !s.isBot && s.connected !== false && s.clientId !== deadHostClientId);
            if (!firstConnectedHuman || firstConnectedHuman.clientId !== this.clientId) return;

            this._hostClaimTimer = setTimeout(async () => {
                this._hostClaimTimer = null;
                if (!this.db || this.roomCode !== code) return;
                try {
                    const roomRef = this.db.ref(`rooms/${code}`);
                    await roomRef.transaction(room => {
                        if (!room || room.hostClientId !== deadHostClientId) return room;
                        const slots = room.slots || {};
                        const oldHost = Object.values(slots).find(s => s && s.clientId === deadHostClientId);
                        if (oldHost && oldHost.connected !== false) return room;
                        room.hostClientId = this.clientId;
                        for (const k of Object.keys(slots)) {
                            if (slots[k]) slots[k].isHost = slots[k].clientId === this.clientId;
                        }
                        room.slots = slots;
                        return room;
                    });
                } catch (_) {}
            }, 4000);
        }

        async addBotToLobby() {
            if (this.role !== 'host' || !this.lobby || this.lobby.started || !this._roomRef) return false;
            const keys = ['p1', 'p2', 'p3', 'p4'];
            await this._roomRef.transaction(room => {
                if (!room || room.started) return room;
                const slots = Object.assign({}, room.slots || {});
                const openKey = keys.find(k => !slots[k]);
                if (!openKey) return room;
                const colorIdx = keys.indexOf(openKey);
                const botCount = Object.values(slots).filter(s => s && s.isBot).length + 1;
                slots[openKey] = {
                    id: openKey,
                    clientId: null,
                    name: `Bot AI ${botCount}`,
                    avatar: AVATARS[(colorIdx + 3) % AVATARS.length],
                    color: PLAYER_COLORS[colorIdx % PLAYER_COLORS.length],
                    isHost: false,
                    isBot: true,
                    connected: true,
                    joinedAt: Date.now()
                };
                room.slots = slots;
                return room;
            });
            return true;
        }

        async removeBotFromLobby(slotId) {
            if (this.role !== 'host' || !this.lobby || this.lobby.started || !this._roomRef) return false;
            await this._roomRef.transaction(room => {
                if (!room || room.started || !room.slots) return room;
                if (room.slots[slotId] && room.slots[slotId].isBot) {
                    delete room.slots[slotId];
                }
                return room;
            });
            return true;
        }

        markGameStarted(stateSnapshot) {
            if (this.role !== 'host' || !this._roomRef) return;
            this.broadcastGameState(stateSnapshot, true);
        }

        broadcastGameState(stateSnapshot, markStarted = false) {
            if (this.role !== 'host' || !this._roomRef || !stateSnapshot) return;
            this.lastPushedRev = Math.max(this.lastPushedRev, this.lastSeenRev) + 1;
            const patch = {
                gameStateJson: JSON.stringify(stateSnapshot),
                stateSeq: stateSnapshot.eventSeq || 0,
                stateRev: this.lastPushedRev,
                updatedAt: global.firebase.database.ServerValue.TIMESTAMP
            };
            if (markStarted) patch.started = true;
            this._roomRef.update(patch).catch(err => {
                this._emitError(`Lỗi đồng bộ trạng thái: ${err?.message || ''}`);
            });
        }

        sendAction(action) {
            if (!this.db || !this.roomCode || !this.localPlayerId) return false;
            this.db.ref(`rooms/${this.roomCode}/actions`).push({
                clientId: this.clientId,
                playerId: this.localPlayerId,
                action,
                ts: Date.now()
            }).catch(err => {
                this._emitError(`Không gửi được thao tác: ${err?.message || ''}`);
            });
            return true;
        }

        sendChat(text, senderProfile = {}) {
            if (!this.db || !this.roomCode) return;
            const cleanText = String(text || '').trim().slice(0, 200);
            if (!cleanText) return;
            const slot = this.lobby?.slots.find(s => s.id === this.localPlayerId) || senderProfile;
            this.db.ref(`rooms/${this.roomCode}/chat`).push({
                senderId: this.localPlayerId || 'p1',
                senderName: slot.name || 'Người chơi',
                senderAvatar: slot.avatar || '🎩',
                senderColor: slot.color || PLAYER_COLORS[0],
                text: cleanText,
                time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                ts: Date.now()
            }).catch(() => {});
        }

        _cleanupRefsOnly() {
            this._clearHostClaimTimer();
            if (this._presenceRef) {
                try { this._presenceRef.onDisconnect().cancel(); } catch (_) {}
                this._presenceRef = null;
            }
            if (this._connRef && this._connHandler) {
                try { this._connRef.off('value', this._connHandler); } catch (_) {}
            }
            if (this._roomRef && this._roomHandler) {
                try { this._roomRef.off('value', this._roomHandler); } catch (_) {}
            }
            if (this._chatRef && this._chatHandler) {
                try { this._chatRef.off('child_added', this._chatHandler); } catch (_) {}
            }
            if (this._actionsRef && this._actionsHandler) {
                try { this._actionsRef.off('child_added', this._actionsHandler); } catch (_) {}
            }
            this._connRef = null;
            this._roomRef = null;
            this._chatRef = null;
            this._actionsRef = null;
            this._connHandler = null;
            this._roomHandler = null;
            this._chatHandler = null;
            this._actionsHandler = null;
            this.role = null;
            this.roomCode = null;
            this.localPlayerId = null;
            this.lobby = null;
            this.lastSeenRev = 0;
            this.lastPushedRev = 0;
        }

        async disconnect(leavePermanently = true) {
            const oldCode = this.roomCode;
            const oldSlot = this.localPlayerId;
            const wasStarted = Boolean(this.lobby?.started);
            const db = this.db;

            if (leavePermanently) {
                this._isLeaving = true;
                clearSession();
            }

            this._cleanupRefsOnly();

            if (leavePermanently && db && oldCode && oldSlot) {
                try {
                    const roomRef = db.ref(`rooms/${oldCode}`);
                    if (!wasStarted) {
                        await roomRef.transaction(room => {
                            if (!room || !room.slots) return null;
                            delete room.slots[oldSlot];
                            const remainingHumans = Object.values(room.slots).filter(s => s && !s.isBot);
                            if (remainingHumans.length === 0) {
                                return null; // Delete empty room cleanly
                            }
                            if (room.hostClientId === this.clientId) {
                                room.hostClientId = remainingHumans[0].clientId;
                                for (const k of Object.keys(room.slots)) {
                                    if (room.slots[k]) room.slots[k].isHost = room.slots[k].clientId === room.hostClientId;
                                }
                            }
                            return room;
                        });
                    } else {
                        await db.ref(`rooms/${oldCode}/slots/${oldSlot}/connected`).set(false);
                    }
                } catch (_) {}
            }
        }
    }

    const api = { NetworkManager };
    global.CoTyPhu = Object.assign(global.CoTyPhu || {}, api);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
