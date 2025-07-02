/**
 * ytm_contentscript.ts
 * Parses YouTube Music player page and transmits song information to background page
 * Based on contentscripts.js by Alexey Savartsov & Brad Lambeth
 * Licensed under the MIT license
 */

// --- Declarations and Interfaces ---
declare var $: any; // jQuery
declare var SETTINGS: { refresh_interval: number; /* other settings if used */ };

// Re-using interfaces from contentscript.ts or defining them here if they are standalone.
// For simplicity, let's assume they are similar enough to be declared here.
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

// --- Player Class (same as in contentscript.ts) ---
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
            album_artist: parser._get_album_artist(), // May often be same as artist for YTM
            album: parser._get_song_album(),
            cover: parser._get_song_cover()
        };
        this.timestamp = Date.now();
    }
}

// --- YtMusicParser Class ---
class YtMusicParser implements IMusicParser {
    constructor() {
        // Initialization if needed
    }

    _get_has_song(): boolean {
        return ($("yt-formatted-string.title.ytmusic-player-bar").text() || "").length > 0;
    }

    _get_is_playing(): boolean {
        // YouTube Music appends " - YouTube Music" or similar to the tab title when playing.
        // More reliably, check the play/pause button's aria-label or title.
        // The play button usually has a title like "Play" when paused, and "Pause" when playing.
        const playPauseButton = $("#play-pause-button"); // Standard YTM player bar play/pause button
        const title = playPauseButton.attr("title") || playPauseButton.attr("aria-label");
        return title === "Pause"; // If the button's action is "Pause", it means music is playing.
    }

    _get_song_position(): number | null {
        const timeParts = ($("span.time-info.ytmusic-player-bar").text() || "").split("/");
        if (timeParts.length < 1) return null;
        const currentTimeStr = $.trim(timeParts[0]);
        const timeArr = currentTimeStr.split(':').map(Number);
        if (timeArr.length === 2) return timeArr[0] * 60 + timeArr[1];
        if (timeArr.length === 3) return timeArr[0] * 3600 + timeArr[1] * 60 + timeArr[2];
        return null;
    }

    _get_song_time(): number | null { // Duration
        const timeParts = ($("span.time-info.ytmusic-player-bar").text() || "").split("/");
        if (timeParts.length < 2) return null;
        const durationStr = $.trim(timeParts[1]);
        const timeArr = durationStr.split(':').map(Number);
        if (timeArr.length === 2) return timeArr[0] * 60 + timeArr[1];
        if (timeArr.length === 3) return timeArr[0] * 3600 + timeArr[1] * 60 + timeArr[2];
        return null;
    }

    _get_song_title(): string | null {
        return $("yt-formatted-string.title.ytmusic-player-bar").attr('title') || $("yt-formatted-string.title.ytmusic-player-bar").text() || null;
    }

    _get_song_artist(): string | null {
        // Artist is usually the first link in the subtitle, but can also be plain text.
        // Prioritize links, then general text.
        const artistLinks = $("span.subtitle.ytmusic-player-bar yt-formatted-string a.ytmusic-player-bar");
        if (artistLinks.length > 0) return $(artistLinks[0]).text() || null;

        // Fallback for cases where artist isn't a link (e.g. some mixes or uploads)
        const subtitleText = $("span.subtitle.ytmusic-player-bar yt-formatted-string.ytmusic-player-bar").text();
        // This might need more complex parsing if there are multiple non-linked items (artist, album, year)
        // For now, assume the first part before potential separators (like '•') is the artist.
        return subtitleText.split('•')[0].trim() || null;
    }

    _get_album_artist(): string | null {
        // YTM often doesn't explicitly distinguish album artist from track artist in the main player UI.
        // For simplicity, returning track artist. This could be enhanced if specific metadata is found.
        return this._get_song_artist();
    }

    _get_song_cover(): string | null {
        let coverUrl = $("img.image.ytmusic-player-bar").attr("src");
        // YTM sometimes serves //lh3.googleusercontent.com/... which needs https:
        if (coverUrl && coverUrl.startsWith("//")) {
            coverUrl = "https:" + coverUrl;
        }
        return coverUrl || null;
    }

    _get_song_album(): string | null {
        const subtitleLinks = $("span.subtitle.ytmusic-player-bar yt-formatted-string a.ytmusic-player-bar");
        // Album is often the second link, or the last if only one link (artist) or more (artist, uploader)
        if (subtitleLinks.length > 1) { // If there are multiple links, assume one is artist, another is album
            return $(subtitleLinks[subtitleLinks.length -1]).text() || null; // Take the last link as a guess for album
        } else if (subtitleLinks.length === 0) { // No links, try to parse from full subtitle text
            const subtitleText = $("span.subtitle.ytmusic-player-bar yt-formatted-string.ytmusic-player-bar").text();
            const parts = subtitleText.split('•');
            if (parts.length > 1) return parts[1].trim() || null; // Second part if available
        }
        // If only one link (artist) or complex case, this might not find album correctly.
        return null;
    }
}

// --- Script Logic (similar to contentscript.ts) ---
var port: chrome.runtime.Port | null = null;
const YTM_RECONNECT_DELAY = 5000;

function connectToBackground(): void {
    try {
        port = chrome.runtime.connect({ name: "ytm_content_script" });
        port.onDisconnect.addListener(() => {
            if (chrome.runtime.lastError) console.warn('YTM CS: Port disconnected:', chrome.runtime.lastError.message);
            else console.log('YTM CS: Port disconnected.');
            port = null;
            setTimeout(connectToBackground, YTM_RECONNECT_DELAY);
        });
        console.log('YTM CS: Connected to background.');
    } catch (error: any) {
        console.warn('YTM CS: Failed to connect, retrying...', error.message);
        setTimeout(connectToBackground, YTM_RECONNECT_DELAY);
    }
}

function sendPlayerUpdate(): void {
    if (!port) return;
    try {
        const parser = new YtMusicParser();
        const playerState = new Player(parser);
        port.postMessage(playerState);
    } catch (error: any) {
        console.warn('YTM CS: Error sending player update:', error.message);
        if (port && error.message.includes("Attempting to use a disconnected port object")) {
             port = null;
             connectToBackground();
        }
    }
}

connectToBackground();

const ytmRefreshIntervalMs = (typeof SETTINGS !== 'undefined' && SETTINGS.refresh_interval ? SETTINGS.refresh_interval : 2) * 1000;
window.setInterval(sendPlayerUpdate, ytmRefreshIntervalMs);

// --- Message Listeners for Player Controls ---
interface PlayerControlMessage {
    cmd: "tgl" | "prv" | "nxt";
}

function handleYtmPlayerControlMessage(
    msg: PlayerControlMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: IPlayerState) => void
): boolean {
    let buttonSelector: string = "";
    switch (msg.cmd) {
        case "tgl":
            buttonSelector = "#play-pause-button"; // Standard YTM play/pause
            break;
        case "prv":
            buttonSelector = ".previous-button"; // Standard YTM previous
            break;
        case "nxt":
            buttonSelector = ".next-button"; // Standard YTM next
            break;
        default:
            return false;
    }

    const button = $(buttonSelector);
    if (button.length > 0) {
        button.click();
        setTimeout(() => {
            sendResponse(new Player(new YtMusicParser()));
        }, 150);
        return true;
    }
    console.warn(`YTM CS: Control button not found for command "${msg.cmd}" with selector "${buttonSelector}"`);
    return false;
}

chrome.runtime.onMessage.addListener(
    (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void): boolean | undefined => {
        if (message && (message.cmd === "tgl" || message.cmd === "prv" || message.cmd === "nxt")) {
            return handleYtmPlayerControlMessage(message as PlayerControlMessage, sender, sendResponse);
        }
        return undefined;
    }
);

console.log("YouTube Music Content Script Loaded");
