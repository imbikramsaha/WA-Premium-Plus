// Automation rules: whether a rule applies to an incoming message. Pure functions.

import type { Hours, RuleConfig } from './types';

function minutes(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** Whether a time falls within the hours (in the computer's time zone). */
export function withinHours(hours: Hours, at: Date): boolean {
  const start = minutes(hours.start);
  const end = minutes(hours.end);
  const now = at.getHours() * 60 + at.getMinutes();
  const day = at.getDay();
  if (start === end) return hours.days.includes(day);
  if (start < end) return hours.days.includes(day) && now >= start && now < end;
  // Overnight, e.g. 22:00–06:00: after the start on a listed day, or before the end the next morning.
  const yesterday = (day + 6) % 7;
  return (hours.days.includes(day) && now >= start) || (hours.days.includes(yesterday) && now < end);
}

export function isActiveAt(when: RuleConfig['when'], at: Date): boolean {
  if (when.mode === 'always' || !when.hours) return true;
  const inside = withinHours(when.hours, at);
  return when.mode === 'inside' ? inside : !inside;
}

export interface IncomingContext {
  chatId: string;
  text: string;
  isGroup: boolean;
  /** The sender is a saved contact. */
  isContact: boolean;
  /** This is the first message we have from this chat. */
  isFirstMessage: boolean;
  at: Date;
}

export function matchesText(match: RuleConfig['match'], text: string): boolean {
  if (!match || match.type === 'any') return true;
  const needle = match.text.trim().toLowerCase();
  const hay = text.trim().toLowerCase();
  if (!needle) return true;
  switch (match.type) {
    case 'exact':
      return hay === needle;
    case 'starts':
      return hay.startsWith(needle);
    case 'contains':
      // Any of several comma-separated keywords, matched as whole words.
      return needle
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
        .some((k) => new RegExp(`(^|[^\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(hay));
    case 'regex':
      try {
        return new RegExp(match.text, 'iu').test(text);
      } catch {
        return false;
      }
  }
}

/** Whether a message-triggered rule applies (ignoring cooldowns and limits). */
export function ruleApplies(config: RuleConfig, ctx: IncomingContext): boolean {
  if (config.trigger === 'groupJoin') return false;
  if (config.trigger === 'firstMessage' && !ctx.isFirstMessage) return false;
  switch (config.scope) {
    case 'chats':
      if (!config.chatIds?.includes(ctx.chatId)) return false;
      break;
    case 'people':
      if (ctx.isGroup) return false;
      break;
    case 'contacts':
      if (ctx.isGroup || !ctx.isContact) return false;
      break;
    case 'unknown':
      if (ctx.isGroup || ctx.isContact) return false;
      break;
  }
  return isActiveAt(config.when, ctx.at) && matchesText(config.match, ctx.text);
}
