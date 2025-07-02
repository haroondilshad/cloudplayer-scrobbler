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
    jest.runAllTimers();
    // Expect log to mention 3 new songs and 0 duplicates skipped
    const batchLog = global.log.mock.calls.find((c) => /Scrobbling/.test(c[0]))[0];
    expect(batchLog).toMatch(/Scrobbling 3 new songs/);
    expect(batchLog).toMatch(/skipped 0 duplicates/);
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
    const batchLog = global.log.mock.calls.find((c) => /Scrobbling/.test(c[0]))[0];
    expect(batchLog).toMatch(/Scrobbling 2 new songs/);
    expect(batchLog).toMatch(/skipped 0 duplicates/);
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
    const batchLog = global.log.mock.calls.find((c) => /Scrobbling/.test(c[0]))[0];
    expect(batchLog).toMatch(/Scrobbling 1 new songs?/);
    expect(batchLog).toMatch(/skipped [0-9]+ duplicates/);
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
    const batchLog = global.log.mock.calls.find((c) => /Scrobbling/.test(c[0]))[0];
    expect(batchLog).toMatch(/Scrobbling 2 new songs/);
    expect(batchLog).toMatch(/skipped [0-9]+ duplicates/);
  });
}); 