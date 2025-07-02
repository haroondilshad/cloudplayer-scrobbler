/**
* Various utility functions
*/

/**
 * Storage utilities for Manifest V3 compatibility
 * Provides localStorage-like interface using chrome.storage.local
 */
const StorageUtils = {
  async get(key: string): Promise<any> {
    const result = await chrome.storage.local.get(key);
    return result[key];
  },

  async set(key: string, value: any): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },

  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  },

  // Synchronous versions for backward compatibility (using callbacks)
  getSync(key: string, callback: (value: any) => void): void {
    chrome.storage.local.get(key, (result: {[key: string]: any}) => {
      if (chrome.runtime.lastError) {
        // Handle error if needed, e.g., log it or pass to callback
        console.error("Error in getSync:", chrome.runtime.lastError.message);
        callback(undefined); // Or however you want to signal an error
        return;
      }
      callback(result[key]);
    });
  },

  setSync(key: string, value: any, callback?: () => void): void {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        console.error("Error in setSync:", chrome.runtime.lastError.message);
      }
      if (callback) {
        callback();
      }
    });
  },

  removeSync(key: string, callback?: () => void): void {
    chrome.storage.local.remove(key, () => {
      if (chrome.runtime.lastError) {
        console.error("Error in removeSync:", chrome.runtime.lastError.message);
      }
      if (callback) {
        callback();
      }
    });
  }
};

// Define a type for the callback to improve readability
type FindTabCallback = (tab: chrome.tabs.Tab | null) => void;

function find_play_tab(callback: FindTabCallback): void {
  chrome.tabs.query({url: '*://music.youtube.com/*'},
    (tabs: chrome.tabs.Tab[]) => { // Added type for tabs
      if (chrome.runtime.lastError) {
        console.error("Error querying YT Music tabs:", chrome.runtime.lastError.message);
        // Potentially try GPM or just callback with null
      }
      if (tabs && tabs.length > 0) {
        callback(tabs[0]);
      } else {
        // Fallback to GPM if no YT Music tab.
        chrome.tabs.query({url: '*://play.google.com/music/listen*'},
          (gpmTabs: chrome.tabs.Tab[]) => { // Renamed inner 'tabs' to 'gpmTabs' and typed
            if (chrome.runtime.lastError) {
              console.error("Error querying GPM tabs:", chrome.runtime.lastError.message);
              callback(null);
              return;
            }
            if (gpmTabs && gpmTabs.length > 0) {
              callback(gpmTabs[0]);
            } else {
              callback(null);
            }
          });
      }
    });
}

function open_play_tab(): void {
  find_play_tab(
    (tab: chrome.tabs.Tab | null) => { // Added type for tab
      if (tab && tab.id) { // Added null check for tab.id before using it
        chrome.tabs.update(tab.id, {selected: true}, () => {
          if (chrome.runtime.lastError) {
            console.error("Error updating tab:", chrome.runtime.lastError.message);
          }
        });
      } else {
        chrome.tabs.create({url: 'https://music.youtube.com', selected: true}, () => {
          if (chrome.runtime.lastError) {
            console.error("Error creating tab:", chrome.runtime.lastError.message);
          }
        });
      }
    }
  );
}
