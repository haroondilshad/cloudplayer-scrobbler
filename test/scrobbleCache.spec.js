// test/scrobbleCache.spec.js
// Comprehensive tests for the scrobbleCache utility

const {
  create_scrobble_key,
  get_scrobble_cache,
  add_to_scrobble_cache,
  is_already_scrobbled,
  cleanup_scrobble_cache,
  clear_scrobble_cache,
} = require('../js/scrobbleCache');

beforeEach(() => {
  clear_scrobble_cache();
});

describe('Cache creation / retrieval / key generation', () => {
  test('create_scrobble_key normalises strings', () => {
    const key = create_scrobble_key('The   Beatles', 'Hey  Jude', '1967–1970');
    expect(key).toBe('the beatles|hey jude|19671970');
  });

  test('add_to_scrobble_cache populates cache', () => {
    add_to_scrobble_cache('A', 'B', 'C', 1);
    expect(get_scrobble_cache()['a|b|c']).toBeDefined();
  });
});

describe('Duplicate detection', () => {
  test('returns true for duplicate within one hour', () => {
    add_to_scrobble_cache('X', 'Y', 'Z', 100);
    expect(is_already_scrobbled('X', 'Y', 'Z', 100 + 1800)).toBe(true);
  });

  test('returns false when timestamp difference > 1h', () => {
    add_to_scrobble_cache('X', 'Y', 'Z', 100);
    expect(is_already_scrobbled('X', 'Y', 'Z', 100 + 7200)).toBe(false);
  });
});

describe('Cache cleanup', () => {
  test('removes entries older than 30 days', () => {
    const oldMs = Date.now() - 31 * 24 * 60 * 60 * 1000;
    localStorage.setItem('scrobble_cache', JSON.stringify({
      old: { scrobbled_at: oldMs, timestamp: 1 },
      recent: { scrobbled_at: Date.now(), timestamp: 2 },
    }));

    cleanup_scrobble_cache();
    const cache = get_scrobble_cache();
    expect(cache.old).toBeUndefined();
    expect(cache.recent).toBeDefined();
  });
});

describe('Integration – live vs history', () => {
  test('history sync skips recently live-scrobbled song', () => {
    const base = 1000;
    add_to_scrobble_cache('Live', 'Song', 'Album', base);
    expect(is_already_scrobbled('Live', 'Song', 'Album', base + 900)).toBe(true);
  });

  test('history sync processes song played long ago', () => {
    const base = 1000;
    add_to_scrobble_cache('Live', 'Song', 'Album', base);
    expect(is_already_scrobbled('Live', 'Song', 'Album', base + 7201)).toBe(false);
  });
});

// Additional create_scrobble_key cases
describe('create_scrobble_key – extended cases', () => {
  test('handles special characters (Guns N\' Roses)', () => {
    const key = create_scrobble_key("Guns N' Roses", "Sweet Child O' Mine", 'Appetite for Destruction');
    expect(key).toBe('guns n roses|sweet child o mine|appetite for destruction');
  });

  test('normalises extra spaces', () => {
    const key = create_scrobble_key('  Artist  Name  ', '  Song   Title  ', '  Album   ');
    expect(key).toBe('artist name|song title|album');
  });
});

// get_scrobble_cache edge cases
describe('get_scrobble_cache edge cases', () => {
  beforeEach(() => clear_scrobble_cache());

  test('returns empty object when no cache key present', () => {
    expect(get_scrobble_cache()).toEqual({});
  });

  test('throws when stored JSON is invalid', () => {
    localStorage.setItem('scrobble_cache', 'invalid json');
    expect(() => get_scrobble_cache()).toThrow();
  });
});

// add_to_scrobble_cache additional behaviour
describe('add_to_scrobble_cache details', () => {
  beforeEach(() => clear_scrobble_cache());

  test('stores multiple different songs', () => {
    add_to_scrobble_cache('Artist1', 'Title1', 'Album1', 1);
    add_to_scrobble_cache('Artist2', 'Title2', 'Album2', 2);
    const cache = get_scrobble_cache();
    expect(Object.keys(cache)).toHaveLength(2);
  });
});

// is_already_scrobbled extended tests
describe('is_already_scrobbled additional cases', () => {
  beforeEach(() => clear_scrobble_cache());

  test('case-insensitive matching', () => {
    add_to_scrobble_cache('artist', 'title', 'album', 1);
    expect(is_already_scrobbled('ARTIST', 'TITLE', 'ALBUM', 1 + 100)).toBe(true);
  });

  test('handles special chars consistently', () => {
    add_to_scrobble_cache("Guns N' Roses", "Sweet Child O' Mine", 'Appetite for Destruction', 10);
    expect(
      is_already_scrobbled(
        "Guns N' Roses",
        "Sweet Child O' Mine",
        'Appetite for Destruction',
        10 + 100,
      ),
    ).toBe(true);
  });
});

// cleanup_scrobble_cache no-op when nothing old
describe('cleanup_scrobble_cache no-op', () => {
  beforeEach(() => clear_scrobble_cache());

  test('does not modify cache if no outdated entries', () => {
    const recent = Date.now();
    localStorage.setItem(
      'scrobble_cache',
      JSON.stringify({ recent: { scrobbled_at: recent, timestamp: 1 } }),
    );
    cleanup_scrobble_cache();
    expect(get_scrobble_cache()).toEqual({ recent: { scrobbled_at: recent, timestamp: 1 } });
  });
});

// clear_scrobble_cache tests
describe('clear_scrobble_cache()', () => {
  test('removes key from localStorage', () => {
    localStorage.setItem('scrobble_cache', JSON.stringify({ test: 'data' }));
    clear_scrobble_cache();
    expect(localStorage.getItem('scrobble_cache')).toBeNull();
  });
}); 