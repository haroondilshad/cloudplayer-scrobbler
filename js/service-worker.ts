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

// Handle messages from popup and other parts of the extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Service worker received message:', message);
  
  // Handle cmd-based messages (from popup)
  if (message.cmd) {
    switch (message.cmd) {
      case 'getPlayer':
        sendResponse(player || {has_song: false});
        break;
        
      case 'getSession':
        sendResponse(lastfm_api.session || {name: null, key: null});
        break;
        
      case 'getSettings':
        sendResponse(SETTINGS || {});
        break;
        
      case 'toggleScrobble':
        toggle_scrobble();
        sendResponse({success: true});
        break;
        
      case 'startWebAuth':
        start_web_auth();
        sendResponse({success: true});
        break;
        
      case 'clearSession':
        clear_session();
        sendResponse({success: true});
        break;
        
      case 'isTrackLoved':
        lastfm_api.is_track_loved(message.title, message.artist, (result) => {
          sendResponse(result);
        });
        return true; // Keep the messaging channel open for async response
        
      case 'loveTrack':
        lastfm_api.love_track(message.title, message.artist, (result) => {
          sendResponse(result);
        });
        return true; // Keep the messaging channel open for async response
        
      case 'unloveTrack':
        lastfm_api.unlove_track(message.title, message.artist, (result) => {
          sendResponse(result);
        });
        return true; // Keep the messaging channel open for async response
        
      case 'openExtensionsPage':
        open_extensions_page();
        sendResponse({success: true});
        break;
        
      case 'startHistorySync':
        start_history_sync(message.syncFromDate);
        sendResponse({success: true});
        break;
        
      case 'reloadSettings':
        // Reload settings from storage
        load_settings();
        sendResponse({success: true});
        break;
        
      case 'getLastfmSession':
        get_lastfm_session(message.token);
        sendResponse({success: true});
        break;
        
      default:
        console.log('Unknown command:', message.cmd);
        sendResponse({error: 'Unknown command'});
    }
  }
  // Handle action-based messages (from history parser and other content scripts)
  else if (message.action) {
    switch (message.action) {
      case 'process_history_songs':
        historySync.processHistorySongs(message.songs);
        sendResponse({success: true});
        break;
        
      case 'get_sync_params':
        chrome.storage.local.get('sync_from_timestamp', (result) => {
          var syncFromTimestamp = parseInt(result.sync_from_timestamp) || Date.now();
          sendResponse({syncFromTimestamp: syncFromTimestamp});
        });
        return true; // Indicates we will respond asynchronously
        
      case 'sync_complete':
        log("Sync completed: " + message.message);
        // Update last sync timestamp even when there were no new songs
        chrome.storage.local.set({
          'last_history_sync': Date.now()
        });
        chrome.storage.local.remove(['history_sync_in_progress', 'sync_from_timestamp']);
        sendResponse({success: true});
        break;
        
      default:
        console.log('Unknown action:', message.action);
        sendResponse({error: 'Unknown action'});
    }
  }
  else {
    console.log('Message has no cmd or action:', message);
    sendResponse({error: 'No cmd or action specified'});
  }
}); 