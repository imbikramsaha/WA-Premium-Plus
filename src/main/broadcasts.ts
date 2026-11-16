// Contact lists and personalised broadcasts, sent one by one with safety limits: a daily cap,
// random pauses, sending hours, a WhatsApp check before each number, and opt-outs.

import { readFile, rm } from 'node:fs/promises';
import { detectColumns, normalizePhone, parseCsv } from '../shared/csv.ts';
import { withinHours } from '../shared/rules.ts';
import { personValues, renderTemplate } from '../shared/template.ts';
import type {
  AppEvent,
  AttachmentKind,
  Campaign,
  CampaignInput,
  CampaignRecipient,
  CampaignStatus,
  ContactList,
  CsvPreview,
  ListImport,
  ListMember,
  OptOut,
} from '../shared/types';
import { keepAttachment } from './media.ts';
import { fallbackName, type Store } from './store.ts';
import type { Webhooks } from './webhooks';
import type { WhatsApp } from './whatsapp';

const TICK_MS = 3_000;
const MAX_CSV_BYTES = 10 * 1024 * 1024;
const MAX_LIST = 20_000;
export const LIMITS = { dailyCap: [1, 1000], minDelay: [10, 3600] } as const;
const OPT_OUT_FOOTER = '\n\nReply STOP to stop these messages.';

interface CampaignRow {
  id: number;
  name: string;
  list_id: number;
  list_name: string | null;
  body: string;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_kind: AttachmentKind | null;
  attachment_size: number | null;
  status: CampaignStatus;
  start_at: number | null;
  daily_cap: number;
  min_delay: number;
  max_delay: number;
  opt_out_footer: number;
  send_from: string;
  send_until: string;
  next_at: number | null;
  last_error: string | null;
  created_at: number;
  finished_at: number | null;
  total: number;
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The next time (from `now`) that falls in the sending window. */
export function nextWindowStart(now: number, from: string, until: string): number {
  const hours = { days: [0, 1, 2, 3, 4, 5, 6], start: from, end: until };
  if (withinHours(hours, new Date(now))) return now;
  const [h = '9', m = '0'] = from.split(':');
  const today = new Date(now);
  today.setHours(Number(h), Number(m), 0, 0);
  return today.getTime() > now ? today.getTime() : today.getTime() + 86_400_000;
}

export interface BroadcastDeps {
  store: Store;
  whatsapp: WhatsApp;
  webhooks: Webhooks;
  attachmentsDir: string;
  emit: (event: AppEvent) => void;
  alert: (title: string, body: string) => void;
}

export class Broadcasts {
  private readonly deps: BroadcastDeps;
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(deps: BroadcastDeps) {
    this.deps = deps;
  }

  private get db() {
    return this.deps.store.db;
  }

  private changed(): void {
    this.deps.emit({ type: 'broadcasts-changed' });
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  // --- Contact lists ---

  async readCsv(path: string): Promise<CsvPreview> {
    const data = await readFile(path);
    if (data.length > MAX_CSV_BYTES) throw new Error('That file is too big (10 MB at most).');
    const rows = parseCsv(data.toString('utf8'));
    if (rows.length === 0) throw new Error('That file has no rows.');
    const detected = detectColumns(rows.slice(0, MAX_LIST + 1));
    if (detected.phoneColumn < 0) throw new Error("Couldn't find a phone number column.");
    return detected;
  }

  listLists(): ContactList[] {
    const rows = this.db
      .prepare(
        `SELECT l.*, (SELECT COUNT(*) FROM list_members m WHERE m.list_id = l.id) AS count
         FROM contact_lists l ORDER BY l.created_at DESC`,
      )
      .all() as Array<{ id: number; name: string; columns: string; created_at: number; count: number }>;
    return rows.map((r) => ({ id: r.id, name: r.name, count: r.count, columns: JSON.parse(r.columns) as string[], createdAt: r.created_at }));
  }

  /** Saves a list. Returns how many contacts were added and skipped (invalid or duplicate numbers). */
  createList(input: ListImport): { id: number; added: number; skipped: number } {
    const name = input.name.trim();
    if (!name) throw new Error('Give the list a name.');
    const members = new Map<string, { name?: string; fields: Record<string, string> }>();
    let skipped = 0;
    let columns: string[] = [];
    if (input.csv) {
      const { csv } = input;
      columns = csv.columns.filter((_, i) => i !== csv.phoneColumn && i !== csv.nameColumn);
      for (const row of csv.rows.slice(0, MAX_LIST)) {
        const digits = normalizePhone(row[csv.phoneColumn] ?? '', csv.defaultCountryCode);
        const jid = digits ? `${digits}@s.whatsapp.net` : undefined;
        if (!jid || members.has(jid)) {
          skipped++;
          continue;
        }
        const fields: Record<string, string> = {};
        csv.columns.forEach((col, i) => {
          if (i !== csv.phoneColumn && i !== csv.nameColumn && row[i]?.trim()) fields[col] = row[i]!.trim();
        });
        members.set(jid, { name: csv.nameColumn >= 0 ? row[csv.nameColumn]?.trim() || undefined : undefined, fields });
      }
    }
    for (const m of input.members ?? []) {
      if (!m.jid.endsWith('@s.whatsapp.net') || members.has(m.jid)) {
        skipped++;
        continue;
      }
      members.set(m.jid, { name: m.name, fields: {} });
    }
    if (members.size === 0) throw new Error('No valid phone numbers to add.');
    let id = 0;
    this.deps.store.transaction(() => {
      id = Number(
        this.db.prepare('INSERT INTO contact_lists (name, columns, created_at) VALUES (?, ?, ?)').run(name, JSON.stringify(columns), Date.now())
          .lastInsertRowid,
      );
      const insert = this.db.prepare('INSERT INTO list_members (list_id, jid, name, fields) VALUES (?, ?, ?, ?)');
      for (const [jid, m] of members) insert.run(id, jid, m.name ?? null, JSON.stringify(m.fields));
    });
    this.changed();
    return { id, added: members.size, skipped };
  }

  listMembers(listId: number): ListMember[] {
    const rows = this.db
      .prepare(
        `SELECT m.jid, COALESCE(m.name, ct.name, ct.notify) AS name, m.fields, o.jid IS NOT NULL AS opted_out
         FROM list_members m LEFT JOIN contacts ct ON ct.id = m.jid LEFT JOIN opt_outs o ON o.jid = m.jid
         WHERE m.list_id = ? ORDER BY name COLLATE NOCASE`,
      )
      .all(listId) as Array<{ jid: string; name: string | null; fields: string; opted_out: number }>;
    return rows.map((r) => ({ jid: r.jid, name: r.name ?? undefined, fields: JSON.parse(r.fields) as Record<string, string>, optedOut: r.opted_out === 1 }));
  }

  removeMember(listId: number, jid: string): void {
    this.db.prepare('DELETE FROM list_members WHERE list_id = ? AND jid = ?').run(listId, jid);
    this.changed();
  }

  deleteList(id: number): void {
    const running = this.db.prepare(`SELECT 1 FROM campaigns WHERE list_id = ? AND status = 'running'`).get(id);
    if (running) throw new Error('A broadcast to this list is running. Pause or cancel it first.');
    this.db.prepare('DELETE FROM list_members WHERE list_id = ?').run(id);
    this.db.prepare('DELETE FROM contact_lists WHERE id = ?').run(id);
    this.changed();
  }

  // --- Opt-outs ---

  listOptOuts(): OptOut[] {
    const rows = this.db.prepare('SELECT * FROM opt_outs ORDER BY at DESC').all() as Array<{ jid: string; at: number; source: string | null }>;
    return rows.map((r) => ({ jid: r.jid, name: this.deps.store.chatName(r.jid), at: r.at, source: r.source ?? '' }));
  }

  addOptOut(jid: string, source = 'Added by you'): void {
    this.db.prepare('INSERT OR IGNORE INTO opt_outs (jid, at, source) VALUES (?, ?, ?)').run(jid, Date.now(), source);
    this.changed();
  }

  removeOptOut(jid: string): void {
    this.db.prepare('DELETE FROM opt_outs WHERE jid = ?').run(jid);
    this.changed();
  }

  // --- Campaigns ---

  listCampaigns(): Campaign[] {
    const rows = this.db
      .prepare(
        `SELECT c.*, l.name AS list_name,
           (SELECT COUNT(*) FROM campaign_recipients r WHERE r.campaign_id = c.id) AS total,
           (SELECT COUNT(*) FROM campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'pending') AS pending,
           (SELECT COUNT(*) FROM campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'sent') AS sent,
           (SELECT COUNT(*) FROM campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'failed') AS failed,
           (SELECT COUNT(*) FROM campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'skipped') AS skipped
         FROM campaigns c LEFT JOIN contact_lists l ON l.id = c.list_id
         ORDER BY c.created_at DESC`,
      )
      .all() as unknown as CampaignRow[];
    return rows.map((r) => {
      const total = r.status === 'draft' ? this.listSize(r.list_id) : r.total;
      return {
        id: r.id,
        name: r.name,
        listId: r.list_id,
        listName: r.list_name ?? 'Deleted list',
        body: r.body,
        attachment: r.attachment_path
          ? { name: r.attachment_name ?? 'file', mimetype: r.attachment_mime ?? '', kind: r.attachment_kind ?? 'document', size: r.attachment_size ?? 0 }
          : undefined,
        status: r.status,
        startAt: r.start_at ?? undefined,
        dailyCap: r.daily_cap,
        minDelay: r.min_delay,
        maxDelay: r.max_delay,
        optOutFooter: r.opt_out_footer === 1,
        sendFrom: r.send_from,
        sendUntil: r.send_until,
        counts: { total, pending: r.status === 'draft' ? total : r.pending, sent: r.sent, failed: r.failed, skipped: r.skipped },
        nextAt: r.next_at ?? undefined,
        lastError: r.last_error ?? undefined,
        createdAt: r.created_at,
        finishedAt: r.finished_at ?? undefined,
      };
    });
  }

  private listSize(listId: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM list_members WHERE list_id = ?').get(listId) as { n: number }).n;
  }

  listRecipients(campaignId: number): CampaignRecipient[] {
    const rows = this.db
      .prepare('SELECT jid, name, status, sent_at, error FROM campaign_recipients WHERE campaign_id = ? ORDER BY rowid')
      .all(campaignId) as Array<{ jid: string; name: string | null; status: CampaignRecipient['status']; sent_at: number | null; error: string | null }>;
    return rows.map((r) => ({ jid: r.jid, name: r.name ?? undefined, status: r.status, sentAt: r.sent_at ?? undefined, error: r.error ?? undefined }));
  }

  private validate(input: CampaignInput): void {
    if (!input.name.trim()) throw new Error('Give the broadcast a name.');
    if (!input.body.trim() && !input.attachmentPath) throw new Error('Write the message.');
    if (!this.db.prepare('SELECT 1 FROM contact_lists WHERE id = ?').get(input.listId)) throw new Error('Choose a contact list.');
    const [capMin, capMax] = LIMITS.dailyCap;
    if (!Number.isInteger(input.dailyCap) || input.dailyCap < capMin || input.dailyCap > capMax) {
      throw new Error(`The daily limit must be between ${capMin} and ${capMax}.`);
    }
    if (input.minDelay < LIMITS.minDelay[0] || input.maxDelay > LIMITS.minDelay[1] || input.maxDelay < input.minDelay) {
      throw new Error(`Pauses must be ${LIMITS.minDelay[0]} seconds or more, and the longest at least the shortest.`);
    }
    if (!/^\d{2}:\d{2}$/.test(input.sendFrom) || !/^\d{2}:\d{2}$/.test(input.sendUntil)) throw new Error('Enter sending hours as HH:MM.');
  }

  async saveCampaign(id: number | undefined, input: CampaignInput): Promise<number> {
    this.validate(input);
    const attachment = input.attachmentPath ? await keepAttachment(input.attachmentPath, this.deps.attachmentsDir) : null;
    const values = [
      input.name.trim(),
      input.listId,
      input.body,
      input.startAt ?? null,
      input.dailyCap,
      Math.round(input.minDelay),
      Math.round(input.maxDelay),
      input.optOutFooter ? 1 : 0,
      input.sendFrom,
      input.sendUntil,
    ] as const;
    if (id) {
      const current = this.db.prepare('SELECT status, attachment_path FROM campaigns WHERE id = ?').get(id) as
        | { status: CampaignStatus; attachment_path: string | null }
        | undefined;
      if (!current) throw new Error('That broadcast was deleted.');
      if (current.status !== 'draft' && current.status !== 'paused') throw new Error('Pause the broadcast before editing it.');
      this.db
        .prepare(
          `UPDATE campaigns SET name = ?, list_id = ?, body = ?, start_at = ?, daily_cap = ?, min_delay = ?, max_delay = ?,
             opt_out_footer = ?, send_from = ?, send_until = ? WHERE id = ?`,
        )
        .run(...values, id);
      if (input.attachmentPath !== undefined) {
        this.db
          .prepare('UPDATE campaigns SET attachment_path = ?, attachment_name = ?, attachment_mime = ?, attachment_kind = ?, attachment_size = ? WHERE id = ?')
          .run(attachment?.path ?? null, attachment?.name ?? null, attachment?.mimetype ?? null, attachment?.kind ?? null, attachment?.size ?? null, id);
        if (current.attachment_path) await rm(current.attachment_path, { force: true });
      }
    } else {
      id = Number(
        this.db
          .prepare(
            `INSERT INTO campaigns (name, list_id, body, start_at, daily_cap, min_delay, max_delay, opt_out_footer, send_from, send_until,
               attachment_path, attachment_name, attachment_mime, attachment_kind, attachment_size, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
          )
          .run(
            ...values,
            attachment?.path ?? null,
            attachment?.name ?? null,
            attachment?.mimetype ?? null,
            attachment?.kind ?? null,
            attachment?.size ?? null,
            Date.now(),
          ).lastInsertRowid,
      );
    }
    this.changed();
    return id;
  }

  /** Starts a draft (taking a snapshot of the list) or resumes a paused broadcast. */
  startCampaign(id: number): void {
    const row = this.db.prepare('SELECT status, list_id, start_at FROM campaigns WHERE id = ?').get(id) as
      | { status: CampaignStatus; list_id: number; start_at: number | null }
      | undefined;
    if (!row) throw new Error('That broadcast was deleted.');
    if (row.status === 'draft') {
      this.deps.store.transaction(() => {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO campaign_recipients (campaign_id, jid, name, fields)
             SELECT ?, m.jid, COALESCE(m.name, ct.name, ct.notify), m.fields
             FROM list_members m LEFT JOIN contacts ct ON ct.id = m.jid WHERE m.list_id = ? ORDER BY m.rowid`,
          )
          .run(id, row.list_id);
      });
    } else if (row.status !== 'paused') {
      throw new Error('This broadcast has finished.');
    }
    this.db
      .prepare(`UPDATE campaigns SET status = 'running', next_at = ?, last_error = NULL WHERE id = ?`)
      .run(Math.max(Date.now(), row.start_at ?? 0), id);
    this.changed();
    void this.tick();
  }

  pauseCampaign(id: number): void {
    this.db.prepare(`UPDATE campaigns SET status = 'paused' WHERE id = ? AND status = 'running'`).run(id);
    this.changed();
  }

  cancelCampaign(id: number): void {
    this.db.prepare(`UPDATE campaigns SET status = 'cancelled', finished_at = ? WHERE id = ? AND status IN ('running', 'paused', 'draft')`).run(Date.now(), id);
    this.changed();
  }

  async deleteCampaign(id: number): Promise<void> {
    const row = this.db.prepare('SELECT status, attachment_path FROM campaigns WHERE id = ?').get(id) as
      | { status: CampaignStatus; attachment_path: string | null }
      | undefined;
    if (row?.status === 'running') throw new Error('Pause or cancel the broadcast first.');
    this.db.prepare('DELETE FROM campaign_recipients WHERE campaign_id = ?').run(id);
    this.db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
    if (row?.attachment_path) await rm(row.attachment_path, { force: true });
    this.changed();
  }

  /** Messages sent by broadcasts since local midnight. */
  sentToday(now = Date.now()): number {
    return (
      this.db.prepare(`SELECT COUNT(*) AS n FROM campaign_recipients WHERE status = 'sent' AND sent_at >= ?`).get(startOfDay(now)) as { n: number }
    ).n;
  }

  /** Sends the next message of the broadcast that's due, if any. */
  async tick(now = Date.now()): Promise<void> {
    if (this.busy || !this.deps.whatsapp.isOpen) return;
    this.busy = true;
    try {
      const campaign = this.db
        .prepare(`SELECT * FROM campaigns WHERE status = 'running' AND (next_at IS NULL OR next_at <= ?) ORDER BY next_at LIMIT 1`)
        .get(now) as CampaignRow | undefined;
      if (campaign) await this.sendNext(campaign, now);
    } finally {
      this.busy = false;
    }
  }

  private setNext(id: number, at: number, error?: string): void {
    this.db.prepare('UPDATE campaigns SET next_at = ?, last_error = ? WHERE id = ?').run(at, error ?? null, id);
    this.changed();
  }

  private async sendNext(c: CampaignRow, now: number): Promise<void> {
    const window = nextWindowStart(now, c.send_from, c.send_until);
    if (window > now) return this.setNext(c.id, window);
    const next = this.db
      .prepare(`SELECT jid, name, fields FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending' ORDER BY rowid LIMIT 1`)
      .get(c.id) as { jid: string; name: string | null; fields: string } | undefined;
    if (next && this.sentToday(now) >= c.daily_cap) {
      // Daily limit reached: continue tomorrow when the sending hours start.
      return this.setNext(c.id, nextWindowStart(startOfDay(now) + 86_400_000, c.send_from, c.send_until), 'Daily limit reached; continuing tomorrow.');
    }
    if (!next) {
      this.db.prepare(`UPDATE campaigns SET status = 'done', finished_at = ?, next_at = NULL WHERE id = ?`).run(now, c.id);
      this.changed();
      const counts = this.listCampaigns().find((x) => x.id === c.id)?.counts;
      this.deps.webhooks.dispatch('broadcast.finished', { campaignId: c.id, name: c.name, counts });
      this.deps.alert(`Broadcast "${c.name}" finished`, counts ? `${counts.sent} sent, ${counts.failed} failed, ${counts.skipped} skipped.` : 'All messages were sent.');
      return;
    }
    const mark = (status: CampaignRecipient['status'], error?: string) =>
      this.db
        .prepare('UPDATE campaign_recipients SET status = ?, sent_at = ?, error = ? WHERE campaign_id = ? AND jid = ?')
        .run(status, status === 'sent' ? Date.now() : null, error ?? null, c.id, next.jid);

    if (this.db.prepare('SELECT 1 FROM opt_outs WHERE jid = ?').get(next.jid)) {
      mark('skipped', 'Opted out');
      return this.setNext(c.id, now);
    }
    const { whatsapp } = this.deps;
    try {
      const [check] = await whatsapp.checkNumbers([next.jid.split('@')[0]!]);
      if (!check?.jid) {
        mark('skipped', 'Not on WhatsApp');
        return this.setNext(c.id, now + 1_000);
      }
      const fields = JSON.parse(next.fields) as Record<string, string>;
      const name = next.name ?? this.deps.store.contactName(next.jid) ?? undefined;
      let text = renderTemplate(c.body, personValues(name, next.jid.split('@')[0], fields));
      if (c.opt_out_footer === 1) text += OPT_OUT_FOOTER;
      if (c.attachment_path) {
        await whatsapp.sendScheduled({
          target: 'chat',
          chatId: check.jid,
          body: text.trim(),
          attachment: {
            path: c.attachment_path,
            name: c.attachment_name ?? 'file',
            mimetype: c.attachment_mime ?? 'application/octet-stream',
            kind: c.attachment_kind ?? 'document',
            size: c.attachment_size ?? 0,
          },
        });
      } else {
        await whatsapp.sendText(check.jid, text.trim());
      }
      mark('sent');
      this.deps.webhooks.dispatch('broadcast.sent', { campaignId: c.id, name: c.name, chatId: check.jid, contactName: name ?? fallbackName(check.jid) });
      const pause = (c.min_delay + Math.random() * (c.max_delay - c.min_delay)) * 1000;
      this.setNext(c.id, Date.now() + pause);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!whatsapp.isOpen) {
        // Lost the connection: try this person again once it's back.
        return this.setNext(c.id, Date.now() + 30_000, message);
      }
      mark('failed', message);
      this.setNext(c.id, Date.now() + c.min_delay * 1000, message);
    }
  }
}
