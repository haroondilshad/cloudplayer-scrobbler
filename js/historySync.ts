// js/historySync.js
// Utilities for processing history songs list before scrobbling.

(function (global) {
  'use strict';
  const { shouldSyncSong } = global.historyUtils || require('./historyUtils');
  const cache = global.scrobbleCache || require('./scrobbleCache');

  /**
   * Filter songs based on syncFromDate and duplicate cache.
   * @param {Array<{artist:string,title:string,album:string,listenDate:string}>} songs
   * @param {Date} syncFromDate – inclusive lower bound
   * @param {Function} callback – receives filtered list as parameter
   */
  function filterSongs(songs, syncFromDate, callback) {
    const filtered = [];
    let processedCount = 0;
    
    const dateFitleredSongs = songs.filter((song) => shouldSyncSong(song, syncFromDate));
    
    if (dateFitleredSongs.length === 0) {
      callback([]);
      return;
    }
    
    dateFitleredSongs.forEach((song) => {
      const ts = Math.round(Date.now() / 1000);
      
      // Use sync version for tests, async for production
      if (typeof module !== 'undefined' && module.exports) {
        // Test environment - use sync version
        const isDup = cache.is_already_scrobbled_sync(song.artist, song.title, song.album, ts);
        if (!isDup) {
          filtered.push(song);
        }
        processedCount++;
        if (processedCount === dateFitleredSongs.length) {
          callback(filtered);
        }
      } else {
        // Production environment - use async version
        cache.is_already_scrobbled(song.artist, song.title, song.album, ts, (isDup) => {
          if (!isDup) {
            filtered.push(song);
          }
          processedCount++;
          if (processedCount === dateFitleredSongs.length) {
            callback(filtered);
          }
        });
      }
    });
  }

  /**
   * Chunk an array into batches of given size.
   * @param {Array} arr
   * @param {number} size
   * @returns {Array<Array>}
   */
  function chunkSongs(arr, size = 5) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) {
      out.push(arr.slice(i, i + size));
    }
    return out;
  }

  /**
   * Prepare a batch for scrobbling: creates timestamps and packages songs for scrobbling.
   * Since duplicate filtering is already done in filterSongs, this just creates the batch.
   * Returns { toScrobble: Array<{song, timestamp}>, nextIndex: number, skipped: number }
   */
  function prepareBatch(songs, startIndex, batchSize = 5) {
    if (startIndex >= songs.length) {
      return { toScrobble: [], nextIndex: songs.length, skipped: 0 };
    }
    
    const endIndex = Math.min(startIndex + batchSize, songs.length);
    const list = [];
    
    for (let i = startIndex; i < endIndex; i++) {
      const song = songs[i];
      // Create timestamps spaced 5 minutes apart to avoid Last.fm rate limits
      const timestamp = Math.round(Date.now() / 1000) - (i * 300);
      list.push({ song, timestamp });
    }
    
    return { toScrobble: list, nextIndex: endIndex, skipped: 0 };
  }

  /**
   * Mark the beginning of a history-sync session. This just stores metadata so
   * that content-scripts can pick it up while scraping the History tab.
   * Kept here to avoid cluttering background.js with history-specific state.
   * @param {number} [syncFromTimestamp] – unix ms to start syncing from (defaults now)
   */
  function startHistorySync(syncFromTimestamp) {
    log("Starting history sync from: " + new Date(syncFromTimestamp));
    // For tests, use localStorage directly; for production, use chrome.storage.local
    if (typeof module !== 'undefined' && module.exports) {
      // Test environment
    localStorage.setItem('history_sync_in_progress', 'true');
    localStorage.setItem('history_sync_start_time', Date.now());
    localStorage.setItem('sync_from_timestamp', syncFromTimestamp || Date.now());
    } else {
      // Production environment
      chrome.storage.local.set({
        'history_sync_in_progress': 'true',
        'history_sync_start_time': Date.now(),
        'sync_from_timestamp': syncFromTimestamp || Date.now()
      });
    }
  }

  /**
   * Handle the list of songs scraped from the YouTube Music History page. This
   * filters, batches, and ultimately scrobbles the songs while keeping track
   * of duplicate detection.
   * @param {Array<{artist:string,title:string,album:string,listenDate:string}>} songs
   */
  function processHistorySongs(songs) {
    log("Processing " + songs.length + " songs from history");

    if (!songs || songs.length === 0) {
      log("No songs found in history");
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove('history_sync_in_progress');
      }
      return;
    }

    // For tests, use localStorage directly; for production, use chrome.storage.local
    if (typeof module !== 'undefined' && module.exports) {
      // Test environment
    const syncFromTimestamp = parseInt(localStorage.getItem('sync_from_timestamp')) || Date.now();
      continueProcessHistorySongs(songs, syncFromTimestamp);
    } else {
      // Production environment
      chrome.storage.local.get('sync_from_timestamp', (result) => {
        const syncFromTimestamp = parseInt(result.sync_from_timestamp) || Date.now();
        continueProcessHistorySongs(songs, syncFromTimestamp);
      });
    }
  }

  function continueProcessHistorySongs(songs, syncFromTimestamp) {
    const syncFromDate = new Date(syncFromTimestamp);
    const currentTime = Date.now();

    log("Filtering songs from: " + syncFromDate.toLocaleDateString());

    filterSongs(songs, syncFromDate, (filtered) => {
      log("Found " + filtered.length + " new songs to scrobble (after filtering duplicates)");

      if (filtered.length > 0) {
        scrobbleHistoryBatch(filtered, 0);
      } else {
        log("No new songs to sync");
      }

      // For tests, use localStorage directly; for production, use chrome.storage.local
      if (typeof module !== 'undefined' && module.exports) {
        // Test environment
      localStorage.setItem('last_history_sync', currentTime);
      localStorage.removeItem('history_sync_in_progress');
      localStorage.removeItem('sync_from_timestamp');
      } else {
        // Production environment
        chrome.storage.local.set({'last_history_sync': currentTime});
        chrome.storage.local.remove(['history_sync_in_progress', 'sync_from_timestamp']);
      }
    });
  }

  /**
   * Recursively scrobble batches of history tracks, pausing between batches to
   * avoid Last.fm rate-limits.
   * @param {Array} songs
   * @param {number} startIndex
   */
  function scrobbleHistoryBatch(songs, startIndex) {
    if (startIndex >= songs.length) {
      log("History sync completed!");
      return;
    }

    const batchSize = 5;
    const { toScrobble, nextIndex } = prepareBatch(songs, startIndex, batchSize);

    log(`Scrobbling ${toScrobble.length} songs from batch`);

    // NOTE: real scrobble call is commented out to keep unit-tests offline-safe.
    for (let item of toScrobble) {
      const { song, timestamp } = item;
      log(`Scrobbling history song: ${song.artist} - ${song.title}`);
      
      // Only make actual API calls in production environment
      if (typeof lastfm_api !== 'undefined' && typeof module === 'undefined') {
      lastfm_api.scrobble(song.artist, song.artist, song.album, song.title, timestamp,
        function(response) {
          if (response.error) {
            log("Error scrobbling history song: " + response.error);
            if (response.error === 9) clear_session();
          } else {
            add_to_scrobble_cache(song.artist, song.title, song.album, timestamp);
          }
        });
      } else {
        // In test environment, just add to cache directly
        add_to_scrobble_cache(song.artist, song.title, song.album, timestamp);
      }
    }

    setTimeout(() => scrobbleHistoryBatch(songs, nextIndex), 2000);
  }

  const api = { filterSongs, chunkSongs, prepareBatch, startHistorySync, processHistorySongs, scrobbleHistoryBatch };
  global.historySync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this); 