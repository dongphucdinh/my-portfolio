(function (global) {
    'use strict';

    function shadeColor(hex, percent) {
        const clean = String(hex || '#ef4444').replace('#', '');
        const num = parseInt(clean.length === 3
            ? clean.split('').map(c => c + c).join('')
            : clean, 16);
        const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + Math.round(2.55 * percent)));
        const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + Math.round(2.55 * percent)));
        const b = Math.min(255, Math.max(0, (num & 0xff) + Math.round(2.55 * percent)));
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    function banknoteSvg(size = 18) {
        const h = Math.round(size * 0.72);
        return `<svg class="banknote-ico" width="${size}" height="${h}" viewBox="0 0 28 20" aria-hidden="true">
            <g transform="rotate(-10 14 10)">
                <rect x="2" y="4" width="24" height="12" rx="2.5" fill="#70c934" stroke="#2c7a1f" stroke-width="1.4"/>
                <rect x="4.5" y="6.2" width="19" height="7.6" rx="1.5" fill="#a2e85b"/>
                <rect x="11.5" y="4" width="5" height="12" fill="#facc15" opacity="0.9"/>
                <circle cx="14" cy="10" r="2.8" fill="#4aa122" stroke="#fef08a" stroke-width="1"/>
            </g>
        </svg>`;
    }

    function _isoHouseBody(level, accentColor) {
        const roofLight = shadeColor(accentColor, 14);
        const roofMain = accentColor || '#e61e6e';
        const roofDark = shadeColor(accentColor, -22);

        if (level === 0) {
            return `
                <ellipse cx="60" cy="60" rx="12" ry="6" fill="rgba(0,0,0,0.16)"/>
                <rect x="58" y="34" width="4" height="26" rx="2" fill="#78350f"/>
                <circle cx="60" cy="33" r="3.5" fill="#fde047" stroke="#b45309" stroke-width="1"/>
                <path d="M62 34 L82 40 L62 48 Z" fill="${roofMain}" stroke="#ffffff" stroke-width="1.2"/>
                <circle cx="52" cy="58" r="3" fill="#ec4899"/>
                <circle cx="68" cy="56" r="2.5" fill="#facc15"/>
            `;
        }

        if (level === 1) {
            return `
                <polygon points="44,62 60,70 76,62 60,54" fill="rgba(0,0,0,0.18)"/>
                <polygon points="46,48 60,55 60,67 46,60" fill="#fffdf8" stroke="#cbd5e1" stroke-width="0.9"/>
                <polygon points="60,55 74,48 74,60 60,67" fill="#e2e8f0" stroke="#cbd5e1" stroke-width="0.9"/>
                <polygon points="51,55 55,57 55,64 51,62" fill="#92400e"/>
                <polygon points="65,54 70,51.5 70,56.5 65,59" fill="#38bdf8" stroke="#ffffff" stroke-width="0.7"/>
                <polygon points="43,48 60,36 60,55" fill="${roofLight}" stroke="${roofDark}" stroke-width="1"/>
                <polygon points="60,36 77,48 60,55" fill="${roofMain}" stroke="${roofDark}" stroke-width="1"/>
                <rect x="65" y="34" width="4" height="8" fill="#94a3b8" stroke="#475569" stroke-width="0.8"/>
            `;
        }

        if (level === 2) {
            return `
                <polygon points="36,62 60,74 84,62 60,50" fill="rgba(0,0,0,0.18)"/>
                <polygon points="40,40 60,50 60,70 40,60" fill="#fffdf8" stroke="#cbd5e1" stroke-width="0.9"/>
                <polygon points="60,50 80,40 80,60 60,70" fill="#e2e8f0" stroke="#cbd5e1" stroke-width="0.9"/>
                <polygon points="45,46 50,48.5 50,53.5 45,51" fill="#38bdf8"/>
                <polygon points="53,50 57,52 57,57 53,55" fill="#38bdf8"/>
                <polygon points="64,50 69,47.5 69,52.5 64,55" fill="#38bdf8"/>
                <polygon points="72,46 77,43.5 77,48.5 72,51" fill="#38bdf8"/>
                <polygon points="49,57 54,59.5 54,67 49,64.5" fill="#b45309"/>
                <polygon points="37,40 60,25 60,50" fill="${roofLight}" stroke="${roofDark}" stroke-width="1"/>
                <polygon points="60,25 83,40 60,50" fill="${roofMain}" stroke="${roofDark}" stroke-width="1"/>
                <polygon points="49,33 55,36 55,42 49,39" fill="#ffffff"/>
                <polygon points="48,33 52,29 56,36" fill="${roofDark}"/>
            `;
        }

        if (level === 3) {
            return `
                <polygon points="30,62 60,76 88,62 60,48" fill="rgba(0,0,0,0.2)"/>
                <polygon points="36,36 60,48 60,71 36,59" fill="#ffffff" stroke="#cbd5e1" stroke-width="0.9"/>
                <polygon points="60,48 82,37 82,60 60,71" fill="#e2e8f0" stroke="#cbd5e1" stroke-width="0.9"/>
                <polygon points="41,42 46,44.5 46,49 41,46.5" fill="#38bdf8"/>
                <polygon points="50,46.5 55,49 55,53.5 50,51" fill="#38bdf8"/>
                <polygon points="64,49 69,46.5 69,51 64,53.5" fill="#38bdf8"/>
                <polygon points="73,44.5 78,42 78,46.5 73,49" fill="#38bdf8"/>
                <polygon points="44,54 51,57.5 51,66 44,62.5" fill="#9a3412"/>
                <polygon points="33,36 60,22 60,48" fill="${roofLight}" stroke="${roofDark}" stroke-width="1"/>
                <polygon points="60,22 85,37 60,48" fill="${roofMain}" stroke="${roofDark}" stroke-width="1"/>
                <polygon points="65,24 72,27.5 72,41 65,37.5" fill="#ffffff" stroke="#cbd5e1" stroke-width="0.8"/>
                <polygon points="72,27.5 79,24 79,37.5 72,41" fill="#cbd5e1" stroke="#94a3b8" stroke-width="0.8"/>
                <polygon points="64,24 72,11 80,24 72,28" fill="${roofMain}" stroke="${roofDark}" stroke-width="1"/>
                <circle cx="72" cy="10" r="2.2" fill="#fde047"/>
            `;
        }

        // Level 4: Grand Hotel Landmark
        return `
            <polygon points="28,63 60,78 92,63 60,48" fill="rgba(0,0,0,0.22)"/>
            <polygon points="38,24 60,35 60,72 38,61" fill="#fffbeb" stroke="#d97706" stroke-width="1"/>
            <polygon points="60,35 82,24 82,61 60,72" fill="#fde68a" stroke="#d97706" stroke-width="1"/>
            <polygon points="43,31 48,33.5 48,38 43,35.5" fill="#0284c7"/>
            <polygon points="51,35 56,37.5 56,42 51,39.5" fill="#0284c7"/>
            <polygon points="43,41 48,43.5 48,48 43,45.5" fill="#0284c7"/>
            <polygon points="51,45 56,47.5 56,52 51,49.5" fill="#0284c7"/>
            <polygon points="64,37 69,34.5 69,39 64,41.5" fill="#0369a1"/>
            <polygon points="72,33 77,30.5 77,35 72,37.5" fill="#0369a1"/>
            <polygon points="64,47 69,44.5 69,49 64,51.5" fill="#0369a1"/>
            <polygon points="72,43 77,40.5 77,45 72,47.5" fill="#0369a1"/>
            <polygon points="45,56 56,61.5 56,69 45,63.5" fill="#dc2626"/>
            <polygon points="36,24 60,12 84,24 60,35" fill="#f59e0b" stroke="#b45309" stroke-width="1"/>
            <ellipse cx="60" cy="19" rx="11" ry="6" fill="#fbbf24" stroke="#b45309" stroke-width="1"/>
            <path d="M53 18 Q60 6 67 18 Z" fill="#fef08a" stroke="#d97706" stroke-width="1"/>
            <circle cx="60" cy="9" r="3.2" fill="#ef4444" stroke="#ffffff" stroke-width="1"/>
        `;
    }

    function buildingCardSvg(level, accentColor = '#e61e6e') {
        return `<svg viewBox="0 0 120 96" class="tier-svg" aria-hidden="true">
            <polygon points="16,60 60,38 104,60 60,82" fill="#9ed945" stroke="#ffffff" stroke-width="1.5"/>
            <polygon points="16,60 60,82 60,89 16,67" fill="#7cb82e"/>
            <polygon points="60,82 104,60 104,67 60,89" fill="#5e961c"/>
            ${_isoHouseBody(level, accentColor)}
        </svg>`;
    }

    function miniBoardBuildingSvg(level, ownerColor = '#e61e6e') {
        return `<svg viewBox="22 8 76 74" class="board-bldg-svg" aria-hidden="true">
            ${_isoHouseBody(level, ownerColor)}
        </svg>`;
    }

    function resortCardSvg() {
        return `<svg viewBox="0 0 120 96" class="tier-svg" aria-hidden="true">
            <polygon points="16,60 60,38 104,60 60,82" fill="#fde68a" stroke="#ffffff" stroke-width="1.5"/>
            <polygon points="16,60 60,82 60,89 16,67" fill="#f59e0b"/>
            <polygon points="60,82 104,60 104,67 60,89" fill="#d97706"/>
            <ellipse cx="78" cy="61" rx="16" ry="7" fill="#38bdf8" opacity="0.85"/>
            <polygon points="40,52 54,59 54,68 40,61" fill="#fffbeb" stroke="#b45309" stroke-width="1"/>
            <polygon points="54,59 68,52 68,61 54,68" fill="#fde68a" stroke="#b45309" stroke-width="1"/>
            <polygon points="36,52 54,39 72,52 54,59" fill="#ef4444" stroke="#991b1b" stroke-width="1"/>
            <path d="M74 56 Q78 38 71 25" stroke="#78350f" stroke-width="4" fill="none" stroke-linecap="round"/>
            <path d="M71 25 Q58 20 52 28 Q62 27 71 25 Z" fill="#22c55e"/>
            <path d="M71 25 Q86 18 90 27 Q80 26 71 25 Z" fill="#16a34a"/>
            <path d="M71 25 Q70 12 62 15 Q68 21 71 25 Z" fill="#4ade80"/>
        </svg>`;
    }

    function resortTileSvg() {
        return `<svg viewBox="0 0 64 64" class="tile-art-svg" aria-hidden="true">
            <ellipse cx="32" cy="49" rx="22" ry="8" fill="#38bdf8" opacity="0.7"/>
            <ellipse cx="32" cy="46" rx="18" ry="6.5" fill="#fde68a" stroke="#f59e0b" stroke-width="1.2"/>
            <path d="M35 45 Q39 28 31 15" stroke="#92400e" stroke-width="4.5" fill="none" stroke-linecap="round"/>
            <path d="M31 15 Q17 11 12 20 Q22 19 31 15 Z" fill="#22c55e"/>
            <path d="M31 15 Q46 10 52 19 Q41 18 31 15 Z" fill="#16a34a"/>
            <path d="M31 15 Q32 4 23 7 Q28 12 31 15 Z" fill="#4ade80"/>
        </svg>`;
    }

    function taxTileSvg() {
        return `<svg viewBox="0 0 64 64" class="tile-art-svg" aria-hidden="true">
            <rect x="16" y="10" width="32" height="44" rx="4" fill="#ffffff" stroke="#dc2626" stroke-width="2.5"/>
            <rect x="22" y="16" width="20" height="6" rx="2" fill="#ef4444"/>
            <line x1="22" y1="28" x2="42" y2="28" stroke="#64748b" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="22" y1="35" x2="38" y2="35" stroke="#64748b" stroke-width="2.5" stroke-linecap="round"/>
            <text x="32" y="48" text-anchor="middle" font-size="11" font-weight="900" fill="#dc2626">10%</text>
        </svg>`;
    }

    function shieldBadgeSvg() {
        return `<svg viewBox="0 0 32 36" class="status-badge-svg" aria-hidden="true">
            <path d="M16 2 L29 7 V17 C29 25 23 31 16 34 C9 31 3 25 3 17 V7 Z" fill="#ef4444" stroke="#fde047" stroke-width="2.6"/>
            <path d="M16 6 L25 9.5 V17 C25 22.5 21 27 16 29.5 Z" fill="#f97316" opacity="0.7"/>
        </svg>`;
    }

    function festivalBadgeSvg() {
        return `<svg viewBox="0 0 40 24" class="status-badge-svg" aria-hidden="true">
            <rect x="1" y="2" width="38" height="18" rx="6" fill="#f97316" stroke="#ffffff" stroke-width="1.8"/>
            <text x="20" y="14.5" text-anchor="middle" font-size="10" font-weight="900" fill="#ffffff">×2</text>
        </svg>`;
    }

    function trophyBadgeSvg(mult = 5) {
        return `<svg viewBox="0 0 42 28" class="status-badge-svg" aria-hidden="true">
            <rect x="1" y="2" width="40" height="22" rx="8" fill="#9333ea" stroke="#fde047" stroke-width="2"/>
            <text x="21" y="17" text-anchor="middle" font-size="11" font-weight="900" fill="#fde047">🏆×${mult}</text>
        </svg>`;
    }

    function powerOutageBadgeSvg() {
        return `<svg viewBox="0 0 32 32" class="status-badge-svg" aria-hidden="true">
            <circle cx="16" cy="16" r="14" fill="#0f172a" stroke="#facc15" stroke-width="2"/>
            <polygon points="18,6 9,17 15,17 13,26 23,14 17,14" fill="#facc15"/>
        </svg>`;
    }

    function chanceWheelSvg() {
        const slices = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
        let paths = '';
        for (let i = 0; i < 8; i++) {
            const a1 = (i * 45) * Math.PI / 180;
            const a2 = ((i + 1) * 45) * Math.PI / 180;
            const x1 = 32 + 24 * Math.cos(a1);
            const y1 = 32 + 24 * Math.sin(a1);
            const x2 = 32 + 24 * Math.cos(a2);
            const y2 = 32 + 24 * Math.sin(a2);
            paths += `<path d="M32,32 L${x1.toFixed(1)},${y1.toFixed(1)} A24,24 0 0,1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${slices[i]}"/>`;
        }
        return `<svg viewBox="0 0 64 64" class="tile-art-svg" aria-hidden="true">
            <circle cx="32" cy="34" r="26" fill="rgba(0,0,0,0.18)"/>
            <circle cx="32" cy="32" r="25" fill="#ffffff" stroke="#1e293b" stroke-width="2"/>
            ${paths}
            <circle cx="32" cy="32" r="8" fill="#ffffff" stroke="#1e293b" stroke-width="2"/>
            <text x="32" y="36" text-anchor="middle" font-size="11" font-weight="900" fill="#0f172a">?</text>
        </svg>`;
    }

    function cornerLandmarkSvg(type) {
        if (type === 'start' || type === 'go') {
            return `<svg viewBox="0 0 90 80" class="corner-3d-svg" aria-hidden="true">
                <ellipse cx="45" cy="68" rx="30" ry="9" fill="rgba(0,0,0,0.18)"/>
                <rect x="16" y="32" width="10" height="35" rx="3" fill="#16a34a" stroke="#ffffff" stroke-width="1.5"/>
                <rect x="64" y="32" width="10" height="35" rx="3" fill="#16a34a" stroke="#ffffff" stroke-width="1.5"/>
                <rect x="12" y="18" width="66" height="19" rx="7" fill="#22c55e" stroke="#ffffff" stroke-width="2"/>
                <text x="45" y="31" text-anchor="middle" font-size="11" font-weight="900" fill="#ffffff" letter-spacing="1">START</text>
                <polygon points="24,37 30,45 36,37" fill="#facc15"/>
                <polygon points="39,37 45,45 51,37" fill="#ef4444"/>
                <polygon points="54,37 60,45 66,37" fill="#38bdf8"/>
            </svg>`;
        }
        if (type === 'lost_island' || type === 'jail') {
            return `<svg viewBox="0 0 90 80" class="corner-3d-svg" aria-hidden="true">
                <ellipse cx="45" cy="62" rx="34" ry="13" fill="#38bdf8" opacity="0.85"/>
                <ellipse cx="46" cy="59" rx="26" ry="10" fill="#fde68a" stroke="#f59e0b" stroke-width="1.5"/>
                <path d="M52 56 Q56 40 48 26" stroke="#92400e" stroke-width="6" fill="none" stroke-linecap="round"/>
                <path d="M48 26 Q32 20 26 30 Q38 28 48 26 Z" fill="#22c55e"/>
                <path d="M48 26 Q66 18 72 28 Q58 27 48 26 Z" fill="#16a34a"/>
                <path d="M48 26 Q48 10 38 14 Q44 20 48 26 Z" fill="#4ade80"/>
                <path d="M48 26 Q56 11 64 16 Q54 21 48 26 Z" fill="#22c55e"/>
                <rect x="26" y="45" width="14" height="12" rx="2" fill="#92400e" stroke="#fef3c7" stroke-width="1.2"/>
                <text x="33" y="54" text-anchor="middle" font-size="7" font-weight="900" fill="#fef3c7">SOS</text>
            </svg>`;
        }
        if (type === 'championship' || type === 'free_parking') {
            return `<svg viewBox="0 0 90 80" class="corner-3d-svg" aria-hidden="true">
                <ellipse cx="45" cy="64" rx="32" ry="11" fill="rgba(0,0,0,0.2)"/>
                <ellipse cx="45" cy="54" rx="31" ry="15" fill="#9333ea" stroke="#ffffff" stroke-width="2"/>
                <ellipse cx="45" cy="48" rx="31" ry="14" fill="#c084fc" stroke="#ffffff" stroke-width="2"/>
                <ellipse cx="45" cy="48" rx="22" ry="9" fill="#84cc16" stroke="#ecfccb" stroke-width="1.5"/>
                <line x1="22" y1="42" x2="22" y2="20" stroke="#ffffff" stroke-width="2"/>
                <polygon points="22,20 35,24 22,29" fill="#facc15"/>
                <line x1="68" y1="42" x2="68" y2="20" stroke="#ffffff" stroke-width="2"/>
                <polygon points="68,20 55,24 68,29" fill="#ec4899"/>
                <circle cx="45" cy="30" r="10" fill="#f59e0b" stroke="#ffffff" stroke-width="1.5"/>
                <text x="45" y="34" text-anchor="middle" font-size="11" font-weight="900" fill="#ffffff">🏆</text>
            </svg>`;
        }
        // world_tour -> Airport Control Tower & White Airplane
        return `<svg viewBox="0 0 90 80" class="corner-3d-svg" aria-hidden="true">
            <ellipse cx="45" cy="64" rx="30" ry="10" fill="rgba(0,0,0,0.18)"/>
            <polygon points="48,30 62,30 66,60 44,60" fill="#cbd5e1" stroke="#475569" stroke-width="1.4"/>
            <polygon points="40,22 70,22 66,32 44,32" fill="#0284c7" stroke="#ffffff" stroke-width="1.5"/>
            <rect x="52" y="13" width="6" height="9" fill="#ef4444"/>
            <path d="M14 48 L39 39 L49 43 L28 55 Z" fill="#ffffff" stroke="#0284c7" stroke-width="1.5"/>
            <polygon points="25,44 33,29 39,40" fill="#38bdf8" stroke="#0284c7" stroke-width="1.2"/>
            <circle cx="24" cy="49" r="3" fill="#f59e0b"/>
        </svg>`;
    }

    function tablePropSvg(kind) {
        if (kind === 'cash') {
            return `<svg viewBox="0 0 180 120" aria-hidden="true">
                <polygon points="18,86 58,68 78,78 38,96" fill="#e2e8f0" stroke="#64748b" stroke-width="1.2"/>
                <polygon points="18,86 38,96 38,107 18,97" fill="#94a3b8"/>
                <polygon points="38,96 78,78 78,89 38,107" fill="#cbd5e1"/>
                <g transform="translate(46, 0)">
                    <polygon points="24,62 88,32 122,49 58,79" fill="#86efac" stroke="#15803d" stroke-width="1.3"/>
                    <polygon points="24,62 58,79 58,98 24,81" fill="#22c55e" stroke="#15803d" stroke-width="1.2"/>
                    <polygon points="58,79 122,49 122,68 58,98" fill="#16a34a" stroke="#14532d" stroke-width="1.2"/>
                    <polygon points="50,50 70,40 94,52 74,62" fill="#fef08a" opacity="0.9"/>
                </g>
                <g transform="translate(54, -14)">
                    <polygon points="24,62 88,32 122,49 58,79" fill="#a7f3d0" stroke="#15803d" stroke-width="1.3"/>
                    <polygon points="24,62 58,79 58,92 24,75" fill="#4ade80" stroke="#15803d" stroke-width="1.2"/>
                    <polygon points="58,79 122,49 122,62 58,92" fill="#16a34a" stroke="#14532d" stroke-width="1.2"/>
                    <polygon points="50,50 70,40 94,52 74,62" fill="#fde047" opacity="0.95"/>
                </g>
            </svg>`;
        }
        if (kind === 'cards') {
            return `<svg viewBox="0 0 160 115" aria-hidden="true">
                <g transform="translate(22, 18) rotate(-8)">
                    <rect x="0" y="20" width="56" height="36" rx="5" fill="#ffffff" stroke="#94a3b8" stroke-width="1.5"/>
                    <text x="28" y="44" text-anchor="middle" font-size="18" fill="#0f172a">♠</text>
                </g>
                <g transform="translate(46, 10) rotate(-3)">
                    <rect x="0" y="20" width="56" height="36" rx="5" fill="#ffffff" stroke="#94a3b8" stroke-width="1.5"/>
                    <text x="28" y="44" text-anchor="middle" font-size="18" fill="#dc2626">♥</text>
                </g>
                <g transform="translate(72, 6) rotate(4)">
                    <rect x="0" y="20" width="56" height="36" rx="5" fill="#ffffff" stroke="#64748b" stroke-width="1.6"/>
                    <text x="28" y="44" text-anchor="middle" font-size="18" fill="#0f172a">♣</text>
                </g>
            </svg>`;
        }
        if (kind === 'coins_bronze') {
            return `<svg viewBox="0 0 150 110" aria-hidden="true">
                ${[0, 1, 2, 3].map(col => {
                    const cx = 32 + col * 24;
                    const count = 2 + (col % 3);
                    let stack = '';
                    for (let r = 0; r < count; r++) {
                        const cy = 84 - r * 9 - col * 4;
                        stack += `
                            <ellipse cx="${cx}" cy="${cy + 4}" rx="13" ry="6" fill="#9a3412" stroke="#7c2d12" stroke-width="1"/>
                            <ellipse cx="${cx}" cy="${cy}" rx="13" ry="6" fill="#ea580c" stroke="#fed7aa" stroke-width="1"/>
                        `;
                    }
                    return stack;
                }).join('')}
            </svg>`;
        }
        return `<svg viewBox="0 0 160 115" aria-hidden="true">
            ${[0, 1, 2, 3].map(col => {
                const cx = 30 + col * 26;
                const count = 2 + col;
                const isSilver = col === 1;
                const topCol = isSilver ? '#e2e8f0' : '#fbbf24';
                const sideCol = isSilver ? '#94a3b8' : '#d97706';
                let stack = '';
                for (let r = 0; r < count; r++) {
                    const cy = 90 - r * 9 - (3 - col) * 3;
                    stack += `
                        <ellipse cx="${cx}" cy="${cy + 4}" rx="14" ry="6.5" fill="${sideCol}" stroke="#78350f" stroke-width="0.9"/>
                        <ellipse cx="${cx}" cy="${cy}" rx="14" ry="6.5" fill="${topCol}" stroke="#fef9c3" stroke-width="1"/>
                    `;
                }
                return stack;
            }).join('')}
        </svg>`;
    }

    const Art = {
        shadeColor,
        banknoteSvg,
        buildingCardSvg,
        miniBoardBuildingSvg,
        resortCardSvg,
        resortTileSvg,
        taxTileSvg,
        shieldBadgeSvg,
        festivalBadgeSvg,
        trophyBadgeSvg,
        powerOutageBadgeSvg,
        chanceWheelSvg,
        cornerLandmarkSvg,
        tablePropSvg
    };

    global.CoTyPhu = Object.assign(global.CoTyPhu || {}, { Art });
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { Art };
    }
})(typeof window !== 'undefined' ? window : globalThis);
