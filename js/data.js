(function (global) {
    'use strict';

    const DEFAULT_CONFIG = {
        startingCash: 2000000,
        startSalary: 300000,
        islandBail: 200000,
        championshipCost: 50000,
        worldTourCost: 50000,
        matchMinutes: 20
    };

    const AVATARS = ['🎩', '🚗', '🐕', '🚢', '👑', '🚀', '🐱', '⚽'];

    const PLAYER_COLORS = ['#f5b800', '#7cc422', '#17a2e5', '#e61e6e'];

    const COLOR_GROUPS = {
        brown: { id: 'brown', name: 'Tây Ban Nha', color: '#a16207', textColor: '#ffffff', tiles: [1, 2, 3] },
        cyan: { id: 'cyan', name: 'Trung Quốc', color: '#0ea5e9', textColor: '#ffffff', tiles: [5, 6, 7] },
        pink: { id: 'pink', name: 'Ý', color: '#e61e6e', textColor: '#ffffff', tiles: [9, 10, 11] },
        orange: { id: 'orange', name: 'Đức', color: '#f97316', textColor: '#ffffff', tiles: [13, 15] },
        red: { id: 'red', name: 'Anh & Úc', color: '#ef4444', textColor: '#ffffff', tiles: [17, 19] },
        yellow: { id: 'yellow', name: 'Hoa Kỳ', color: '#eab308', textColor: '#0f172a', tiles: [21, 22, 23] },
        blue: { id: 'blue', name: 'Pháp', color: '#2563eb', textColor: '#ffffff', tiles: [26, 27] },
        purple: { id: 'purple', name: 'Nhật Bản', color: '#7c3aed', textColor: '#ffffff', tiles: [29, 31] }
    };

    const RESORT_TILES = [4, 14, 18, 25];

    const BOARD_SIDES = [
        [1, 2, 3, 4, 5, 6, 7],
        [9, 10, 11, 13, 14, 15],
        [17, 18, 19, 21, 22, 23],
        [25, 26, 27, 29, 31]
    ];

    const BOARD_TILES = [
        { index: 0, name: 'START', shortName: 'START', type: 'start', description: 'Nhận 300 000 mỗi lần đi qua hoặc dừng lại.' },
        { index: 1, name: 'GRANADA', shortName: 'GRANADA', type: 'city', group: 'brown', price: 60000, houseCost: 50000, hotelCost: 100000, rent: [2000, 10000, 30000, 75000, 120000] },
        { index: 2, name: 'SEVILLE', shortName: 'SEVILLE', type: 'city', group: 'brown', price: 60000, houseCost: 50000, hotelCost: 100000, rent: [4000, 15000, 45000, 110000, 160000] },
        { index: 3, name: 'MADRID', shortName: 'MADRID', type: 'city', group: 'brown', price: 80000, houseCost: 50000, hotelCost: 100000, rent: [6000, 20000, 55000, 130000, 180000] },
        { index: 4, name: 'BALI', shortName: 'BALI', type: 'resort', price: 200000, rent: [25000, 50000, 100000, 200000] },
        { index: 5, name: 'HONG KONG', shortName: 'HONG KONG', type: 'city', group: 'cyan', price: 100000, houseCost: 50000, hotelCost: 120000, rent: [8000, 25000, 65000, 145000, 195000] },
        { index: 6, name: 'BEIJING', shortName: 'BEIJING', type: 'city', group: 'cyan', price: 100000, houseCost: 50000, hotelCost: 120000, rent: [8000, 25000, 65000, 145000, 195000] },
        { index: 7, name: 'SHANGHAI', shortName: 'SHANGHAI', type: 'city', group: 'cyan', price: 120000, houseCost: 50000, hotelCost: 150000, rent: [10000, 30000, 80000, 165000, 225000] },
        { index: 8, name: 'LOST ISLAND', shortName: 'LOST\nISLAND', type: 'lost_island', description: 'Đảo Hoang! Tung đôi, nộp 200 000 hoặc dùng Thẻ Thoát Đảo để rời khỏi.' },
        { index: 9, name: 'VENICE', shortName: 'VENICE', type: 'city', group: 'pink', price: 140000, houseCost: 100000, hotelCost: 180000, rent: [12000, 45000, 120000, 260000, 395000] },
        { index: 10, name: 'MILAN', shortName: 'MILAN', type: 'city', group: 'pink', price: 140000, houseCost: 100000, hotelCost: 180000, rent: [12000, 45000, 125000, 275000, 413000] },
        { index: 11, name: 'ROME', shortName: 'ROME', type: 'city', group: 'pink', price: 160000, houseCost: 100000, hotelCost: 200000, rent: [15000, 50000, 135000, 300000, 440000] },
        { index: 12, name: 'CHANCE', shortName: 'CHANCE', type: 'chance' },
        { index: 13, name: 'HAMBURG', shortName: 'HAMBURG', type: 'city', group: 'orange', price: 180000, houseCost: 100000, hotelCost: 220000, rent: [16000, 55000, 150000, 320000, 468000] },
        { index: 14, name: 'CYPRUS', shortName: 'CYPRUS', type: 'resort', price: 200000, rent: [25000, 50000, 100000, 200000] },
        { index: 15, name: 'BERLIN', shortName: 'BERLIN', type: 'city', group: 'orange', price: 200000, houseCost: 100000, hotelCost: 240000, rent: [18000, 60000, 165000, 345000, 495000] },
        { index: 16, name: 'WORLD CHAMPIONSHIPS', shortName: 'WORLD\nCHAMP', type: 'championship', description: 'Tổ chức Giải Vô Địch trên 1 ô của bạn (phí 50 000) để nhân ×2..×5 tiền thuê!' },
        { index: 17, name: 'LONDON', shortName: 'LONDON', type: 'city', group: 'red', price: 220000, houseCost: 150000, hotelCost: 260000, rent: [20000, 75000, 195000, 420000, 600000] },
        { index: 18, name: 'DUBAI', shortName: 'DUBAI', type: 'resort', price: 200000, rent: [25000, 50000, 100000, 200000] },
        { index: 19, name: 'SYDNEY', shortName: 'SYDNEY', type: 'city', group: 'red', price: 240000, houseCost: 150000, hotelCost: 280000, rent: [22000, 85000, 215000, 460000, 660000] },
        { index: 20, name: 'CHANCE', shortName: 'CHANCE', type: 'chance' },
        { index: 21, name: 'CHICAGO', shortName: 'CHICAGO', type: 'city', group: 'yellow', price: 260000, houseCost: 150000, hotelCost: 300000, rent: [24000, 95000, 240000, 500000, 700000] },
        { index: 22, name: 'LAS VEGAS', shortName: 'LAS VEGAS', type: 'city', group: 'yellow', price: 260000, houseCost: 150000, hotelCost: 300000, rent: [25000, 100000, 255000, 540000, 760000] },
        { index: 23, name: 'NEW YORK', shortName: 'NEW YORK', type: 'city', group: 'yellow', price: 280000, houseCost: 150000, hotelCost: 320000, rent: [28000, 110000, 275000, 580000, 810000] },
        { index: 24, name: 'WORLD TOUR', shortName: 'WORLD\nTOUR', type: 'world_tour', description: 'Sẵn sàng dùng máy bay ở lượt tới để bay tới bất kỳ ô nào trên bàn cờ (phí 50 000).' },
        { index: 25, name: 'NICE', shortName: 'NICE', type: 'resort', price: 200000, rent: [25000, 50000, 100000, 200000] },
        { index: 26, name: 'LYON', shortName: 'LYON', type: 'city', group: 'blue', price: 300000, houseCost: 200000, hotelCost: 350000, rent: [32000, 125000, 320000, 680000, 950000] },
        { index: 27, name: 'PARIS', shortName: 'PARIS', type: 'city', group: 'blue', price: 320000, houseCost: 200000, hotelCost: 380000, rent: [35000, 140000, 360000, 760000, 1100000] },
        { index: 28, name: 'CHANCE', shortName: 'CHANCE', type: 'chance' },
        { index: 29, name: 'OSAKA', shortName: 'OSAKA', type: 'city', group: 'purple', price: 350000, houseCost: 200000, hotelCost: 420000, rent: [40000, 160000, 410000, 860000, 1250000] },
        { index: 30, name: 'TAX', shortName: 'TAX', type: 'tax', rate: 0.1, description: 'Nộp thuế 10% tổng giá trị bất động sản đang sở hữu.' },
        { index: 31, name: 'TOKYO', shortName: 'TOKYO', type: 'city', group: 'purple', price: 400000, houseCost: 200000, hotelCost: 450000, rent: [50000, 190000, 480000, 980000, 1400000] }
    ];

    const CHANCE_CARDS = [
        { id: 'bt1', title: 'ĐỘNG ĐẤT (EARTHQUAKE)', text: 'Chọn 1 thành phố (chưa phải Khách sạn) của đối thủ để phá hủy trả về đất trống! (Khiên sẽ chặn)', action: 'earthquake' },
        { id: 'bt2', title: 'QUÀ HOÀNG GIA (ROYAL GIFT)', text: 'Tặng miễn phí 1 thành phố bất kỳ của bạn cho 1 đối thủ.', action: 'royal_gift' },
        { id: 'bt3', title: 'KHIÊN BẢO VỆ (SHIELD)', text: 'Đặt Khiên lên 1 thành phố của bạn để chặn 1 lần Động Đất, Cúp Điện hoặc Đổi Đất.', action: 'shield' },
        { id: 'bt4', title: 'CÚP ĐIỆN (POWER OUTAGE)', text: 'Cắt điện 1 thành phố của đối thủ trong 2 vòng — tiền thuê giảm về 0! (Khiên sẽ chặn)', action: 'power_outage' },
        { id: 'bt5', title: 'LỄ HỘI THÀNH PHỐ (FESTIVAL)', text: 'Tổ chức Lễ Hội nhân ×2 tiền thuê vĩnh viễn cho 1 thành phố bạn sở hữu!', action: 'festival' },
        { id: 'bt6', title: 'HOÁN ĐỔI ĐẤT (CITY SWAP)', text: 'Đổi 1 thành phố của bạn lấy 1 thành phố (chưa phải Khách sạn / Khu nghỉ dưỡng) của đối thủ!', action: 'city_swap' },
        { id: 'bt7', title: 'THẺ THOÁT ĐẢO (ESCAPE)', text: 'Giữ thẻ này để rời khỏi Đảo Hoang miễn phí bất cứ lúc nào.', action: 'escape_card' },
        { id: 'bt8', title: 'VÉ MÁY BAY VIP (WORLD TOUR)', text: 'Di chuyển ngay tới ô World Tour (ô 24) và sẵn sàng bay ở lượt kế tiếp!', action: 'go_world_tour' },
        { id: 'bt9', title: 'THƯ MỜI VÔ ĐỊCH', text: 'Di chuyển thẳng tới ô World Championships (ô 16) để nhân tiền thuê!', action: 'go_championship' },
        { id: 'bt10', title: 'LẠC VÀO ĐẢO HOANG', text: 'Bị đưa thẳng ra Đảo Hoang (ô 8)! Không qua START, không nhận 300 000.', action: 'go_lost_island' },
        { id: 'bt11', title: 'VỀ ĐIỂM XUẤT PHÁT', text: 'Tiến thẳng về ô START (ô 0) và nhận thưởng 300 000!', action: 'go_start' },
        { id: 'bt12', title: 'CHÚC MỪNG SINH NHẬT', text: 'Mỗi người chơi khác tặng bạn 50 000 quà sinh nhật!', action: 'birthday', amount: 50000 },
        { id: 'bt13', title: 'TRÚNG SỐ ĐỘC ĐẮC', text: 'Ngân hàng trao thưởng nóng cho bạn 250 000!', action: 'jackpot', amount: 250000 },
        { id: 'bt14', title: 'KIỂM TRA THUẾ ĐẶC BIỆT', text: 'Nộp thuế 10% tổng giá trị bất động sản (tối thiểu 100 000 nếu chưa có đất).', action: 'tax_audit' }
    ];

    function formatMoney(amount) {
        const num = Number(amount) || 0;
        const sign = num < 0 ? '-' : '';
        const abs = Math.abs(Math.round(num));
        return sign + abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }

    function formatShortMoney(amount) {
        const num = Number(amount) || 0;
        const sign = num < 0 ? '-' : '';
        const abs = Math.abs(num);
        if (abs >= 1000000) {
            const m = (abs / 1000000).toFixed(2).replace(/\.?0+$/, '');
            return sign + m + 'M';
        }
        if (abs >= 1000) {
            const k = (abs / 1000).toFixed(1).replace(/\.0$/, '');
            return sign + k + 'K';
        }
        return sign + String(Math.round(abs));
    }

    const api = {
        DEFAULT_CONFIG,
        AVATARS,
        PLAYER_COLORS,
        COLOR_GROUPS,
        RESORT_TILES,
        BOARD_SIDES,
        BOARD_TILES,
        CHANCE_CARDS,
        formatMoney,
        formatShortMoney
    };

    global.CoTyPhu = Object.assign(global.CoTyPhu || {}, api);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
