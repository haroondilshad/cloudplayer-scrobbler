/**
 * history_parser.js
 * Simple parser to extract and log songs from YouTube Music history page
 */

function extractHistorySongs() {
    const songs = [];
    const sections = document.querySelectorAll('ytmusic-shelf-renderer');
    
    sections.forEach(section => {
        try {
            // Extract the date from the section header
            const dateElement = section.querySelector('.header .title yt-formatted-string');
            const dateText = dateElement ? dateElement.textContent.trim() : 'Unknown Date';
            
            // Get all songs in this section
            const songElements = section.querySelectorAll('ytmusic-responsive-list-item-renderer');
            
            songElements.forEach(element => {
                try {
                    // Extract song title
                    const titleElement = element.querySelector('.title a');
                    const title = titleElement ? titleElement.textContent.trim() : '';
                    
                    // Extract artist
                    const artistElement = element.querySelector('.secondary-flex-columns .flex-column a');
                    const artist = artistElement ? artistElement.textContent.trim() : '';
                    
                    // Extract album
                    const albumElements = element.querySelectorAll('.secondary-flex-columns .flex-column a');
                    const album = albumElements.length > 1 ? albumElements[1].textContent.trim() : '';
                    
                    // Extract duration
                    const durationElement = element.querySelector('.fixed-column[title*="minutes"]');
                    const duration = durationElement ? durationElement.textContent.trim() : '';
                    
                    if (title && artist) {
                        songs.push({
                            title: title,
                            artist: artist,
                            album: album,
                            duration: duration,
                            listenDate: dateText
                        });
                    }
                } catch (error) {
                    console.log('Error parsing song element:', error);
                }
            });
        } catch (error) {
            console.log('Error parsing section:', error);
        }
    });
    
    return songs;
}

// Wait for page to load and then extract songs
setTimeout(() => {
    const songs = extractHistorySongs();
    console.log('Found', songs.length, 'total songs in history');
    
    // Get sync parameters from background
    chrome.runtime.sendMessage({action: 'get_sync_params'}, (response) => {
        const syncFromTimestamp = response.syncFromTimestamp || Date.now();
        const syncFromDate = new Date(syncFromTimestamp);
        
        console.log('Filtering songs from:', syncFromDate.toLocaleDateString());
        
        // Filter songs based on sync date
        const filteredSongs = songs.filter(song => {
            return shouldSyncSong(song, syncFromDate);
        });
        
        console.log('Found', filteredSongs.length, 'songs to sync:');
        filteredSongs.forEach((song, index) => {
            console.log(`${index + 1}. ${song.artist} - ${song.title} (${song.album}) [${song.duration}] - Listened: ${song.listenDate}`);
        });
        
        // Send filtered songs to background script for processing
        if (filteredSongs.length > 0) {
            chrome.runtime.sendMessage({
                action: 'process_history_songs',
                songs: filteredSongs
            });
        } else {
            console.log('No new songs to sync since', syncFromDate.toLocaleDateString());
            chrome.runtime.sendMessage({
                action: 'sync_complete',
                message: 'No new songs to sync'
            });
        }
    });
}, 2000);

/**
 * Determine if a song should be synced based on its date
 */
function shouldSyncSong(song, syncFromDate) {
    const songDate = parseSongDate(song.listenDate);
    
    // If we can't parse the date, default to not syncing (safer)
    if (!songDate) {
        console.log('Could not parse date for song:', song.listenDate);
        return false;
    }
    
    // Only sync songs that are on or after the sync from date
    return songDate >= syncFromDate;
}

/**
 * Parse song listen date to JavaScript Date object
 */
function parseSongDate(dateText) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    switch(dateText.toLowerCase()) {
        case 'today':
            return today;
        case 'yesterday':
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            return yesterday;
        case 'this week':
            // Assume it's from the beginning of this week
            const thisWeek = new Date(today);
            thisWeek.setDate(today.getDate() - today.getDay());
            return thisWeek;
        case 'last week':
            const lastWeek = new Date(today);
            lastWeek.setDate(today.getDate() - today.getDay() - 7);
            return lastWeek;
        default:
            // Try to parse as a specific date (e.g., "January 15, 2025")
            const parsedDate = new Date(dateText);
            if (!isNaN(parsedDate.getTime())) {
                return parsedDate;
            }
            
            // If all else fails, return null
            return null;
    }
} 