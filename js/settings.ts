/**
 * settings.ts
 * User settings for the application
 * Copyright (c) 2011 Alexey Savartsov <asavartsov@gmail.com>
 * Licensed under the MIT license
 */

export interface Settings {
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
    max_scrobbles: number | string; // Can be number or "Infinity" string then parsed
    history_sync_interval: number;
    refresh_interval: number;
    gmusic_ads_metadata: {
        title: string;
        artist: string;
    };
    logs_enabled?: boolean; // Optional as it's loaded async
    scrobble?: boolean; // Optional as it's loaded async
    play_tab_status_filter?: string; // Optional, if not present in original
}

export const SETTINGS: Settings = {
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
    max_scrobbles: Number.POSITIVE_INFINITY, // Default, will be overridden by storage if present
    history_sync_interval: 60, // NEW: default history sync interval in minutes (60 = hourly)
    refresh_interval: 2,
    gmusic_ads_metadata: {
        title: 'We\'ll be right back',
        artist: 'Subscribe to go ad-free'
    }
    // logs_enabled and scrobble are loaded asynchronously
};

// Load settings from chrome.storage.local asynchronously
chrome.storage.local.get([
  'max_scrobbles',
  'logs_enabled',
  'history_sync_interval',
  'scrobble'
], (result: { [key: string]: any }) => {
  if (result.max_scrobbles) {
    const parsedMaxScrobbles = parseInt(result.max_scrobbles);
    SETTINGS.max_scrobbles = isNaN(parsedMaxScrobbles) ? Number.POSITIVE_INFINITY : parsedMaxScrobbles;
  }
  SETTINGS.logs_enabled = result.logs_enabled === true || result.logs_enabled === 'true';

  // Load user-defined history sync interval.
  // If a value (including "0") is stored, use it; otherwise keep the default.
  if (result.history_sync_interval !== undefined) {
    const parsedInterval = parseInt(result.history_sync_interval);
    SETTINGS.history_sync_interval = isNaN(parsedInterval) ? SETTINGS.history_sync_interval : parsedInterval;
  }

  // This enables scrobbling by default
  SETTINGS.scrobble = result.scrobble !== false && result.scrobble !== "false";
});

// Make settings available globally for legacy parts that might still use it.
// Consider refactoring those parts to import SETTINGS directly.
if (typeof window !== 'undefined') {
    (window as any).SETTINGS = SETTINGS;
}

// For modules that were doing `const { settings } = require("./settings.js");`
// or `import { settings } from "./settings";`
export const settings = SETTINGS;
