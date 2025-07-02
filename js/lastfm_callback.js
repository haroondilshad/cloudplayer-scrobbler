/**
 * lastfm_callback.js
 * LastFM callback script
 * Copyright (c) 2011 Alexey Savartsov <asavartsov@gmail.com>
 * Licensed under the MIT license
 */
function _url_param(name, url) {
    return unescape((RegExp(name + '=' +
        '(.+?)(&|$)').exec(url) || [,null])[1]);
}

chrome.runtime.sendMessage({
    cmd: 'getLastfmSession',
    token: _url_param("token", location.search)
}, function() {
    open_play_tab();
    setTimeout(function() {
        window.close();
    }, 100);
});
