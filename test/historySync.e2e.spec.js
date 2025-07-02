// test/historySync.e2e.spec.js
// End-to-end style tests covering the high-level history-sync flow, including
// duplicate detection against the scrobble cache.

/* eslint-disable no-undef */

const { add_to_scrobble_cache, clear_scrobble_cache } = require('../js/scrobbleCache');

// Helper wrapper to load a fresh historySync module per test with spies
function loadHistorySync() {
  jest.resetModules();
  clear_scrobble_cache();
  global.log = jest.fn();

  // Ensure historyUtils is globally exposed so historySync picks it up
  global.historyUtils = require('../js/historyUtils');

  // Make scrobbleCache functions global as historySync.js test path might call them globally
  const scrobbleCacheFns = require('../js/scrobbleCache');
  global.add_to_scrobble_cache = scrobbleCacheFns.add_to_scrobble_cache;
  // is_already_scrobbled is used via cache.is_already_scrobbled in filterSongs, so not needed globally here.
  // clear_scrobble_cache is used directly in beforeEach.

  return require('../js/historySync');
}

// Build some convenience song factories
function makeSong(artist, title, album, dateStr) {
  return { artist, title, album: album || '', listenDate: dateStr };
}

describe('historySync.processHistorySongs E2E', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    clear_scrobble_cache();
    localStorage.clear();
  });

  afterEach(() => jest.useRealTimers());

  test('scrobbles all new songs when none are cached and after syncFromDate', () => {
    const historySync = loadHistorySync();

    // Set sync window start (Jan 1 2024)
    const syncFrom = new Date('2024-01-01').getTime();
    localStorage.setItem('sync_from_timestamp', syncFrom.toString());

    const songs = [
      makeSong('A', '1', '', 'January 2, 2024'),
      makeSong('B', '2', '', 'January 2, 2024'),
      makeSong('C', '3', '', 'January 3, 2024'),
    ];

    historySync.processHistorySongs(songs);
    jest.runAllTimers(); // Ensure any setTimeouts in scrobbleHistoryBatch are run

    // Check the log for "Found X new songs..."
    const foundLog = global.log.mock.calls.find(call => call[0].startsWith("Found ") && call[0].includes("new songs to scrobble"));
    expect(foundLog[0]).toMatch(/Found 3 new songs to scrobble/);

    // Check the log for "Scrobbling X songs from batch"
    const batchLog = global.log.mock.calls.find(call => call[0].startsWith("Scrobbling ") && call[0].includes("songs from batch"));
    expect(batchLog[0]).toMatch(/Scrobbling 3 songs from batch/); // Assuming all 3 are in the first batch
  });

  test('filters out songs before syncFromDate', () => {
    const historySync = loadHistorySync();
    const syncFrom = new Date('2024-01-01').getTime();
    localStorage.setItem('sync_from_timestamp', syncFrom.toString());

    const songs = [
      makeSong('Old', 'Song', '', 'December 30, 2023'), // should be skipped
      makeSong('New', 'Song1', '', 'January 2, 2024'),
      makeSong('New2', 'Song2', '', 'January 3, 2024'),
    ];

    historySync.processHistorySongs(songs);
    jest.runAllTimers();

    const foundLog = global.log.mock.calls.find(call => call[0].startsWith("Found ") && call[0].includes("new songs to scrobble"));
    expect(foundLog[0]).toMatch(/Found 2 new songs to scrobble/);

    const batchLog = global.log.mock.calls.find(call => call[0].startsWith("Scrobbling ") && call[0].includes("songs from batch"));
    expect(batchLog[0]).toMatch(/Scrobbling 2 songs from batch/);
  });

  test('skips tracks already in scrobble cache', () => {
    const historySync = loadHistorySync();
    const syncFrom = new Date('2024-01-01').getTime();
    localStorage.setItem('sync_from_timestamp', syncFrom.toString());

    // Cache one of the songs
    add_to_scrobble_cache('Dup', 'Song', '', Math.round(Date.now() / 1000));

    const songs = [
      makeSong('Dup', 'Song', '', 'January 2, 2024'), // duplicate
      makeSong('Fresh', 'New', '', 'January 2, 2024'),
    ];

    historySync.processHistorySongs(songs);
    jest.runAllTimers();

    const foundLog = global.log.mock.calls.find(call => call[0].startsWith("Found ") && call[0].includes("new songs to scrobble"));
    expect(foundLog[0]).toMatch(/Found 1 new song/); // Singular "song" is correct here based on "Found X new songs" log

    const batchLog = global.log.mock.calls.find(call => call[0].startsWith("Scrobbling ") && call[0].includes("songs from batch"));
    expect(batchLog[0]).toMatch(/Scrobbling 1 songs? from batch/); // Make 's' optional
  });

  test('mixed case of old + duplicate + new yields correct counts', () => {
    const historySync = loadHistorySync();
    const syncFrom = new Date('2024-01-01').getTime();
    localStorage.setItem('sync_from_timestamp', syncFrom.toString());

    add_to_scrobble_cache('Dup', 'Song', '', Math.round(Date.now() / 1000));

    const songs = [
      makeSong('Old', 'Song', '', 'December 20, 2023'), // old
      makeSong('Dup', 'Song', '', 'January 2, 2024'),   // duplicate
      makeSong('Fresh', 'New', '', 'January 2, 2024'),  // should scrobble
      makeSong('Fresh2', 'New2', '', 'January 3, 2024'), // should scrobble
    ];

    historySync.processHistorySongs(songs);
    jest.runAllTimers();

    const foundLog = global.log.mock.calls.find(call => call[0].startsWith("Found ") && call[0].includes("new songs to scrobble"));
    expect(foundLog[0]).toMatch(/Found 2 new songs to scrobble/);

    const batchLog = global.log.mock.calls.find(call => call[0].startsWith("Scrobbling ") && call[0].includes("songs from batch"));
    expect(batchLog[0]).toMatch(/Scrobbling 2 songs from batch/);
  });
});