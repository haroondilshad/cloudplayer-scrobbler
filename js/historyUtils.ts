// js/historyUtils.js
// Utilities related to history-sync date handling.
(function (global) {
  'use strict';

  /**
   * Convert label from YT Music history ("Today", "Yesterday", etc.) to Date.
   * If parsing fails returns null.
   */
  function parseSongDate(dateText) {
    if (!dateText) return null;
    const txt = dateText.toLowerCase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    switch (txt) {
      case 'today':
        return new Date(today);
      case 'yesterday':
        return new Date(today.getTime() - 24 * 60 * 60 * 1000);
      case 'this week': {
        const d = new Date(today);
        d.setDate(today.getDate() - today.getDay()); // start of week (Sun)
        return d;
      }
      case 'last week': {
        const d = new Date(today);
        d.setDate(today.getDate() - today.getDay() - 7);
        return d;
      }
      default: {
        const parsed = new Date(dateText);
        return isNaN(parsed.getTime()) ? null : parsed;
      }
    }
  }

  /**
   * Decide whether a song (with given listenDate label) should be synced.
   * @param {{listenDate:string}} song
   * @param {Date} syncFromDate – inclusive lower bound
   */
  function shouldSyncSong(song, syncFromDate) {
    const d = parseSongDate(song.listenDate);
    if (!d) return false;
    return d >= syncFromDate;
  }

  const api = { parseSongDate, shouldSyncSong };
  global.historyUtils = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof self !== 'undefined' ? self : this); 