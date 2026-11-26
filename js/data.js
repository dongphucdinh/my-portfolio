(function (global) {
    'use strict';

    const DEFAULT_CONFIG = {
        startingCash: 1500,
        goSalary: 200,
        jailBail: 50,
        freeParkingJackpot: false
    };

    const AVATARS = ['🎩', '🚗', '🐕', '🚢', '👑', '🚀', '🐱', '⚽'];

    const PLAYER_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b'];

    const COLOR_GROUPS = {
        brown: { id: 'brown', name: 'Nâu (Miền Tây)', color: '#8b4513', textColor: '#ffffff', tiles: [1, 3] },
        lightblue: { id: 'lightblue', name: 'Xanh Nhạt (Biển Nam)', color: '#38bdf8', textColor: '#0f172a', tiles: [6, 8, 9] },
        pink: { id: 'pink', name: 'Hồng (Cao Nguyên & Biển)', color: '#ec4899', textColor: '#ffffff', tiles: [11, 13, 14] },
        orange: { id: 'orange', name: 'Cam (Di Sản Miền Trung)', color: '#f97316', textColor: '#ffffff', tiles: [16, 18, 19] },
        red: { id: 'red', name: 'Đỏ (Bắc Trung Bộ)', color: '#ef4444', textColor: '#ffffff', tiles: [21, 23, 24] },
        yellow: { id: 'yellow', name: 'Vàng (Duyên Hải & Tây Bắc)', color: '#eab308', textColor: '#0f172a', tiles: [26, 27, 29] },
        green: { id: 'green', name: 'Xanh Lá (Đảo & Công Nghiệp)', color: '#16a34a', textColor: '#ffffff', tiles: [31, 32, 34] },
        darkblue: { id: 'darkblue', name: 'Xanh Đậm (Đô Thị Đặc Biệt)', color: '#1d4ed8', textColor: '#ffffff', tiles: [37, 39] }
    };

    const STATION_TILES = [5, 15, 25, 35];
    const UTILITY_TILES = [12, 28];

    const BOARD_TILES = [
        { index: 0, name: 'Khởi Hành', shortName: 'KHỞI HÀNH', type: 'go', icon: '🏁', description: 'Nhận 200k mỗi lần đi qua hoặc dừng lại.' },
        { index: 1, name: 'Cà Mau', shortName: 'Cà Mau', type: 'property', group: 'brown', price: 60, rent: [2, 10, 30, 90, 160, 250], houseCost: 50 },
        { index: 2, name: 'Khí Vận', shortName: 'Khí Vận', type: 'chest', icon: '🎁' },
        { index: 3, name: 'Bạc Liêu', shortName: 'Bạc Liêu', type: 'property', group: 'brown', price: 60, rent: [4, 20, 60, 180, 320, 450], houseCost: 50 },
        { index: 4, name: 'Thuế Thu Nhập', shortName: 'Thuế TN', type: 'tax', amount: 200, icon: '💸' },
        { index: 5, name: 'Ga Sài Gòn', shortName: 'Ga Sài Gòn', type: 'station', price: 200, icon: '🚂' },
        { index: 6, name: 'Cần Thơ', shortName: 'Cần Thơ', type: 'property', group: 'lightblue', price: 100, rent: [6, 30, 90, 270, 400, 550], houseCost: 50 },
        { index: 7, name: 'Cơ Hội', shortName: 'Cơ Hội', type: 'chance', icon: '❓' },
        { index: 8, name: 'Vũng Tàu', shortName: 'Vũng Tàu', type: 'property', group: 'lightblue', price: 100, rent: [6, 30, 90, 270, 400, 550], houseCost: 50 },
        { index: 9, name: 'Phan Thiết', shortName: 'Phan Thiết', type: 'property', group: 'lightblue', price: 120, rent: [8, 40, 100, 300, 450, 600], houseCost: 50 },
        { index: 10, name: 'Nhà Tù / Thăm Tù', shortName: 'NHÀ TÙ', type: 'jail', icon: '⛓️', description: 'Thăm tù miễn phí hoặc bị giam giữ.' },
        { index: 11, name: 'Đà Lạt', shortName: 'Đà Lạt', type: 'property', group: 'pink', price: 140, rent: [10, 50, 150, 450, 625, 750], houseCost: 100 },
        { index: 12, name: 'Công Ty Điện Lực', shortName: 'Điện Lực', type: 'utility', price: 150, icon: '⚡' },
        { index: 13, name: 'Nha Trang', shortName: 'Nha Trang', type: 'property', group: 'pink', price: 140, rent: [10, 50, 150, 450, 625, 750], houseCost: 100 },
        { index: 14, name: 'Quy Nhơn', shortName: 'Quy Nhơn', type: 'property', group: 'pink', price: 160, rent: [12, 60, 180, 500, 700, 900], houseCost: 100 },
        { index: 15, name: 'Ga Đà Nẵng', shortName: 'Ga Đà Nẵng', type: 'station', price: 200, icon: '🚂' },
        { index: 16, name: 'Hội An', shortName: 'Hội An', type: 'property', group: 'orange', price: 180, rent: [14, 70, 200, 550, 750, 950], houseCost: 100 },
        { index: 17, name: 'Khí Vận', shortName: 'Khí Vận', type: 'chest', icon: '🎁' },
        { index: 18, name: 'Huế', shortName: 'Huế', type: 'property', group: 'orange', price: 180, rent: [14, 70, 200, 550, 750, 950], houseCost: 100 },
        { index: 19, name: 'Đà Nẵng', shortName: 'Đà Nẵng', type: 'property', group: 'orange', price: 200, rent: [16, 80, 220, 600, 800, 1000], houseCost: 100 },
        { index: 20, name: 'Đỗ Xe Miễn Phí', shortName: 'ĐỖ XE FREE', type: 'free_parking', icon: '🅿️', description: 'Nghỉ ngơi miễn phí (hoặc nhận Quỹ Đỗ Xe nếu bật).' },
        { index: 21, name: 'Vinh', shortName: 'Vinh', type: 'property', group: 'red', price: 220, rent: [18, 90, 250, 700, 875, 1050], houseCost: 150 },
        { index: 22, name: 'Cơ Hội', shortName: 'Cơ Hội', type: 'chance', icon: '❓' },
        { index: 23, name: 'Ninh Bình', shortName: 'Ninh Bình', type: 'property', group: 'red', price: 220, rent: [18, 90, 250, 700, 875, 1050], houseCost: 150 },
        { index: 24, name: 'Thanh Hóa', shortName: 'Thanh Hóa', type: 'property', group: 'red', price: 240, rent: [20, 100, 300, 750, 925, 1100], houseCost: 150 },
        { index: 25, name: 'Ga Vinh', shortName: 'Ga Vinh', type: 'station', price: 200, icon: '🚂' },
        { index: 26, name: 'Hải Phòng', shortName: 'Hải Phòng', type: 'property', group: 'yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150], houseCost: 150 },
        { index: 27, name: 'Hạ Long', shortName: 'Hạ Long', type: 'property', group: 'yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150], houseCost: 150 },
        { index: 28, name: 'Công Ty Cấp Nước', shortName: 'Cấp Nước', type: 'utility', price: 150, icon: '💧' },
        { index: 29, name: 'Sa Pa', shortName: 'Sa Pa', type: 'property', group: 'yellow', price: 280, rent: [24, 120, 360, 850, 1025, 1200], houseCost: 150 },
        { index: 30, name: 'Vào Tù', shortName: 'VÀO TÙ', type: 'go_to_jail', icon: '🚓', description: 'Đi thẳng vào Nhà Tù, không nhận lương Khởi Hành.' },
        { index: 31, name: 'Phú Quốc', shortName: 'Phú Quốc', type: 'property', group: 'green', price: 300, rent: [26, 130, 390, 900, 1100, 1275], houseCost: 200 },
        { index: 32, name: 'Bình Dương', shortName: 'Bình Dương', type: 'property', group: 'green', price: 300, rent: [26, 130, 390, 900, 1100, 1275], houseCost: 200 },
        { index: 33, name: 'Khí Vận', shortName: 'Khí Vận', type: 'chest', icon: '🎁' },
        { index: 34, name: 'Biên Hòa', shortName: 'Biên Hòa', type: 'property', group: 'green', price: 320, rent: [28, 150, 450, 1000, 1200, 1400], houseCost: 200 },
        { index: 35, name: 'Ga Hà Nội', shortName: 'Ga Hà Nội', type: 'station', price: 200, icon: '🚂' },
        { index: 36, name: 'Cơ Hội', shortName: 'Cơ Hội', type: 'chance', icon: '❓' },
        { index: 37, name: 'TP. Hồ Chí Minh', shortName: 'TP. HCM', type: 'property', group: 'darkblue', price: 350, rent: [35, 175, 500, 1100, 1300, 1500], houseCost: 200 },
        { index: 38, name: 'Thuế Xa Xỉ', shortName: 'Thuế Xa Xỉ', type: 'tax', amount: 100, icon: '💎' },
        { index: 39, name: 'Hà Nội', shortName: 'Hà Nội', type: 'property', group: 'darkblue', price: 400, rent: [50, 200, 600, 1400, 1700, 2000], houseCost: 200 }
    ];

    const CHANCE_CARDS = [
        { id: 'ch1', title: 'Tiến Về Khởi Hành', text: 'Đi thẳng tới ô Khởi Hành và nhận lương 200k.', action: 'move_to', target: 0 },
        { id: 'ch2', title: 'Thăm Thủ Đô', text: 'Di chuyển tới Hà Nội (ô 39). Nếu đi qua Khởi Hành, nhận 200k.', action: 'move_to', target: 39 },
        { id: 'ch3', title: 'Du Lịch Đà Nẵng', text: 'Di chuyển tới Đà Nẵng (ô 19). Nếu đi qua Khởi Hành, nhận 200k.', action: 'move_to', target: 19 },
        { id: 'ch4', title: 'Nghỉ Dưỡng Đà Lạt', text: 'Di chuyển tới Đà Lạt (ô 11). Nếu đi qua Khởi Hành, nhận 200k.', action: 'move_to', target: 11 },
        { id: 'ch5', title: 'Chuyến Tàu Phương Nam', text: 'Đi tới Ga Sài Gòn (ô 5). Nếu đi qua Khởi Hành, nhận 200k.', action: 'move_to', target: 5 },
        { id: 'ch6', title: 'Tới Nhà Ga Gần Nhất', text: 'Tiến tới Nhà Ga gần nhất. Nếu đã có chủ, trả gấp đôi tiền thuê!', action: 'nearest_station', multiplier: 2 },
        { id: 'ch7', title: 'Tới Công Ty Dịch Vụ Gần Nhất', text: 'Tiến tới Công Ty Điện/Nước gần nhất. Nếu có chủ, trả gấp 10 lần tổng xúc xắc!', action: 'nearest_utility', multiplier: 10 },
        { id: 'ch8', title: 'Quay Lại Phía Sau', text: 'Lùi lại 3 ô.', action: 'move_back', steps: 3 },
        { id: 'ch9', title: 'Lệnh Bắt Khẩn Cấp', text: 'Đi thẳng vào Nhà Tù! Không qua ô Khởi Hành, không nhận 200k.', action: 'go_to_jail' },
        { id: 'ch10', title: 'Thẻ Miễn Tù', text: 'Giữ thẻ này để ra tù miễn phí hoặc đem giao dịch.', action: 'jail_free_card' },
        { id: 'ch11', title: 'Cổ Tức Ngân Hàng', text: 'Ngân hàng trả cổ tức cho bạn 50k.', action: 'collect', amount: 50 },
        { id: 'ch12', title: 'Đáo Hạn Khoản Đầu Tư', text: 'Khoản đầu tư xây dựng sinh lời, nhận ngay 150k.', action: 'collect', amount: 150 },
        { id: 'ch13', title: 'Phạt Quá Tốc Độ', text: 'Vi phạm giao thông, nộp phạt 15k.', action: 'pay', amount: 15 },
        { id: 'ch14', title: 'Tu Sửa Bất Động Sản', text: 'Đóng phí sửa chữa: 25k cho mỗi nhà và 100k cho mỗi khách sạn.', action: 'repairs', perHouse: 25, perHotel: 100 },
        { id: 'ch15', title: 'Được Bầu Làm Chủ Tịch', text: 'Chiêu đãi mọi người: trả mỗi người chơi đang hoạt động 50k.', action: 'pay_all', amount: 50 },
        { id: 'ch16', title: 'Thưởng Chứng Khoán', text: 'Thị trường khởi sắc, bạn thu về 100k.', action: 'collect', amount: 100 }
    ];

    const CHEST_CARDS = [
        { id: 'cc1', title: 'Về Ô Khởi Hành', text: 'Tiến thẳng tới ô Khởi Hành và nhận 200k.', action: 'move_to', target: 0 },
        { id: 'cc2', title: 'Ngân Hàng Nhầm Lẫn', text: 'Lỗi hệ thống có lợi cho bạn, nhận thêm 200k.', action: 'collect', amount: 200 },
        { id: 'cc3', title: 'Phí Khám Bệnh', text: 'Thanh toán hóa đơn phòng khám hết 50k.', action: 'pay', amount: 50 },
        { id: 'cc4', title: 'Bán Cổ Phiếu', text: 'Bán bớt cổ phiếu thu về 50k.', action: 'collect', amount: 50 },
        { id: 'cc5', title: 'Ân Xá Miễn Tù', text: 'Nhận 1 thẻ Ra Tù Miễn Phí để dùng khi cần.', action: 'jail_free_card' },
        { id: 'cc6', title: 'Áp Giải Vào Tù', text: 'Đi thẳng vào Nhà Tù! Không qua Khởi Hành, không nhận 200k.', action: 'go_to_jail' },
        { id: 'cc7', title: 'Chúc Mừng Sinh Nhật', text: 'Mỗi người chơi khác tặng bạn 20k quà sinh nhật!', action: 'collect_all', amount: 20 },
        { id: 'cc8', title: 'Hoàn Thuế Thu Nhập', text: 'Cơ quan thuế hoàn trả cho bạn 20k.', action: 'collect', amount: 20 },
        { id: 'cc9', title: 'Đáo Hạn Bảo Hiểm', text: 'Hợp đồng bảo hiểm nhân thọ đáo hạn, nhận 100k.', action: 'collect', amount: 100 },
        { id: 'cc10', title: 'Viện Phí Nội Trú', text: 'Thanh toán viện phí 100k.', action: 'pay', amount: 100 },
        { id: 'cc11', title: 'Đóng Học Phí', text: 'Nộp học phí kỳ mới hết 50k.', action: 'pay', amount: 50 },
        { id: 'cc12', title: 'Phí Tư Vấn Chiến Lược', text: 'Nhận thù lao tư vấn 25k.', action: 'collect', amount: 25 },
        { id: 'cc13', title: 'Đóng Góp Hạ Tầng Đô Thị', text: 'Đóng góp 40k cho mỗi nhà và 115k cho mỗi khách sạn.', action: 'repairs', perHouse: 40, perHotel: 115 },
        { id: 'cc14', title: 'Giải Nhì Duyên Dáng', text: 'Bạn giành giải thưởng cuộc thi địa phương, nhận 10k.', action: 'collect', amount: 10 },
        { id: 'cc15', title: 'Nhận Thừa Kế', text: 'Bạn được thừa kế tài sản trị giá 100k.', action: 'collect', amount: 100 },
        { id: 'cc16', title: 'Trợ Cấp Du Lịch', text: 'Nhận voucher hoàn tiền du lịch trị giá 75k.', action: 'collect', amount: 75 }
    ];

    function formatMoney(amount) {
        const num = Number(amount) || 0;
        const sign = num < 0 ? '-' : '';
        const abs = Math.abs(Math.round(num));
        return sign + abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'k';
    }

    const api = {
        DEFAULT_CONFIG,
        AVATARS,
        PLAYER_COLORS,
        COLOR_GROUPS,
        STATION_TILES,
        UTILITY_TILES,
        BOARD_TILES,
        CHANCE_CARDS,
        CHEST_CARDS,
        formatMoney
    };

    global.CoTyPhu = Object.assign(global.CoTyPhu || {}, api);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
