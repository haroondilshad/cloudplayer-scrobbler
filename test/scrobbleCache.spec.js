// test/scrobbleCache.spec.js
// Comprehensive tests for the scrobbleCache utility

const {
  create_scrobble_key,
  get_scrobble_cache, // Using async version
  add_to_scrobble_cache,
  is_already_scrobbled, // Using async version
  cleanup_scrobble_cache,
  clear_scrobble_cache,
} = require('../js/scrobbleCache');

beforeEach((done) => { // Make beforeEach async
  // Clear the chrome.storage.local mock's store before each test
  if (global.chrome && global.chrome.storage && global.chrome.storage.local &&
      typeof global.chrome.storage.local.__clearStoreDirectly === 'function') {
    global.chrome.storage.local.__clearStoreDirectly();
  }
  // clear_scrobble_cache() operates on chrome.storage.local (async mock)
  clear_scrobble_cache();
  // Give a tick for the async clear to complete via the mock
  setTimeout(done, 0);
});

// Diagnostic tests for localStorageMock itself
describe('localStorageMock direct test', () => {
  beforeEach(() => {
    // Ensure a clean slate for the mock's internal store for these direct tests
    if (global.localStorage && typeof global.localStorage.clear === 'function') {
      global.localStorage.clear();
    }
  });

  test('mock setItem and getItem work', () => {
    global.localStorage.setItem('mykey_direct', 'myvalue_direct');
    expect(global.localStorage.getItem('mykey_direct')).toBe('myvalue_direct');
  });

  test('mock removeItem works', () => {
    global.localStorage.setItem('mykey_direct_remove', 'myvalue_direct_remove');
    expect(global.localStorage.getItem('mykey_direct_remove')).toBe('myvalue_direct_remove');
    global.localStorage.removeItem('mykey_direct_remove');
    expect(global.localStorage.getItem('mykey_direct_remove')).toBeNull();
  });

  test('mock clear works', () => {
    global.localStorage.setItem('mykey_direct_clear1', 'myvalue_direct_clear1');
    global.localStorage.setItem('mykey_direct_clear2', 'myvalue_direct_clear2');
    global.localStorage.clear();
    expect(global.localStorage.getItem('mykey_direct_clear1')).toBeNull();
    expect(global.localStorage.getItem('mykey_direct_clear2')).toBeNull();
  });
});

describe('Cache creation / retrieval / key generation', () => {
  test('create_scrobble_key normalises strings', () => {
    const key = create_scrobble_key('The   Beatles', 'Hey  Jude', '1967–1970');
    expect(key).toBe('the beatles|hey jude|19671970');
  });

  test('add_to_scrobble_cache populates cache', (done) => {
    add_to_scrobble_cache('A', 'B', 'C', 1);
    // add_to_scrobble_cache calls getCache (async mock) then saveCache (async mock)
    // Verify after a tick, using the async get_scrobble_cache
    setTimeout(() => { // Allow async operations of add_to_scrobble_cache to complete
      get_scrobble_cache(cache => {
        try {
          expect(cache['a|b|c']).toBeDefined();
          done();
        } catch (error) {
          done(error);
        }
      });
    }, 0);
  });
});

describe('Duplicate detection', () => {
  test('returns true for duplicate within one hour', (done) => {
    add_to_scrobble_cache('X', 'Y', 'Z', 100);
    setTimeout(() => { // Allow add_to_scrobble_cache to complete
      is_already_scrobbled('X', 'Y', 'Z', 100 + 1800, (isDup) => {
        try {
          expect(isDup).toBe(true);
          done();
        } catch (error) {
          done(error);
        }
      });
    }, 0);
  });

  test('returns false when timestamp difference > 1h', (done) => {
    add_to_scrobble_cache('X', 'Y', 'Z', 100);
    setTimeout(() => { // Allow add_to_scrobble_cache to complete
      is_already_scrobbled('X', 'Y', 'Z', 100 + 7200, (isDup) => {
        try {
          expect(isDup).toBe(false);
          done();
        } catch (error) {
          done(error);
        }
      });
    }, 0);
  });
});

describe('Cache cleanup', () => {
  test('removes entries older than 30 days from chrome.storage.local mock', (done) => {
    const oldMs = Date.now() - (31 * 24 * 60 * 60 * 1000);
    const initialCache = {
      'old|song|album': { scrobbled_at: oldMs, timestamp: 1, artist: 'Old', title: 'Song', album: 'Album' },
      'recent|song|album': { scrobbled_at: Date.now(), timestamp: 2, artist: 'Recent', title: 'Song', album: 'Album' },
    };

    global.chrome.storage.local.set({ 'scrobble_cache': JSON.stringify(initialCache) }, () => {
      cleanup_scrobble_cache(); // This is async due to get/set on chrome.storage.local mock

      // Need to wait for cleanup to finish. The mock calls callbacks via Promise.resolve().
      // A simple way is to use a short timeout, or ideally, cleanup_scrobble_cache would return a promise.
      // For now, using a timeout and then get_scrobble_cache_sync (which uses the async mock).
      // A better test would be to check after the 'set' inside cleanup_scrobble_cache's saveCache has resolved.
      // Let's assume the mock's async nature is handled by Jest's timer mocks if advanceTimersByTime is used,
      // or rely on the fact that get_scrobble_cache_sync will fetch the latest state after operations.

      // To properly test async behavior of cleanup_scrobble_cache with async storage:
      // We need to wait for the internal 'set' operation of cleanup_scrobble_cache to complete.
      // The simplest way given current structure is to use a small delay.
      setTimeout(() => {
        // get_scrobble_cache_sync will use the async chrome.storage.local.get mock.
        // This is problematic. get_scrobble_cache_sync is meant for the localStorage path.
        // We should use the async get_scrobble_cache for verification here.
        // OR, ensure that for tests, scrobbleCache uses a truly synchronous path if chrome API is mocked to be sync.
        // The chrome.storage.local mock IS async (uses Promise.resolve().then(callback)).

        // Let's use the async get_scrobble_cache from the module for verification
        const { get_scrobble_cache } = require('../js/scrobbleCache'); // re-require for clarity if needed
        get_scrobble_cache((cache) => {
          try {
            expect(cache['old|song|album']).toBeUndefined();
            expect(cache['recent|song|album']).toBeDefined();
            done();
          } catch (error) {
            done(error);
          }
        });
      }, 10); // Small delay for mocked async operations
    });
  });
});

describe('Integration – live vs history', () => {
  test('history sync skips recently live-scrobbled song', (done) => {
    const base = 1000;
    add_to_scrobble_cache('Live', 'Song', 'Album', base);
    setTimeout(() => {
      is_already_scrobbled('Live', 'Song', 'Album', base + 900, (isDup) => {
        try {
          expect(isDup).toBe(true);
          done();
        } catch (error) {
          done(error);
        }
      });
    }, 0);
  });

  test('history sync processes song played long ago', (done) => {
    const base = 1000;
    add_to_scrobble_cache('Live', 'Song', 'Album', base);
    setTimeout(() => {
      is_already_scrobbled('Live', 'Song', 'Album', base + 7201, (isDup) => {
        try {
          expect(isDup).toBe(false);
          done();
        } catch (error) {
          done(error);
        }
      });
    }, 0);
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
  // beforeEach for this describe block will use the main async beforeEach

  test('returns empty object when no cache key present', (done) => {
    get_scrobble_cache(cache => {
      try {
        expect(cache).toEqual({});
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  test('callback receives empty object for invalid JSON', (done) => {
    // Note: The current scrobbleCache.js getCache logs error and returns {} for invalid JSON, doesn't throw.
    // The chrome.storage.local.get mock also doesn't throw for invalid JSON, it would just return nothing for the key.
    // Let's test the behavior: it should result in an empty cache object passed to callback.
    global.chrome.storage.local.set({ 'scrobble_cache': 'invalid json' }, () => {
      get_scrobble_cache(cache => {
        try {
          expect(cache).toEqual({}); // Expecting empty object due to parse failure handling
          done();
        } catch (error) {
          done(error);
        }
      });
    });
  });
});

// add_to_scrobble_cache additional behaviour
describe('add_to_scrobble_cache details', () => {
  test('stores multiple different songs', (done) => {
    add_to_scrobble_cache('Artist1', 'Title1', 'Album1', 1);
    add_to_scrobble_cache('Artist2', 'Title2', 'Album2', 2);
    setTimeout(() => { // Allow multiple async add_to_scrobble_cache calls to complete
      get_scrobble_cache(cache => {
        try {
          expect(Object.keys(cache)).toHaveLength(2);
          done();
        } catch (error) {
          done(error);
        }
      });
    }, 0);
  });
});

// is_already_scrobbled extended tests
describe('is_already_scrobbled additional cases', () => {
  test('case-insensitive matching', (done) => {
    add_to_scrobble_cache('artist', 'title', 'album', 1);
    setTimeout(() => {
      is_already_scrobbled('ARTIST', 'TITLE', 'ALBUM', 1 + 100, (isDup) => {
        try {
          expect(isDup).toBe(true);
          done();
        } catch (error) {
          done(error);
        }
      });
    }, 0);
  });

  test('handles special chars consistently', (done) => {
    add_to_scrobble_cache("Guns N' Roses", "Sweet Child O' Mine", 'Appetite for Destruction', 10);
    setTimeout(() => {
      is_already_scrobbled(
        "Guns N' Roses",
        "Sweet Child O' Mine",
        'Appetite for Destruction',
        10 + 100,
        (isDup) => {
          try {
            expect(isDup).toBe(true);
            done();
          } catch (error) {
            done(error);
          }
        }
      );
    }, 0);
  });
});

// cleanup_scrobble_cache no-op when nothing old
describe('cleanup_scrobble_cache no-op', () => {
  test('does not modify cache if no outdated entries', (done) => {
    const recent = Date.now();
    const initialData = { 'recent|song|data': { scrobbled_at: recent, timestamp: 1, artist: 'Recent', title: 'Song', album: 'Data' } };
    global.chrome.storage.local.set({ 'scrobble_cache': JSON.stringify(initialData) }, () => {
      cleanup_scrobble_cache();
      setTimeout(() => {
        get_scrobble_cache(cache => {
          try {
            expect(cache).toEqual(initialData);
            done();
          } catch (error) {
            done(error);
          }
        });
      }, 10); // Allow time for async cleanup (get/set)
    });
  });
});

// clear_scrobble_cache tests
describe('clear_scrobble_cache()', () => {
  test('removes key from chrome.storage.local mock', (done) => {
    // Setup: Put something in the chrome.storage.local mock
    global.chrome.storage.local.set({ 'scrobble_cache': JSON.stringify({ test: 'data' }) }, () => {
      // Action: Call the function that should use chrome.storage.local.remove
      clear_scrobble_cache(); // This internally calls chrome.storage.local.remove

      // Verification: Check if the item is removed from chrome.storage.local mock
      // The remove operation in the mock is async (calls callback via Promise.resolve)
      // So we need to wait for it to complete. A simple way is another get.
      global.chrome.storage.local.get('scrobble_cache', (result) => {
        try {
          expect(result.scrobble_cache).toBeUndefined();
          done();
        } catch (error) {
          done(error);
        }
      });
    });
  });
});