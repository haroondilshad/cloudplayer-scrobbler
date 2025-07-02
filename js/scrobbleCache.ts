// This will recreate the module if missing 

(function(global){
  'use strict';

  function normalizeString(str){
    return (str||'').toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();
  }
  function createKey(artist,title,album){
    return normalizeString(artist)+'|'+normalizeString(title)+'|'+normalizeString(album);
  }
  function getCache(callback){
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('scrobble_cache', (result) => {
        let cache = {};
        if (result.scrobble_cache) {
          try {
            cache = JSON.parse(result.scrobble_cache);
          } catch (e) {
            console.error("Error parsing scrobble_cache from chrome.storage.local:", e);
            // cache remains {}
          }
        }
        callback(cache);
      });
    } else {
      // Fallback for environments without chrome.storage (like tests)
      let cache = {};
      const raw = global.localStorage && global.localStorage.getItem('scrobble_cache');
      if (raw) {
        try {
          cache = JSON.parse(raw);
        } catch (e) {
          console.error("Error parsing scrobble_cache from localStorage:", e);
          // cache remains {}
        }
      }
      callback(cache);
    }
  }
  function saveCache(cache){
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({'scrobble_cache': JSON.stringify(cache)});
    } else {
      // Fallback for environments without chrome.storage (like tests)  
    if(global.localStorage){global.localStorage.setItem('scrobble_cache',JSON.stringify(cache));}
    }
  }
  function cleanup(){
    getCache((cache) => {
    const cutoff=Date.now()-30*24*60*60*1000;
    let dirty=false;
    Object.keys(cache).forEach(k=>{if(cache[k].scrobbled_at<cutoff){delete cache[k];dirty=true;}});
    if(dirty) saveCache(cache);
    });
  }
  function add(artist,title,album,timestamp){
    getCache((cache) => {
    cache[createKey(artist,title,album)]={artist,title,album,timestamp,scrobbled_at:Date.now()};
    saveCache(cache);
    cleanup();
    });
  }
  function isDup(artist,title,album,songTimestamp,callback){
    getCache((cache) => {
      const entry=cache[createKey(artist,title,album)];
      if(!entry) {
        callback(false);
        return;
      }
      callback(Math.abs(songTimestamp-entry.timestamp)<3600); // 1h
    });
  }
  function clear(){ 
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove('scrobble_cache');
    } else {
      // Fallback for environments without chrome.storage (like tests)
      if(global.localStorage){global.localStorage.removeItem('scrobble_cache');}
    }
  }

  // Provide synchronous versions for backward compatibility (mainly for tests)
  function getCacheSync(){
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      // This shouldn't be called in production, but fallback to localStorage for tests
      const raw = global.localStorage && global.localStorage.getItem('scrobble_cache');
      return raw ? JSON.parse(raw) : {};
    } else {
      const raw = global.localStorage && global.localStorage.getItem('scrobble_cache');
      return raw ? JSON.parse(raw) : {};
    }
  }
  
  function isDupSync(artist,title,album,songTimestamp){
    const cache = getCacheSync();
    const entry = cache[createKey(artist,title,album)];
    if(!entry) return false;
    return Math.abs(songTimestamp-entry.timestamp)<3600; // 1h
  }

  const api={
    normalizeString:createKey,
    create_scrobble_key:createKey,
    get_scrobble_cache:getCache,
    get_scrobble_cache_sync:getCacheSync, // For tests
    add_to_scrobble_cache:add,
    is_already_scrobbled:isDup,
    is_already_scrobbled_sync:isDupSync, // For tests  
    cleanup_scrobble_cache:cleanup,
    clear_scrobble_cache:clear
  };
  global.scrobbleCache=api;
  if(typeof module!=='undefined'&&module.exports){module.exports=api;}
})(typeof self!=='undefined'?self:globalThis); 