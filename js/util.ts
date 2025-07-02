/**
* Various utility functions
*/

/**
 * Storage utilities for Manifest V3 compatibility
 * Provides localStorage-like interface using chrome.storage.local
 */
const StorageUtils = {
  async get(key) {
    const result = await chrome.storage.local.get(key);
    return result[key];
  },

  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },

  async remove(key) {
    await chrome.storage.local.remove(key);
  },

  // Synchronous versions for backward compatibility (using callbacks)
  getSync(key, callback) {
    chrome.storage.local.get(key, (result) => {
      callback(result[key]);
    });
  },

  setSync(key, value, callback) {
    chrome.storage.local.set({ [key]: value }, callback);
  },

  removeSync(key, callback) {
    chrome.storage.local.remove(key, callback);
  }
};

function find_play_tab(callback) {
  chrome.tabs.query({url: '*://music.youtube.com/*'},
    function(tabs) {
      if (tabs.length > 0) {
        callback(tabs[0]);
      } else {
        // Fallback to GPM if no YT Music tab.
        chrome.tabs.query({url: '*://play.google.com/music/listen*'},
          function(tabs) {
            if (tabs.length > 0) {
              callback(tabs[0]);
            } else {
              callback(null);
            }
          });
      }
    });
}

function open_play_tab() {
  find_play_tab(
    function(tab) {
      if (tab) {
        chrome.tabs.update(tab.id, {selected: true});
      } else {
        chrome.tabs.create({url:
          'https://music.youtube.com',
           selected: true});
      }
    }
  );
}
