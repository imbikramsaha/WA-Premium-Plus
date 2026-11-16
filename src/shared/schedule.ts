// Repeat rules for scheduled messages. Pure functions, shared by the scheduler and the window.

import { instantIn, isValidZone, wallTimeIn, type WallTime } from './timezones.ts';
import type { RepeatRule } from './types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_ITERATIONS = 20_000;

/** Reads and builds wall-clock times, in the computer's zone or a named one. */
interface Calendar {
  parts(ms: number): WallTime;
  make(wall: WallTime): number;
}

const LOCAL: Calendar = {
  parts(ms) {
    const d = new Date(ms);
    return {
      year: d.getFullYear(),
      month: d.getMonth(),
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
    };
  },
  make: (w) => new Date(w.year, w.month, w.day, w.hour, w.minute, w.second).getTime(),
};

function calendarFor(rule: Pick<RepeatRule, 'timeZone'>): Calendar {
  const zone = rule.timeZone;
  if (!zone) return LOCAL;
  return { parts: (ms) => wallTimeIn(ms, zone), make: (w) => instantIn(w, zone) };
}

/** Day of the week (0 = Sunday) of a wall-clock date; days may overflow the month. */
function weekdayOf(w: WallTime, extraDays = 0): number {
  return new Date(Date.UTC(w.year, w.month, w.day + extraDays)).getUTCDay();
}

function addMonthsClamped(cal: Calendar, anchor: WallTime, months: number): number {
  const month = anchor.month + months;
  const lastDay = new Date(Date.UTC(anchor.year, month + 1, 0)).getUTCDate();
  return cal.make({ ...anchor, month, day: Math.min(anchor.day, lastDay) });
}

function addDays(cal: Calendar, anchor: WallTime, days: number): number {
  return cal.make({ ...anchor, day: anchor.day + days });
}

/** Whole weeks between the Sundays starting the weeks of two wall-clock dates. */
function weeksBetween(a: WallTime, aExtraDays: number): number {
  const dayNumber = (w: WallTime, extra: number) => Math.round(Date.UTC(w.year, w.month, w.day + extra) / 86_400_000);
  const startA = dayNumber(a, 0) - weekdayOf(a);
  const startB = dayNumber(a, aExtraDays) - weekdayOf(a, aExtraDays);
  return Math.round((startB - startA) / 7);
}

/** The n-th occurrence (n >= 1) after the anchor for simple, evenly spaced rules. */
function nth(cal: Calendar, anchor: WallTime, rule: RepeatRule, n: number): number | null {
  const interval = Math.max(1, Math.floor(rule.interval ?? 1));
  switch (rule.repeat) {
    case 'daily':
      return addDays(cal, anchor, n);
    case 'weekly':
      return addDays(cal, anchor, 7 * n);
    case 'monthly':
      return addMonthsClamped(cal, anchor, n);
    case 'yearly':
      return addMonthsClamped(cal, anchor, 12 * n);
    case 'custom':
      if (rule.unit === 'month') return addMonthsClamped(cal, anchor, interval * n);
      if (rule.unit === 'day') return addDays(cal, anchor, interval * n);
      return null; // custom weekly is handled day by day
    default:
      return null;
  }
}

/**
 * The next send time strictly after `after`, or null when the rule doesn't repeat
 * (or has ended). Occurrences are counted from the original time (`anchorAt`), so a
 * message scheduled for the 31st goes out on the last day of shorter months without drifting.
 * With `rule.timeZone`, times follow the wall clock in that zone (for example 9:00 in London,
 * through daylight-saving changes there); otherwise the computer's own zone.
 */
export function nextOccurrence(anchorAt: number, rule: RepeatRule, after: number): number | null {
  if (rule.repeat === 'none') return null;
  const cal = calendarFor(rule);
  const anchor = cal.parts(anchorAt);
  let next: number | null = null;

  const dayByDay =
    rule.repeat === 'weekdays' || (rule.repeat === 'custom' && (rule.unit ?? 'week') === 'week');
  if (dayByDay) {
    const interval = Math.max(1, Math.floor(rule.interval ?? 1));
    const weekdays =
      rule.repeat === 'weekdays'
        ? [1, 2, 3, 4, 5]
        : rule.weekdays && rule.weekdays.length > 0
          ? rule.weekdays
          : [weekdayOf(anchor)];
    for (let n = 1; n < MAX_ITERATIONS; n++) {
      if (!weekdays.includes(weekdayOf(anchor, n))) continue;
      if (rule.repeat === 'custom' && weeksBetween(anchor, n) % interval !== 0) continue;
      const candidate = addDays(cal, anchor, n);
      if (candidate > after) {
        next = candidate;
        break;
      }
    }
  } else {
    for (let n = 1; n < MAX_ITERATIONS; n++) {
      const candidate = nth(cal, anchor, rule, n);
      if (candidate === null) break;
      if (candidate > after) {
        next = candidate;
        break;
      }
    }
  }

  if (next !== null && rule.endAt !== undefined && next > rule.endAt) return null;
  return next;
}

/**
 * The first send: the chosen time, unless the rule only sends on certain weekdays and the
 * chosen day isn't one of them, in which case the next matching day at the same time.
 */
export function firstOccurrence(anchorAt: number, rule: RepeatRule): number {
  const days =
    rule.repeat === 'weekdays'
      ? [1, 2, 3, 4, 5]
      : rule.repeat === 'custom' && (rule.unit ?? 'week') === 'week' && rule.weekdays?.length
        ? rule.weekdays
        : null;
  if (!days || days.includes(weekdayOf(calendarFor(rule).parts(anchorAt)))) return anchorAt;
  return nextOccurrence(anchorAt, rule, anchorAt) ?? anchorAt;
}

/** Send times within a window, for calendars. At most `limit` of them. */
export function occurrencesBetween(
  firstAt: number,
  anchorAt: number,
  rule: RepeatRule,
  from: number,
  to: number,
  limit = 100,
): number[] {
  const times: number[] = [];
  let t: number | null = firstAt;
  // Skip ahead to the window without listing every earlier occurrence.
  if (t < from && rule.repeat !== 'none') t = nextOccurrence(anchorAt, rule, from - 1);
  while (t !== null && t <= to && times.length < limit) {
    if (t >= from) times.push(t);
    t = nextOccurrence(anchorAt, rule, t);
  }
  return times;
}

/** Checks and cleans up a rule coming from the window. Throws on invalid input. */
export function normalizeRule(value: unknown): RepeatRule {
  const rule = (value ?? {}) as Partial<RepeatRule>;
  const repeats = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom'];
  if (!repeats.includes(rule.repeat as string)) throw new Error('Invalid repeat option.');
  const clean: RepeatRule = { repeat: rule.repeat as RepeatRule['repeat'] };
  if (clean.repeat === 'custom') {
    const interval = Number(rule.interval ?? 1);
    if (!Number.isInteger(interval) || interval < 1 || interval > 365) {
      throw new Error('Repeat interval must be a whole number from 1 to 365.');
    }
    if (!['day', 'week', 'month'].includes(rule.unit as string)) throw new Error('Invalid repeat unit.');
    clean.interval = interval;
    clean.unit = rule.unit;
    if (rule.unit === 'week') {
      const days = Array.isArray(rule.weekdays) ? rule.weekdays : [];
      const valid = [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
      if (valid.length === 0) throw new Error('Pick at least one day of the week.');
      clean.weekdays = valid;
    }
  }
  if (rule.timeZone !== undefined && rule.timeZone !== null) {
    if (!isValidZone(rule.timeZone)) throw new Error('Unknown time zone.');
    clean.timeZone = rule.timeZone;
  }
  if (clean.repeat !== 'none' && rule.endAt !== undefined && rule.endAt !== null) {
    if (typeof rule.endAt !== 'number' || !Number.isFinite(rule.endAt)) throw new Error('Invalid end date.');
    clean.endAt = rule.endAt;
  }
  return clean;
}

function formatIn(zone: string | undefined, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(undefined, zone ? { ...options, timeZone: zone } : options);
}

/** Human description, e.g. "Every 2 weeks on Mon, Wed until 31 Dec 2026". */
export function describeRule(rule: RepeatRule, anchorAt: number): string {
  const anchor = new Date(anchorAt);
  const zone = rule.timeZone;
  const weekdayLong = formatIn(zone, { weekday: 'long' });
  const dayMonth = formatIn(zone, { day: 'numeric', month: 'long' });
  const shortDate = formatIn(zone, { day: 'numeric', month: 'short', year: 'numeric' });
  const dayOfMonth = Number(formatIn(zone, { day: 'numeric' }).format(anchor));
  let text: string;
  switch (rule.repeat) {
    case 'none':
      return 'Does not repeat';
    case 'daily':
      text = 'Every day';
      break;
    case 'weekdays':
      text = 'Every weekday (Mon–Fri)';
      break;
    case 'weekly':
      text = `Every week on ${weekdayLong.format(anchor)}`;
      break;
    case 'monthly':
      text = `Every month on day ${dayOfMonth}`;
      break;
    case 'yearly':
      text = `Every year on ${dayMonth.format(anchor)}`;
      break;
    case 'custom': {
      const n = rule.interval ?? 1;
      const unit = rule.unit ?? 'week';
      const plural = n === 1 ? unit : `${n} ${unit}s`;
      text = `Every ${plural}`;
      if (unit === 'week' && rule.weekdays?.length) {
        text += ` on ${rule.weekdays.map((d) => DAY_NAMES[d]).join(', ')}`;
      }
      break;
    }
  }
  if (rule.endAt !== undefined) text += ` until ${shortDate.format(new Date(rule.endAt))}`;
  return text;
}
