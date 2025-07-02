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
// declare function find_play_tab(callback: (tab: chrome.tabs.Tab | null) => void): void; // Defined locally in sidebar.ts
declare function open_play_tab(): void;

interface Song {
    artist: string;
    title: string;
    album: string | null;
    cover: string | null;
    duration?: number;
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

interface PopupSettings { // Renaming to SidebarSettings for clarity if needed, but PopupSettings is fine
    scrobble?: boolean;
    error_icon?: string;
}

// Global state variables
var currentPlayer: PlayerState | null = null;
var currentSession: SessionState | null = null;
var currentSettings: PopupSettings | null = null;


// --- Initialization ---
$(document).ready(function() {
    initializePopup(); // Function name kept from original for similarity
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

        if (!currentPlayer) currentPlayer = { has_song: false, is_playing: false, song: { artist: '', title: '', album: null, cover: null }};
        if (!currentSession) currentSession = { name: null, key: null };
        if (!currentSettings) currentSettings = { scrobble: true, error_icon: "../img/main-icon-error.png" };

        chrome.storage.local.get("seen_alert", (result: { [key: string]: any }) => {
            if (chrome.runtime.lastError) console.error("Error getting seen_alert:", chrome.runtime.lastError.message);
            else if (result.seen_alert === undefined) show_alert();
        });

        set_play_link();
        render_song();
        if (currentSession.name && currentSession.key) render_scrobble_link();
        render_auth_link();

        $("#sync-history-btn").click(on_sync_history);
        $("#options-link").click(on_options);

        $("input[name='sync-date']").change(function(this: HTMLInputElement) {
            $("#custom-sync-date").prop('disabled', $(this).val() !== 'custom');
        });

        render_sync_info();

    }).catch(error => {
        console.error('Failed to initialize sidebar:', error);
        $("#song").addClass("nosong").html("Error loading sidebar. <br>Try again or check console.");
    });
}

// --- Communication Helper ---
function sendMessageToServiceWorker<TMessage, TResponse>(message: TMessage): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response: TResponse) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(response);
        });
    });
}

// --- UI Setup ---
function set_play_link(): void {
    $("#cover").click(open_play_tab);
}

// --- Render Functions (largely same as popup.ts, ensure types are consistent) ---
function update_song_info(player: PlayerState): void {
    $("#artist").text(player.song.artist);
    $("#track").text(player.song.title);
    $("#cover").attr({ src: player.song.cover || "../img/defaultcover.png", alt: player.song.album || "Album cover" });
    $("#album").text(player.song.album || "");
    if (currentSession?.name && currentSession?.key) render_love_button(player);
    toggle_play_btn(player);
}

function toggle_play_btn(player: PlayerState): void {
    const play_btn = $("#play-pause-btn");
    play_btn.removeClass().addClass(player.is_playing ? "pause" : "play");
}

function render_song(): void {
    if (currentPlayer && currentPlayer.has_song) {
        update_song_info(currentPlayer);
        $("#play-pause-btn").click(toggle_play);
        $("#next-btn").click(next_song);
        $("#prev-btn").click(prev_song);
        $("#lastfm-buttons").toggle(!!(currentSession?.name && currentSession?.key));
        $("#player-controls").show();
    } else {
        $("#song").addClass("nosong");
        $("#artist").text("");
        $("#track").html('No song playing or detected.');
        $("#cover").attr({ src: "../img/defaultcover.png", alt: "No song" });
        $("#lastfm-buttons, #player-controls").hide();
    }
}

function render_scrobble_link(): void {
    if (!currentSettings) return;
    $("#scrobbling").html('<a></a>').find('a')
        .attr("href", "#")
        .click(on_toggle_scrobble)
        .text(currentSettings.scrobble ? "Stop scrobbling" : "Resume scrobbling");
}

function render_auth_link(): void {
    if (currentSession?.name && currentSession?.key) {
        render_scrobble_link();
        $("#lastfm-profile").html(`Logged in as <a href="http://last.fm/user/${currentSession.name}" target="_blank">${currentSession.name}</a><a href="#" title="Logout" class="logout"></a>`)
            .find("a.logout").click(on_logout);
    } else {
        $("#scrobbling").empty();
        $("#lastfm-profile").html('<a></a>').find('a')
            .attr("href", "#")
            .click(on_auth)
            .text("Connect to Last.fm");
    }
}

function render_love_button(player: PlayerState): void {
    if (!player?.song) return;
    $("#love-button").html('<img src="../img/ajax-loader.gif" alt="Loading...">');
    sendMessageToServiceWorker<{ cmd: string; title: string; artist: string }, boolean>(
        { cmd: 'isTrackLoved', title: player.song.title, artist: player.song.artist }
    ).then(isLoved => {
        $("#love-button").html('<a href="#"></a>').find('a')
            .attr({ title: isLoved ? "Unlove this song" : "Love this song" })
            .click(() => isLoved ? on_unlove(player) : on_love(player))
            .addClass(isLoved ? "loved" : "notloved");
    }).catch(error => {
        console.error('Error checking if track is loved:', error);
        $("#love-button").html('<span class="error-text">Error</span>');
    });
}

// --- Event Handlers (ensure types and functionality match popup.ts where applicable) ---
function toggle_play(): void {
    const has_song = currentPlayer?.has_song;
    find_play_tab((tab) => {
        if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, { cmd: "tgl" }, (playerResponse?: PlayerState) => {
                if (chrome.runtime.lastError) return console.error("Error toggling play:", chrome.runtime.lastError.message);
                if (playerResponse) {
                    currentPlayer = playerResponse;
                    if (has_song) toggle_play_btn(currentPlayer);
                    else { update_song_info(currentPlayer); toggle_play_btn(currentPlayer); }
                }
            });
        }
    });
}

function prev_song(): void {
    find_play_tab((tab) => {
        if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, { cmd: "prv" }, (playerResponse?: PlayerState) => {
                if (chrome.runtime.lastError) return console.error("Error prev song:", chrome.runtime.lastError.message);
                if (playerResponse) {
                    playerResponse.is_playing = true;
                    currentPlayer = playerResponse;
                    update_song_info(currentPlayer);
                }
            });
        }
    });
}

function next_song(): void {
    find_play_tab((tab) => {
        if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, { cmd: "nxt" }, (playerResponse?: PlayerState) => {
                if (chrome.runtime.lastError) return console.error("Error next song:", chrome.runtime.lastError.message);
                if (playerResponse) {
                    playerResponse.is_playing = true;
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
        currentSettings!.scrobble = !currentSettings!.scrobble;
        render_scrobble_link();
    }).catch(error => console.error("Error toggling scrobble:", error));
}

function on_auth(): void {
    sendMessageToServiceWorker<{ cmd: string }, void>({ cmd: 'startWebAuth' })
        .catch(error => console.error("Error starting web auth:", error));
    // No window.close() for sidebar
}

function on_options(): void {
    chrome.tabs.create({ url: chrome.runtime.getURL('html/options.html') });
    // No window.close() for sidebar
}

function on_logout(): void {
    sendMessageToServiceWorker<{ cmd: string }, void>({ cmd: 'clearSession' }).then(() => {
        currentSession = { name: null, key: null };
        render_auth_link();
        $("#love-button").empty();
        $("#lastfm-buttons").hide();
    }).catch(error => console.error("Error logging out:", error));
}

interface LastFmApiResponse { error?: number; message?: string; }

function on_love(player: PlayerState): void {
    if (!player?.song || !currentSettings) return;
    $("#love-button").html('<img src="../img/ajax-loader.gif" alt="Loving...">');
    sendMessageToServiceWorker<{ cmd: string; title: string; artist: string }, LastFmApiResponse | undefined>(
        { cmd: 'loveTrack', title: player.song.title, artist: player.song.artist }
    ).then(result => {
        if (result && !result.error) render_love_button(player);
        else {
            console.error("Love track API error:", result?.message);
            if (result?.error === 9 && currentSettings?.error_icon) {
                sendMessageToServiceWorker<{ cmd: string }, void>({ cmd: 'clearSession' })
                    .then(() => { currentSession = { name: null, key: null }; render_auth_link(); });
            }
            if(currentSettings?.error_icon) chrome.action.setIcon({ path: currentSettings.error_icon });
            render_love_button(player);
        }
    }).catch(error => { console.error('Client error loving track:', error); render_love_button(player); });
}

function on_unlove(player: PlayerState): void {
    if (!player?.song || !currentSettings) return;
    $("#love-button").html('<img src="../img/ajax-loader.gif" alt="Unloving...">');
    sendMessageToServiceWorker<{ cmd: string; title: string; artist: string }, LastFmApiResponse | undefined>(
        { cmd: 'unloveTrack', title: player.song.title, artist: player.song.artist }
    ).then(result => {
        if (result && !result.error) render_love_button(player);
        else {
            console.error("Unlove track API error:", result?.message);
            if (result?.error === 9 && currentSettings?.error_icon) {
                sendMessageToServiceWorker<{ cmd: string }, void>({ cmd: 'clearSession' })
                    .then(() => { currentSession = { name: null, key: null }; render_auth_link(); });
            }
            if(currentSettings?.error_icon) chrome.action.setIcon({ path: currentSettings.error_icon });
            render_love_button(player);
        }
    }).catch(error => { console.error('Client error unloving track:', error); render_love_button(player); });
}

function show_alert(): void {
    $("#alert").removeClass("hidden");
    $("#extns_link").click(() => sendMessageToServiceWorker<{ cmd: string }, void>({ cmd: 'openExtensionsPage' })
        .catch(err => console.error("Error opening extensions page", err)));
    $("#dismiss_alert").click(() => {
        $("#alert").addClass("hidden");
        chrome.storage.local.set({ "seen_alert": "1" },
            () => { if (chrome.runtime.lastError) console.error("Error setting seen_alert:", chrome.runtime.lastError.message); });
    });
}

function render_sync_info(): void {
    chrome.storage.local.get('last_history_sync', (result: { [key: string]: any }) => {
        if (chrome.runtime.lastError) return console.error("Error getting last_history_sync:", chrome.runtime.lastError.message);
        const lastSyncTimestamp = result.last_history_sync;
        if (lastSyncTimestamp) {
            const lastSyncDate = new Date(parseInt(lastSyncTimestamp, 10));
            const dateStr = `${lastSyncDate.toLocaleDateString()} ${lastSyncDate.toLocaleTimeString()}`;
            $("#sync-status").html(`Last sync: ${dateStr}`).removeClass('hidden error info').addClass('success');
            $("label[for='sync-from-now']").text(`Since last sync (${lastSyncDate.toLocaleDateString()})`);
        } else {
            $("label[for='sync-from-now']").text('Since last sync (never)');
            $("#sync-status").addClass('hidden');
        }
    });
}

function on_sync_history(): void {
    const syncOption = $("input[name='sync-date']:checked").val() as string | undefined;
    let syncFromDateTimestamp: number;

    if (syncOption === 'custom') {
        const customDateStr = ($("#custom-sync-date").val() as string | undefined)?.trim();
        if (!customDateStr) return alert('Please select a custom date.');
        syncFromDateTimestamp = new Date(customDateStr).getTime();
        if (isNaN(syncFromDateTimestamp)) return alert('Invalid custom date selected.');
    } else {
        chrome.storage.local.get('last_history_sync', (result: { [key: string]: any }) => {
            if (chrome.runtime.lastError) {
                console.error("Error getting last_history_sync for sync:", chrome.runtime.lastError.message);
                return alert("Could not retrieve last sync time. Please try again.");
            }
            syncFromDateTimestamp = result.last_history_sync ? parseInt(result.last_history_sync, 10) : Date.now();
            performHistorySync(syncFromDateTimestamp);
        });
        return; // Exits because performHistorySync is called in async callback
    }
    performHistorySync(syncFromDateTimestamp);
}

function performHistorySync(syncFromTimestamp: number): void {
    $("#sync-history-btn").prop('disabled', true).text('Syncing...');
    $("#sync-status").html('Preparing sync...').removeClass('hidden success error').addClass('info');

    sendMessageToServiceWorker<{ cmd: string; syncFromDate: number }, void>(
        { cmd: 'startHistorySync', syncFromDate: syncFromTimestamp }
    ).then(() => {
        chrome.tabs.create({ url: 'https://music.youtube.com/history' });
        // No window.close() for sidebar
    }).catch(error => {
        console.error("Error starting history sync:", error);
        $("#sync-history-btn").prop('disabled', false).text('Sync History');
        $("#sync-status").html('Error starting sync. Check console.').removeClass('hidden info success').addClass('error');
    });
}

// --- Sidebar Specific find_play_tab and Listener ---
function find_play_tab(callback: (tab: chrome.tabs.Tab | null) => void): void {
    chrome.tabs.query({ url: ["*://play.google.com/music/listen*", "*://music.youtube.com/*"] }, (tabs) => {
        if (chrome.runtime.lastError) {
            console.error("Error querying tabs:", chrome.runtime.lastError.message);
            callback(null);
            return;
        }
        if (tabs && tabs.length > 0) {
            const playTab = tabs.find(t => t.audible) || tabs.find(t => t.active && !t.incognito) || tabs.find(t=> !t.incognito) || tabs[0];
            callback(playTab || null);
        } else {
            console.log("No music tab found for sidebar.");
            callback(null);
        }
    });
}

interface ExtensionMessage {
    type: 'PLAYER_STATE_UPDATED' | 'SESSION_UPDATED' | 'SETTINGS_UPDATED' | 'HISTORY_SYNC_COMPLETE' | 'HISTORY_SYNC_UPDATE';
    player?: PlayerState;
    session?: SessionState;
    settings?: PopupSettings;
    statusText?: string;
    statusType?: 'success' | 'error' | 'info';
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void): boolean | void => {
    if (sender.id !== chrome.runtime.id) return; // Only process messages from own extension (e.g. service worker)

    switch (message.type) {
        case 'PLAYER_STATE_UPDATED':
            if (message.player) {
                currentPlayer = message.player;
                render_song();
            }
            break;
        case 'SESSION_UPDATED':
            if (message.session) {
                currentSession = message.session;
                render_auth_link();
                if (currentPlayer?.has_song) render_love_button(currentPlayer);
            }
            break;
        case 'SETTINGS_UPDATED':
            if (message.settings) {
                currentSettings = message.settings;
                render_scrobble_link();
            }
            break;
        case 'HISTORY_SYNC_COMPLETE':
        case 'HISTORY_SYNC_UPDATE':
            $("#sync-history-btn").prop('disabled', false).text('Sync History');
            if (message.statusText) {
                $("#sync-status").html(message.statusText).removeClass('hidden info error success').addClass(message.statusType || 'info');
            }
            render_sync_info();
            break;
    }
    // return true; // If you need to send an async response from here, though not typical for these updates
});
