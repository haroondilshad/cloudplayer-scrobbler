/**
 * service-worker.js
 * Service Worker for Manifest V3
 * Combines all background scripts for the YouTube Music Last.fm Scrobbler extension
 */

// Import all the necessary scripts in dependency order
importScripts(
  'md5.js',
  'lastfm.js',
  'settings.js',
  'util.js',
  'logging.js',
  'scrobbleCache.js',
  'historyUtils.js',
  'historySync.js',
  'background.js'
);

console.log('Service worker loaded successfully');

// Set up the side panel to open when the action icon is clicked.
if (chrome.sidePanel) { // Check if sidePanel API is available
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Failed to set side panel behavior:', error));
} else {
  console.warn('chrome.sidePanel API not available.');
}


// --- Overrides for broadcasting state changes ---
// Ensure these functions are defined (they should be from imported background.js)

// Modify lastfm_api.authorize to broadcast session changes
if (typeof lastfm_api !== 'undefined' && typeof lastfm_api.authorize === 'function') {
  const original_authorize = lastfm_api.authorize;
  lastfm_api.authorize = function(token, cb) {
      original_authorize.call(lastfm_api, token, function(response) {
          if (response.session) {
              chrome.runtime.sendMessage({type: 'SESSION_UPDATED', session: response.session}).catch(e => console.log("Error broadcasting session update:", e.message));
          }
          if (cb) cb(response);
      });
  };
}

// Modify clear_session in background.js to broadcast
if (typeof clear_session === 'function') {
  const original_clear_session = clear_session;
  self.clear_session = function() { // Use self to assign to global scope if clear_session is global
      original_clear_session.call(this);
      chrome.runtime.sendMessage({type: 'SESSION_UPDATED', session: {name: null, key: null}}).catch(e => console.log("Error broadcasting session update:", e.message));
  };
}


// Modify toggle_scrobble in background.js to broadcast
if (typeof toggle_scrobble === 'function') {
  const original_toggle_scrobble = toggle_scrobble;
  self.toggle_scrobble = function() {
      original_toggle_scrobble.call(this);
      // Ensure SETTINGS is accessible and updated
      chrome.runtime.sendMessage({type: 'SETTINGS_UPDATED', settings: typeof SETTINGS !== 'undefined' ? SETTINGS : {}}).catch(e => console.log("Error broadcasting settings update:", e.message));
  };
}

// Modify port_on_message in background.js to broadcast player state
if (typeof port_on_message === 'function') {
  const original_port_on_message = port_on_message;
  self.port_on_message = function(message) {
      original_port_on_message.call(this, message);
      // Ensure player is accessible and updated
      if (typeof player !== 'undefined' && player) {
          chrome.runtime.sendMessage({type: 'PLAYER_STATE_UPDATED', player: player}).catch(e => console.log("Error broadcasting player state:", e.message));
      }
  };
}

// Modify the on_message in background.js for sync events to broadcast
if (typeof on_message === 'function') {
  const original_on_message_for_background = on_message;
  self.on_message = function(message, sender, sendResponse) { // Assign to self.on_message
      let isAsync = false;
      if (message.action === 'sync_complete') {
          // Call original logic first. It might be async.
          // However, the original on_message for sync_complete is synchronous.
          original_on_message_for_background(message, sender, sendResponse);
          chrome.runtime.sendMessage({type: 'HISTORY_SYNC_COMPLETE', statusText: message.message || 'Sync complete!', statusType: 'success'}).catch(e => console.log("Error broadcasting sync completion:", e.message));
          // original_on_message_for_background would have called sendResponse({success: true})
          // No need to return true unless original did for this specific path.
      } else if (message.action === 'process_history_songs') {
          chrome.runtime.sendMessage({type: 'HISTORY_SYNC_UPDATE', statusText: 'Processing history songs...', statusType: 'info'}).catch(e => console.log("Error broadcasting sync update:", e.message));
          isAsync = original_on_message_for_background(message, sender, sendResponse);
      } else if (message.action === 'get_sync_params') {
          // This is the critical one from background.js that handles async and was updated
          isAsync = original_on_message_for_background(message, sender, sendResponse);
      } else {
          // For other actions, just delegate
          isAsync = original_on_message_for_background(message, sender, sendResponse);
      }
      return isAsync; // Return true if the delegated call was asynchronous
  };
}

// Main message listener for service worker
// Remove any pre-existing listener from importScripts if necessary, though usually the last one added wins.
// Better to ensure background.js doesn't add its own listener in service worker mode.
// (Checked: background.js does not add its listener in non-test environments)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Service worker (top level) received message:', message);
  let isAsync = false;

  if (message.cmd) { // From popup/sidebar
    switch (message.cmd) {
      case 'getPlayer': sendResponse(typeof player !== 'undefined' ? player : {has_song: false}); break;
      case 'getSession': sendResponse(typeof lastfm_api !== 'undefined' && lastfm_api.session ? lastfm_api.session : {name: null, key: null}); break;
      case 'getSettings': sendResponse(typeof SETTINGS !== 'undefined' ? SETTINGS : {}); break;
      case 'toggleScrobble':
        if (typeof self.toggle_scrobble === 'function') self.toggle_scrobble(); else if (typeof toggle_scrobble === 'function') toggle_scrobble();
        sendResponse({success: true});
        break;
      case 'startWebAuth':
        if (typeof start_web_auth === 'function') start_web_auth();
        sendResponse({success: true});
        break;
      case 'clearSession':
        if (typeof self.clear_session === 'function') self.clear_session(); else if (typeof clear_session === 'function') clear_session();
        sendResponse({success: true});
        break;
      case 'isTrackLoved':
        if (typeof lastfm_api !== 'undefined' && typeof lastfm_api.is_track_loved === 'function') {
          lastfm_api.is_track_loved(message.title, message.artist, sendResponse);
          isAsync = true;
        } else { sendResponse(false); }
        break;
      case 'loveTrack':
        if (typeof lastfm_api !== 'undefined' && typeof lastfm_api.love_track === 'function') {
          lastfm_api.love_track(message.title, message.artist, sendResponse);
          isAsync = true;
        } else { sendResponse({error: 'API not ready'}); }
        break;
      case 'unloveTrack':
        if (typeof lastfm_api !== 'undefined' && typeof lastfm_api.unlove_track === 'function') {
          lastfm_api.unlove_track(message.title, message.artist, sendResponse);
          isAsync = true;
        } else { sendResponse({error: 'API not ready'}); }
        break;
      case 'openExtensionsPage':
        if (typeof open_extensions_page === 'function') open_extensions_page();
        sendResponse({success: true});
        break;
      case 'startHistorySync':
        if (typeof start_history_sync === 'function') start_history_sync(message.syncFromDate);
        sendResponse({success: true});
        chrome.runtime.sendMessage({type: 'HISTORY_SYNC_UPDATE', statusText: 'History sync initiated...', statusType: 'info'}).catch(e => console.log("Error broadcasting sync update:", e.message));
        break;
      case 'reloadSettings':
        if (typeof load_settings === 'function') load_settings();
        // Ensure SETTINGS is updated before broadcasting
        chrome.runtime.sendMessage({type: 'SETTINGS_UPDATED', settings: typeof SETTINGS !== 'undefined' ? SETTINGS : {}}).catch(e => console.log("Error broadcasting settings update:", e.message));
        sendResponse({success: true});
        break;
      case 'getLastfmSession':
        // get_lastfm_session calls lastfm_api.authorize, which is async and now broadcasts.
        if (typeof get_lastfm_session === 'function') get_lastfm_session(message.token);
        sendResponse({success: true}); // Respond immediately. UI update via broadcast.
        break;
      default:
        console.log('Unknown command:', message.cmd);
        sendResponse({error: 'Unknown command'});
    }
  }
  else if (message.action) { // From content scripts
    // Delegate to the on_message function (which is now self.on_message if overridden)
    if (typeof self.on_message === 'function') {
      isAsync = self.on_message(message, sender, sendResponse);
    } else if (typeof on_message === 'function') { // Fallback if self.on_message wasn't set
      isAsync = on_message(message, sender, sendResponse);
    } else {
      console.error("on_message handler not found for action:", message.action);
      sendResponse({error: 'Action handler not found'});
    }
  }
  else {
    console.log('Message has no cmd or action:', message);
    sendResponse({error: 'No cmd or action specified'});
  }
  return isAsync; // Return true if any path set isAsync to true
});

log("Service worker setup complete with side panel behavior and enhanced message handling.");