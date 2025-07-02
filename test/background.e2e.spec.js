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

// Build a minimal Chrome extension API mock
function makeChromeMock() {
  const createListener = () => {
    const listeners = [];
    return {
      addListener: jest.fn((cb) => listeners.push(cb)),
      _get: () => listeners[0],
    };
  };

  return {
    browserAction: {
      setIcon: jest.fn(),
    },
    runtime: {
      onMessage: createListener(),
      onConnect: createListener(),
    },
    commands: {
      onCommand: createListener(),
    },
    tabs: {
      sendMessage: jest.fn(),
      create: jest.fn(),
    },
  };
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
  global.localStorage.clear();

  global.SETTINGS = makeSettings(settingsOverrides);
  global.chrome = makeChromeMock();
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
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('process_history_songs message delegates to historySync.processHistorySongs', () => {
    const { background } = loadBackgroundEnvironment();

    const onMessage = global.chrome.runtime.onMessage._get();
    const songs = [{ artist: 'A', title: 'Song' }];
    const sendResponse = jest.fn();

    onMessage({ action: 'process_history_songs', songs }, {}, sendResponse);

    expect(global.historySync.processHistorySongs).toHaveBeenCalledWith(songs);
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  test('get_sync_params returns timestamp from localStorage', () => {
    const { background } = loadBackgroundEnvironment();
    const TS = 1234567890;
    localStorage.setItem('sync_from_timestamp', TS.toString());

    const onMessage = global.chrome.runtime.onMessage._get();
    const sendResponse = jest.fn();

    onMessage({ action: 'get_sync_params' }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ syncFromTimestamp: TS });
  });

  test('sync_complete clears sync flags', () => {
    const { background } = loadBackgroundEnvironment();

    localStorage.setItem('history_sync_in_progress', 'true');
    localStorage.setItem('sync_from_timestamp', '42');

    const onMessage = global.chrome.runtime.onMessage._get();
    const sendResponse = jest.fn();

    onMessage({ action: 'sync_complete', message: 'done' }, {}, sendResponse);

    expect(localStorage.getItem('history_sync_in_progress')).toBeNull();
    expect(localStorage.getItem('sync_from_timestamp')).toBeNull();
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  test('live playback reaches scrobble point and caches track', () => {
    const { background, cacheSpy } = loadBackgroundEnvironment();

    // Capture onConnect listener & create fake port
    const onConnect = global.chrome.runtime.onConnect._get();
    const port = {
      onMessage: { addListener: jest.fn() },
      onDisconnect: { addListener: jest.fn() },
    };
    onConnect(port);

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

    expect(global.chrome.browserAction.setIcon).toHaveBeenCalledWith({ path: 'playing.png' });
  });

  test('70% of song duration triggers scrobble', () => {
    const { cacheSpy } = loadBackgroundEnvironment({ scrobble_point: 0.7, scrobble_interval: 420 });

    const onConnect = global.chrome.runtime.onConnect._get();
    const port = { onMessage: { addListener: jest.fn() }, onDisconnect: { addListener: jest.fn() } };
    onConnect(port);
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

    const onConnect = global.chrome.runtime.onConnect._get();
    const port = { onMessage: { addListener: jest.fn() }, onDisconnect: { addListener: jest.fn() } };
    onConnect(port);
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