/**
 * background.js
 * Background page script
 * Copyright (c) 2011 Alexey Savartsov <asavartsov@gmail.com>
 * Licensed under the MIT license
 */
log("background.js loaded");
var player = {}; // Previous player state
var time_played = 0;
var last_refresh = (new Date()).getTime();
var num_scrobbles = 0;
var curr_song_title = '';
var lastfm_api = new LastFM(SETTINGS.api_key, SETTINGS.api_secret);

// Load settings from storage
chrome.storage.local.get(['session_key', 'session_name'], (result) => {
  lastfm_api.session.key = result.session_key;
  lastfm_api.session.name = result.session_name;
});


if (!SETTINGS.scrobble) {
  chrome.action.setIcon({'path': SETTINGS.scrobbling_stopped_icon});
}

// Connect event handlers
chrome.runtime.onConnect.addListener(port_on_connect);
// Message listener registration moved to service-worker.js, but keep the function for tests
// Export on_message function for testing (tests import background.js directly)
if (typeof module !== 'undefined' && module.exports) {
  chrome.runtime.onMessage.addListener(on_message);
}
bind_keyboard_shortcuts();


/**
 * Handle messages from content scripts
 */
function on_message(message, sender, sendResponse) {
  if (message.action === 'process_history_songs') {
    historySync.processHistorySongs(message.songs);
    sendResponse({success: true});
  } else if (message.action === 'get_sync_params') {
    chrome.storage.local.get('sync_from_timestamp', (result) => {
      var syncFromTimestamp = parseInt(result.sync_from_timestamp) || Date.now();
    sendResponse({syncFromTimestamp: syncFromTimestamp});
    });
    return true; // Indicates we will respond asynchronously
  } else if (message.action === 'sync_complete') {
    log("Sync completed: " + message.message);
    // Update last sync timestamp even when there were no new songs
    chrome.storage.local.set({
      'last_history_sync': Date.now()
    });
    chrome.storage.local.remove(['history_sync_in_progress', 'sync_from_timestamp']);
    sendResponse({success: true});
  }
}

/**
 * Content script has connected to the extension
 */
function port_on_connect(port) {
  log("Content script connected");
  port.onMessage.addListener(port_on_message);
  port.onDisconnect.addListener(port_on_disconnect);
}


/**
 * New message arrives to the port
 */
function port_on_message(message) {
  // Current player state
  var _p = message;
  var now = (new Date()).getTime();

  // Save player state
  player = _p;

  if (!SETTINGS.scrobble) {
    chrome.action.setIcon({'path': SETTINGS.scrobbling_stopped_icon});

    return;
  }

  if (_p.has_song) {
    // if the song changed or looped
    if (_p.song.title != curr_song_title ||
        _p.song.position <= SETTINGS.refresh_interval) {
      log("Started playing: " + _p.song.artist + " - " + _p.song.title);
      curr_song_title = _p.song.title;
      time_played = 0;
      num_scrobbles = 0;
      last_refresh = now - SETTINGS.refresh_interval*1000;

      lastfm_api.now_playing(_p.song.title,
        _p.song.artist,
        _p.song.album,
        _p.song.time,
        function(response) {
           // TODO:
        }
      );
    }

    if (_p.is_playing) {
      chrome.action.setIcon({'path': SETTINGS.playing_icon });
      if ((_p.song.time &&
           time_played >= _p.song.time * SETTINGS.scrobble_point ||
           time_played >= SETTINGS.scrobble_interval) &&
           num_scrobbles < SETTINGS.max_scrobbles &&
           !is_advertisment(_p.song)) {
        log("Scrobbled: " + _p.song.artist + " - " + _p.song.title);
        log("time_played: " + time_played);
        log("scrobble point: " + (_p.song.time * SETTINGS.scrobble_point));
        log("num_scrobbles: " + num_scrobbles);

        scrobble_song(_p.song.artist,_p.song.album_artist,
          _p.song.album, _p.song.title,
          Math.round(new Date().getTime() / 1000 - time_played));
        time_played = 0;
        num_scrobbles += 1;
      } else {
        /*
        * Don't depend on the SETTINGS.refresh_interval to
        * calculate time_played since there can be a significant delay
        * between the time the message was sent from the contentscript
        * to when it's recieved here.
        * See: https://github.com/newgiin/cloudplayer-scrobbler/issues/23
        */
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


function scrobble_song(artist, album_artist, album, title, time) {
  // Scrobble this song
  lastfm_api.scrobble(artist, album_artist, album, title, time,
    function(response) {
      if (response.error) {
        if (response.error == 9) {
          // Session expired
          clear_session();
        }
        chrome.action.setIcon({'path': SETTINGS.error_icon});
      } else {
        // Track successful scrobble to prevent duplicates
        add_to_scrobble_cache(artist, title, album, time);
        log("Successfully scrobbled and cached: " + artist + " - " + title);
      }
    });
}

// Alias scrobble cache utility functions
var add_to_scrobble_cache = scrobbleCache.add_to_scrobble_cache;
var is_already_scrobbled = scrobbleCache.is_already_scrobbled;
var cleanup_scrobble_cache = scrobbleCache.cleanup_scrobble_cache;
var clear_scrobble_cache = scrobbleCache.clear_scrobble_cache;

function is_advertisment(song) {
  return (song.title === SETTINGS.gmusic_ads_metadata.title &&
          song.artist === SETTINGS.gmusic_ads_metadata.artist);
}


/**
 * Content script has disconnected
 */
function port_on_disconnect() {
  player = {}; // Clear player state
  time_played = 0;
  num_scrobbles = 0;
  curr_song_title = '';
  chrome.action.setIcon({'path': SETTINGS.main_icon});
}


/**
 * Authentication link from popup window
 */
function start_web_auth() {
  var callback_url = chrome.runtime.getURL(SETTINGS.callback_file);
  chrome.tabs.create({
    'url': ('http://www.last.fm/api/auth?api_key=' + SETTINGS.api_key + '&cb=' +
            callback_url)
  });
}


/**
 * Clears last.fm session
 */
function clear_session() {
  lastfm_api.session = {};

  chrome.storage.local.remove(['session_key', 'session_name']);
}


/**
 * Toggles setting to scrobble songs or not
 */
function toggle_scrobble() {
  SETTINGS.scrobble = !SETTINGS.scrobble;
  chrome.storage.local.set({'scrobble': SETTINGS.scrobble});

  // Set the icon corresponding the current scrobble state
  var icon = (SETTINGS.scrobble ?
              SETTINGS.main_icon : SETTINGS.scrobbling_stopped_icon);
  chrome.action.setIcon({'path': icon});
}


/**
 * Last.fm session request
 */
function get_lastfm_session(token) {
  lastfm_api.authorize(token, function(response) {
    // Save session
    if (response.session) {
      chrome.storage.local.set({
        'session_key': response.session.key,
        'session_name': response.session.name
      });
    }
  });
}


function bind_keyboard_shortcuts() {
  chrome.commands.onCommand.addListener(
    function(command) {
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
          open_play_tab();
          break;
        default:
          console.error("No handler for command '" + command + "'");
      }
    }
  );
}


function send_cmd_to_play_tab(cmd) {
  find_play_tab(
    function(tab) {
      if (tab) {
        chrome.tabs.sendMessage(tab.id, {cmd: cmd}, function() {});
      } else {
        log("Unable to find Play tab");
      }
    }
  );
}


function open_extensions_page() {
  chrome.tabs.create({url: 'chrome://extensions/'});
}

// ===================== History Sync Scheduling ==========================

/**
 * Schedule or clear the history sync alarm based on user settings.
 * If SETTINGS.history_sync_interval is > 0, an alarm named 'history_sync'
 * will fire every N minutes (where N is the interval). Otherwise any
 * existing alarm will be cleared.
 */
function schedule_history_sync() {
  chrome.alarms.clear('history_sync', function() {
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
schedule_history_sync();

// Listen for alarm events to trigger automatic history sync
chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm && alarm.name === 'history_sync') {
    log('Alarm fired: history_sync');
    start_history_sync(); // Use default logic (sync from last sync)
  }
});

/**
 * Initiate a history sync session.
 * This sets up localStorage flags so that content scripts can detect
 * the sync session, then navigates (or reloads) the history page so the
 * scraper can run.
 *
 * @param {number} [syncFromTimestamp] – Unix ms timestamp to sync from.
 *   If omitted, it defaults to last_history_sync (if present) otherwise now.
 */
function start_history_sync(syncFromTimestamp) {
  // Determine the sync start timestamp
  var ts = typeof syncFromTimestamp === 'number' ? syncFromTimestamp : null;
  if (!ts) {
    chrome.storage.local.get('last_history_sync', (result) => {
      ts = result.last_history_sync ? parseInt(result.last_history_sync) : Date.now();
      // Continue with the rest of the function
      continueHistorySync(ts);
    });
    return; // Exit early to handle async storage
  } else {
    continueHistorySync(ts);
  }
}

function continueHistorySync(ts) {

  // Mark sync session so content scripts know to scrape
  if (typeof historySync !== 'undefined' && historySync.startHistorySync) {
    historySync.startHistorySync(ts);
  } else {
    // Fallback: store flags directly
    chrome.storage.local.set({
      'history_sync_in_progress': 'true',
      'history_sync_start_time': Date.now(),
      'sync_from_timestamp': ts
    });
  }

  // Open or reload the YT Music history page in a background tab
  var historyUrlPrefix = 'https://music.youtube.com/history';
  chrome.tabs.query({ url: historyUrlPrefix + '*' }, function(tabs) {
    if (tabs && tabs.length > 0) {
      // Reload the first matching tab to trigger scraping
      chrome.tabs.reload(tabs[0].id);
    } else {
      // Create a new inactive tab so we don't steal focus
      chrome.tabs.create({ url: historyUrlPrefix, active: false });
    }
  });
}

// Expose the function so popup can call it (bp.start_history_sync)
this.start_history_sync = start_history_sync;

// =================== End History Sync Scheduling ========================
