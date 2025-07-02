// js/historySync.ts
// Utilities for processing history songs list before scrobbling.

(function (global: any) {
  'use strict';

  // --- Declarations for dependencies ---
  interface HistoryUtilsLib {
    shouldSyncSong: (song: HistorySongToScrobble, syncFromDate: Date) => boolean;
  }
  interface ScrobbleCacheLib {
    is_already_scrobbled: (artist: string, title: string, album: string | null, songTimestamp: number, callback: (isDup: boolean) => void) => void;
    add_to_scrobble_cache: (artist: string, title: string, album: string | null, timestamp: number) => void;
  }
  declare var log: (message: any) => void;
  declare var lastfm_api: { scrobble: (artist: string, album_artist: string, album: string | null, title: string, timestamp: number, callback: (response: any) => void) => void };
  declare function clear_session(): void; // From background.js
  // Assuming add_to_scrobble_cache is part of scrobbleCache or available globally from background.js aliases
  declare var add_to_scrobble_cache: (artist: string, title: string, album: string | null, timestamp: number) => void;


  const historyUtils: HistoryUtilsLib = global.historyUtils || (typeof require !== 'undefined' ? require('./historyUtils') : { shouldSyncSong: () => false });
  const cache: ScrobbleCacheLib = global.scrobbleCache || (typeof require !== 'undefined' ? require('./scrobbleCache') : { is_already_scrobbled: (_a,_b,_c,_d,cb) => cb(false), add_to_scrobble_cache: () => {} });

  interface HistorySongToScrobble {
    artist: string;
    title: string;
    album: string | null; // Album can be null
    listenDate: string; // The string date from history page
  }

  interface BatchItem {
    song: HistorySongToScrobble;
    timestamp: number;
  }

  interface PrepareBatchResult {
    toScrobble: BatchItem[];
    nextIndex: number;
    skipped: number; // Though 'skipped' is not used in current logic after prepareBatch
  }

  interface HistorySyncAPI {
    filterSongs: (songs: HistorySongToScrobble[], syncFromDate: Date, callback: (filtered: HistorySongToScrobble[]) => void) => void;
    chunkSongs: <T>(arr: T[], size?: number) => T[][];
    prepareBatch: (songs: HistorySongToScrobble[], startIndex: number, batchSize?: number) => PrepareBatchResult;
    startHistorySync: (syncFromTimestamp?: number) => void;
    processHistorySongs: (songs: HistorySongToScrobble[]) => void;
    scrobbleHistoryBatch: (songs: HistorySongToScrobble[], startIndex: number) => void;
  }

  function filterSongs(
    songs: HistorySongToScrobble[],
    syncFromDate: Date,
    callback: (filtered: HistorySongToScrobble[]) => void
  ): void {
    const filtered: HistorySongToScrobble[] = [];
    let processedCount = 0;

    const dateFilteredSongs = songs.filter((song) => historyUtils.shouldSyncSong(song, syncFromDate));

    if (dateFilteredSongs.length === 0) {
      callback([]);
      return;
    }

    dateFilteredSongs.forEach((song) => {
      // Timestamp for is_already_scrobbled check should ideally be the song's actual listen time,
      // but YTM history doesn't provide exact time, only date. Using current time for check is a fallback.
      // This might lead to incorrect duplicate checks if songs were listened to much earlier on the same day.
      // However, scrobbleCache checks for timestamps within 1 hour.
      // For history, we might assume that if it's on a new day, it's unlikely to be an immediate re-scrobble.
      // The timestamp for *scrobbling* will be staggered.
      const checkTimestamp = Math.round(Date.now() / 1000);

      cache.is_already_scrobbled(song.artist, song.title, song.album, checkTimestamp, (isDup) => {
        if (!isDup) {
          filtered.push(song);
        }
        processedCount++;
        if (processedCount === dateFilteredSongs.length) {
          callback(filtered);
        }
      });
    });
  }

  function chunkSongs<T>(arr: T[], size: number = 5): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      out.push(arr.slice(i, i + size));
    }
    return out;
  }

  function prepareBatch(
    songs: HistorySongToScrobble[],
    startIndex: number,
    batchSize: number = 5
  ): PrepareBatchResult {
    if (startIndex >= songs.length) {
      return { toScrobble: [], nextIndex: songs.length, skipped: 0 };
    }

    const endIndex = Math.min(startIndex + batchSize, songs.length);
    const list: BatchItem[] = [];

    // Create staggered timestamps for scrobbling to avoid Last.fm rate limits / duplicate issues.
    // Base timestamp on current time, going backwards for the batch.
    const baseTimestamp = Math.round(Date.now() / 1000);
    for (let i = 0; i < (endIndex - startIndex); i++) {
      const song = songs[startIndex + i];
      // Stagger by 5 minutes (300 seconds) for each song in the batch, further into the past.
      const timestamp = baseTimestamp - (i * 300);
      list.push({ song, timestamp });
    }
    // The list is naturally ordered from most recent (baseTimestamp) to oldest in the batch.
    // Last.fm typically wants scrobbles in chronological order of listening.
    // For history, we are assigning artificial timestamps. Reversing makes the first song in batch "oldest".
    list.reverse();

    return { toScrobble: list, nextIndex: endIndex, skipped: 0 };
  }

  function startHistorySync(syncFromTimestamp?: number): void {
    const ts = syncFromTimestamp || Date.now();
    log("Starting history sync from: " + new Date(ts));

    const storageData = {
      'history_sync_in_progress': 'true', // Stored as string for legacy compatibility
      'history_sync_start_time': Date.now(), // Number
      'sync_from_timestamp': ts // Number
    };

    if (typeof module !== 'undefined' && module.exports && global.localStorage) { // Test environment
      localStorage.setItem('history_sync_in_progress', storageData.history_sync_in_progress);
      localStorage.setItem('history_sync_start_time', String(storageData.history_sync_start_time));
      localStorage.setItem('sync_from_timestamp', String(storageData.sync_from_timestamp));
    } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) { // Production
      chrome.storage.local.set(storageData, () => {
        if (chrome.runtime.lastError) log("Error setting history sync start flags: " + chrome.runtime.lastError.message);
      });
    }
  }

  function processHistorySongs(songs: HistorySongToScrobble[]): void {
    log("Processing " + songs.length + " songs from history");

    if (!songs || songs.length === 0) {
      log("No songs found in history to process.");
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove('history_sync_in_progress', () => {
            if(chrome.runtime.lastError) log("Error removing history_sync_in_progress: " + chrome.runtime.lastError.message);
        });
      } else if (global.localStorage) {
        localStorage.removeItem('history_sync_in_progress');
      }
      return;
    }

    if (typeof module !== 'undefined' && module.exports && global.localStorage) { // Test environment
      const syncFromTsStr = localStorage.getItem('sync_from_timestamp');
      const syncFromTimestamp = syncFromTsStr ? parseInt(syncFromTsStr) : Date.now();
      continueProcessHistorySongs(songs, syncFromTimestamp);
    } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) { // Production
      chrome.storage.local.get('sync_from_timestamp', (result: {[key:string]: any}) => {
        if (chrome.runtime.lastError) {
            log("Error getting sync_from_timestamp for processing: " + chrome.runtime.lastError.message);
            // Potentially stop or use a default if this is critical
            return;
        }
        const syncFromTimestamp = result.sync_from_timestamp ? parseInt(result.sync_from_timestamp) : Date.now();
        continueProcessHistorySongs(songs, syncFromTimestamp);
      });
    }
  }

  function continueProcessHistorySongs(songs: HistorySongToScrobble[], syncFromTimestamp: number): void {
    const syncFromDate = new Date(syncFromTimestamp);
    syncFromDate.setHours(0,0,0,0); // Normalize to start of day for shouldSyncSong comparison
    const currentTimeMarker = Date.now(); // Timestamp for when this processing batch started

    log("Filtering songs from date: " + syncFromDate.toLocaleDateString());

    filterSongs(songs, syncFromDate, (filteredSongs) => {
      log(`Found ${filteredSongs.length} new songs to scrobble (after date and duplicate filtering).`);

      if (filteredSongs.length > 0) {
        // Reverse the filtered songs so that the oldest are scrobbled first.
        // This is important because prepareBatch staggers timestamps backwards from Date.now().
        // If we scrobble oldest first, their artificial timestamps will be further in the past.
        scrobbleHistoryBatch(filteredSongs.reverse(), 0);
      } else {
        log("No new songs to sync from history page.");
      }

      // Update last_history_sync and clear in-progress flags
      const finalStorageActions = () => {
          if (typeof module !== 'undefined' && module.exports && global.localStorage) {
            localStorage.setItem('last_history_sync', String(currentTimeMarker));
            localStorage.removeItem('history_sync_in_progress');
            localStorage.removeItem('sync_from_timestamp');
          } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({'last_history_sync': currentTimeMarker}, () => {
                if(chrome.runtime.lastError) log("Error setting last_history_sync: " + chrome.runtime.lastError.message);
            });
            chrome.storage.local.remove(['history_sync_in_progress', 'sync_from_timestamp'], () => {
                if(chrome.runtime.lastError) log("Error removing final sync flags: " + chrome.runtime.lastError.message);
            });
          }
      };

      // If no songs to scrobble immediately, perform cleanup. Otherwise, it's handled by scrobbleHistoryBatch completion.
      if (filteredSongs.length === 0) {
          finalStorageActions();
      } else {
          // Store a reference to this function so scrobbleHistoryBatch can call it on completion
          (global as any)._completeHistorySyncProcessing = finalStorageActions;
      }
    });
  }

  function scrobbleHistoryBatch(songs: HistorySongToScrobble[], startIndex: number): void {
    if (startIndex >= songs.length) {
      log("History sync: All batches processed!");
      if (typeof (global as any)._completeHistorySyncProcessing === 'function') {
        (global as any)._completeHistorySyncProcessing();
        delete (global as any)._completeHistorySyncProcessing;
      }
      return;
    }

    const batchSize = 5; // Scrobble in batches of 5
    const { toScrobble, nextIndex } = prepareBatch(songs, startIndex, batchSize);

    log(`Scrobbling batch of ${toScrobble.length} history songs. Starting from index ${startIndex}. Next index ${nextIndex}.`);

    for (let item of toScrobble) {
      const { song, timestamp } = item;
      log(`Preparing to scrobble history song: ${song.artist} - ${song.title} at timestamp ${new Date(timestamp * 1000).toLocaleString()}`);

      if (typeof lastfm_api !== 'undefined' && typeof module === 'undefined') { // Production
        lastfm_api.scrobble(song.artist, song.artist, song.album, song.title, timestamp, (response: any) => {
          if (response.error) {
            log(`Error scrobbling history song "${song.title}": ${response.error} - ${response.message}`);
            if (response.error === 9 && typeof clear_session === 'function') clear_session(); // Session error
          } else {
            // Successfully scrobbled, now add to local scrobble cache to prevent re-scrobbling by live player
            if (typeof add_to_scrobble_cache === 'function') {
                 add_to_scrobble_cache(song.artist, song.title, song.album, timestamp);
            }
            log(`Successfully scrobbled from history: ${song.artist} - ${song.title}`);
          }
        });
      } else { // Test environment or if lastfm_api not available
         if (typeof add_to_scrobble_cache === 'function') { // In tests, this might be mocked
            add_to_scrobble_cache(song.artist, song.title, song.album, timestamp);
            log(`(Test Env) Added to scrobble cache: ${song.artist} - ${song.title}`);
         }
      }
    }

    // Wait before processing next batch to avoid rate limiting
    setTimeout(() => scrobbleHistoryBatch(songs, nextIndex), 2000); // 2 seconds delay
  }

  const api: HistorySyncAPI = { filterSongs, chunkSongs, prepareBatch, startHistorySync, processHistorySongs, scrobbleHistoryBatch };
  global.historySync = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);