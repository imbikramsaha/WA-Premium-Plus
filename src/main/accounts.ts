// The WhatsApp numbers linked to the app. The first account keeps its data in the app's data
// folder (where versions before multi-account support kept it); others in accounts/<id>/.

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AccountSummary } from '../shared/types';
import { Account, type AccountHost } from './account';
import { clearCallsSession } from './calls';

const FILE = 'accounts.json';
const MAX_ACCOUNTS = 5;

interface SavedAccount {
  id: string;
  /** Last known name and number, to show while connecting. */
  name?: string;
  phone?: string;
}

interface Saved {
  active: string;
  accounts: SavedAccount[];
}

export class Accounts {
  private readonly dataDir: string;
  private readonly host: AccountHost;
  private readonly open = new Map<string, Account>();
  private saved: Saved;

  constructor(dataDir: string, host: AccountHost) {
    this.dataDir = dataDir;
    this.host = host;
    this.saved = this.load();
    for (const a of this.saved.accounts) this.open.set(a.id, new Account(a.id, this.dirFor(a.id), host));
    if (!this.open.has(this.saved.active)) this.saved.active = this.saved.accounts[0]!.id;
  }

  private load(): Saved {
    try {
      const parsed = JSON.parse(readFileSync(join(this.dataDir, FILE), 'utf8')) as Saved;
      const accounts = (parsed.accounts ?? []).filter((a) => /^[a-z0-9]{1,24}$/.test(a.id));
      if (accounts.length > 0) return { active: parsed.active, accounts };
    } catch {
      // first run, or an unreadable file: start with the main account
    }
    return { active: 'main', accounts: [{ id: 'main' }] };
  }

  private save(): void {
    mkdirSync(this.dataDir, { recursive: true });
    writeFileSync(join(this.dataDir, FILE), JSON.stringify(this.saved, null, 2));
  }

  private dirFor(id: string): string {
    return id === 'main' ? this.dataDir : join(this.dataDir, 'accounts', id);
  }

  get active(): Account {
    return this.open.get(this.saved.active)!;
  }

  get activeId(): string {
    return this.saved.active;
  }

  get(id: string): Account | undefined {
    return this.open.get(id);
  }

  all(): Account[] {
    return [...this.open.values()];
  }

  /** A display name for notifications when there's more than one account. */
  labelFor(id: string): string | undefined {
    if (this.open.size < 2) return undefined;
    const s = this.saved.accounts.find((a) => a.id === id);
    return s?.name || s?.phone;
  }

  startAll(): void {
    for (const account of this.open.values()) account.start();
  }

  stopAll(): void {
    for (const account of this.open.values()) account.stop();
  }

  /** Remembers the account's name and number once it's connected. */
  remember(id: string): void {
    const account = this.open.get(id);
    const me = account?.whatsapp.connection.me;
    const entry = this.saved.accounts.find((a) => a.id === id);
    if (!me || !entry) return;
    const phone = `+${me.id.split('@')[0]}`;
    if (entry.name === me.name && entry.phone === phone) return;
    entry.name = me.name;
    entry.phone = phone;
    this.save();
  }

  list(): AccountSummary[] {
    return this.saved.accounts.map((s) => {
      const account = this.open.get(s.id)!;
      const state = account.whatsapp.connection;
      const unread = account.store
        .listChats()
        .filter((c) => !c.archived && !(c.mutedUntil === -1 || c.mutedUntil > Date.now()))
        .reduce((sum, c) => sum + (c.unreadCount > 0 ? 1 : 0), 0);
      return {
        id: s.id,
        name: state.me?.name || s.name || s.phone || (state.linked ? 'WhatsApp account' : 'New account'),
        phone: state.me ? `+${state.me.id.split('@')[0]}` : s.phone,
        status: state.status,
        linked: state.linked,
        unreadChats: unread,
        active: s.id === this.saved.active,
      };
    });
  }

  switchTo(id: string): void {
    if (!this.open.has(id)) throw new Error('That account was removed.');
    this.saved.active = id;
    this.save();
  }

  /** Adds an account and makes it the active one; it shows a QR code to link. */
  add(): Account {
    if (this.open.size >= MAX_ACCOUNTS) throw new Error(`You can add up to ${MAX_ACCOUNTS} WhatsApp accounts.`);
    const id = `a${randomBytes(4).toString('hex')}`;
    const account = new Account(id, this.dirFor(id), this.host);
    this.open.set(id, account);
    this.saved.accounts.push({ id });
    this.saved.active = id;
    this.save();
    account.start();
    return account;
  }

  /** Unlinks an account and deletes its data. The last account can't be removed (log out instead). */
  async remove(id: string): Promise<void> {
    const account = this.open.get(id);
    if (!account) return;
    if (this.open.size === 1) throw new Error("This is your only account. Use Log out instead.");
    await account.whatsapp.logout({ restart: false }).catch(() => undefined);
    account.close();
    this.open.delete(id);
    this.saved.accounts = this.saved.accounts.filter((a) => a.id !== id);
    if (this.saved.active === id) this.saved.active = this.saved.accounts[0]!.id;
    this.save();
    await clearCallsSession(id);
    if (id !== 'main') await rm(account.dir, { recursive: true, force: true });
  }
}
