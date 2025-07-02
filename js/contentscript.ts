/**
 * contentscript.ts
 * Parses Google Play Music player page and transmits song information to background page
 * Copyright (c) 2011 Alexey Savartsov, <asavartsov@gmail.com>, Brad Lambeth <brad@lambeth.us>
 * Licensed under the MIT license
 */

// --- Declarations and Interfaces ---
declare var $: any; // jQuery, assuming it's injected by manifest or another script.
declare var SETTINGS: { refresh_interval: number; /* other settings if used */ }; // Assuming SETTINGS is made available

interface SongDetails {
    position: number | null;
    time: number | null; // Duration
    title: string | null;
    artist: string | null;
    album_artist: string | null;
    album: string | null;
    cover: string | null;
}

interface IPlayerState {
    has_song: boolean;
    is_playing: boolean;
    song: SongDetails;
    // Add timestamp for when this state was captured, if helpful for background
    timestamp?: number;
}

interface IMusicParser {
    _get_has_song(): boolean;
    _get_is_playing(): boolean;
    _get_song_position(): number | null;
    _get_song_time(): number | null;
    _get_song_title(): string | null;
    _get_song_artist(): string | null;
    _get_album_artist(): string | null;
    _get_song_album(): string | null;
    _get_song_cover(): string | null;
}

// --- Player Class ---
class Player implements IPlayerState {
    public has_song: boolean;
    public is_playing: boolean;
    public song: SongDetails;
    public timestamp: number;

    constructor(parser: IMusicParser) {
        this.has_song = parser._get_has_song();
        this.is_playing = parser._get_is_playing();
        this.song = {
            position: parser._get_song_position(),
            time: parser._get_song_time(),
            title: parser._get_song_title(),
            artist: parser._get_song_artist(),
            album_artist: parser._get_album_artist(),
            album: parser._get_song_album(),
            cover: parser._get_song_cover()
        };
        this.timestamp = Date.now();
    }
}

// --- GoogleMusicParser Class ---
class GoogleMusicParser implements IMusicParser {
    constructor() {
        // Initialization if needed
    }

    _get_has_song(): boolean {
        return $("#playerSongInfo").children().length > 0;
    }

    _get_is_playing(): boolean {
        let play_btn = $(".material-player-middle paper-icon-button[data-id='play-pause']");
        if (play_btn.length === 0) {
            play_btn = $(".material-player-middle sj-icon-button[data-id='play-pause']");
        }
        return play_btn.hasClass("playing");
    }

    _get_song_position(): number | null {
        const time_str = $("#time_container_current").text();
        const parts = $.trim(time_str).split(':').map(Number);
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return null;
    }

    _get_song_time(): number | null { // Duration
        const time_str = $("#time_container_duration").text();
        const parts = $.trim(time_str).split(':').map(Number);
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return null;
    }

    _get_song_title(): string | null {
        return $("#currently-playing-title").text() || null;
    }

    _get_song_artist(): string | null {
        return $("#player-artist").text() || null;
    }

    _get_album_artist(): string | null {
        const album_artist_attr = $("#playerSongInfo .player-album").attr('data-id');
        if (album_artist_attr) {
            try {
                return decodeURIComponent(album_artist_attr.split('/')[1].replace(/\+/g, ' '));
            } catch (e) { return null; }
        }
        return null;
    }

    _get_song_cover(): string | null {
        return $("#playerBarArt").attr("src") || null;
    }

    _get_song_album(): string | null {
        return $("#playerSongInfo .player-album").text() || null;
    }
}

// --- Script Logic ---
var port: chrome.runtime.Port | null = null;
const RECONNECT_DELAY = 5000; // 5 seconds

function connectToBackground(): void {
    try {
        port = chrome.runtime.connect({ name: "gmusic_content_script" });

        port.onDisconnect.addListener(() => {
            if (chrome.runtime.lastError) {
                console.warn('GMusic CS: Port disconnected:', chrome.runtime.lastError.message);
            } else {
                console.log('GMusic CS: Port disconnected.');
            }
            port = null; // Clear the port variable
            setTimeout(connectToBackground, RECONNECT_DELAY);
        });
        console.log('GMusic CS: Connected to background.');
    } catch (error: any) {
        console.warn('GMusic CS: Failed to connect, retrying...', error.message);
        setTimeout(connectToBackground, RECONNECT_DELAY);
    }
}

function sendPlayerUpdate(): void {
    if (!port) {
        // console.warn("GMusic CS: Port not connected. Attempting to reconnect before sending update.");
        // connectToBackground(); // Attempt to connect immediately if port is lost
        // It might be better to just wait for the standard reconnect logic to kick in.
        return;
    }
    try {
        const parser = new GoogleMusicParser();
        const playerState = new Player(parser);
        port.postMessage(playerState);
    } catch (error: any) {
        console.warn('GMusic CS: Error sending player update:', error.message);
        // If postMessage fails, the port is likely invalid.
        // The onDisconnect listener should handle reconnection.
        if (port && error.message.includes("Attempting to use a disconnected port object")) {
             port = null; // Ensure it's nullified so connectToBackground tries again
             connectToBackground();
        }
    }
}

// Initial connection
connectToBackground();

// Send player updates at regular intervals
// Ensure SETTINGS is available or provide a default.
const refreshIntervalMs = (typeof SETTINGS !== 'undefined' && SETTINGS.refresh_interval ? SETTINGS.refresh_interval : 2) * 1000;
window.setInterval(sendPlayerUpdate, refreshIntervalMs);

// --- Message Listeners for Player Controls ---
interface PlayerControlMessage {
    cmd: "tgl" | "prv" | "nxt";
}

function handlePlayerControlMessage(
    msg: PlayerControlMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: IPlayerState) => void
): boolean {
    let selector: string = "";
    switch (msg.cmd) {
        case "tgl":
            selector = ".material-player-middle paper-icon-button[data-id='play-pause'], .material-player-middle sj-icon-button[data-id='play-pause']";
            break;
        case "prv":
            selector = ".material-player-middle paper-icon-button[data-id='rewind'], .material-player-middle sj-icon-button[data-id='rewind']";
            break;
        case "nxt":
            selector = ".material-player-middle paper-icon-button[data-id='forward'], .material-player-middle sj-icon-button[data-id='forward']";
            break;
        default:
            return false; // Not our message
    }

    const button = $(selector);
    if (button.length > 0) {
        button.click();
        // Wait a little for the UI to update before sending a response
        setTimeout(() => {
            sendResponse(new Player(new GoogleMusicParser()));
        }, 150); // Increased delay slightly
        return true; // Indicates asynchronous response
    }
    return false;
}

// Add a single listener that delegates based on msg.cmd
chrome.runtime.onMessage.addListener(
    (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void): boolean | undefined => {
        if (message && (message.cmd === "tgl" || message.cmd === "prv" || message.cmd === "nxt")) {
            return handlePlayerControlMessage(message as PlayerControlMessage, sender, sendResponse);
        }
        // If not handled, return undefined (or false) to close the channel for other listeners.
        return undefined;
    }
);

console.log("Google Music Content Script Loaded");
