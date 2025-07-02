// This will recreate the module if missing 

(function(global){
  'use strict';

  function normalizeString(str){
    return (str||'').toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();
  }
  function createKey(artist,title,album){
    return normalizeString(artist)+'|'+normalizeString(title)+'|'+normalizeString(album);
  }
  function getCache(){
    const raw=global.localStorage&&global.localStorage.getItem('scrobble_cache');
    return raw?JSON.parse(raw):{};
  }
  function saveCache(cache){
    if(global.localStorage){global.localStorage.setItem('scrobble_cache',JSON.stringify(cache));}
  }
  function cleanup(){
    const cache=getCache();
    const cutoff=Date.now()-30*24*60*60*1000;
    let dirty=false;
    Object.keys(cache).forEach(k=>{if(cache[k].scrobbled_at<cutoff){delete cache[k];dirty=true;}});
    if(dirty) saveCache(cache);
  }
  function add(artist,title,album,timestamp){
    const cache=getCache();
    cache[createKey(artist,title,album)]={artist,title,album,timestamp,scrobbled_at:Date.now()};
    saveCache(cache);
    cleanup();
  }
  function isDup(artist,title,album,songTimestamp){
    const entry=getCache()[createKey(artist,title,album)];
    if(!entry) return false;
    return Math.abs(songTimestamp-entry.timestamp)<3600; // 1h
  }
  function clear(){ if(global.localStorage){global.localStorage.removeItem('scrobble_cache');} }

  const api={normalizeString:createKey,create_scrobble_key:createKey,get_scrobble_cache:getCache,add_to_scrobble_cache:add,is_already_scrobbled:isDup,cleanup_scrobble_cache:cleanup,clear_scrobble_cache:clear};
  global.scrobbleCache=api;
  if(typeof module!=='undefined'&&module.exports){module.exports=api;}
})(typeof self!=='undefined'?self:globalThis); 