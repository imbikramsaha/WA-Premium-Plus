// Window requests for automation, reminders, broadcasts and webhooks.

import { WEBHOOK_EVENTS, type AutomationSettings, type CallSettings, type CampaignInput, type Hours, type RuleAction, type RuleConfig, type WebhookEvent } from '../shared/types';
import type { Account } from './account';

type Handle = (channel: string, fn: (account: Account, ...args: unknown[]) => unknown) => void;

const str = (v: unknown, max = 4096): string => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`Invalid ${what}.`);
  return v;
};
const time = (v: unknown, fallback: string): string => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : fallback);

function parseHours(value: unknown): Hours | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const h = value as Record<string, unknown>;
  const days = (Array.isArray(h.days) ? h.days : []).filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6);
  if (days.length === 0) throw new Error('Pick at least one day.');
  return { days: [...new Set(days)].sort(), start: time(h.start, '09:00'), end: time(h.end, '18:00') };
}

function parseWhen(value: unknown): RuleConfig['when'] {
  const w = (value ?? {}) as Record<string, unknown>;
  const mode = w.mode === 'inside' || w.mode === 'outside' ? w.mode : 'always';
  return mode === 'always' ? { mode } : { mode, hours: parseHours(w.hours) ?? { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' } };
}

function parseAction(value: unknown): RuleAction {
  const a = (value ?? {}) as Record<string, unknown>;
  switch (a.type) {
    case 'reply': {
      const text = str(a.text).trim();
      if (!text) throw new Error('Write the reply text.');
      return { type: 'reply', text, quote: Boolean(a.quote) };
    }
    case 'label':
      return { type: 'label', labelId: int(a.labelId, 'label') };
    case 'markRead':
    case 'notify':
      return { type: a.type };
    default:
      throw new Error('Unknown action.');
  }
}

export function parseRuleConfig(value: unknown): RuleConfig {
  const c = (value ?? {}) as Record<string, unknown>;
  const trigger = c.trigger === 'firstMessage' || c.trigger === 'groupJoin' ? c.trigger : 'message';
  const scope = c.scope === 'contacts' || c.scope === 'unknown' || c.scope === 'chats' ? c.scope : 'people';
  const chatIds = (Array.isArray(c.chatIds) ? c.chatIds : []).filter((id): id is string => typeof id === 'string').slice(0, 500);
  if ((scope === 'chats' || trigger === 'groupJoin') && chatIds.length === 0) {
    throw new Error(trigger === 'groupJoin' ? 'Choose the groups to welcome people in.' : 'Choose at least one chat.');
  }
  const m = (c.match ?? {}) as Record<string, unknown>;
  type MatchType = NonNullable<RuleConfig['match']>['type'];
  const matchType: MatchType = ['contains', 'exact', 'starts', 'regex'].includes(m.type as string) ? (m.type as MatchType) : 'any';
  const matchText = str(m.text, 500);
  if (matchType !== 'any' && !matchText.trim()) throw new Error('Enter the words to look for.');
  if (matchType === 'regex') {
    try {
      new RegExp(matchText, 'iu');
    } catch {
      throw new Error('That pattern is not a valid regular expression.');
    }
  }
  const actions = (Array.isArray(c.actions) ? c.actions : []).map(parseAction);
  if (actions.length === 0) throw new Error('Add at least one action.');
  const cooldown = Number(c.cooldownMinutes ?? 0);
  return {
    trigger,
    scope: trigger === 'groupJoin' ? 'chats' : scope,
    chatIds: scope === 'chats' || trigger === 'groupJoin' ? chatIds : undefined,
    match: trigger === 'groupJoin' ? undefined : { type: matchType, text: matchText },
    when: parseWhen(c.when),
    actions,
    cooldownMinutes: Number.isFinite(cooldown) ? Math.max(0, Math.min(60 * 24 * 30, Math.round(cooldown))) : 0,
  };
}

function parseCampaign(value: unknown): CampaignInput {
  const c = (value ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    name: str(c.name, 200),
    listId: int(c.listId, 'list'),
    body: str(c.body, 65_536),
    attachmentPath: c.attachmentPath === null ? null : typeof c.attachmentPath === 'string' ? c.attachmentPath : undefined,
    startAt: typeof c.startAt === 'number' ? c.startAt : undefined,
    dailyCap: Math.round(num(c.dailyCap, 100)),
    minDelay: num(c.minDelay, 30),
    maxDelay: num(c.maxDelay, 90),
    optOutFooter: c.optOutFooter !== false,
    sendFrom: time(c.sendFrom, '09:00'),
    sendUntil: time(c.sendUntil, '20:00'),
  };
}

export function registerAutomationIpc(handle: Handle): void {
  handle('listQuickReplies', (a) => a.automation.listQuickReplies());
  handle('saveQuickReply', (a, v) => {
    const r = (v ?? {}) as Record<string, unknown>;
    a.automation.saveQuickReply({ id: typeof r.id === 'number' ? r.id : undefined, shortcut: str(r.shortcut, 64), body: str(r.body, 65_536) });
  });
  handle('deleteQuickReply', (a, id) => a.automation.deleteQuickReply(int(id, 'ID')));

  handle('listRules', (a) => a.automation.listRules());
  handle('saveRule', (a, v) => {
    const r = (v ?? {}) as Record<string, unknown>;
    const name = str(r.name, 120).trim();
    if (!name) throw new Error('Give the rule a name.');
    a.automation.saveRule({ id: typeof r.id === 'number' ? r.id : undefined, name, enabled: r.enabled !== false, config: parseRuleConfig(r.config) });
  });
  handle('setRuleEnabled', (a, id, enabled) => a.automation.setRuleEnabled(int(id, 'ID'), Boolean(enabled)));
  handle('deleteRule', (a, id) => a.automation.deleteRule(int(id, 'ID')));

  handle('getCallSettings', (a) => a.automation.callSettings());
  handle('saveCallSettings', (a, v) => {
    const c = (v ?? {}) as Record<string, unknown>;
    const settings: CallSettings = {
      autoReject: Boolean(c.autoReject),
      message: str(c.message, 2000),
      scope: c.scope === 'unknown' ? 'unknown' : 'everyone',
      when: parseWhen(c.when),
    };
    a.automation.saveCallSettings(settings);
  });
  handle('getAutomationSettings', (a) => a.automation.settings());
  handle('saveAutomationSettings', (a, v) => {
    const c = (v ?? {}) as Record<string, unknown>;
    const max = Number(c.maxRepliesPerHour);
    const settings: AutomationSettings = {
      maxRepliesPerHour: Number.isFinite(max) ? Math.max(1, Math.min(500, Math.round(max))) : 30,
      optOutKeywords: (Array.isArray(c.optOutKeywords) ? c.optOutKeywords : [])
        .map((k) => str(k, 40).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 20),
      optOutReply: str(c.optOutReply, 1000),
    };
    a.automation.saveSettings(settings);
  });

  handle('listReminders', (a) => a.reminders.list());
  handle('createReminder', (a, v) => {
    const r = (v ?? {}) as Record<string, unknown>;
    const chatId = str(r.chatId, 200);
    if (!chatId) throw new Error('Choose a chat.');
    if (typeof r.dueAt !== 'number' || !Number.isFinite(r.dueAt)) throw new Error('Pick when to be reminded.');
    a.reminders.create({
      chatId,
      messageId: typeof r.messageId === 'string' ? r.messageId : undefined,
      note: str(r.note, 1000),
      dueAt: r.dueAt,
      onlyIfNoReply: r.onlyIfNoReply !== false,
      followUp: str(r.followUp, 65_536) || undefined,
    });
  });
  handle('cancelReminder', (a, id) => a.reminders.cancel(int(id, 'ID')));
  handle('deleteReminder', (a, id) => a.reminders.delete(int(id, 'ID')));

  handle('readCsv', (a, path) => a.broadcasts.readCsv(str(path, 4096)));
  handle('listContactLists', (a) => a.broadcasts.listLists());
  handle('createContactList', (a, v) => {
    const input = (v ?? {}) as Record<string, unknown>;
    const csv = input.csv as Record<string, unknown> | undefined;
    const members = Array.isArray(input.members) ? input.members : undefined;
    return a.broadcasts.createList({
      name: str(input.name, 200),
      csv: csv
        ? {
            columns: (Array.isArray(csv.columns) ? csv.columns : []).map((c) => str(c, 200)),
            phoneColumn: int(csv.phoneColumn, 'phone column'),
            nameColumn: typeof csv.nameColumn === 'number' ? csv.nameColumn : -1,
            rows: (Array.isArray(csv.rows) ? csv.rows : []).map((r) => (Array.isArray(r) ? r.map((x) => str(x, 1000)) : [])),
            defaultCountryCode: str(csv.defaultCountryCode, 4),
          }
        : undefined,
      members: members?.map((m) => {
        const x = (m ?? {}) as Record<string, unknown>;
        return { jid: str(x.jid, 200), name: str(x.name, 200) || undefined };
      }),
    });
  });
  handle('listListMembers', (a, id) => a.broadcasts.listMembers(int(id, 'list')));
  handle('removeListMember', (a, id, jid) => a.broadcasts.removeMember(int(id, 'list'), str(jid, 200)));
  handle('deleteContactList', (a, id) => a.broadcasts.deleteList(int(id, 'list')));
  handle('listCampaigns', (a) => a.broadcasts.listCampaigns());
  handle('saveCampaign', (a, id, v) => a.broadcasts.saveCampaign(typeof id === 'number' ? id : undefined, parseCampaign(v)));
  handle('startCampaign', (a, id) => a.broadcasts.startCampaign(int(id, 'broadcast')));
  handle('pauseCampaign', (a, id) => a.broadcasts.pauseCampaign(int(id, 'broadcast')));
  handle('cancelCampaign', (a, id) => a.broadcasts.cancelCampaign(int(id, 'broadcast')));
  handle('deleteCampaign', (a, id) => a.broadcasts.deleteCampaign(int(id, 'broadcast')));
  handle('listCampaignRecipients', (a, id) => a.broadcasts.listRecipients(int(id, 'broadcast')));
  handle('broadcastsSentToday', (a) => a.broadcasts.sentToday());
  handle('listOptOuts', (a) => a.broadcasts.listOptOuts());
  handle('addOptOut', (a, jid) => a.broadcasts.addOptOut(str(jid, 200)));
  handle('removeOptOut', (a, jid) => a.broadcasts.removeOptOut(str(jid, 200)));

  handle('listWebhooks', (a) => a.webhooks.list());
  handle('saveWebhook', (a, v) => {
    const w = (v ?? {}) as Record<string, unknown>;
    a.webhooks.save({
      id: typeof w.id === 'number' ? w.id : undefined,
      url: str(w.url, 2000),
      events: (Array.isArray(w.events) ? w.events : []).filter((e): e is WebhookEvent => WEBHOOK_EVENTS.includes(e as WebhookEvent)),
      enabled: w.enabled !== false,
    });
  });
  handle('deleteWebhook', (a, id) => a.webhooks.delete(int(id, 'webhook')));
  handle('testWebhook', (a, id) => a.webhooks.test(int(id, 'webhook')));
}
