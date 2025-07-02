const { parseSongDate, shouldSyncSong } = require('../js/historyUtils');

describe('parseSongDate()', () => {
  const today = new Date();
  today.setHours(0,0,0,0);

  test.each([
    ['Today', today],
    ['today', today],
    ['Yesterday', new Date(today.getTime() - 24*60*60*1000)],
  ])('parses %s correctly', (label, expected) => {
    const d = parseSongDate(label);
    expect(d.getFullYear()).toBe(expected.getFullYear());
    expect(d.getMonth()).toBe(expected.getMonth());
    expect(d.getDate()).toBe(expected.getDate());
  });

  test('parses specific date string', () => {
    const d = parseSongDate('January 15, 2025');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(15);
  });

  test('returns null for unknown label', () => {
    expect(parseSongDate('Some Random Day')).toBeNull();
  });
});

describe('shouldSyncSong()', () => {
  const syncFrom = new Date('2024-01-01');

  test('returns true when song date >= syncFrom', () => {
    const song = { listenDate: 'January 10, 2024' };
    expect(shouldSyncSong(song, syncFrom)).toBe(true);
  });

  test('returns false when song date < syncFrom', () => {
    const song = { listenDate: 'December 25, 2023' };
    expect(shouldSyncSong(song, syncFrom)).toBe(false);
  });

  test('returns false when date cannot be parsed', () => {
    const song = { listenDate: 'Unparseable' };
    expect(shouldSyncSong(song, syncFrom)).toBe(false);
  });
}); 