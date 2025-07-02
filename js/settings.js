var SETTINGS = {
    api_key: 'd00dce85051b7dbcbfcc165eaebfc6d2',
    api_secret: 'bdfcae3563763ece1b6d3dcdd56a7ab8',

    callback_file: 'html/lastfm_callback.html',

    main_icon: '../img/main-icon.png',
    playing_icon: '../img/main-icon-playing.png',
    paused_icon: '../img/main-icon-paused.png',
    error_icon: '../img/main-icon-error.png',
    scrobbling_stopped_icon: '../img/main-icon-scrobbling-stopped.png',

    scrobble_point: 0.7,
    scrobble_interval: 420, // 7 minutes
    max_scrobbles: Number.POSITIVE_INFINITY,

    // NEW: default history sync interval in minutes (60 = hourly)
    history_sync_interval: 60,

    refresh_interval: 2,

    gmusic_ads_metadata: {
        title: 'We\'ll be right back',
        artist: 'Subscribe to go ad-free'
    }
};

SETTINGS.max_scrobbles = localStorage.getItem('max_scrobbles') &&
                            parseInt(localStorage.getItem('max_scrobbles')) ||
                            SETTINGS.max_scrobbles;

SETTINGS.logs_enabled = localStorage.getItem('logs_enabled') &&
                            localStorage.getItem('logs_enabled') == 'true';

// Load user-defined history sync interval.
// If a value (including "0") is stored, use it; otherwise keep the default.
var _storedInterval = localStorage.getItem('history_sync_interval');
if (_storedInterval !== null) {
    SETTINGS.history_sync_interval = parseInt(_storedInterval);
}

// This enables scrobbling by default
SETTINGS.scrobble = localStorage.getItem("scrobble") != "false";
