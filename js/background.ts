/**
 * background.js
 * Background page script
 * Copyright (c) 2011 Alexey Savartsov <asavartsov@gmail.com>
 * Licensed under the MIT license
 */

// --- Type Aliases and Interfaces (subset, more can be added as needed) ---
interface SongData {
    title: string;
    artist: string;
    album?: string | null;
    album_artist?: string | null; // For scrobble_song
    cover?: string | null;
    time?: number; // Duration
    position?: number; // Current playback position
    timestamp?: number; // Play start time for scrobbling
    scrobbled?: boolean;
}

interface PlayerInternalState {
    has_song: boolean;
    is_playing?: boolean;
    song?: SongData;
    tab_id?: number;
    incognito?: boolean;
}

// --- Global Variables ---
log("background.js loaded");
var player: PlayerInternalState = { has_song: false }; // Previous player state
var time_played: number = 0;
var last_refresh: number = (new Date()).getTime();
var num_scrobbles: number = 0;
var curr_song_title: string = '';

// Assuming LastFM class and SETTINGS are declared/available globally (e.g. via service-worker importScripts)
declare var LastFM: any; // Replace 'any' with actual class type if available
declare var SETTINGS: any; // Replace 'any' with actual AppSettings interface if available
declare var log: (message: any) => void;
declare var scrobbleCache: any; // Replace 'any' with ScrobbleCacheAPI if available
declare var historySync: { // Declare historySync and its methods
    processHistorySongs: (songs: any[]) => void; // TODO: Define song type for history
    startHistorySync: (ts: number) => void;
};


var lastfm_api = new LastFM(SETTINGS.api_key, SETTINGS.api_secret);

// Load settings from storage
chrome.storage.local.get(['session_key', 'session_name'], (result: {[key: string]: any}) => {
    if (chrome.runtime.lastError) {
        log("Error loading session from storage: " + chrome.runtime.lastError.message);
        return;
    }
    if (lastfm_api && lastfm_api.session) {
        lastfm_api.session.key = result.session_key;
        lastfm_api.session.name = result.session_name;
    } else {
        log("lastfm_api or session not initialized at time of storage.get callback");
    }
});

if (SETTINGS && !SETTINGS.scrobble) {
  chrome.action.setIcon({'path': SETTINGS.scrobbling_stopped_icon});
}

// Connect event handlers
// Assuming port_on_connect is defined below and typed
chrome.runtime.onConnect.addListener(port_on_connect as (port: chrome.runtime.Port) => void);
// Message listener registration moved to service-worker.js, but keep the function for tests
// Export on_message function for testing (tests import background.js directly)
if (typeof module !== 'undefined' && module.exports) {
  chrome.runtime.onMessage.addListener(on_message);
}
bind_keyboard_shortcuts();


/**
 * Handle messages from content scripts
 */
function on_message(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void): boolean | undefined {
  if (message.action === 'process_history_songs') {
    if (historySync) historySync.processHistorySongs(message.songs);
    sendResponse({success: true});
  } else if (message.action === 'get_sync_params') {
    chrome.storage.local.get('sync_from_timestamp', (result: {[key: string]: any}) => {
      if (chrome.runtime.lastError) {
        log("Error getting sync_from_timestamp: " + chrome.runtime.lastError.message);
        sendResponse({error: chrome.runtime.lastError.message});
        return;
      }
      const syncFromTimestamp = result.sync_from_timestamp ? parseInt(result.sync_from_timestamp) : Date.now();
      sendResponse({syncFromTimestamp: syncFromTimestamp});
    });
    return true; // Indicates we will respond asynchronously
  } else if (message.action === 'sync_complete') {
    log("Sync completed: " + message.message);
    chrome.storage.local.set({ 'last_history_sync': Date.now() }, () => {
        if(chrome.runtime.lastError) log("Error setting last_history_sync: " + chrome.runtime.lastError.message);
    });
    chrome.storage.local.remove(['history_sync_in_progress', 'sync_from_timestamp'], () => {
        if(chrome.runtime.lastError) log("Error removing sync flags: " + chrome.runtime.lastError.message);
    });
    sendResponse({success: true});
  }
  return undefined; // Not async by default
}

/**
 * Content script has connected to the extension
 */
function port_on_connect(port: chrome.runtime.Port): void {
  log("Content script connected: " + port.name);
  // Assuming port_on_message and port_on_disconnect are defined and typed below
  port.onMessage.addListener(port_on_message as (message: any, port: chrome.runtime.Port) => void);
  port.onDisconnect.addListener(port_on_disconnect as (port: chrome.runtime.Port) => void);
}


/**
 * New message arrives to the port
 */
function port_on_message(message: PlayerInternalState, port: chrome.runtime.Port): void {
  // Current player state
  const _p: PlayerInternalState = message;
  const now = (new Date()).getTime();

  // Save player state
  player = _p;

  if (!SETTINGS || !SETTINGS.scrobble) {
    if (SETTINGS) chrome.action.setIcon({'path': SETTINGS.scrobbling_stopped_icon});
    return;
  }

  if (_p.has_song && _p.song) {
    // if the song changed or looped
    if (_p.song.title !== curr_song_title || (_p.song.position !== undefined && _p.song.position <= SETTINGS.refresh_interval)) {
      log(`Started playing: ${_p.song.artist} - ${_p.song.title}`);
      curr_song_title = _p.song.title;
      time_played = 0;
      num_scrobbles = 0;
      last_refresh = now - (SETTINGS.refresh_interval || 2) * 1000; // Default refresh_interval if not set

      if (lastfm_api && _p.song.duration) {
        lastfm_api.now_playing(_p.song.title,
          _p.song.artist,
          _p.song.album,
          _p.song.duration, // Ensure song.time is song.duration
          function(response: any) {
             // TODO: Handle response from now_playing if necessary
          }
        );
      }
    }

    if (_p.is_playing) {
      chrome.action.setIcon({'path': SETTINGS.playing_icon });
      if (_p.song.duration && // Make sure duration is known
          (time_played >= _p.song.duration * SETTINGS.scrobble_point || time_played >= SETTINGS.scrobble_interval) &&
           num_scrobbles < SETTINGS.max_scrobbles &&
           _p.song.timestamp && // Ensure timestamp is present
           !is_advertisment(_p.song)) {
        log(`Scrobbled: ${_p.song.artist} - ${_p.song.title}`);
        // console.log("time_played: " + time_played);
        // console.log("scrobble point: " + (_p.song.duration * SETTINGS.scrobble_point));
        // console.log("num_scrobbles: " + num_scrobbles);

        scrobble_song(_p.song.artist, _p.song.album_artist, // Pass album_artist
          _p.song.album, _p.song.title,
          Math.round(_p.song.timestamp / 1000)); // Use the timestamp from the song data directly
        time_played = 0; // Reset time_played for this song segment
        num_scrobbles += 1;
      } else {
        time_played += (now - last_refresh) / 1000;
      }
    } else {
      // The player is paused
      chrome.action.setIcon({'path': SETTINGS.paused_icon});
    }
  } else {
    chrome.action.setIcon({'path': SETTINGS.main_icon});
  }
  last_refresh = now;
}


function scrobble_song(artist: string, album_artist: string | null | undefined, album: string | null | undefined, title: string, time: number): void {
  // Scrobble this song
  if (!lastfm_api) return;
  lastfm_api.scrobble(artist, album_artist || artist, album, title, time, // Fallback album_artist to artist
    (response: any) => { // TODO: Define specific response type for scrobble
      if (response.error) {
        if (response.error == 9) { // Session expired
          clear_session();
        }
        if (SETTINGS) chrome.action.setIcon({'path': SETTINGS.error_icon});
      } else {
        // Track successful scrobble to prevent duplicates
        if (scrobbleCache && typeof scrobbleCache.add_to_scrobble_cache === 'function') {
            scrobbleCache.add_to_scrobble_cache(artist, title, album, time);
        }
        log("Successfully scrobbled and cached: " + artist + " - " + title);
      }
    });
}

// Alias scrobble cache utility functions if scrobbleCache is available
var add_to_scrobble_cache = scrobbleCache?.add_to_scrobble_cache;
var is_already_scrobbled = scrobbleCache?.is_already_scrobbled;
var cleanup_scrobble_cache = scrobbleCache?.cleanup_scrobble_cache;
var clear_scrobble_cache = scrobbleCache?.clear_scrobble_cache;


function is_advertisment(song: SongData): boolean {
  return !!(SETTINGS && song.title === SETTINGS.gmusic_ads_metadata.title &&
          song.artist === SETTINGS.gmusic_ads_metadata.artist);
}


/**
 * Content script has disconnected
 */
function port_on_disconnect(port: chrome.runtime.Port): void {
  log("Content script disconnected: " + port.name);
  player = { has_song: false }; // Clear player state
  time_played = 0;
  num_scrobbles = 0;
  curr_song_title = '';
  if (SETTINGS) chrome.action.setIcon({'path': SETTINGS.main_icon});
}


/**
 * Authentication link from popup window
 */
function start_web_auth(): void {
  if (!SETTINGS) return;
  const callback_url = chrome.runtime.getURL(SETTINGS.callback_file);
  chrome.tabs.create({
    'url': ('http://www.last.fm/api/auth?api_key=' + SETTINGS.api_key + '&cb=' +
            callback_url)
  });
}


/**
 * Clears last.fm session
 */
function clear_session(): void {
  if (lastfm_api) lastfm_api.session = {};
  chrome.storage.local.remove(['session_key', 'session_name'], () => {
      if (chrome.runtime.lastError) log("Error removing session keys: " + chrome.runtime.lastError.message);
  });
}


/**
 * Toggles setting to scrobble songs or not
 */
function toggle_scrobble(): void {
  if (!SETTINGS) return;
  SETTINGS.scrobble = !SETTINGS.scrobble;
  chrome.storage.local.set({'scrobble': SETTINGS.scrobble}, () => {
      if (chrome.runtime.lastError) log("Error setting scrobble status: " + chrome.runtime.lastError.message);
  });

  const icon = (SETTINGS.scrobble ? SETTINGS.main_icon : SETTINGS.scrobbling_stopped_icon);
  chrome.action.setIcon({'path': icon});
}


/**
 * Last.fm session request
 */
function get_lastfm_session(token: string): void {
  if (!lastfm_api) return;
  lastfm_api.authorize(token, (response: any) => { // TODO: Define session auth response type
    if (response.session) {
      chrome.storage.local.set({
        'session_key': response.session.key,
        'session_name': response.session.name
      }, () => {
          if (chrome.runtime.lastError) log("Error saving session: " + chrome.runtime.lastError.message);
      });
    }
  });
}


function bind_keyboard_shortcuts(): void {
  chrome.commands.onCommand.addListener(
    (command: string) => {
      switch (command) {
        case 'toggle_play':
          send_cmd_to_play_tab('tgl');
          break;
        case 'prev_song':
          send_cmd_to_play_tab('prv');
          break;
        case 'next_song':
          send_cmd_to_play_tab('nxt');
          break;
        case 'goto_play_tab':
          if (typeof open_play_tab === 'function') open_play_tab();
          break;
        default:
          console.error("No handler for command '" + command + "'");
      }
    }
  );
}

// Assuming find_play_tab and open_play_tab are declared globally (e.g., from util.js via service worker)
declare function find_play_tab(callback: (tab: chrome.tabs.Tab | null) => void): void;
declare function open_play_tab(): void;


function send_cmd_to_play_tab(cmd: string): void {
  find_play_tab(
    (tab: chrome.tabs.Tab | null) => {
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, {cmd: cmd}, () => {
            if (chrome.runtime.lastError) log("Error sending command " + cmd + ": " + chrome.runtime.lastError.message);
        });
      } else {
        log("Unable to find Play tab to send command: " + cmd);
      }
    }
  );
}


function open_extensions_page(): void {
  chrome.tabs.create({url: 'chrome://extensions/'});
}

// ===================== History Sync Scheduling ==========================

/**
 * Schedule or clear the history sync alarm based on user settings.
 */
function schedule_history_sync(): void {
  if (!SETTINGS) return;
  chrome.alarms.clear('history_sync', (wasCleared: boolean) => {
    if (SETTINGS.history_sync_interval && SETTINGS.history_sync_interval > 0) {
      chrome.alarms.create('history_sync', {
        periodInMinutes: SETTINGS.history_sync_interval
      });
      log('Scheduled history sync every ' + SETTINGS.history_sync_interval + ' minutes');
    } else {
      log('Automatic history sync disabled');
    }
  });
}

// Initialize alarm schedule at startup
if (typeof schedule_history_sync === "function") schedule_history_sync();


// Listen for alarm events to trigger automatic history sync
chrome.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
  if (alarm && alarm.name === 'history_sync') {
    log('Alarm fired: history_sync');
    if (typeof start_history_sync === "function") start_history_sync(); // Use default logic (sync from last sync)
  }
});

/**
 * Initiate a history sync session.
 * @param {number} [syncFromTimestamp] – Unix ms timestamp to sync from.
 */
function start_history_sync(syncFromTimestamp?: number): void {
  var tsToSync: number | null = typeof syncFromTimestamp === 'number' ? syncFromTimestamp : null;

  if (tsToSync === null) {
    chrome.storage.local.get('last_history_sync', (result: {[key: string]: any}) => {
      if (chrome.runtime.lastError) {
          log("Error getting last_history_sync: " + chrome.runtime.lastError.message);
          tsToSync = Date.now(); // Fallback to now
      } else {
        tsToSync = result.last_history_sync ? parseInt(result.last_history_sync) : Date.now();
      }
      continueHistorySync(tsToSync as number);
    });
  } else {
    continueHistorySync(tsToSync);
  }
}

function continueHistorySync(ts: number): void {
  if (typeof historySync !== 'undefined' && historySync.startHistorySync) {
    historySync.startHistorySync(ts);
  } else {
    log("historySync object or startHistorySync method not found. Falling back to direct storage set.");
    chrome.storage.local.set({
      'history_sync_in_progress': 'true', // Stored as string for compatibility
      'history_sync_start_time': Date.now(), // Stored as number
      'sync_from_timestamp': ts // Stored as number
    }, () => {
        if (chrome.runtime.lastError) log("Error setting history sync flags: " + chrome.runtime.lastError.message);
    });
  }

  const historyUrlPrefix = 'https://music.youtube.com/history';
  chrome.tabs.query({ url: historyUrlPrefix + '*' }, (tabs: chrome.tabs.Tab[]) => {
    if (chrome.runtime.lastError) {
        log("Error querying history tabs: " + chrome.runtime.lastError.message);
        return;
    }
    if (tabs && tabs.length > 0 && tabs[0].id) {
      chrome.tabs.reload(tabs[0].id, undefined, () => {
          if (chrome.runtime.lastError) log("Error reloading history tab: " + chrome.runtime.lastError.message);
      });
    } else {
      chrome.tabs.create({ url: historyUrlPrefix, active: false }, () => {
           if (chrome.runtime.lastError) log("Error creating history tab: " + chrome.runtime.lastError.message);
      });
    }
  });
}

// Expose the function so popup can call it and for service worker direct calls
// In service worker context 'this' is the global scope (self)
if (typeof self !== 'undefined') {
  (self as any).start_history_sync = start_history_sync;
} else if (typeof global !== 'undefined') { // For Node.js tests
  (global as any).start_history_sync = start_history_sync;
}


// =================== End History Sync Scheduling ========================
