/**
 * lastfm_callback.ts
 * LastFM callback script
 * Copyright (c) 2011 Alexey Savartsov <asavartsov@gmail.com>
 * Licensed under the MIT license
 */

// Assuming open_play_tab is globally available from util.ts
declare function open_play_tab(): void;
// Assuming chrome is globally available (standard for extension scripts)

function _url_param(name: string, url: string): string | null {
    const param = (RegExp(name + '=' + '(.+?)(&|$)').exec(url) || [,null])[1];
    if (param === null) {
        return null;
    }
    // unescape is deprecated, but we keep it to match original behavior.
    // Consider decodeURIComponent if issues arise or for future proofing.
    return unescape(param as string);
}

chrome.runtime.sendMessage(
  {
    cmd: 'getLastfmSession',
    token: _url_param("token", location.search)
  },
  function(): void { // Explicitly type the callback
    if (chrome.runtime.lastError) {
        console.error("Error in sendMessage callback:", chrome.runtime.lastError.message);
        // Decide if window should still close or if open_play_tab should still be called
    }
    open_play_tab();
    setTimeout(function(): void {
        window.close();
    }, 100);
  }
);
