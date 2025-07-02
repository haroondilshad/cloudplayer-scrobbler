/**
 * popup.js
 * Popup page script
 * Copyright (c) 2011 Alexey Savartsov <asavartsov@gmail.com>
 * Licensed under the MIT license
 */

/* Global state */
var currentPlayer = null;
var currentSession = null;
var currentSettings = null;

/* Render popup when DOM is ready */
$(document).ready(function() {
    // Initialize popup by getting current state from service worker
    initializePopup();
});

function initializePopup() {
    // Get initial state from service worker
    Promise.all([
        sendMessageToServiceWorker({cmd: 'getPlayer'}),
        sendMessageToServiceWorker({cmd: 'getSession'}),
        sendMessageToServiceWorker({cmd: 'getSettings'})
    ]).then(([player, session, settings]) => {
        currentPlayer = player;
        currentSession = session;
        currentSettings = settings;
        
        chrome.storage.local.get("seen_alert", (result) => {
            if (result.seen_alert === undefined) {
                show_alert();
            }
        });
        
        set_play_link();
        render_song();
        if (currentSession.name && currentSession.key) {
            render_scrobble_link();
        }
        render_auth_link();
        $("#sync-history-btn").click(on_sync_history);
        $("#options-link").click(on_options);
        
        // Handle date selection radio buttons
        $("input[name='sync-date']").change(function() {
            if ($(this).val() === 'custom') {
                $("#custom-sync-date").prop('disabled', false);
            } else {
                $("#custom-sync-date").prop('disabled', true);
            }
        });
        
        // Show last sync info if available
        render_sync_info();
    }).catch(error => {
        console.error('Failed to initialize popup:', error);
    });
}

// Helper function to send messages to service worker
function sendMessageToServiceWorker(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve(response);
            }
        });
    });
}

function set_play_link() {
    $("#cover").click(open_play_tab);
}

/* Render functions */
function update_song_info(player) {
    $("#artist").text(player.song.artist);
    $("#track").text(player.song.title);
    $("#cover").attr({ src: player.song.cover || "../img/defaultcover.png",
        alt:player.song.album});
    $("#album").text(player.song.album);

    if (currentSession.name && currentSession.key) {
        render_love_button(player);
    }
    toggle_play_btn(player);
}

function toggle_play_btn(player) {
    var play_btn = $("#play-pause-btn");
    if (player.is_playing) {
        play_btn.removeClass();
        play_btn.addClass("pause");
    } else {
        play_btn.removeClass();
        play_btn.addClass("play");
    }
}

/**
 * Renders current song details
 */
function render_song() {
    if (currentPlayer && currentPlayer.has_song) {
        update_song_info(currentPlayer);
        $("#play-pause-btn").click(toggle_play);
        $("#next-btn").click(next_song);
        $("#prev-btn").click(prev_song);
        if (!(currentSession.name && currentSession.key)) {
            $("#lastfm-buttons").hide();
        }
    } else {
        $("#song").addClass("nosong");
        $("#artist").text("");
        $("#track").html('');
        $("#cover ").attr({ src: "../img/defaultcover.png" });
        $("#lastfm-buttons").hide();
        $("#player-controls").hide();
    }
}

/**
 * Renders the link to turn on/off scrobbling
 */
function render_scrobble_link() {
    $("#scrobbling").html('<a></a>');
    $("#scrobbling a")
    .attr("href", "#")
    .click(on_toggle_scrobble)
    .text(currentSettings.scrobble ? "Stop scrobbling" : "Resume scrobbling");
}

/**
 * Renders authentication/profile link
 */
function render_auth_link() {
    if (currentSession.name && currentSession.key) {
        render_scrobble_link();
        $("#lastfm-profile").html("Logged in as " + "<a></a><a></a>");
        $("#lastfm-profile a:first")
        .attr({
            href: "http://last.fm/user/" + currentSession.name,
            target: "_blank"
        })
        .text(currentSession.name);

        $("#lastfm-profile a:last")
        .attr({
            href: "#",
            title: "Logout"
        })
        .click(on_logout)
        .addClass("logout");
    } else {
        $("#lastfm-profile").html('<a></a>');
        $("#lastfm-profile a").attr("href", "#")
        .click(on_auth)
        .text("Connect to Last.fm");
    }
}

/**
 * Renders the love button
 */
function render_love_button(player) {
    $("#love-button").html('<img src="../img/ajax-loader.gif">');

    sendMessageToServiceWorker({
        cmd: 'isTrackLoved',
        title: player.song.title,
        artist: player.song.artist
    }).then(result => {
        $("#love-button").html('<a href="#"></a>');
        if (result) {
            $("#love-button a").attr({ title: "Unlove this song"})
            .click(function() {on_unlove(player);})
            .addClass("loved");
        } else {
            $("#love-button a").attr({ title: "Love this song" })
            .click(function() {on_love(player);})
            .addClass("notloved");
        }
    }).catch(error => {
        console.error('Error checking if track is loved:', error);
    });
}

/* Event handlers */

function toggle_play() {
    var has_song = currentPlayer && currentPlayer.has_song;
    find_play_tab(
        function(tab) {
            chrome.tabs.sendMessage(tab.id, {cmd: "tgl"},
                function(player) {
                    if (has_song) {
                        toggle_play_btn(player);
                    } else { // if pressing FF on previous song reached end of play queue
                        update_song_info(player);
                        toggle_play_btn(player);
                    }
                }
            );
        }
    );
}

function prev_song() {
    find_play_tab(
        function(tab) {
            chrome.tabs.sendMessage(tab.id, {cmd: "prv"},
                function(player) {
                    /* The player state is in a disabled state as it loads the
                    * song initially, but we should display it as playing since
                    * hitting next or previous always starts a song.
                    */
                    player.is_playing = true;
                    update_song_info(player);
                });
        }
    );
}

function next_song() {
    find_play_tab(
        function(tab) {
            chrome.tabs.sendMessage(tab.id, {cmd: "nxt"},
                function(player) {
                    player.is_playing = true;
                    update_song_info(player);
                });
        }
    );
}

/**
 * Turn on/off scrobbling link was clicked
 */
function on_toggle_scrobble() {
    sendMessageToServiceWorker({cmd: 'toggleScrobble'}).then(() => {
        // Update current settings
        currentSettings.scrobble = !currentSettings.scrobble;
        render_scrobble_link();
    });
}

/**
 * Authentication link was clicked
 */
function on_auth() {
    sendMessageToServiceWorker({cmd: 'startWebAuth'});
    window.close();
}

/**
 * Options link was clicked
 */
function on_options() {
    chrome.tabs.create({url: chrome.runtime.getURL('html/options.html')});
    window.close();
}

/**
 * Logout link was clicked
 */
function on_logout() {
    sendMessageToServiceWorker({cmd: 'clearSession'}).then(() => {
        currentSession = {name: null, key: null};
        render_auth_link();
    });
}

/**
 * Love button was clicked
 */
function on_love(player) {
    sendMessageToServiceWorker({
        cmd: 'loveTrack',
        title: player.song.title,
        artist: player.song.artist
    }).then(result => {
        if (!result.error) {
            render_love_button(player);
        } else {
            if (result.error == 9) {
                // Session expired
                sendMessageToServiceWorker({cmd: 'clearSession'}).then(() => {
                    currentSession = {name: null, key: null};
                    render_auth_link();
                });
            }
            chrome.action.setIcon({
                'path': currentSettings.error_icon 
            });
        }
    }).catch(error => {
        console.error('Error loving track:', error);
    });

    $("#love-button").html('<img src="../img/ajax-loader.gif">');
}

/**
 * Unlove button was clicked
 */
function on_unlove(player) {
    sendMessageToServiceWorker({
        cmd: 'unloveTrack',
        title: player.song.title,
        artist: player.song.artist
    }).then(result => {
        if (!result.error) {
            render_love_button(player);
        } else {
            if (result.error == 9) {
                // Session expired
                sendMessageToServiceWorker({cmd: 'clearSession'}).then(() => {
                    currentSession = {name: null, key: null};
                    render_auth_link();
                });
            }
            chrome.action.setIcon({
                'path': currentSettings.error_icon 
            });
        }
    }).catch(error => {
        console.error('Error unloving track:', error);
    });

    $("#love-button").html('<img src="../img/ajax-loader.gif">');
}

/**
* Show temporary msg from me to user <3
*/
function show_alert() {
    $("#alert").removeClass("hidden");
    $("#extns_link").click(function() {
        sendMessageToServiceWorker({cmd: 'openExtensionsPage'});
    });
    $("#dismiss_alert").click(function() {
        $("#alert").addClass("hidden");
        chrome.storage.local.set({"seen_alert": "1"});
    });
}

/**
 * Render sync information
 */
function render_sync_info() {
    chrome.storage.local.get('last_history_sync', (result) => {
        var lastSync = result.last_history_sync;
        if (lastSync) {
            var lastSyncDate = new Date(parseInt(lastSync));
            var dateStr = lastSyncDate.toLocaleDateString() + ' ' + lastSyncDate.toLocaleTimeString();
            $("#sync-status").html('Last sync: ' + dateStr).removeClass('hidden').removeClass('error info').addClass('success');
            
            // Update radio button text to show "Since last sync"
            $("label[for='sync-from-now']").text('Since last sync (' + lastSyncDate.toLocaleDateString() + ')');
        } else {
            // First time sync
            $("label[for='sync-from-now']").text('Since last sync (never)');
        }
    });
}

/**
 * Sync History button was clicked
 */
function on_sync_history() {
    // Get selected sync option
    var syncOption = $("input[name='sync-date']:checked").val();
    var syncFromDate = null;
    
    if (syncOption === 'custom') {
        var customDate = $("#custom-sync-date").val();
        if (!customDate) {
            alert('Please select a custom date');
            return;
        }
        syncFromDate = new Date(customDate).getTime();
    } else {
        // Use last sync time or current time for first sync
        chrome.storage.local.get('last_history_sync', (result) => {
            var lastSync = result.last_history_sync;
        syncFromDate = lastSync ? parseInt(lastSync) : Date.now();
            performHistorySync(syncFromDate);
        });
        return; // Exit early to handle async storage
    }
    performHistorySync(syncFromDate);
}

function performHistorySync(syncFromDate) {
    // Disable button to prevent multiple clicks
    $("#sync-history-btn").prop('disabled', true).text('Syncing...');
    $("#sync-status").html('Preparing sync...').removeClass('hidden').removeClass('success error').addClass('info');
    
    // Tell background script to start history sync with date
    sendMessageToServiceWorker({cmd: 'startHistorySync', syncFromDate: syncFromDate});
    
    // Create/navigate to history tab
    chrome.tabs.create({url: 'https://music.youtube.com/history'});
    window.close();
}