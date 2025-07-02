/**
 * lastfm.ts
 * Last.fm authorization and scrobbling XHR requests
 * Copyright (c) 2011 Alexey Savartsov <asavartsov@gmail.com>
 * Licensed under the MIT license
 */

// Assume hex_md5 is globally available from md5.ts
declare function hex_md5(s: string): string;

interface LastFMSession {
    key?: string;
    name?: string;
}

interface RequestParams {
    [key: string]: string | number | undefined; // Allow undefined for optional params
    api_key: string;
    method: string;
    format?: string;
    api_sig?: string;
    sk?: string; // Session key
}

// Simplified interfaces for Last.fm API responses (can be expanded)
interface AuthSessionResponse {
    session: {
        key: string;
        name: string;
        subscriber: string; // Actually a number string "0" or "1"
    };
}

interface TrackInfoResponse {
    track?: {
        userloved?: string; // Actually "0" or "1"
        // other track properties
    };
    error?: number;
    message?: string;
}

interface ScrobbleResponse {
    scrobbles?: {
        '@attr': { accepted: number; ignored: number };
        scrobble: any; // Can be a single object or array of objects
    };
    error?: number;
    message?: string;
}

interface NowPlayingResponse {
    nowplaying?: any; // Structure can vary
    error?: number;
    message?: string;
}

interface LoveResponse {
    error?: number;
    message?: string;
    // Successful love has no body, just 200 OK
}


class LastFM {
    private API_KEY: string;
    private API_SECRET: string;
    private API_ROOT: string = "http://ws.audioscrobbler.com/2.0/";
    public session: LastFMSession = {};

    constructor(api_key?: string, api_secret?: string) {
        this.API_KEY = api_key || "";
        this.API_SECRET = api_secret || "";
    }

    public authorize(token: string, callback: (reply?: AuthSessionResponse) => void): void {
        const params: RequestParams = {
            api_key: this.API_KEY,
            method: "auth.getSession",
            token: token
        };

        params.api_sig = this._req_sign(params);
        params.format = "json";

        this._xhr<AuthSessionResponse>("GET", params, (reply) => {
            if (reply && reply.session) {
                this.session.key = reply.session.key;
                this.session.name = reply.session.name;
                callback(reply);
            } else {
                callback();
            }
        });
    }

    public now_playing(track: string, artist: string, album: string | null, duration: number, callback: (result?: NowPlayingResponse) => void): void {
        const params: RequestParams = {
            api_key: this.API_KEY,
            method: "track.updateNowPlaying",
            track: track,
            artist: artist,
            duration: duration,
            album: album || "",
            sk: this.session.key
        };

        params.api_sig = this._req_sign(params);
        params.format = "json";

        this._xhr<NowPlayingResponse>("POST", params, callback);
    }

    public scrobble(artist: string, album_artist: string | null, album: string | null, track: string,
                    timestamp: number, callback: (result?: ScrobbleResponse) => void): void {
        const params: RequestParams = {
            api_key: this.API_KEY,
            method: "track.scrobble",
            track: track,
            timestamp: timestamp,
            artist: artist,
            albumArtist: album_artist || artist, // Fallback to artist if album_artist is null
            album: album || "",
            sk: this.session.key
        };

        params.api_sig = this._req_sign(params);
        params.format = "json";

        this._xhr<ScrobbleResponse>("POST", params, callback);
    }

    public love_track(track: string, artist: string, callback: (result?: LoveResponse) => void): void {
        const params: RequestParams = {
            api_key: this.API_KEY,
            method: "track.love",
            track: track,
            artist: artist,
            sk: this.session.key
        };

        params.api_sig = this._req_sign(params);
        params.format = "json"; // Though not strictly needed for response, good for consistency

        this._xhr<LoveResponse>("POST", params, callback);
    }

    public unlove_track(track: string, artist: string, callback: (result?: LoveResponse) => void): void {
        const params: RequestParams = {
            api_key: this.API_KEY,
            method: "track.unlove",
            track: track,
            artist: artist,
            sk: this.session.key
        };

        params.api_sig = this._req_sign(params);
        params.format = "json"; // For consistency

        this._xhr<LoveResponse>("POST", params, callback);
    }

    public is_track_loved(track: string, artist: string, callback: (isLoved: boolean) => void): void {
        if (!this.session.name) {
            callback(false);
            return;
        }

        const params: RequestParams = {
            api_key: this.API_KEY,
            method: "track.getInfo",
            track: track,
            artist: artist,
            username: this.session.name,
            format: 'json'
        };
        // No signature needed for track.getInfo if session key not provided

        this._xhr<TrackInfoResponse>("GET", params, (result) => {
            if (result && !result.error && result.track) {
                callback(result.track.userloved === "1");
            } else {
                callback(false);
            }
        });
    }

    private _req_sign(params: RequestParams): string {
        const keys: string[] = [];
        let key: string;
        let signature: string = "";

        for (key in params) {
            if (params.hasOwnProperty(key) && params[key] !== undefined) {
                 // Filter out format and api_sig itself if present, though usually not
                if (key !== 'format' && key !== 'api_sig') {
                    keys.push(key);
                }
            }
        }

        keys.sort(); // Sort keys alphabetically

        for (const sortedKey of keys) {
            signature += sortedKey + String(params[sortedKey]);
        }

        signature += this.API_SECRET;
        return hex_md5(signature);
    }

    private _xhr<T>(method: "GET" | "POST", params: RequestParams, callback: (reply: T | null) => void): void {
        let uri = this.API_ROOT;
        const _paramsArray: string[] = [];

        for (const paramName in params) {
            if (params.hasOwnProperty(paramName) && params[paramName] !== undefined) {
                _paramsArray.push(encodeURIComponent(paramName) + "=" + encodeURIComponent(String(params[paramName])));
            }
        }

        const queryString = _paramsArray.join('&');

        const fetchOptions: RequestInit = {
            method: method,
            headers: {
                "If-Modified-Since": "Thu, 01 Jun 1970 00:00:00 GMT", // Prevent caching
                "Pragma": "no-cache" // Prevent caching
            }
        };

        if (method === "GET") {
            uri += '?' + queryString.replace(/%20/g, '+'); // Some APIs expect + for space
        } else if (method === "POST") {
            fetchOptions.headers = {
                ...fetchOptions.headers,
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
            };
            fetchOptions.body = queryString;
        } else {
            // Should not happen with current typings
            console.error("Unsupported HTTP method:", method);
            callback(null);
            return;
        }

        fetch(uri, fetchOptions)
            .then(response => {
                if (!response.ok) {
                    // Log HTTP errors that are not network errors
                    console.error(`HTTP error! Status: ${response.status} for ${params.method}`, response);
                    // Try to parse error body if present
                    return response.text().then(text => {
                        try {
                            const errorReply = JSON.parse(text) as T; // Attempt to parse as T
                            callback(errorReply); // Send parsed error if possible
                        } catch (e) {
                            callback(null); // If body isn't JSON or unparseable
                        }
                    });
                }
                // For successful "love" and "unlove" which might return 200 OK with no body or non-JSON
                if (response.status === 200 && (params.method === "track.love" || params.method === "track.unlove")) {
                    // Check if content type is JSON before trying to parse
                    const contentType = response.headers.get("content-type");
                    if (contentType && contentType.includes("application/json")) {
                        return response.json() as Promise<T>;
                    }
                    // If not JSON, resolve with a generic success object or null.
                    // For love/unlove, Last.fm often returns an empty body for success.
                    // We can cast an empty object or handle as per API specifics.
                    callback({} as T); // Or specific success indicator if appropriate
                    return null; // Stop further processing in this chain
                }
                return response.json() as Promise<T>;
            })
            .then(data => {
                if (data === null) return; // Already handled by non-JSON response in previous .then

                // Check for Last.fm specific API errors within the JSON response
                const apiError = (data as any)?.error;
                if (apiError) {
                    console.log(`Last.fm API error for ${params.method}: ${apiError} - ${(data as any)?.message}`);
                }
                callback(data);
            })
            .catch(error => {
                console.error(`Fetch network error for ${params.method}:`, error);
                callback(null);
            });
    }
}
