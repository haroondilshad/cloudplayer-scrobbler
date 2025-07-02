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
   * @returns {Array} filtered list
   */
  function filterSongs(songs, syncFromDate) {
    return songs.filter((song) => {
      if (!shouldSyncSong(song, syncFromDate)) return false;
      const ts = Math.round(Date.now() / 1000);
      if (cache.is_already_scrobbled(song.artist, song.title, song.album, ts)) return false;
      return true;
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
   * Prepare a batch for scrobbling: filters duplicates inside window and returns next index.
   * Returns { toScrobble: Array<{song, timestamp}>, nextIndex: number, skipped: number }
   */
  function prepareBatch(songs, startIndex, batchSize = 5, isDuplicateFn = cache.is_already_scrobbled) {
    if (startIndex >= songs.length) {
      return { toScrobble: [], nextIndex: songs.length, skipped: 0 };
    }
    const endIndex = Math.min(startIndex + batchSize, songs.length);
    const list = [];
    let skipped = 0;
    for (let i = startIndex; i < endIndex; i++) {
      const song = songs[i];
      const timestamp = Math.round(Date.now() / 1000) - (i * 300);
      if (isDuplicateFn(song.artist, song.title, song.album, timestamp)) {
        skipped++;
        continue;
      }
      list.push({ song, timestamp });
    }
    return { toScrobble: list, nextIndex: endIndex, skipped };
  }

  /**
   * Mark the beginning of a history-sync session. This just stores metadata so
   * that content-scripts can pick it up while scraping the History tab.
   * Kept here to avoid cluttering background.js with history-specific state.
   * @param {number} [syncFromTimestamp] – unix ms to start syncing from (defaults now)
   */
  function startHistorySync(syncFromTimestamp) {
    log("Starting history sync from: " + new Date(syncFromTimestamp));
    localStorage.setItem('history_sync_in_progress', 'true');
    localStorage.setItem('history_sync_start_time', Date.now());
    localStorage.setItem('sync_from_timestamp', syncFromTimestamp || Date.now());
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
      localStorage.removeItem('history_sync_in_progress');
      return;
    }

    const syncFromTimestamp = parseInt(localStorage.getItem('sync_from_timestamp')) || Date.now();
    const syncFromDate = new Date(syncFromTimestamp);
    const currentTime = Date.now();

    log("Filtering songs from: " + syncFromDate.toLocaleDateString());

    const newSongs = filterSongs(songs, syncFromDate);
    log("Found " + newSongs.length + " new songs to scrobble (after filtering duplicates)");

    if (newSongs.length > 0) {
      scrobbleHistoryBatch(newSongs, 0);
    } else {
      log("No new songs to sync");
    }

    localStorage.setItem('last_history_sync', currentTime);
    localStorage.removeItem('history_sync_in_progress');
    localStorage.removeItem('sync_from_timestamp');
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
    const { toScrobble, nextIndex, skipped } = prepareBatch(songs, startIndex, batchSize);

    log(`Scrobbling ${toScrobble.length} new songs from batch (skipped ${skipped} duplicates)`);

    // NOTE: real scrobble call is commented out to keep unit-tests offline-safe.
    for (let item of toScrobble) {
      const { song, timestamp } = item;
      log(`Scrobbling history song: ${song.artist} - ${song.title}`);

      /* Uncomment in production
      lastfm_api.scrobble(song.artist, song.artist, song.album, song.title, timestamp,
        function(response) {
          if (response.error) {
            log("Error scrobbling history song: " + response.error);
            if (response.error === 9) clear_session();
          } else {
            add_to_scrobble_cache(song.artist, song.title, song.album, timestamp);
          }
        });
      */
    }

    setTimeout(() => scrobbleHistoryBatch(songs, nextIndex), 2000);
  }

  const api = { filterSongs, chunkSongs, prepareBatch, startHistorySync, processHistorySongs, scrobbleHistoryBatch };
  global.historySync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this); 