// Define an interface for the settings object
interface AppSettings {
    api_key: string;
    api_secret: string;
    callback_file: string;
    main_icon: string;
    playing_icon: string;
    paused_icon: string;
    error_icon: string;
    scrobbling_stopped_icon: string;
    scrobble_point: number;
    scrobble_interval: number;
    max_scrobbles: number;
    history_sync_interval: number;
    refresh_interval: number;
    gmusic_ads_metadata: {
        title: string;
        artist: string;
    };
    logs_enabled?: boolean; // Optional as it's loaded from storage
    scrobble?: boolean;     // Optional as it's loaded from storage
}

var SETTINGS: AppSettings = {
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
    // logs_enabled and scrobble will be initialized after loading from storage
};

// Define a type for the storage result
interface StoredSettings {
    max_scrobbles?: string | number;
    logs_enabled?: string; // Stored as string "true" or "false"
    history_sync_interval?: string | number;
    scrobble?: string; // Stored as string "true" or "false"
}

// Load settings from chrome.storage.local asynchronously
chrome.storage.local.get([
  'max_scrobbles',
  'logs_enabled',
  'history_sync_interval',
  'scrobble'
], (result: StoredSettings) => {
  if (chrome.runtime.lastError) {
    console.error("Error loading settings:", chrome.runtime.lastError.message);
    return;
  }

  if (result.max_scrobbles !== undefined) {
    SETTINGS.max_scrobbles = typeof result.max_scrobbles === 'string' ? parseInt(result.max_scrobbles, 10) : result.max_scrobbles;
  }

  SETTINGS.logs_enabled = result.logs_enabled === 'true';

  // Load user-defined history sync interval.
  // If a value (including "0") is stored, use it; otherwise keep the default.
  if (result.history_sync_interval !== undefined) {
    SETTINGS.history_sync_interval = typeof result.history_sync_interval === 'string' ? parseInt(result.history_sync_interval, 10) : result.history_sync_interval;
  }

  // This enables scrobbling by default if not set or if set to "true"
  // It disables scrobbling only if explicitly set to "false"
  SETTINGS.scrobble = result.scrobble !== "false";
});
