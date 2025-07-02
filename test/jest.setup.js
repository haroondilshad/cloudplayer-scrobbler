// test/jest.setup.js
// Global Jest setup for extension utility tests

// Minimal mock for localStorage so utility code using it works in Node.
const localStorageMock = {
  _store: {},
  getItem: function(key) { return key in this._store ? this._store[key] : null; },
  setItem: function(key, value) { this._store[key] = value; },
  removeItem: function(key) { delete this._store[key]; },
  clear: function() { this._store = {}; }
};
global.localStorage = localStorageMock;

global.console = {
  log: jest.fn(),
  error: jest.fn(), // Also mock error to suppress expected errors in tests if any
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

// Helper to create a mock for Chrome event listeners (onMessage, onConnect, etc.)
function createChromeEventMock() {
  const listeners = [];
  return {
    addListener: jest.fn((callback) => {
      if (typeof callback === 'function') {
        listeners.push(callback);
      }
    }),
    removeListener: jest.fn((callback) => {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }),
    hasListener: jest.fn((callback) => listeners.includes(callback)),
    hasListeners: jest.fn(() => listeners.length > 0),
    // Helper for tests to manually dispatch an event to the first listener
    _dispatchEvent: (...args) => {
      if (listeners.length > 0) {
        return listeners[0](...args);
      }
    },
    // Helper to get a specific listener
    _getListener: (index = 0) => listeners[index],
    _clearListeners: () => { listeners.length = 0; }
  };
}

// Mock for chrome.storage.local (keeping jest.fn for spy capabilities)
const chromeStorageLocalMock = (() => {
  let store = {};
  return {
    get: jest.fn((keys, callback) => {
      const result = {};
      if (keys === null) { Object.assign(result, store); }
      else if (typeof keys === 'string') { if (keys in store) { result[keys] = store[keys]; } }
      else if (Array.isArray(keys)) { keys.forEach(key => { if (key in store) { result[key] = store[key]; } }); }
      else if (typeof keys === 'object') { Object.keys(keys).forEach(key => { result[key] = store.hasOwnProperty(key) ? store[key] : keys[key]; }); }
      if (typeof callback === 'function') { callback(result); } else { return Promise.resolve(result); }
    }),
    set: jest.fn((items, callback) => {
      Object.assign(store, items); // Simplified set
      if (typeof callback === 'function') { callback(); } else { return Promise.resolve(); }
    }),
    remove: jest.fn((keys, callback) => {
      const keysToRemove = Array.isArray(keys) ? keys : [keys];
      keysToRemove.forEach(key => { delete store[key]; });
      if (typeof callback === 'function') { callback(); } else { return Promise.resolve(); }
    }),
    clear: jest.fn(callback => {
      store = {};
      if (typeof callback === 'function') { callback(); } else { return Promise.resolve(); }
    }),
    __getStore: () => store,
    __clearStore: () => { store = {}; }
  };
})();

global.chrome = {
  storage: {
    local: chromeStorageLocalMock,
    onChanged: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
      hasListener: jest.fn()
    }
  },
  runtime: {
    sendMessage: jest.fn((message, callback) => {
      // Basic mock, can be expanded if tests need specific responses
      if (typeof callback === 'function') {
        // Simulate async response for some messages if needed by tests
        // For now, just call callback if provided
        // callback();
      }
      return Promise.resolve(); // For listeners that expect a promise
    }),
    onMessage: createChromeEventMock(),
    onConnect: createChromeEventMock(),
    getURL: jest.fn(path => 'chrome-extension://mockaglobalsidepanel/' + path), // Path updated to match previous attempt
    lastError: undefined
  },
  action: { // Manifest V3
    setIcon: jest.fn((details, callback) => { Promise.resolve().then(() => { if (callback) callback(); }); }),
    setTitle: jest.fn((details, callback) => { Promise.resolve().then(() => { if (callback) callback(); }); }),
    setPopup: jest.fn((details, callback) => { Promise.resolve().then(() => { if (callback) callback(); }); }),
    setBadgeText: jest.fn((details, callback) => { Promise.resolve().then(() => { if (callback) callback(); }); }),
    setBadgeBackgroundColor: jest.fn((details, callback) => { Promise.resolve().then(() => { if (callback) callback(); }); })
  },
  browserAction: { // Manifest V2 fallback
    setIcon: jest.fn((details, callback) => { Promise.resolve().then(() => { if (callback) callback(); }); }),
    setTitle: jest.fn((details, callback) => { Promise.resolve().then(() => { if (callback) callback(); }); }),
  },
  commands: { // Added
    onCommand: createChromeEventMock()
  },
  alarms: {
    create: jest.fn(),
    get: jest.fn(callbackOrName => {
      if(typeof callbackOrName === 'function') callbackOrName(undefined);
      return Promise.resolve(undefined);
    }),
    getAll: jest.fn(callback => {
      if(typeof callback === 'function') callback([]);
      return Promise.resolve([]);
    }),
    clear: jest.fn(callbackOrName => {
       if(typeof callbackOrName === 'function') callbackOrName(true);
       return Promise.resolve(true);
    }),
    onAlarm: {
      addListener: jest.fn()
    }
  },
  tabs: {
    create: jest.fn(),
    query: jest.fn((queryInfo, callback) => {
      if (typeof callback === 'function') {
        callback([]); // Simulate no tabs found by default
      }
      return Promise.resolve([]);
    }),
    sendMessage: jest.fn((tabId, message, options, callback) => {
      if (typeof options === 'function') { // options is optional
        callback = options;
      }
      if (typeof callback === 'function') {
        // callback(); // Simulate response if needed
      }
      return Promise.resolve();
    }),
    reload: jest.fn()
  },
  sidePanel: {
    setPanelBehavior: jest.fn(() => Promise.resolve()),
    open: jest.fn(() => Promise.resolve()),
  },
  // Add other chrome APIs as needed by the scripts under test
};

// To reset mocks before each test if needed, use jest.clearAllMocks() in the test file's beforeEach,
// or specific mockResets for chromeStorageLocalMock if it maintains state across tests.
// For chrome.storage.local, individual test files can call:
// if (global.chrome && global.chrome.storage && global.chrome.storage.local && global.chrome.storage.local.__clearStore) {
//   global.chrome.storage.local.__clearStore();
// }
// in their own beforeEach blocks if they need to reset the storage mock.
// Similarly for chrome.runtime.lastError.

// Helper to reset mocks, can be called in test files' beforeEach
global.resetChromeApiMocks = () => {
  if (chrome.storage.local.__clearStoreDirectly) { // Use the new name
    chrome.storage.local.__clearStoreDirectly();
  }
  if (localStorage && typeof localStorage.clear === 'function') {
    localStorage.clear();
  }
  if (chrome.runtime) {
    chrome.runtime.lastError = undefined;
  }

  // Clear listeners from event mocks
  const eventMocks = [
    chrome.storage.onChanged,
    chrome.runtime.onMessage,
    chrome.runtime.onConnect,
    chrome.commands.onCommand,
    chrome.alarms.onAlarm,
  ];
  eventMocks.forEach(eventMock => {
    if (eventMock && eventMock._clearListeners) {
      eventMock._clearListeners();
    }
  });

  // Reset call counts for top-level jest.fn mocks
  // This is a bit broad; ideally, specific mocks are cleared by tests that use them.
  // However, for a general reset function, this can be useful.
  const apisToClear = [
    chrome.runtime, chrome.action, chrome.browserAction,
    chrome.alarms, chrome.tabs, chrome.sidePanel, chrome.storage.local
  ];
  apisToClear.forEach(api => {
    if (api) {
      Object.values(api).forEach(fn => {
        if (jest.isMockFunction(fn) && fn.mockClear) { // Check for mockClear
          fn.mockClear();
        }
      });
    }
  });
};