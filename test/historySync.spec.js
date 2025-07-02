jest.mock('../js/scrobbleCache.js'); // Mock the entire scrobbleCache module
const scrobbleCache = require('../js/scrobbleCache'); // This is now the mocked module
const { filterSongs, chunkSongs } = require('../js/historySync'); // historySync will use the mocked scrobbleCache

beforeEach(() => {
  // Reset all mocks before each test (including scrobbleCache mocks if defined as jest.fn())
  jest.clearAllMocks();
  // If clear_scrobble_cache was a real function on the mock, call it.
  // But since we mock the whole module, we'd mock clear_scrobble_cache as well if needed.
  // For now, clearAllMocks() should suffice for resetting mock call counts etc.
  // If scrobbleCache mock needs internal state reset, that would be done on the mock setup.
});

describe('filterSongs()', () => {
  const syncFrom = new Date('2024-01-01T00:00:00.000Z');
  const sampleSongs = [
    { artist: 'ArtistA', title: 'TrackA', album: 'AlbumA', listenDate: 'January 2, 2024' },
    { artist: 'ArtistB', title: 'TrackB', album: 'AlbumB', listenDate: 'January 3, 2024' },
    { artist: 'ArtistOld', title: 'TrackOld', album: 'AlbumOld', listenDate: 'December 1, 2023' },
    { artist: 'ArtistDup', title: 'TrackDup', album: 'AlbumDup', listenDate: 'January 4, 2024' },
  ];

  beforeEach(() => {
    // Define the mock implementation for is_already_scrobbled for each test in this describe block
    scrobbleCache.is_already_scrobbled.mockImplementation((artist, title, album, ts, callback) => {
      let isDuplicate = false;
      if (artist === 'ArtistDup' && title === 'TrackDup') {
        isDuplicate = true;
      }
      callback(isDuplicate); // Call the callback, essential for async flow in filterSongs
    });
  });

  test('filters out songs older than syncFromDate and already scrobbled songs', (done) => {
    filterSongs(sampleSongs, syncFrom, (filtered) => {
      try {
        expect(filtered.length).toBe(2);
        expect(filtered.find(s => s.artist === 'ArtistOld')).toBeUndefined();
        expect(filtered.find(s => s.artist === 'ArtistDup')).toBeUndefined();
        expect(filtered.find(s => s.artist === 'ArtistA')).toBeDefined();
        expect(filtered.find(s => s.artist === 'ArtistB')).toBeDefined();
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  test('keeps all songs if none are old or duplicates', (done) => {
    const nonDuplicateSamples = [
      { artist: 'Fresh1', title: 'TrackNew1', album: 'AlbumNew1', listenDate: 'January 5, 2024' },
      { artist: 'Fresh2', title: 'TrackNew2', album: 'AlbumNew2', listenDate: 'January 6, 2024' },
    ];
    // Ensure mock considers these as not duplicates
    scrobbleCache.is_already_scrobbled.mockImplementation((artist, title, album, ts, callback) => callback(false));

    filterSongs(nonDuplicateSamples, syncFrom, (filtered) => {
      try {
        expect(filtered.length).toBe(2);
        expect(filtered[0].artist).toBe('Fresh1');
        expect(filtered[1].artist).toBe('Fresh2');
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  test('returns empty array if all songs are filtered out', (done) => {
    const allOldOrDupSongs = [
      { artist: 'ArtistOld', title: 'TrackOld', album: 'AlbumOld', listenDate: 'December 1, 2023' },
      { artist: 'ArtistDup', title: 'TrackDup', album: 'AlbumDup', listenDate: 'January 4, 2024' },
    ];
    // Mock is_already_scrobbled to mark ArtistDup as duplicate
    scrobbleCache.is_already_scrobbled.mockImplementation((artist, title, album, ts, callback) => callback(artist === 'ArtistDup'));

    filterSongs(allOldOrDupSongs, syncFrom, (filtered) => {
      try {
        expect(filtered.length).toBe(0);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  test('handles empty input song list', (done) => {
    filterSongs([], syncFrom, (filtered) => {
      try {
        expect(filtered.length).toBe(0);
        done();
      } catch (error) {
        done(error);
      }
    });
  });
});

describe('chunkSongs()', () => {
  test('splits array into chunks', () => {
    const arr = [1,2,3,4,5,6,7];
    const chunks = chunkSongs(arr, 3);
    expect(chunks).toEqual([[1,2,3],[4,5,6],[7]]);
  });
});

describe('prepareBatch()', () => {
  const historySync = require('../js/historySync'); // Ensure it's required to get prepareBatch

  test('correctly batches songs without filtering', () => {
    const songsToBatch = [
      { artist: 'ArtistC', title: 'TrackC', album: 'AlbumC', listenDate: 'January 2, 2024' },
      { artist: 'ArtistD', title: 'TrackD', album: 'AlbumD', listenDate: 'January 2, 2024' },
      { artist: 'ArtistE', title: 'TrackE', album: 'AlbumE', listenDate: 'January 2, 2024' },
    ];

    // Test with a batch size smaller than the number of songs
    let batch = historySync.prepareBatch(songsToBatch, 0, 2);
    expect(batch.toScrobble.length).toBe(2);
    expect(batch.skipped).toBe(0); // prepareBatch itself does not skip based on cache
    expect(batch.nextIndex).toBe(2);
    expect(batch.toScrobble[0].song.artist).toBe('ArtistC');
    expect(batch.toScrobble[1].song.artist).toBe('ArtistD');

    // Test with a batch size larger than the number of songs
    batch = historySync.prepareBatch(songsToBatch, 0, 5);
    expect(batch.toScrobble.length).toBe(3);
    expect(batch.skipped).toBe(0);
    expect(batch.nextIndex).toBe(3);
    expect(batch.toScrobble[2].song.artist).toBe('ArtistE');

    // Test batching from a startIndex
    batch = historySync.prepareBatch(songsToBatch, 1, 1);
    expect(batch.toScrobble.length).toBe(1);
    expect(batch.skipped).toBe(0);
    expect(batch.nextIndex).toBe(2);
    expect(batch.toScrobble[0].song.artist).toBe('ArtistD');

    // Test when startIndex is at the end of the list
    batch = historySync.prepareBatch(songsToBatch, 3, 5);
    expect(batch.toScrobble.length).toBe(0);
    expect(batch.skipped).toBe(0);
    expect(batch.nextIndex).toBe(3);
  });
});