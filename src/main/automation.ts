// Automation for one account: rules (keyword replies, away and welcome messages), quick
// replies, declining calls with a message, and broadcast opt-outs.

import { ruleApplies, isActiveAt, type IncomingContext } from '../shared/rules.ts';
import { personValues, renderTemplate } from '../shared/template.ts';
import type {
  AppEvent,
  AutomationRule,
  AutomationSettings,
  CallSettings,
  ChatMessage,
  QuickReply,
  RuleAction,
  RuleConfig,
} from '../shared/types';
import { fallbackName, type Store } from './store.ts';
import type { Webhooks } from './webhooks';
import type { IncomingCall, WhatsApp } from './whatsapp';

export const DEFAULT_CALL_SETTINGS: CallSettings = {
  autoReject: false,
  message: "Sorry, I can't take calls right now. Please send me a message.",
  scope: 'everyone',
  when: { mode: 'always' },
};

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  maxRepliesPerHour: 30,
  optOutKeywords: ['stop', 'unsubscribe'],
  optOutReply: "You won't get these messages any more.",
};

/** Pause before an automatic reply, so it doesn't arrive instantly (seconds). */
const REPLY_DELAY = [2, 6];
/** Messages older than this when they arrive (e.g. after the computer was off) get no auto-reply. */
const MAX_AGE_S = 10 * 60;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = () => (REPLY_DELAY[0]! + Math.random() * (REPLY_DELAY[1]! - REPLY_DELAY[0]!)) * 1000;

interface RuleRow {
  id: number;
  name: string;
  enabled: number;
  config: string;
  created_at: number;
  fires: number;
  last_fired: number | null;
}

export interface AutomationDeps {
  store: Store;
  whatsapp: WhatsApp;
  webhooks: Webhooks;
  emit: (event: AppEvent) => void;
  /** Shows a desktop notification; clicking it opens the chat. */
  alert: (title: string, body: string, chatId?: string) => void;
}

export class Automation {
  private readonly deps: AutomationDeps;
  private rules: AutomationRule[] | null = null;

  constructor(deps: AutomationDeps) {
    this.deps = deps;
  }

  private get db() {
    return this.deps.store.db;
  }

  // --- Settings ---

  callSettings(): CallSettings {
    return { ...DEFAULT_CALL_SETTINGS, ...this.deps.store.getSetting<Partial<CallSettings>>('calls', {}) };
  }

  saveCallSettings(settings: CallSettings): void {
    this.deps.store.setSetting('calls', settings);
    this.deps.emit({ type: 'automation-changed' });
  }

  settings(): AutomationSettings {
    return { ...DEFAULT_AUTOMATION_SETTINGS, ...this.deps.store.getSetting<Partial<AutomationSettings>>('automation', {}) };
  }

  saveSettings(settings: AutomationSettings): void {
    this.deps.store.setSetting('automation', settings);
    this.deps.emit({ type: 'automation-changed' });
  }

  // --- Quick replies ---

  listQuickReplies(): QuickReply[] {
    return this.db.prepare('SELECT id, shortcut, body FROM quick_replies ORDER BY shortcut').all() as unknown as QuickReply[];
  }

  saveQuickReply(reply: { id?: number; shortcut: string; body: string }): void {
    const shortcut = reply.shortcut.trim().replace(/^\/+/, '').toLowerCase();
    if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(shortcut)) throw new Error('Use letters, numbers, - or _ for the shortcut (no spaces).');
    if (!reply.body.trim()) throw new Error('Write the reply text.');
    const clash = this.db.prepare('SELECT id FROM quick_replies WHERE shortcut = ?').get(shortcut) as { id: number } | undefined;
    if (clash && clash.id !== reply.id) throw new Error(`/${shortcut} is already used.`);
    if (reply.id) {
      this.db.prepare('UPDATE quick_replies SET shortcut = ?, body = ? WHERE id = ?').run(shortcut, reply.body, reply.id);
    } else {
      this.db.prepare('INSERT INTO quick_replies (shortcut, body, created_at) VALUES (?, ?, ?)').run(shortcut, reply.body, Date.now());
    }
    this.deps.emit({ type: 'automation-changed' });
  }

  deleteQuickReply(id: number): void {
    this.db.prepare('DELETE FROM quick_replies WHERE id = ?').run(id);
    this.deps.emit({ type: 'automation-changed' });
  }

  // --- Rules ---

  listRules(): AutomationRule[] {
    if (this.rules) return this.rules;
    const rows = this.db
      .prepare(
        `SELECT r.*, (SELECT COUNT(*) FROM rule_fires f WHERE f.rule_id = r.id) AS fires,
                (SELECT MAX(at) FROM rule_fires f WHERE f.rule_id = r.id) AS last_fired
         FROM rules r ORDER BY r.id`,
      )
      .all() as unknown as RuleRow[];
    this.rules = rows.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled === 1,
      config: JSON.parse(r.config) as RuleConfig,
      createdAt: r.created_at,
      fires: r.fires,
      lastFiredAt: r.last_fired ?? undefined,
    }));
    return this.rules;
  }

  private changed(): void {
    this.rules = null;
    this.deps.emit({ type: 'automation-changed' });
  }

  saveRule(rule: { id?: number; name: string; enabled: boolean; config: RuleConfig }): void {
    const config = JSON.stringify(rule.config);
    if (rule.id) {
      this.db.prepare('UPDATE rules SET name = ?, enabled = ?, config = ? WHERE id = ?').run(rule.name, rule.enabled ? 1 : 0, config, rule.id);
    } else {
      this.db.prepare('INSERT INTO rules (name, enabled, config, created_at) VALUES (?, ?, ?, ?)').run(rule.name, rule.enabled ? 1 : 0, config, Date.now());
    }
    this.changed();
  }

  setRuleEnabled(id: number, enabled: boolean): void {
    this.db.prepare('UPDATE rules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
    this.changed();
  }

  deleteRule(id: number): void {
    this.db.prepare('DELETE FROM rules WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM rule_fires WHERE rule_id = ?').run(id);
    this.changed();
  }

  private firedRecently(ruleId: number, chatId: string, minutes: number): boolean {
    if (minutes <= 0) return false;
    return Boolean(
      this.db.prepare('SELECT 1 FROM rule_fires WHERE rule_id = ? AND chat_id = ? AND at > ? LIMIT 1').get(ruleId, chatId, Date.now() - minutes * 60_000),
    );
  }

  private repliesInLastHour(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM rule_fires WHERE at > ?').get(Date.now() - 3_600_000) as { n: number }).n;
  }

  private recordFire(ruleId: number, chatId: string): void {
    this.db.prepare('INSERT INTO rule_fires (rule_id, chat_id, at) VALUES (?, ?, ?)').run(ruleId, chatId, Date.now());
    // Keep the log small.
    this.db.prepare('DELETE FROM rule_fires WHERE at < ?').run(Date.now() - 90 * 86_400_000);
    this.rules = null;
  }

  // --- Events ---

  /** Called for every new message. Runs opt-outs and rules for live incoming messages. */
  async onMessage(message: ChatMessage, info: { notify: boolean }): Promise<void> {
    if (!info.notify || message.fromMe) return;
    const { chatId } = message;
    if (!/@(s\.whatsapp\.net|g\.us)$/.test(chatId)) return; // not statuses, channels or broadcasts
    if (Date.now() / 1000 - message.timestamp > MAX_AGE_S) return;
    const isGroup = chatId.endsWith('@g.us');
    if (!isGroup && (await this.handleOptOut(message))) return;

    const sender = isGroup ? message.author : chatId;
    const ctx: IncomingContext = {
      chatId,
      text: message.body,
      isGroup,
      isContact: sender ? this.deps.store.isSavedContact(sender) : false,
      isFirstMessage: this.deps.store.countMessages(chatId) <= 1,
      at: new Date(),
    };
    let replied = false;
    for (const rule of this.listRules()) {
      if (!rule.enabled || !ruleApplies(rule.config, ctx)) continue;
      if (this.firedRecently(rule.id, chatId, rule.config.cooldownMinutes)) continue;
      const replies = rule.config.actions.some((a) => a.type === 'reply');
      // One automatic reply per message, within the hourly safety limit.
      if (replies && (replied || this.repliesInLastHour() >= this.settings().maxRepliesPerHour)) continue;
      this.recordFire(rule.id, chatId);
      if (replies) replied = true;
      await this.run(rule, rule.config.actions, message, sender);
    }
    if (replied) this.deps.emit({ type: 'automation-changed' });
  }

  private async run(rule: AutomationRule, actions: RuleAction[], message: ChatMessage, sender?: string): Promise<void> {
    const { store, whatsapp } = this.deps;
    const name = sender ? (store.contactName(sender) ?? message.authorName) : undefined;
    const values = personValues(name, sender?.split('@')[0]);
    for (const action of actions) {
      try {
        switch (action.type) {
          case 'reply':
            await sleep(randomDelay());
            await whatsapp.sendText(message.chatId, renderTemplate(action.text, values), action.quote ? message.id : undefined);
            break;
          case 'label':
            store.setChatLabel(message.chatId, action.labelId, true);
            this.deps.emit({ type: 'labels-changed' });
            this.deps.emit({ type: 'chats-changed' });
            break;
          case 'markRead':
            await whatsapp.markRead(message.chatId);
            break;
          case 'notify':
            this.deps.alert(`${rule.name}: ${store.chatName(message.chatId)}`, message.body || 'New message', message.chatId);
            break;
        }
      } catch {
        // Not connected or not allowed: skip this action.
      }
    }
  }

  /** Someone sent just an opt-out keyword: stop broadcasts to them. Returns true if handled. */
  private async handleOptOut(message: ChatMessage): Promise<boolean> {
    const settings = this.settings();
    const text = message.body.trim().toLowerCase().replace(/[.!]+$/, '');
    if (!text || !settings.optOutKeywords.some((k) => k.trim().toLowerCase() === text)) return false;
    const already = this.db.prepare('SELECT 1 FROM opt_outs WHERE jid = ?').get(message.chatId);
    if (already) return true;
    this.db.prepare('INSERT INTO opt_outs (jid, at, source) VALUES (?, ?, ?)').run(message.chatId, Date.now(), `Replied "${message.body.trim()}"`);
    this.deps.emit({ type: 'broadcasts-changed' });
    this.deps.webhooks.dispatch('optout', { chatId: message.chatId, name: this.deps.store.chatName(message.chatId), text: message.body });
    if (settings.optOutReply.trim()) {
      await sleep(randomDelay());
      await this.deps.whatsapp.sendText(message.chatId, settings.optOutReply).catch(() => undefined);
    }
    return true;
  }

  /** Welcome messages when people join a group. */
  async onGroupParticipants(update: { groupId: string; participants: string[]; action: string }): Promise<void> {
    if (update.action !== 'add') return;
    const me = this.deps.whatsapp.connection.me?.id;
    const people = update.participants.filter((p) => p !== me && p.endsWith('@s.whatsapp.net'));
    if (people.length === 0) return;
    for (const rule of this.listRules()) {
      const c = rule.config;
      if (!rule.enabled || c.trigger !== 'groupJoin' || !c.chatIds?.includes(update.groupId)) continue;
      if (!isActiveAt(c.when, new Date())) continue;
      this.recordFire(rule.id, update.groupId);
      const names = people.map((p) => this.deps.store.contactName(p) ?? fallbackName(p));
      const mention = people.map((p) => `@${p.split('@')[0]}`).join(' ');
      for (const action of c.actions) {
        if (action.type !== 'reply') continue;
        const text = renderTemplate(action.text, { ...personValues(names.join(', '), people[0]!.split('@')[0]), mention });
        await sleep(randomDelay());
        await this.deps.whatsapp.sendText(update.groupId, text, undefined, text.includes('@') ? people : undefined).catch(() => undefined);
      }
    }
    this.deps.emit({ type: 'automation-changed' });
  }

  /** Declines a call and sends a message, if set up to. */
  async onCall(call: IncomingCall): Promise<boolean> {
    const settings = this.callSettings();
    if (!settings.autoReject || !isActiveAt(settings.when, new Date())) return false;
    if (settings.scope === 'unknown' && this.deps.store.isSavedContact(call.chatId)) return false;
    try {
      await this.deps.whatsapp.rejectCall(call.id, call.from);
      if (!call.isGroup && settings.message.trim()) {
        const values = personValues(this.deps.store.contactName(call.chatId), call.chatId.split('@')[0]);
        await sleep(1_500);
        await this.deps.whatsapp.sendText(call.chatId, renderTemplate(settings.message, values));
      }
      return true;
    } catch {
      return false;
    }
  }
}
