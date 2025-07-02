/**
 * popup.js
 * Popup page script
 * Copyright (c) 2011 Alexey Savartsov <asavartsov@gmail.com>
 * Licensed under the MIT license
 */

// --- Globals and Declarations ---

// Assuming jQuery is loaded globally. Without @types/jquery, $ will be 'any'.
declare var $: any;

// Assuming these are globally available from other scripts
declare function find_play_tab(callback: (tab: chrome.tabs.Tab | null) => void): void;
declare function open_play_tab(): void;

interface Song {
    artist: string;
    title: string;
    album: string | null;
    cover: string | null;
    duration?: number; // Optional, as it's not always present
}

interface PlayerState {
    has_song: boolean;
    is_playing: boolean;
    song: Song;
}

interface SessionState {
    name: string | null;
    key: string | null;
}

interface PopupSettings {
    scrobble?: boolean;
    error_icon?: string; // Assuming this is a path
    // Add other settings properties if used from currentSettings global
}

// Global state variables
var currentPlayer: PlayerState | null = null;
var currentSession: SessionState | null = null;
var currentSettings: PopupSettings | null = null;


// --- Initialization ---

// Use DOMContentLoaded for vanilla JS, or $(document).ready for jQuery.
// jQuery's ready is used in original, so we'll keep its structure.
$(document).ready(function() {
    initializePopup();
});

function initializePopup(): void {
    Promise.all([
        sendMessageToServiceWorker<{ cmd: string }, PlayerState | null>({ cmd: 'getPlayer' }),
        sendMessageToServiceWorker<{ cmd: string }, SessionState | null>({ cmd: 'getSession' }),
        sendMessageToServiceWorker<{ cmd: string }, PopupSettings | null>({ cmd: 'getSettings' })
    ]).then(([player, session, settings]) => {
        currentPlayer = player;
        currentSession = session;
        currentSettings = settings;

        // Ensure defaults if any part of the state is null
        if (!currentPlayer) currentPlayer = { has_song: false, is_playing: false, song: { artist: '', title: '', album: null, cover: null }};
        if (!currentSession) currentSession = { name: null, key: null };
        if (!currentSettings) currentSettings = { scrobble: true }; // Default scrobbling to true if not set

        chrome.storage.local.get("seen_alert", (result: { [key: string]: any }) => {
            if (chrome.runtime.lastError) {
                console.error("Error getting seen_alert:", chrome.runtime.lastError.message);
            } else if (result.seen_alert === undefined) {
                show_alert();
            }
        });

        set_play_link();
        render_song();
        if (currentSession.name && currentSession.key) {
            render_scrobble_link(); // Depends on currentSettings.scrobble
        }
        render_auth_link(); // Depends on currentSession

        $("#sync-history-btn").click(on_sync_history);
        $("#options-link").click(on_options);

        $("input[name='sync-date']").change(function(this: HTMLInputElement) {
            if ($(this).val() === 'custom') {
                $("#custom-sync-date").prop('disabled', false);
            } else {
                $("#custom-sync-date").prop('disabled', true);
            }
        });

        render_sync_info();

    }).catch(error => {
        console.error('Failed to initialize popup:', error);
        // Maybe render an error state in the popup
        $("#song").addClass("nosong").html("Error loading popup. <br>Try again or check console.");
    });
}

// --- Communication Helper ---
function sendMessageToServiceWorker<TMessage, TResponse>(message: TMessage): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response: TResponse) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve(response);
            }
        });
    });
}

// --- UI Setup ---
function set_play_link(): void {
    $("#cover").click(open_play_tab);
}

// --- Render Functions ---
function update_song_info(player: PlayerState): void {
    $("#artist").text(player.song.artist);
    $("#track").text(player.song.title);
    $("#cover").attr({
        src: player.song.cover || "../img/defaultcover.png",
        alt: player.song.album || "Album cover"
    });
    $("#album").text(player.song.album || "");

    if (currentSession?.name && currentSession?.key) {
        render_love_button(player);
    }
    toggle_play_btn(player);
}

function toggle_play_btn(player: PlayerState): void {
    const play_btn = $("#play-pause-btn");
    play_btn.removeClass(); // Clear existing classes
    if (player.is_playing) {
        play_btn.addClass("pause");
    } else {
        play_btn.addClass("play");
    }
}

function render_song(): void {
    if (currentPlayer && currentPlayer.has_song) {
        update_song_info(currentPlayer);
        $("#play-pause-btn").click(toggle_play);
        $("#next-btn").click(next_song);
        $("#prev-btn").click(prev_song);
        if (!(currentSession?.name && currentSession?.key)) {
            $("#lastfm-buttons").hide();
        } else {
            $("#lastfm-buttons").show();
        }
         $("#player-controls").show();
    } else {
        $("#song").addClass("nosong");
        $("#artist").text("");
        $("#track").html('No song playing or detected.'); // Clearer message
        $("#cover").attr({ src: "../img/defaultcover.png", alt: "No song" });
        $("#lastfm-buttons").hide();
        $("#player-controls").hide();
    }
}

function render_scrobble_link(): void {
    if (!currentSettings) return; // Should not happen if initialized correctly
    $("#scrobbling").html('<a></a>'); // Clear and create new link
    $("#scrobbling a")
        .attr("href", "#")
        .click(on_toggle_scrobble)
        .text(currentSettings.scrobble ? "Stop scrobbling" : "Resume scrobbling");
}

function render_auth_link(): void {
    if (currentSession?.name && currentSession?.key) {
        render_scrobble_link(); // Re-render scrobble link based on current settings
        $("#lastfm-profile").html(`Logged in as <a href="http://last.fm/user/${currentSession.name}" target="_blank">${currentSession.name}</a><a href="#" title="Logout" class="logout"></a>`);
        $("#lastfm-profile a.logout").click(on_logout);
    } else {
        $("#scrobbling").empty(); // Clear scrobbling link if not logged in
        $("#lastfm-profile").html('<a></a>');
        $("#lastfm-profile a")
            .attr("href", "#")
            .click(on_auth)
            .text("Connect to Last.fm");
    }
}

function render_love_button(player: PlayerState): void {
    if (!player || !player.song) return;
    $("#love-button").html('<img src="../img/ajax-loader.gif" alt="Loading...">'); // Spinner

    sendMessageToServiceWorker<{ cmd: string; title: string; artist: string }, boolean>({
        cmd: 'isTrackLoved',
        title: player.song.title,
        artist: player.song.artist
    }).then(isLoved => {
        $("#love-button").html('<a href="#"></a>'); // Clear spinner
        const loveLink = $("#love-button a");
        if (isLoved) {
            loveLink.attr({ title: "Unlove this song" })
                .click(() => on_unlove(player)) // Pass player state
                .addClass("loved");
        } else {
            loveLink.attr({ title: "Love this song" })
                .click(() => on_love(player)) // Pass player state
                .addClass("notloved");
        }
    }).catch(error => {
        console.error('Error checking if track is loved:', error);
        $("#love-button").html('<span class="error-text">Error</span>'); // Show error
    });
}

function toggle_play(): void {
    const has_song = currentPlayer && currentPlayer.has_song;
    find_play_tab((tab: chrome.tabs.Tab | null) => {
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { cmd: "tgl" }, (playerResponse: PlayerState) => {
                if (chrome.runtime.lastError) {
                    console.error("Error toggling play:", chrome.runtime.lastError.message);
                    return;
                }
                currentPlayer = playerResponse; // Update global state
                if (has_song && currentPlayer) {
                    toggle_play_btn(currentPlayer);
                } else if (currentPlayer) {
                    update_song_info(currentPlayer); // Update if new song started
                    toggle_play_btn(currentPlayer);
                }
            });
        }
    });
}

function prev_song(): void {
    find_play_tab((tab: chrome.tabs.Tab | null) => {
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { cmd: "prv" }, (playerResponse: PlayerState) => {
                if (chrome.runtime.lastError) {
                    console.error("Error going to previous song:", chrome.runtime.lastError.message);
                    return;
                }
                if (playerResponse) {
                    playerResponse.is_playing = true; // Assume playing after action
                    currentPlayer = playerResponse;
                    update_song_info(currentPlayer);
                }
            });
        }
    });
}

function next_song(): void {
    find_play_tab((tab: chrome.tabs.Tab | null) => {
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { cmd: "nxt" }, (playerResponse: PlayerState) => {
                if (chrome.runtime.lastError) {
                    console.error("Error going to next song:", chrome.runtime.lastError.message);
                    return;
                }
                if (playerResponse) {
                    playerResponse.is_playing = true; // Assume playing after action
                    currentPlayer = playerResponse;
                    update_song_info(currentPlayer);
                }
            });
        }
    });
}

function on_toggle_scrobble(): void {
    if (!currentSettings) return;
    sendMessageToServiceWorker<{ cmd: string }, void>({ cmd: 'toggleScrobble' }).then(() => {
        currentSettings!.scrobble = !currentSettings!.scrobble; // Update local state
        render_scrobble_link();
    }).catch(error => console.error("Error toggling scrobble setting:", error));
}

function on_auth(): void {
    sendMessageToServiceWorker<{ cmd: string }, void>({ cmd: 'startWebAuth' })
        .then(() => window.close())
        .catch(error => console.error("Error starting web auth:", error));
}

function on_options(): void {
    chrome.tabs.create({ url: chrome.runtime.getURL('html/options.html') });
    window.close();
}

function on_logout(): void {
    sendMessageToServiceWorker<{ cmd: string }, void>({ cmd: 'clearSession' }).then(() => {
        currentSession = { name: null, key: null }; // Update local state
        render_auth_link();
        $("#love-button").empty(); // Clear love button as session is gone
        $("#lastfm-buttons").hide();
    }).catch(error => console.error("Error logging out:", error));
}

interface LastFmApiResponse {
    error?: number;
    message?: string;
    // other possible fields
}

function on_love(player: PlayerState): void {
    if (!player || !player.song || !currentSettings) return;
    $("#love-button").html('<img src="../img/ajax-loader.gif" alt="Loving...">');
    sendMessageToServiceWorker<{ cmd: string; title: string; artist: string }, LastFmApiResponse>({
        cmd: 'loveTrack',
        title: player.song.title,
        artist: player.song.artist
    }).then(result => {
        if (!result.error) {
            render_love_button(player); // Re-render to show loved state
        } else {
            console.error("Love track API error:", result.message);
            if (result.error === 9 && currentSettings?.error_icon) { // Session expired
                sendMessageToServiceWorker<{ cmd: string }, void>({ cmd: 'clearSession' }).then(() => {
                    currentSession = { name: null, key: null };
                    render_auth_link();
                });
            }
            chrome.action.setIcon({ path: currentSettings.error_icon });
            render_love_button(player); // Re-render to show original state or error
        }
    }).catch(error => {
        console.error('Client-side error loving track:', error);
        render_love_button(player); // Re-render on error
    });
}

function on_unlove(player: PlayerState): void {
    if (!player || !player.song || !currentSettings) return;
    $("#love-button").html('<img src="../img/ajax-loader.gif" alt="Unloving...">');
    sendMessageToServiceWorker<{ cmd: string; title: string; artist: string }, LastFmApiResponse>({
        cmd: 'unloveTrack',
        title: player.song.title,
        artist: player.song.artist
    }).then(result => {
        if (!result.error) {
            render_love_button(player);
        } else {
            console.error("Unlove track API error:", result.message);
            if (result.error === 9 && currentSettings?.error_icon) { // Session expired
                sendMessageToServiceWorker<{ cmd: string }, void>({ cmd: 'clearSession' }).then(() => {
                    currentSession = { name: null, key: null };
                    render_auth_link();
                });
            }
            chrome.action.setIcon({ path: currentSettings.error_icon });
            render_love_button(player);
        }
    }).catch(error => {
        console.error('Client-side error unloving track:', error);
        render_love_button(player);
    });
}

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