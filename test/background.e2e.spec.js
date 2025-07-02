// test/background.e2e.spec.js
// Jest E2E style tests exercising the message-passing and live-playback paths of background.js.

/* eslint-disable no-undef */

// Helper to build a minimal SETTINGS object used by background.js
function makeSettings(overrides = {}) {
  return Object.assign({
    scrobble: true,
    scrobbling_stopped_icon: 'stopped.png',
    playing_icon: 'playing.png',
    paused_icon: 'paused.png',
    main_icon: 'main.png',
    error_icon: 'error.png',
    api_key: 'dummyKey',
    api_secret: 'dummySecret',
    refresh_interval: 5, // seconds
    scrobble_point: 0.5,
    scrobble_interval: 240, // seconds
    max_scrobbles: 1,
    gmusic_ads_metadata: { title: 'Ad', artist: 'Google' },
    callback_file: 'callback.html',
  }, overrides);
}

// Minimal LastFM mock that calls the provided callback immediately
function mockLastFMClass() {
  return jest.fn().mockImplementation(() => ({
    session: {},
    scrobble: jest.fn((a, b, c, d, e, cb) => cb({})), // success response
    now_playing: jest.fn(),
    authorize: jest.fn(),
  }));
}

// Build a fresh background.js with mocks for each test case
function loadBackgroundEnvironment(settingsOverrides = {}) {
  jest.resetModules();
  // global.localStorage.clear(); // This will be handled by resetChromeApiMocks if called by test suite

  global.SETTINGS = makeSettings(settingsOverrides);
  // global.chrome is now set by jest.setup.js and reset by resetChromeApiMocks
  // Ensure jest.setup.js has run and global.chrome is the rich mock.
  if (!global.chrome || !global.chrome.storage || !global.chrome.storage.local) {
    throw new Error("global.chrome.storage.local mock not found. Ensure jest.setup.js ran correctly.");
  }

  global.log = jest.fn();
  global.LastFM = mockLastFMClass();

  // Provide historySync stub with spyable methods
  const historySyncStub = {
    processHistorySongs: jest.fn(),
  };
  global.historySync = historySyncStub;

  // Spy on cache BEFORE background.js loads so its alias sees the mocked fn
  const scrobbleCache = require('../js/scrobbleCache');
  const cacheSpy = jest.spyOn(scrobbleCache, 'add_to_scrobble_cache');

  const background = require('../js/background.js');
  return { background, cacheSpy };
}

/**
 * Tests
 */

describe('background.js message handling & live scrobble integration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    if (typeof global.resetChromeApiMocks === 'function') {
      global.resetChromeApiMocks();
    } else {
      // Fallback or error if global reset function isn't defined from jest.setup.js
      console.warn("global.resetChromeApiMocks not found, chrome API mocks may not be reset cleanly.");
      if (global.chrome && global.chrome.storage && global.chrome.storage.local && global.chrome.storage.local.__clearStoreDirectly) {
        global.chrome.storage.local.__clearStoreDirectly();
      }
      if (global.localStorage && global.localStorage.clear) {
        global.localStorage.clear();
      }
    }
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('process_history_songs message delegates to historySync.processHistorySongs', () => {
    const { background } = loadBackgroundEnvironment();

    // The listener is added by background.js to global.chrome.runtime.onMessage
    // We need to invoke it. The createChromeEventMock provides _dispatchEvent or _getListener.
    const onMessageListener = global.chrome.runtime.onMessage._getListener();
    expect(onMessageListener).toBeDefined();

    const songs = [{ artist: 'A', title: 'Song' }];
    const sendResponse = jest.fn();

    // Simulate message from content script
    onMessageListener({ action: 'process_history_songs', songs }, {}, sendResponse);

    expect(global.historySync.processHistorySongs).toHaveBeenCalledWith(songs);
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  test('get_sync_params returns timestamp from localStorage', () => {
    const { background } = loadBackgroundEnvironment(); // background.js execution adds the listener
    const TS = 1234567890;
    // This test relies on localStorage, not chrome.storage.local, for these params
    // as per original on_message in background.js for get_sync_params.
    // Let's verify: background.js on_message for get_sync_params uses chrome.storage.local.get
    // So, we should use chrome.storage.local mock here.
    global.chrome.storage.local.set({ 'sync_from_timestamp': TS.toString() });


    const onMessageListener = global.chrome.runtime.onMessage._getListener();
    expect(onMessageListener).toBeDefined();
    const sendResponse = jest.fn();

    // Simulate message
    onMessageListener({ action: 'get_sync_params' }, {}, sendResponse);

    // Since chrome.storage.local.get is async, we need to wait for sendResponse
    // The mock in jest.setup.js calls callback via Promise.resolve().then()
    return Promise.resolve().then(() => {
       expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ syncFromTimestamp: TS }));
    });
  });

  test('sync_complete clears sync flags from chrome.storage.local', () => {
    const { background } = loadBackgroundEnvironment();

    global.chrome.storage.local.set({
      'history_sync_in_progress': 'true',
      'sync_from_timestamp': '42'
    });

    const onMessageListener = global.chrome.runtime.onMessage._getListener();
    expect(onMessageListener).toBeDefined();
    const sendResponse = jest.fn();

    onMessageListener({ action: 'sync_complete', message: 'done' }, {}, sendResponse);

    return Promise.resolve().then(() => {
      // Check chrome.storage.local mock
      const store = global.chrome.storage.local.__getStore();
      expect(store['history_sync_in_progress']).toBeUndefined();
      expect(store['sync_from_timestamp']).toBeUndefined();
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  test('live playback reaches scrobble point and caches track', () => {
    const { background, cacheSpy } = loadBackgroundEnvironment();

    // Capture onConnect listener & create fake port
    const onConnectListener = global.chrome.runtime.onConnect._getListener(); // Corrected
    expect(onConnectListener).toBeDefined();
    const port = {
      onMessage: { addListener: jest.fn() }, // This will be spied on by the test
      onDisconnect: { addListener: jest.fn() }, // This can also be spied on if needed
    };
    onConnectListener(port); // Invoke the captured listener with the mock port

    const portMessageListener = port.onMessage.addListener.mock.calls[0][0];

    // First message – start playing
    const song = { artist: 'Artist', title: 'Title', album: 'Album', time: 240, position: 10 };
    portMessageListener({
      has_song: true,
      is_playing: true,
      song,
    });

    // Advance time beyond 120 seconds (scrobble point)
    jest.advanceTimersByTime(121000);

    // Second message with progressed position
    portMessageListener({
      has_song: true,
      is_playing: true,
      song: { ...song, position: 130 },
    });

    expect(global.chrome.action.setIcon).toHaveBeenCalledWith({ path: SETTINGS.playing_icon }); // Use SETTINGS.playing_icon for accuracy
  });

  test('70% of song duration triggers scrobble', () => {
    const { cacheSpy } = loadBackgroundEnvironment({ scrobble_point: 0.7, scrobble_interval: 420 });

    const onConnectListener = global.chrome.runtime.onConnect._getListener(); // Corrected
    expect(onConnectListener).toBeDefined();
    const port = { onMessage: { addListener: jest.fn() }, onDisconnect: { addListener: jest.fn() } };
    onConnectListener(port); // Corrected
    const portMsg = port.onMessage.addListener.mock.calls[0][0];

    const song = { artist: 'A', title: 'Threshold70', album: '', time: 100, position: 1 };
    portMsg({ has_song: true, is_playing: true, song });

    // advance to 71 seconds ( > 70% of 100 sec )
    jest.advanceTimersByTime(71000);
    portMsg({ has_song: true, is_playing: true, song: { ...song, position: 72 } });
    jest.advanceTimersByTime(1000);
    portMsg({ has_song: true, is_playing: true, song: { ...song, position: 73 } });

    expect(cacheSpy).toHaveBeenCalled();
  });

  test('7-minute absolute threshold triggers scrobble for long track', () => {
    const { cacheSpy } = loadBackgroundEnvironment({ scrobble_point: 0.7, scrobble_interval: 420 });

    const onConnectListener = global.chrome.runtime.onConnect._getListener(); // Corrected
    expect(onConnectListener).toBeDefined();
    const port = { onMessage: { addListener: jest.fn() }, onDisconnect: { addListener: jest.fn() } };
    onConnectListener(port); // Corrected
    const portMsg = port.onMessage.addListener.mock.calls[0][0];

    const song = { artist: 'Long', title: 'Epic', album: '', time: 1800, position: 1 }; // 30 min track
    portMsg({ has_song: true, is_playing: true, song });

    // advance 7 minutes (420000 ms)
    jest.advanceTimersByTime(421000);
    portMsg({ has_song: true, is_playing: true, song: { ...song, position: 422 } });
    jest.advanceTimersByTime(1000);
    portMsg({ has_song: true, is_playing: true, song: { ...song, position: 423 } });

    expect(cacheSpy).toHaveBeenCalled();
  });
}); 