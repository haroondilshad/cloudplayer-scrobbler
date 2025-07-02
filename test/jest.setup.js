// test/jest.setup.js
// Global Jest setup for extension utility tests

// Minimal mock for localStorage so utility code using it works in Node.
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = v;
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
  };
})();

global.localStorage = localStorageMock;

global.console = {
  log: jest.fn(),
}; 