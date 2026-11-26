(function (global) {
    'use strict';

    const FIREBASE_CONFIG = {
        databaseURL: 'https://cotyphu-14cdf-default-rtdb.asia-southeast1.firebasedatabase.app'
    };

    const api = { FIREBASE_CONFIG };
    global.CoTyPhu = Object.assign(global.CoTyPhu || {}, api);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
