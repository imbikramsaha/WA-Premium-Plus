import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { firstOccurrence, nextOccurrence, occurrencesBetween } from '../src/shared/schedule.ts';
import { formatWallTime, instantIn, parseWallTime, wallTimeIn, zoneForPhone } from '../src/shared/timezones.ts';

describe('time zones', () => {
  it('guesses a zone from the country calling code', () => {
    assert.deepEqual(zoneForPhone('447700900123@s.whatsapp.net'), { zone: 'Europe/London', uncertain: false });
    assert.deepEqual(zoneForPhone('+91 98765 43210'), { zone: 'Asia/Kolkata', uncertain: false });
    assert.deepEqual(zoneForPhone('8801712614961@s.whatsapp.net'), { zone: 'Asia/Dhaka', uncertain: false });
    assert.deepEqual(zoneForPhone('12125550123'), { zone: 'America/New_York', uncertain: true });
    assert.deepEqual(zoneForPhone('77012345678'), { zone: 'Asia/Almaty', uncertain: false });
    assert.equal(zoneForPhone('120363000000000001@g.us'), undefined);
    assert.equal(zoneForPhone('123456789012345@lid'), undefined);
  });

  it('converts wall-clock time in a zone, including daylight-saving changes', () => {
    // London is UTC+0 in winter and UTC+1 in summer.
    assert.equal(parseWallTime('2026-01-15T09:00', 'Europe/London'), Date.UTC(2026, 0, 15, 9));
    assert.equal(parseWallTime('2026-07-15T09:00', 'Europe/London'), Date.UTC(2026, 6, 15, 8));
    assert.equal(parseWallTime('2026-07-15T09:00', 'Asia/Kolkata'), Date.UTC(2026, 6, 15, 3, 30));
    // 02:30 doesn't exist in New York on 8 March 2026: it becomes 03:30 (EDT, UTC-4).
    assert.equal(instantIn({ year: 2026, month: 2, day: 8, hour: 2, minute: 30, second: 0 }, 'America/New_York'), Date.UTC(2026, 2, 8, 7, 30));
    // 01:30 happens twice on 1 November 2026: the first (EDT) is used.
    assert.equal(instantIn({ year: 2026, month: 10, day: 1, hour: 1, minute: 30, second: 0 }, 'America/New_York'), Date.UTC(2026, 10, 1, 5, 30));
    assert.equal(formatWallTime(Date.UTC(2026, 6, 15, 3, 30), 'Asia/Kolkata'), '2026-07-15T09:00');
    assert.deepEqual(wallTimeIn(Date.UTC(2026, 11, 31, 23, 30), 'Asia/Tokyo'), { year: 2027, month: 0, day: 1, hour: 8, minute: 30, second: 0 });
  });

  it("repeats at the same wall-clock time in the recipient's zone", () => {
    const rule = { repeat: 'daily' as const, timeZone: 'Europe/London' };
    const start = parseWallTime('2026-03-28T09:00', 'Europe/London'); // the day before clocks go forward
    const next = nextOccurrence(start, rule, start)!;
    assert.equal(formatWallTime(next, 'Europe/London'), '2026-03-29T09:00');
    assert.equal(next - start, 23 * 3_600_000); // a 23-hour day there

    const monthly = { repeat: 'monthly' as const, timeZone: 'America/New_York' };
    const jan31 = parseWallTime('2026-01-31T18:00', 'America/New_York');
    assert.equal(formatWallTime(nextOccurrence(jan31, monthly, jan31)!, 'America/New_York'), '2026-02-28T18:00');

    // Weekdays rule: the weekday is the recipient's, not ours. 23:30 Friday in New York is
    // Saturday morning in Kolkata, so a weekday rule in New York still sends on Friday.
    const weekdays = { repeat: 'weekdays' as const, timeZone: 'America/New_York' };
    const friday = parseWallTime('2026-11-20T23:30', 'America/New_York');
    assert.equal(firstOccurrence(friday, weekdays), friday);
    assert.equal(formatWallTime(nextOccurrence(friday, weekdays, friday)!, 'America/New_York'), '2026-11-23T23:30');
  });

  it('lists occurrences in a window', () => {
    const rule = { repeat: 'weekly' as const, timeZone: 'Asia/Kolkata' };
    const first = parseWallTime('2026-11-02T10:00', 'Asia/Kolkata');
    const from = parseWallTime('2026-11-15T00:00', 'Asia/Kolkata');
    const to = parseWallTime('2026-12-01T00:00', 'Asia/Kolkata');
    const times = occurrencesBetween(first, first, rule, from, to).map((t) => formatWallTime(t, 'Asia/Kolkata'));
    assert.deepEqual(times, ['2026-11-16T10:00', '2026-11-23T10:00', '2026-11-30T10:00']);
    assert.deepEqual(occurrencesBetween(first, first, { repeat: 'none' }, from, to), []);
  });
});

describe('zone names', () => {
  it('treats old aliases as the same zone', async () => {
    const { sameZone, zoneCity } = await import('../src/shared/timezones.ts');
    assert.ok(sameZone('Asia/Calcutta', 'Asia/Kolkata'));
    assert.ok(!sameZone('Europe/London', 'Asia/Kolkata'));
    assert.equal(zoneCity('Asia/Calcutta'), 'Kolkata');
    assert.equal(zoneCity('America/New_York'), 'New York');
  });
});
