const { filterSongs, chunkSongs } = require('../js/historySync');
const { add_to_scrobble_cache, clear_scrobble_cache } = require('../js/scrobbleCache');

beforeEach(() => clear_scrobble_cache());

describe('filterSongs()', () => {
  const syncFrom = new Date('2024-01-01');
  const sample = [
    { artist: 'A', title: 'T', album: 'Alb', listenDate: 'January 2, 2024' },
    { artist: 'Dup', title: 'Song', album: '', listenDate: 'January 3, 2024' },
    { artist: 'Old', title: 'Song', album: '', listenDate: 'December 1, 2023' },
  ];

  test('filters out songs before syncFrom', () => {
    const res = filterSongs(sample, syncFrom);
    expect(res.find((s) => s.artist === 'Old')).toBeUndefined();
  });

  test('filters out already scrobbled songs', () => {
    add_to_scrobble_cache('Dup', 'Song', '', Math.round(Date.now() / 1000));
    const res = filterSongs(sample, syncFrom);
    expect(res.find((s) => s.artist === 'Dup')).toBeUndefined();
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
  test('returns correct toScrobble and skipped counts', () => {
    const songs = [
      { artist: 'Dup', title: 'S', album: '', listenDate: 'January 2, 2024' },
      { artist: 'A', title: '1', album: '', listenDate: 'January 2, 2024' },
      { artist: 'B', title: '2', album: '', listenDate: 'January 2, 2024' },
    ];
    add_to_scrobble_cache('Dup', 'S', '', Math.round(Date.now() / 1000));
    const batch = require('../js/historySync').prepareBatch(songs, 0, 3);
    expect(batch.toScrobble.length).toBe(2);
    expect(batch.skipped).toBe(1);
    expect(batch.nextIndex).toBe(3);
  });
}); 