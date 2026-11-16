import { useEffect, useMemo, useState } from 'react';
import {
  WEBHOOK_EVENTS,
  type AutomationRule,
  type AutomationSettings,
  type CallSettings,
  type ChatSummary,
  type Hours,
  type Label,
  type QuickReply,
  type Reminder,
  type RuleAction,
  type RuleConfig,
  type Webhook,
  type WebhookEvent,
} from '../../../shared/types';
import { errorMessage, formatDateTime, formatRelative } from '../format';
import { ChatPicker } from './ChatPicker';
import { BellRingIcon, BoltIcon, CopyIcon, PhoneIcon, PlusIcon, TrashIcon } from './Icons';
import { Menu, Modal, useMenu } from './Menu';
import { ReminderDialog } from './ReminderDialog';

type Tab = 'rules' | 'quick' | 'calls' | 'reminders' | 'webhooks';
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BUSINESS_HOURS: Hours = { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };

async function attempt(action: () => Promise<unknown>, setError?: (e: string | null) => void): Promise<boolean> {
  try {
    setError?.(null);
    await action();
    return true;
  } catch (err) {
    if (setError) setError(errorMessage(err));
    else window.alert(errorMessage(err));
    return false;
  }
}

function useLoad<T>(load: () => Promise<T>, initial: T, events: string[]): [T, () => void] {
  const [value, setValue] = useState<T>(initial);
  const reload = () => void load().then(setValue);
  useEffect(() => {
    reload();
    return window.wapp.onEvent((e) => events.includes(e.type) && reload());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [value, reload];
}

function describeHours(h?: Hours): string {
  if (!h) return '';
  const days = h.days.length === 7 ? 'every day' : h.days.length === 5 && !h.days.includes(0) && !h.days.includes(6) ? 'Mon–Fri' : h.days.map((d) => DAY_NAMES[d]).join(', ');
  return `${days} ${h.start}–${h.end}`;
}

function describeWhen(when: RuleConfig['when']): string {
  if (when.mode === 'always') return '';
  return `${when.mode === 'inside' ? 'during' : 'outside'} ${describeHours(when.hours)}`;
}

function describeConfig(c: RuleConfig, labels: Label[], chats: ChatSummary[]): string {
  const who =
    c.scope === 'chats'
      ? `${c.chatIds?.length ?? 0} chosen chat${c.chatIds?.length === 1 ? '' : 's'}`
      : c.scope === 'contacts'
        ? 'saved contacts'
        : c.scope === 'unknown'
          ? 'numbers not in your contacts'
          : 'anyone (not groups)';
  const trigger =
    c.trigger === 'groupJoin'
      ? `People joining ${c.chatIds?.map((id) => chats.find((x) => x.id === id)?.name ?? 'a group').join(', ')}`
      : c.trigger === 'firstMessage'
        ? `First message from ${who}`
        : c.match && c.match.type !== 'any'
          ? `Messages from ${who} that ${c.match.type === 'exact' ? 'say exactly' : c.match.type === 'starts' ? 'start with' : c.match.type === 'regex' ? 'match' : 'mention'} “${c.match.text}”`
          : `Messages from ${who}`;
  const when = describeWhen(c.when);
  const actions = c.actions
    .map((a) =>
      a.type === 'reply' ? 'reply' : a.type === 'label' ? `label “${labels.find((l) => l.id === a.labelId)?.name ?? '?'}”` : a.type === 'markRead' ? 'mark read' : 'notify you',
    )
    .join(', ');
  return `${trigger}${when ? `, ${when}` : ''} → ${actions}`;
}

function HoursEditor({ hours, onChange }: { hours: Hours; onChange: (h: Hours) => void }) {
  return (
    <div className="hours-editor">
      <div className="weekday-toggles">
        {DAY_LETTERS.map((letter, day) => (
          <button
            key={day}
            type="button"
            title={DAY_NAMES[day]}
            className={hours.days.includes(day) ? 'active' : ''}
            onClick={() =>
              onChange({ ...hours, days: hours.days.includes(day) ? hours.days.filter((d) => d !== day) : [...hours.days, day].sort() })
            }
          >
            {letter}
          </button>
        ))}
      </div>
      <input type="time" value={hours.start} onChange={(e) => onChange({ ...hours, start: e.target.value })} />
      <span className="muted">to</span>
      <input type="time" value={hours.end} onChange={(e) => onChange({ ...hours, end: e.target.value })} />
    </div>
  );
}

function WhenEditor({ when, onChange, insideLabel = 'Only during', outsideLabel = 'Only outside' }: {
  when: RuleConfig['when'];
  onChange: (w: RuleConfig['when']) => void;
  insideLabel?: string;
  outsideLabel?: string;
}) {
  return (
    <div className="field">
      <span className="field-label">When</span>
      <select
        value={when.mode}
        onChange={(e) => {
          const mode = e.target.value as RuleConfig['when']['mode'];
          onChange(mode === 'always' ? { mode } : { mode, hours: when.hours ?? BUSINESS_HOURS });
        }}
      >
        <option value="always">Any time</option>
        <option value="inside">{insideLabel} these hours</option>
        <option value="outside">{outsideLabel} these hours (away)</option>
      </select>
      {when.mode !== 'always' && when.hours && <HoursEditor hours={when.hours} onChange={(hours) => onChange({ ...when, hours })} />}
    </div>
  );
}

// --- Rules ---

interface RuleDraft {
  id?: number;
  name: string;
  enabled: boolean;
  config: RuleConfig;
}

const TEMPLATES: Array<{ label: string; draft: RuleDraft }> = [
  {
    label: 'Keyword auto-reply',
    draft: {
      name: 'Prices',
      enabled: true,
      config: {
        trigger: 'message',
        scope: 'people',
        match: { type: 'contains', text: 'price, cost, rate' },
        when: { mode: 'always' },
        actions: [{ type: 'reply', text: 'Hi {first_name}! You can see all our prices here: https://example.com/prices', quote: true }],
        cooldownMinutes: 60,
      },
    },
  },
  {
    label: 'Away message',
    draft: {
      name: 'Away message',
      enabled: true,
      config: {
        trigger: 'message',
        scope: 'people',
        when: { mode: 'outside', hours: BUSINESS_HOURS },
        actions: [{ type: 'reply', text: "Thanks for your message! We're away right now and will reply during business hours (Mon–Fri, 9 am–6 pm)." }],
        cooldownMinutes: 720,
      },
    },
  },
  {
    label: 'Welcome new contacts',
    draft: {
      name: 'Welcome',
      enabled: true,
      config: {
        trigger: 'firstMessage',
        scope: 'unknown',
        when: { mode: 'always' },
        actions: [{ type: 'reply', text: 'Hi! Thanks for reaching out. How can I help you today?' }],
        cooldownMinutes: 0,
      },
    },
  },
  {
    label: 'Welcome people who join a group',
    draft: {
      name: 'Group welcome',
      enabled: true,
      config: {
        trigger: 'groupJoin',
        scope: 'chats',
        chatIds: [],
        when: { mode: 'always' },
        actions: [{ type: 'reply', text: 'Welcome {mention}! 👋 Please take a moment to read the group description.' }],
        cooldownMinutes: 0,
      },
    },
  },
];

function RuleDialog({ initial, chats, labels, onClose }: { initial: RuleDraft; chats: ChatSummary[]; labels: Label[]; onClose: () => void }) {
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const c = draft.config;
  const set = (config: Partial<RuleConfig>) => setDraft({ ...draft, config: { ...c, ...config } });
  const action = <T extends RuleAction['type']>(type: T) => c.actions.find((a) => a.type === type) as Extract<RuleAction, { type: T }> | undefined;
  const toggleAction = (a: RuleAction, on: boolean) =>
    set({ actions: on ? [...c.actions.filter((x) => x.type !== a.type), a] : c.actions.filter((x) => x.type !== a.type) });
  const updateAction = (a: RuleAction) => set({ actions: c.actions.map((x) => (x.type === a.type ? a : x)) });
  const reply = action('reply');
  const label = action('label');
  const groupJoin = c.trigger === 'groupJoin';
  const pickable = groupJoin ? chats.filter((x) => x.isGroup) : chats.filter((x) => !x.id.endsWith('@newsletter'));

  async function save() {
    if (await attempt(() => window.wapp.saveRule(draft), setError)) onClose();
  }

  return (
    <Modal
      title={draft.id ? 'Edit rule' : 'New rule'}
      wide
      onClose={onClose}
      footer={
        <>
          <label className="check-row footer-note">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
            Turned on
          </label>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" onClick={() => void save()}>
            Save rule
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Name</span>
          <input value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Trigger</span>
          <select
            value={c.trigger}
            onChange={(e) => {
              const trigger = e.target.value as RuleConfig['trigger'];
              set(
                trigger === 'groupJoin'
                  ? { trigger, scope: 'chats', chatIds: [], actions: c.actions.filter((a) => a.type === 'reply') }
                  : { trigger, scope: c.scope === 'chats' && c.trigger === 'groupJoin' ? 'people' : c.scope },
              );
            }}
          >
            <option value="message">A message arrives</option>
            <option value="firstMessage">Someone messages you for the first time</option>
            <option value="groupJoin">People join a group</option>
          </select>
        </label>
      </div>

      {!groupJoin && (
        <div className="form-grid">
          <label className="field">
            <span className="field-label">From</span>
            <select value={c.scope} onChange={(e) => set({ scope: e.target.value as RuleConfig['scope'], chatIds: c.chatIds ?? [] })}>
              <option value="people">Anyone (not groups)</option>
              <option value="contacts">Saved contacts</option>
              <option value="unknown">Numbers not in my contacts</option>
              <option value="chats">Chosen chats or groups…</option>
            </select>
          </label>
          {c.trigger === 'message' && (
            <div className="field">
              <span className="field-label">If the message</span>
              <div className="when-row">
                <select
                  value={c.match?.type ?? 'any'}
                  onChange={(e) => set({ match: { type: e.target.value as NonNullable<RuleConfig['match']>['type'], text: c.match?.text ?? '' } })}
                >
                  <option value="any">is anything</option>
                  <option value="contains">mentions any of</option>
                  <option value="exact">is exactly</option>
                  <option value="starts">starts with</option>
                  <option value="regex">matches pattern</option>
                </select>
                {c.match && c.match.type !== 'any' && (
                  <input
                    value={c.match.text}
                    placeholder={c.match.type === 'contains' ? 'price, cost, rate' : c.match.type === 'regex' ? '^order #\\d+' : 'hello'}
                    onChange={(e) => set({ match: { ...c.match!, text: e.target.value } })}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {(c.scope === 'chats' || groupJoin) && (
        <div className="field">
          <span className="field-label">{groupJoin ? 'Groups' : 'Chats'} · {c.chatIds?.length ?? 0} chosen</span>
          <ChatPicker
            entries={pickable.map((x) => ({ id: x.id, name: x.name }))}
            selected={c.chatIds ?? []}
            placeholder={groupJoin ? 'Search groups' : 'Search chats'}
            onToggle={(id) => set({ chatIds: c.chatIds?.includes(id) ? c.chatIds.filter((x) => x !== id) : [...(c.chatIds ?? []), id] })}
          />
        </div>
      )}

      <WhenEditor when={c.when} onChange={(when) => set({ when })} />

      <div className="field">
        <span className="field-label">Then</span>
        <label className="check-row">
          <input type="checkbox" checked={Boolean(reply)} onChange={(e) => toggleAction({ type: 'reply', text: '', quote: false }, e.target.checked)} />
          Reply with
        </label>
        {reply && (
          <>
            <textarea rows={3} value={reply.text} onChange={(e) => updateAction({ ...reply, text: e.target.value })} placeholder="Your reply" />
            <span className="hint">
              {'{first_name}'}, {'{name}'} and {'{phone}'} are filled in; {'{Hi|Hello}'} picks one at random.
              {groupJoin ? ' {mention} mentions the new members.' : ''}
            </span>
            {!groupJoin && (
              <label className="check-row">
                <input type="checkbox" checked={Boolean(reply.quote)} onChange={(e) => updateAction({ ...reply, quote: e.target.checked })} />
                Quote their message in the reply
              </label>
            )}
          </>
        )}
        {!groupJoin && (
          <>
            <label className="check-row">
              <input
                type="checkbox"
                checked={Boolean(label)}
                disabled={labels.length === 0}
                onChange={(e) => toggleAction({ type: 'label', labelId: labels[0]?.id ?? 0 }, e.target.checked)}
              />
              Add the label
              {label ? (
                <select value={label.labelId} onChange={(e) => updateAction({ type: 'label', labelId: Number(e.target.value) })}>
                  {labels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              ) : labels.length === 0 ? (
                <span className="muted small">(make labels from a chat's menu first)</span>
              ) : null}
            </label>
            <label className="check-row">
              <input type="checkbox" checked={Boolean(action('markRead'))} onChange={(e) => toggleAction({ type: 'markRead' }, e.target.checked)} />
              Mark the chat as read
            </label>
            <label className="check-row">
              <input type="checkbox" checked={Boolean(action('notify'))} onChange={(e) => toggleAction({ type: 'notify' }, e.target.checked)} />
              Show me a notification
            </label>
          </>
        )}
      </div>
      {!groupJoin && (
        <label className="field inline-number">
          <span className="field-label">Don't run again for the same chat within</span>
          <span>
            <input type="number" min={0} max={43200} value={c.cooldownMinutes} onChange={(e) => set({ cooldownMinutes: Number(e.target.value) })} /> minutes
          </span>
        </label>
      )}
      {error && <p className="error small">{error}</p>}
    </Modal>
  );
}

function RulesTab({ chats, labels }: { chats: ChatSummary[]; labels: Label[] }) {
  const [rules] = useLoad(() => window.wapp.listRules(), [] as AutomationRule[], ['automation-changed']);
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const { menu, close, openUnder } = useMenu();
  useEffect(() => void window.wapp.getAutomationSettings().then(setSettings), []);

  return (
    <>
      <div className="section-head">
        <p className="muted">
          Rules run on this computer while WA Premium Plus is open. They answer people, not groups, unless you choose groups,
          and they never reply to your own messages.
        </p>
        <button
          className="button primary"
          onClick={(e) =>
            openUnder(e.currentTarget, [
              ...TEMPLATES.map((t) => ({ label: t.label, onClick: () => setEditing(structuredClone(t.draft)) })),
              {
                label: 'Blank rule',
                separator: true,
                onClick: () =>
                  setEditing({
                    name: 'New rule',
                    enabled: true,
                    config: { trigger: 'message', scope: 'people', when: { mode: 'always' }, actions: [{ type: 'reply', text: '' }], cooldownMinutes: 60 },
                  }),
              },
            ])
          }
        >
          <PlusIcon size={16} /> New rule
        </button>
      </div>
      {rules.length === 0 ? (
        <div className="empty-inline">
          <BoltIcon size={28} />
          <p>No rules yet. Start with an away message or a keyword reply.</p>
        </div>
      ) : (
        <ul className="card-list">
          {rules.map((rule) => (
            <li key={rule.id} className={`card-row${rule.enabled ? '' : ' disabled'}`}>
              <label className="switch" title={rule.enabled ? 'Turn off' : 'Turn on'}>
                <input type="checkbox" checked={rule.enabled} onChange={(e) => void attempt(() => window.wapp.setRuleEnabled(rule.id, e.target.checked))} />
                <span />
              </label>
              <div className="card-main">
                <strong>{rule.name}</strong>
                <span className="muted small">{describeConfig(rule.config, labels, chats)}</span>
                <span className="muted small">
                  {rule.fires === 0 ? 'Not run yet' : `Ran ${rule.fires}×, last ${formatRelative(rule.lastFiredAt!)}`}
                </span>
              </div>
              <button className="button small" onClick={() => setEditing({ id: rule.id, name: rule.name, enabled: rule.enabled, config: structuredClone(rule.config) })}>
                Edit
              </button>
              <button
                className="icon-button tiny"
                title="Delete rule"
                onClick={() => window.confirm(`Delete the rule "${rule.name}"?`) && void attempt(() => window.wapp.deleteRule(rule.id))}
              >
                <TrashIcon size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {settings && (
        <section className="settings-block">
          <h3>Limits and opt-outs</h3>
          <label className="field inline-number">
            <span className="field-label">Send at most</span>
            <span>
              <input
                type="number"
                min={1}
                max={500}
                value={settings.maxRepliesPerHour}
                onChange={(e) => setSettings({ ...settings, maxRepliesPerHour: Number(e.target.value) })}
              />{' '}
              automatic replies per hour (protects your number if something goes wrong)
            </span>
          </label>
          <label className="field">
            <span className="field-label">Opt-out words (someone sending just one of these stops broadcasts to them)</span>
            <input
              value={settings.optOutKeywords.join(', ')}
              onChange={(e) => setSettings({ ...settings, optOutKeywords: e.target.value.split(',').map((k) => k.trim()) })}
            />
          </label>
          <label className="field">
            <span className="field-label">Reply when someone opts out (leave empty for none)</span>
            <input value={settings.optOutReply} onChange={(e) => setSettings({ ...settings, optOutReply: e.target.value })} />
          </label>
          <div>
            <button
              className="button"
              onClick={() =>
                void attempt(() => window.wapp.saveAutomationSettings({ ...settings, optOutKeywords: settings.optOutKeywords.filter(Boolean) })).then(
                  (ok) => {
                    if (!ok) return;
                    setSaved(true);
                    window.setTimeout(() => setSaved(false), 2000);
                  },
                )
              }
            >
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </section>
      )}
      {menu && <Menu {...menu} onClose={close} />}
      {editing && <RuleDialog initial={editing} chats={chats} labels={labels} onClose={() => setEditing(null)} />}
    </>
  );
}

// --- Quick replies ---

function QuickRepliesTab() {
  const [replies] = useLoad(() => window.wapp.listQuickReplies(), [] as QuickReply[], ['automation-changed']);
  const [draft, setDraft] = useState<{ id?: number; shortcut: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (draft && (await attempt(() => window.wapp.saveQuickReply(draft), setError))) setDraft(null);
  }

  return (
    <>
      <div className="section-head">
        <p className="muted">
          Type <kbd>/</kbd> in any chat to pick a saved reply. {'{first_name}'} and {'{name}'} are filled in with the person's name.
        </p>
        <button className="button primary" onClick={() => setDraft({ shortcut: '', body: '' })}>
          <PlusIcon size={16} /> New quick reply
        </button>
      </div>
      {draft && (
        <div className="inline-editor">
          <div className="when-row">
            <span className="slash">/</span>
            <input autoFocus value={draft.shortcut} placeholder="thanks" maxLength={32} onChange={(e) => setDraft({ ...draft, shortcut: e.target.value })} />
          </div>
          <textarea rows={3} value={draft.body} placeholder="Thank you, {first_name}! Have a great day." onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          {error && <p className="error small">{error}</p>}
          <div className="row-buttons">
            <button className="button" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className="button primary" onClick={() => void save()}>
              Save
            </button>
          </div>
        </div>
      )}
      {replies.length === 0 && !draft ? (
        <div className="empty-inline">
          <p>No quick replies yet.</p>
        </div>
      ) : (
        <ul className="card-list">
          {replies.map((r) => (
            <li key={r.id} className="card-row">
              <code className="shortcut">/{r.shortcut}</code>
              <div className="card-main">
                <span className="clamp">{r.body}</span>
              </div>
              <button className="button small" onClick={() => setDraft({ id: r.id, shortcut: r.shortcut, body: r.body })}>
                Edit
              </button>
              <button className="icon-button tiny" title="Delete" onClick={() => void attempt(() => window.wapp.deleteQuickReply(r.id))}>
                <TrashIcon size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// --- Calls ---

function CallsTab() {
  const [settings, setSettings] = useState<CallSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void window.wapp.getCallSettings().then(setSettings), []);
  if (!settings) return <div className="spinner" />;

  async function save() {
    if (await attempt(() => window.wapp.saveCallSettings(settings!), setError)) {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <section className="settings-block">
      <label className="check-row big">
        <label className="switch">
          <input type="checkbox" checked={settings.autoReject} onChange={(e) => setSettings({ ...settings, autoReject: e.target.checked })} />
          <span />
        </label>
        Decline incoming calls automatically and send a message
      </label>
      <label className="field">
        <span className="field-label">Message</span>
        <textarea rows={3} value={settings.message} onChange={(e) => setSettings({ ...settings, message: e.target.value })} />
        <span className="hint">Leave empty to decline without a message. {'{first_name}'} is filled in.</span>
      </label>
      <label className="field">
        <span className="field-label">Calls from</span>
        <select value={settings.scope} onChange={(e) => setSettings({ ...settings, scope: e.target.value as CallSettings['scope'] })}>
          <option value="everyone">Everyone</option>
          <option value="unknown">Only numbers not in my contacts</option>
        </select>
      </label>
      <WhenEditor when={settings.when} onChange={(when) => setSettings({ ...settings, when })} />
      <p className="hint">
        This works while WA Premium Plus is running. Your phone may still ring briefly before the call is declined.
      </p>
      {error && <p className="error small">{error}</p>}
      <div>
        <button className="button primary" onClick={() => void save()}>
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </section>
  );
}

// --- Reminders ---

function RemindersTab({ chats, onOpenChat }: { chats: ChatSummary[]; onOpenChat: (chatId: string) => void }) {
  const [reminders] = useLoad(() => window.wapp.listReminders(), [] as Reminder[], ['reminders-changed']);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState<{ chatId: string; chatName: string } | null>(null);
  const pending = reminders.filter((r) => r.status === 'pending');
  const past = reminders.filter((r) => r.status !== 'pending').slice(0, 50);
  const STATUS: Record<Reminder['status'], string> = { pending: 'Pending', done: 'Done', resolved: 'They replied', cancelled: 'Cancelled' };

  const row = (r: Reminder) => (
    <li key={r.id} className="card-row">
      <BellRingIcon size={18} />
      <div className="card-main">
        <button className="link-button" onClick={() => onOpenChat(r.chatId)}>
          <strong>{r.chatName}</strong>
        </button>
        <span className="muted small">
          {r.status === 'pending' ? `${formatDateTime(r.dueAt)} · ${formatRelative(r.dueAt)}` : `${STATUS[r.status]}${r.doneAt ? ` · ${formatDateTime(r.doneAt)}` : ''}`}
          {r.onlyIfNoReply ? ' · only if no reply' : ''}
        </span>
        {r.note && <span className="small">{r.note}</span>}
        {r.followUp && <span className="muted small clamp">Follow-up: {r.followUp}</span>}
      </div>
      {r.status === 'pending' ? (
        <button className="button small" onClick={() => void attempt(() => window.wapp.cancelReminder(r.id))}>
          Cancel
        </button>
      ) : (
        <button className="icon-button tiny" title="Delete" onClick={() => void attempt(() => window.wapp.deleteReminder(r.id))}>
          <TrashIcon size={15} />
        </button>
      )}
    </li>
  );

  return (
    <>
      <div className="section-head">
        <p className="muted">
          Get reminded to follow up, or have a follow-up sent for you, if someone hasn't replied. Set one from any chat's menu
          or a message's menu too.
        </p>
        <button className="button primary" onClick={() => setPicking(true)}>
          <PlusIcon size={16} /> New reminder
        </button>
      </div>
      {pending.length === 0 && past.length === 0 && (
        <div className="empty-inline">
          <p>No reminders.</p>
        </div>
      )}
      {pending.length > 0 && <ul className="card-list">{pending.map(row)}</ul>}
      {past.length > 0 && (
        <>
          <h3 className="list-title">Earlier</h3>
          <ul className="card-list">{past.map(row)}</ul>
        </>
      )}
      {picking && (
        <Modal title="Remind me about…" onClose={() => setPicking(false)}>
          <ChatPicker
            single
            entries={chats.filter((c) => !c.id.endsWith('@newsletter')).map((c) => ({ id: c.id, name: c.name }))}
            selected={[]}
            placeholder="Search chats"
            onToggle={(id) => {
              setPicking(false);
              setCreating({ chatId: id, chatName: chats.find((c) => c.id === id)?.name ?? id });
            }}
          />
        </Modal>
      )}
      {creating && <ReminderDialog {...creating} onClose={() => setCreating(null)} />}
    </>
  );
}

// --- Webhooks ---

const EVENT_LABELS: Record<WebhookEvent, string> = {
  'message.received': 'Message received',
  'message.sent': 'Message sent',
  'call.received': 'Incoming call',
  'scheduled.sent': 'Scheduled item sent',
  'scheduled.failed': 'Scheduled item failed',
  'broadcast.sent': 'Broadcast message sent',
  'broadcast.finished': 'Broadcast finished',
  optout: 'Someone opted out',
  'reminder.due': 'Reminder due',
};

function WebhookDialog({ initial, onClose }: { initial: { id?: number; url: string; events: WebhookEvent[]; enabled: boolean }; onClose: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title={draft.id ? 'Edit webhook' : 'New webhook'}
      onClose={onClose}
      footer={
        <>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            onClick={() => void attempt(() => window.wapp.saveWebhook(draft), setError).then((ok) => ok && onClose())}
          >
            Save
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">URL</span>
        <input autoFocus value={draft.url} placeholder="https://your-n8n.example.com/webhook/…" onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
      </label>
      <div className="field">
        <span className="field-label">Events</span>
        <div className="check-grid">
          {WEBHOOK_EVENTS.map((event) => (
            <label key={event} className="check-row">
              <input
                type="checkbox"
                checked={draft.events.includes(event)}
                onChange={(e) =>
                  setDraft({ ...draft, events: e.target.checked ? [...draft.events, event] : draft.events.filter((x) => x !== event) })
                }
              />
              {EVENT_LABELS[event]}
            </label>
          ))}
        </div>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
        Turned on
      </label>
      {error && <p className="error small">{error}</p>}
    </Modal>
  );
}

function WebhooksTab() {
  const [hooks] = useLoad(() => window.wapp.listWebhooks(), [] as Webhook[], ['automation-changed']);
  const [editing, setEditing] = useState<{ id?: number; url: string; events: WebhookEvent[]; enabled: boolean } | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  return (
    <>
      <div className="section-head">
        <p className="muted">
          Send events to n8n, Zapier, Make or your own server as JSON POST requests:{' '}
          <code>{'{ event, account, timestamp, data }'}</code>. Each request carries <code>X-WAPP-Signature: sha256=…</code>, an
          HMAC of the body with the webhook's secret, so you can check it came from this app.
        </p>
        <button className="button primary" onClick={() => setEditing({ url: '', events: ['message.received'], enabled: true })}>
          <PlusIcon size={16} /> New webhook
        </button>
      </div>
      {hooks.length === 0 ? (
        <div className="empty-inline">
          <p>No webhooks yet.</p>
        </div>
      ) : (
        <ul className="card-list">
          {hooks.map((h) => (
            <li key={h.id} className={`card-row${h.enabled ? '' : ' disabled'}`}>
              <div className="card-main">
                <strong className="mono clamp">{h.url}</strong>
                <span className="muted small">{h.events.map((e) => EVENT_LABELS[e]).join(' · ')}</span>
                <span className="muted small">
                  {h.lastStatus ? `Last delivery: ${h.lastStatus} · ${formatRelative(h.lastAt!)}` : 'Nothing sent yet'}
                  {!h.enabled && ' · off'}
                </span>
              </div>
              <button
                className="button small"
                title="Copy the signing secret"
                onClick={() =>
                  void navigator.clipboard.writeText(h.secret).then(() => {
                    setCopied(h.id);
                    window.setTimeout(() => setCopied(null), 2000);
                  })
                }
              >
                <CopyIcon size={14} /> {copied === h.id ? 'Copied' : 'Secret'}
              </button>
              <button
                className="button small"
                disabled={testing === h.id}
                onClick={() => {
                  setTesting(h.id);
                  void window.wapp
                    .testWebhook(h.id)
                    .then((status) => window.alert(`Test event sent: ${status}`))
                    .catch((err) => window.alert(errorMessage(err)))
                    .finally(() => setTesting(null));
                }}
              >
                {testing === h.id ? 'Sending…' : 'Test'}
              </button>
              <button className="button small" onClick={() => setEditing({ id: h.id, url: h.url, events: h.events, enabled: h.enabled })}>
                Edit
              </button>
              <button
                className="icon-button tiny"
                title="Delete"
                onClick={() => window.confirm('Delete this webhook?') && void attempt(() => window.wapp.deleteWebhook(h.id))}
              >
                <TrashIcon size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <WebhookDialog initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

export function AutomationView({
  chats,
  labels,
  onOpenChat,
}: {
  chats: ChatSummary[];
  labels: Label[];
  onOpenChat: (chatId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('rules');
  const tabs: Array<[Tab, string]> = useMemo(
    () => [
      ['rules', 'Rules'],
      ['quick', 'Quick replies'],
      ['calls', 'Calls'],
      ['reminders', 'Reminders'],
      ['webhooks', 'Webhooks'],
    ],
    [],
  );
  return (
    <div className="scheduled">
      <header className="content-header">
        <div>
          <h2>Automation</h2>
          <p className="muted">Auto-replies, away and welcome messages, quick replies, follow-ups and integrations.</p>
        </div>
      </header>
      <div className="tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {id === 'calls' && <PhoneIcon size={14} />}
            {label}
          </button>
        ))}
      </div>
      <div className="scheduled-body">
        {tab === 'rules' && <RulesTab chats={chats} labels={labels} />}
        {tab === 'quick' && <QuickRepliesTab />}
        {tab === 'calls' && <CallsTab />}
        {tab === 'reminders' && <RemindersTab chats={chats} onOpenChat={onOpenChat} />}
        {tab === 'webhooks' && <WebhooksTab />}
      </div>
    </div>
  );
}

