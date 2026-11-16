// Repeat rules for scheduled messages. Pure functions, shared by the scheduler and the window.

import type { RepeatRule } from './types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_ITERATIONS = 20_000;

function addMonthsClamped(anchor: Date, months: number): Date {
  const year = anchor.getFullYear();
  const month = anchor.getMonth() + months;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(
    year,
    month,
    Math.min(anchor.getDate(), lastDay),
    anchor.getHours(),
    anchor.getMinutes(),
    anchor.getSeconds(),
  );
}

function addDays(anchor: Date, days: number): Date {
  const next = new Date(anchor);
  next.setDate(anchor.getDate() + days);
  return next;
}

/** Whole weeks between the Sundays starting the weeks of `a` and `b`. */
function weeksBetween(a: Date, b: Date): number {
  const startOfWeek = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
  return Math.round((startOfWeek(b).getTime() - startOfWeek(a).getTime()) / (7 * 86_400_000));
}

/** The n-th occurrence (n >= 1) after the anchor for simple, evenly spaced rules. */
function nth(anchor: Date, rule: RepeatRule, n: number): Date | null {
  const interval = Math.max(1, Math.floor(rule.interval ?? 1));
  switch (rule.repeat) {
    case 'daily':
      return addDays(anchor, n);
    case 'weekly':
      return addDays(anchor, 7 * n);
    case 'monthly':
      return addMonthsClamped(anchor, n);
    case 'yearly':
      return addMonthsClamped(anchor, 12 * n);
    case 'custom':
      if (rule.unit === 'month') return addMonthsClamped(anchor, interval * n);
      if (rule.unit === 'day') return addDays(anchor, interval * n);
      return null; // custom weekly is handled day by day
    default:
      return null;
  }
}

/**
 * The next send time strictly after `after`, or null when the rule doesn't repeat
 * (or has ended). Occurrences are counted from the original time (`anchorAt`), so a
 * message scheduled for the 31st goes out on the last day of shorter months without drifting.
 */
export function nextOccurrence(anchorAt: number, rule: RepeatRule, after: number): number | null {
  if (rule.repeat === 'none') return null;
  const anchor = new Date(anchorAt);
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
          : [anchor.getDay()];
    for (let n = 1; n < MAX_ITERATIONS; n++) {
      const candidate = addDays(anchor, n);
      if (!weekdays.includes(candidate.getDay())) continue;
      if (rule.repeat === 'custom' && weeksBetween(anchor, candidate) % interval !== 0) continue;
      if (candidate.getTime() > after) {
        next = candidate.getTime();
        break;
      }
    }
  } else {
    for (let n = 1; n < MAX_ITERATIONS; n++) {
      const candidate = nth(anchor, rule, n);
      if (!candidate) break;
      if (candidate.getTime() > after) {
        next = candidate.getTime();
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
  if (!days || days.includes(new Date(anchorAt).getDay())) return anchorAt;
  return nextOccurrence(anchorAt, rule, anchorAt) ?? anchorAt;
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
  if (clean.repeat !== 'none' && rule.endAt !== undefined && rule.endAt !== null) {
    if (typeof rule.endAt !== 'number' || !Number.isFinite(rule.endAt)) throw new Error('Invalid end date.');
    clean.endAt = rule.endAt;
  }
  return clean;
}

const weekdayLong = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const dayMonth = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' });
const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Human description, e.g. "Every 2 weeks on Mon, Wed until 31 Dec 2026". */
export function describeRule(rule: RepeatRule, anchorAt: number): string {
  const anchor = new Date(anchorAt);
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
      text = `Every month on day ${anchor.getDate()}`;
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
