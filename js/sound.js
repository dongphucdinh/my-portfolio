(function (global) {
    'use strict';

    class SoundFX {
        constructor() {
            this.ctx = null;
            this.muted = false;
            try {
                if (typeof localStorage !== 'undefined') {
                    this.muted = localStorage.getItem('cotyphu_muted') === '1';
                }
            } catch (_) {
                this.muted = false;
            }
        }

        _ensureCtx() {
            if (this.muted || typeof window === 'undefined') return null;
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return null;
            if (!this.ctx) {
                this.ctx = new AudioCtx();
            }
            if (this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => {});
            }
            return this.ctx;
        }

        toggleMute() {
            this.muted = !this.muted;
            try {
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('cotyphu_muted', this.muted ? '1' : '0');
                }
            } catch (_) {}
            return this.muted;
        }

        _tone(freq, duration, type = 'sine', gainVal = 0.08, delay = 0, slideTo = null) {
            const ctx = this._ensureCtx();
            if (!ctx) return;
            const now = ctx.currentTime + delay;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, now);
            if (slideTo) {
                osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
            }
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(gainVal, now + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + duration + 0.02);
        }

        dice() {
            const hits = [
                [260, 0.045, 0.06, 0.00, 340],
                [350, 0.045, 0.055, 0.06, 240],
                [430, 0.05, 0.065, 0.13, 310],
                [290, 0.05, 0.06, 0.22, 410],
                [380, 0.055, 0.065, 0.32, 270],
                [460, 0.06, 0.07, 0.44, 520]
            ];
            for (const [f, dur, g, delay, slide] of hits) {
                this._tone(f, dur, 'triangle', g, delay, slide);
            }
        }

        diceLand(isDouble = false) {
            this._tone(175, 0.09, 'sine', 0.09, 0.00, 92);
            this._tone(540, 0.06, 'triangle', 0.07, 0.01, 360);
            if (isDouble) {
                this._tone(659.25, 0.09, 'triangle', 0.08, 0.06);
                this._tone(987.77, 0.11, 'triangle', 0.08, 0.13);
                this._tone(1318.51, 0.18, 'triangle', 0.09, 0.21);
            }
        }

        step() {
            this._tone(520, 0.045, 'sine', 0.045, 0, 620);
        }

        buy() {
            this._tone(523.25, 0.09, 'triangle', 0.08, 0.00);
            this._tone(659.25, 0.12, 'triangle', 0.08, 0.07);
            this._tone(783.99, 0.16, 'triangle', 0.08, 0.14);
        }

        cash() {
            this._tone(880, 0.08, 'sine', 0.06, 0.00);
            this._tone(1174.66, 0.14, 'sine', 0.07, 0.07);
        }

        pay() {
            this._tone(330, 0.11, 'sawtooth', 0.045, 0.00, 220);
            this._tone(220, 0.16, 'sawtooth', 0.045, 0.10, 165);
        }

        card() {
            this._tone(440, 0.07, 'sine', 0.06, 0.00, 660);
            this._tone(587.33, 0.12, 'sine', 0.06, 0.06);
        }

        build() {
            this._tone(392, 0.08, 'square', 0.045, 0.00);
            this._tone(523.25, 0.11, 'square', 0.045, 0.08);
            this._tone(659.25, 0.15, 'square', 0.045, 0.16);
        }

        jail() {
            this._tone(260, 0.18, 'sawtooth', 0.06, 0.00, 180);
            this._tone(196, 0.24, 'sawtooth', 0.06, 0.18, 130);
        }

        auction() {
            this._tone(698.46, 0.08, 'triangle', 0.07, 0.00);
            this._tone(880, 0.10, 'triangle', 0.07, 0.08);
        }

        win() {
            const notes = [523.25, 659.25, 783.99, 1046.5];
            notes.forEach((n, idx) => this._tone(n, 0.22, 'triangle', 0.09, idx * 0.11));
        }
    }

    const api = { SoundFX };
    global.CoTyPhu = Object.assign(global.CoTyPhu || {}, api);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
