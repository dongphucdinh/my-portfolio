(function (global) {
    'use strict';

    const Data = typeof module !== 'undefined' && module.exports
        ? require('./data.js')
        : global.CoTyPhu;

    const { AVATARS, PLAYER_COLORS, DEFAULT_CONFIG } = Data;

    const PEER_PREFIX = 'cotyphu-vn-';
    const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const ICE_CONFIG = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };

    function generateRoomCode() {
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
        }
        return code;
    }

    class NetworkManager {
        constructor(callbacks = {}) {
            this.callbacks = callbacks;
            this.peer = null;
            this.role = null; // 'host' | 'client' | null
            this.roomCode = null;
            this.localPlayerId = null;
            this.connections = new Map(); // host: peerId -> DataConnection
            this.hostConn = null; // client: DataConnection to host
            this.lobby = null;
        }

        isAvailable() {
            return typeof global.Peer === 'function';
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

        _broadcast(payload) {
            for (const conn of this.connections.values()) {
                if (conn.open) {
                    try {
                        conn.send(payload);
                    } catch (_) {}
                }
            }
        }

        _syncLobbyToAll() {
            if (this.callbacks.onLobbyUpdate) {
                this.callbacks.onLobbyUpdate(this.lobby);
            }
            this._broadcast({ type: 'LOBBY_STATE', lobby: this.lobby });
        }

        createRoom(hostProfile, configOverrides = {}) {
            if (!this.isAvailable()) {
                return Promise.reject(new Error('Thư viện PeerJS chưa sẵn sàng. Vui lòng kiểm tra kết nối mạng.'));
            }
            this.disconnect();
            this.role = 'host';
            this.roomCode = generateRoomCode();
            this.localPlayerId = 'p1';

            const config = Object.assign({}, DEFAULT_CONFIG, configOverrides);
            this.lobby = {
                roomCode: this.roomCode,
                started: false,
                config,
                slots: [
                    {
                        id: 'p1',
                        peerId: null,
                        name: (hostProfile.name || 'Chủ phòng').trim(),
                        avatar: hostProfile.avatar || AVATARS[0],
                        color: PLAYER_COLORS[0],
                        isHost: true,
                        isBot: false,
                        connected: true
                    }
                ]
            };

            return new Promise((resolve, reject) => {
                let settled = false;
                const peerId = PEER_PREFIX + this.roomCode;
                const peer = new global.Peer(peerId, { config: ICE_CONFIG, debug: 0 });
                this.peer = peer;

                peer.on('open', (id) => {
                    this.lobby.slots[0].peerId = id;
                    settled = true;
                    this._emitStatus('connected', `Đã mở phòng ${this.roomCode}`);
                    this._syncLobbyToAll();
                    resolve({ roomCode: this.roomCode, shareUrl: this.getShareUrl(), lobby: this.lobby });
                });

                peer.on('connection', (conn) => {
                    this._handleIncomingPeer(conn);
                });

                peer.on('error', (err) => {
                    const msg = err?.type === 'unavailable-id'
                        ? 'Mã phòng bị trùng, vui lòng tạo lại.'
                        : `Lỗi kết nối P2P: ${err?.message || err?.type || 'Không xác định'}`;
                    this._emitError(msg);
                    if (!settled) {
                        settled = true;
                        this.disconnect();
                        reject(new Error(msg));
                    }
                });
            });
        }

        _handleIncomingPeer(conn) {
            conn.on('open', () => {
                this.connections.set(conn.peer, conn);
            });

            conn.on('data', (msg) => {
                if (!msg || typeof msg !== 'object') return;
                if (msg.type === 'HELLO') {
                    this._registerClientSlot(conn, msg.profile || {});
                } else if (msg.type === 'ACTION') {
                    const slot = this.lobby?.slots.find(s => s.peerId === conn.peer);
                    if (!slot) return;
                    if (this.callbacks.onHostAction) {
                        this.callbacks.onHostAction(slot.id, msg.action);
                    }
                } else if (msg.type === 'CHAT') {
                    const slot = this.lobby?.slots.find(s => s.peerId === conn.peer);
                    if (!slot) return;
                    const chatPayload = {
                        type: 'CHAT',
                        senderId: slot.id,
                        senderName: slot.name,
                        senderAvatar: slot.avatar,
                        senderColor: slot.color,
                        text: String(msg.text || '').slice(0, 200),
                        time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                    };
                    if (this.callbacks.onChatMessage) this.callbacks.onChatMessage(chatPayload);
                    this._broadcast(chatPayload);
                }
            });

            conn.on('close', () => {
                this._handlePeerDisconnect(conn.peer);
            });

            conn.on('error', () => {
                this._handlePeerDisconnect(conn.peer);
            });
        }

        _registerClientSlot(conn, profile) {
            if (!this.lobby) return;
            if (this.lobby.started) {
                try {
                    conn.send({ type: 'ERROR', message: 'Ván đấu đã bắt đầu, không thể tham gia lúc này.' });
                } catch (_) {}
                setTimeout(() => conn.close(), 200);
                return;
            }

            // Re-assign if same peer reconnects
            const existing = this.lobby.slots.find(s => s.peerId === conn.peer);
            if (existing) {
                existing.connected = true;
                conn.send({ type: 'WELCOME', playerId: existing.id, lobby: this.lobby });
                this._syncLobbyToAll();
                return;
            }

            // Replace a bot slot if already at 4
            if (this.lobby.slots.length >= 4) {
                const botIdx = this.lobby.slots.findIndex(s => s.isBot);
                if (botIdx !== -1) {
                    this.lobby.slots.splice(botIdx, 1);
                } else {
                    try {
                        conn.send({ type: 'ERROR', message: 'Phòng đã đủ tối đa 4 người chơi.' });
                    } catch (_) {}
                    setTimeout(() => conn.close(), 200);
                    return;
                }
            }

            const idx = this.lobby.slots.length;
            const usedIds = new Set(this.lobby.slots.map(s => s.id));
            let nextNum = idx + 1;
            while (usedIds.has(`p${nextNum}`)) nextNum++;
            const slotId = `p${nextNum}`;

            const newSlot = {
                id: slotId,
                peerId: conn.peer,
                name: (profile.name || `Khách ${nextNum}`).trim().slice(0, 20),
                avatar: profile.avatar || AVATARS[idx % AVATARS.length],
                color: PLAYER_COLORS[idx % PLAYER_COLORS.length],
                isHost: false,
                isBot: false,
                connected: true
            };
            this.lobby.slots.push(newSlot);
            conn.send({ type: 'WELCOME', playerId: slotId, lobby: this.lobby });
            this._syncLobbyToAll();
        }

        _handlePeerDisconnect(peerId) {
            this.connections.delete(peerId);
            if (!this.lobby) return;
            const slotIdx = this.lobby.slots.findIndex(s => s.peerId === peerId);
            if (slotIdx === -1) return;

            const slot = this.lobby.slots[slotIdx];
            if (!this.lobby.started) {
                this.lobby.slots.splice(slotIdx, 1);
                this._reindexLobbyColors();
                this._syncLobbyToAll();
            } else {
                slot.connected = false;
                slot.isBot = true;
                if (this.callbacks.onPeerDroppedInGame) {
                    this.callbacks.onPeerDroppedInGame(slot.id, slot.name);
                }
            }
        }

        _reindexLobbyColors() {
            this.lobby.slots.forEach((s, idx) => {
                s.color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
            });
        }

        addBotToLobby() {
            if (this.role !== 'host' || !this.lobby || this.lobby.started) return false;
            if (this.lobby.slots.length >= 4) return false;
            const usedIds = new Set(this.lobby.slots.map(s => s.id));
            let nextNum = this.lobby.slots.length + 1;
            while (usedIds.has(`p${nextNum}`)) nextNum++;
            const botCount = this.lobby.slots.filter(s => s.isBot).length + 1;
            this.lobby.slots.push({
                id: `p${nextNum}`,
                peerId: null,
                name: `Bot AI ${botCount}`,
                avatar: AVATARS[(nextNum + 3) % AVATARS.length],
                color: PLAYER_COLORS[this.lobby.slots.length % PLAYER_COLORS.length],
                isHost: false,
                isBot: true,
                connected: true
            });
            this._syncLobbyToAll();
            return true;
        }

        removeBotFromLobby(slotId) {
            if (this.role !== 'host' || !this.lobby || this.lobby.started) return false;
            const idx = this.lobby.slots.findIndex(s => s.id === slotId && s.isBot);
            if (idx === -1) return false;
            this.lobby.slots.splice(idx, 1);
            this._reindexLobbyColors();
            this._syncLobbyToAll();
            return true;
        }

        updateLobbyConfig(configOverrides) {
            if (this.role !== 'host' || !this.lobby || this.lobby.started) return;
            this.lobby.config = Object.assign({}, this.lobby.config, configOverrides);
            this._syncLobbyToAll();
        }

        markGameStarted(stateSnapshot) {
            if (this.role !== 'host' || !this.lobby) return;
            this.lobby.started = true;
            this.broadcastGameState(stateSnapshot);
        }

        broadcastGameState(stateSnapshot) {
            if (this.role !== 'host') return;
            this._broadcast({ type: 'GAME_STATE', state: stateSnapshot });
        }

        joinRoom(rawCode, profile) {
            if (!this.isAvailable()) {
                return Promise.reject(new Error('Thư viện PeerJS chưa sẵn sàng. Vui lòng kiểm tra kết nối mạng.'));
            }
            const cleanCode = String(rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (cleanCode.length !== 6) {
                return Promise.reject(new Error('Mã phòng phải gồm 6 ký tự.'));
            }

            this.disconnect();
            this.role = 'client';
            this.roomCode = cleanCode;

            return new Promise((resolve, reject) => {
                let settled = false;
                const peer = new global.Peer(undefined, { config: ICE_CONFIG, debug: 0 });
                this.peer = peer;

                const timeout = setTimeout(() => {
                    if (!settled) {
                        settled = true;
                        this.disconnect();
                        reject(new Error('Hết thời gian kết nối tới phòng. Hãy kiểm tra lại mã phòng.'));
                    }
                }, 12000);

                peer.on('open', () => {
                    const hostId = PEER_PREFIX + cleanCode;
                    const conn = peer.connect(hostId, { reliable: true });
                    this.hostConn = conn;

                    conn.on('open', () => {
                        conn.send({ type: 'HELLO', profile });
                    });

                    conn.on('data', (msg) => {
                        if (!msg || typeof msg !== 'object') return;
                        if (msg.type === 'WELCOME') {
                            clearTimeout(timeout);
                            this.localPlayerId = msg.playerId;
                            this.lobby = msg.lobby;
                            settled = true;
                            this._emitStatus('connected', `Đã vào phòng ${cleanCode}`);
                            if (this.callbacks.onLobbyUpdate) this.callbacks.onLobbyUpdate(this.lobby);
                            resolve({ playerId: msg.playerId, lobby: this.lobby });
                        } else if (msg.type === 'LOBBY_STATE') {
                            this.lobby = msg.lobby;
                            if (this.callbacks.onLobbyUpdate) this.callbacks.onLobbyUpdate(this.lobby);
                        } else if (msg.type === 'GAME_STATE') {
                            if (this.callbacks.onGameState) this.callbacks.onGameState(msg.state);
                        } else if (msg.type === 'CHAT') {
                            if (this.callbacks.onChatMessage) this.callbacks.onChatMessage(msg);
                        } else if (msg.type === 'ERROR') {
                            clearTimeout(timeout);
                            this._emitError(msg.message);
                            if (!settled) {
                                settled = true;
                                this.disconnect();
                                reject(new Error(msg.message));
                            }
                        }
                    });

                    conn.on('close', () => {
                        clearTimeout(timeout);
                        this._emitError('Chủ phòng đã đóng kết nối hoặc rời phòng.');
                        if (this.callbacks.onHostDisconnected) this.callbacks.onHostDisconnected();
                    });

                    conn.on('error', (err) => {
                        clearTimeout(timeout);
                        const msg = `Không thể kết nối chủ phòng: ${err?.message || 'Lỗi mạng'}`;
                        if (!settled) {
                            settled = true;
                            this.disconnect();
                            reject(new Error(msg));
                        }
                    });
                });

                peer.on('error', (err) => {
                    clearTimeout(timeout);
                    const msg = err?.type === 'peer-unavailable'
                        ? `Không tìm thấy phòng "${cleanCode}". Chủ phòng có thể đã thoát.`
                        : `Lỗi P2P: ${err?.message || err?.type || 'Không xác định'}`;
                    this._emitError(msg);
                    if (!settled) {
                        settled = true;
                        this.disconnect();
                        reject(new Error(msg));
                    }
                });
            });
        }

        sendAction(action) {
            if (this.role === 'client' && this.hostConn && this.hostConn.open) {
                this.hostConn.send({ type: 'ACTION', action });
                return true;
            }
            return false;
        }

        sendChat(text, senderProfile = {}) {
            const cleanText = String(text || '').trim().slice(0, 200);
            if (!cleanText) return;

            if (this.role === 'host') {
                const slot = this.lobby?.slots.find(s => s.id === this.localPlayerId) || senderProfile;
                const payload = {
                    type: 'CHAT',
                    senderId: this.localPlayerId || 'p1',
                    senderName: slot.name || 'Chủ phòng',
                    senderAvatar: slot.avatar || '🎩',
                    senderColor: slot.color || PLAYER_COLORS[0],
                    text: cleanText,
                    time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                };
                if (this.callbacks.onChatMessage) this.callbacks.onChatMessage(payload);
                this._broadcast(payload);
            } else if (this.role === 'client' && this.hostConn && this.hostConn.open) {
                this.hostConn.send({ type: 'CHAT', text: cleanText });
            }
        }

        disconnect() {
            for (const conn of this.connections.values()) {
                try { conn.close(); } catch (_) {}
            }
            this.connections.clear();
            if (this.hostConn) {
                try { this.hostConn.close(); } catch (_) {}
                this.hostConn = null;
            }
            if (this.peer) {
                try { this.peer.destroy(); } catch (_) {}
                this.peer = null;
            }
            this.role = null;
            this.roomCode = null;
            this.localPlayerId = null;
            this.lobby = null;
        }
    }

    const api = { NetworkManager, PEER_PREFIX };
    global.CoTyPhu = Object.assign(global.CoTyPhu || {}, api);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
