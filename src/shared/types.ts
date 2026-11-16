// Types shared by the main process, the preload script and the renderer.

export type ConnectionStatus = 'connecting' | 'qr' | 'open';

export interface ConnectionState {
  status: ConnectionStatus;
  /** True once a WhatsApp account is linked, including while reconnecting. */
  linked: boolean;
  /** QR code as a PNG data URL, present while status is 'qr'. */
  qr?: string;
  /** The linked account, present while status is 'open'. */
  me?: { id: string; name?: string };
}

export type MessageKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'poll'
  | 'call'
  | 'deleted'
  | 'other';

export type MessageAck = 'error' | 'pending' | 'sent' | 'delivered' | 'read' | 'played';

export interface MediaInfo {
  mimetype?: string;
  fileName?: string;
  /** Size in bytes. */
  size?: number;
  /** Duration of audio and video, in seconds. */
  seconds?: number;
  /** True for voice notes (as opposed to audio files). */
  ptt?: boolean;
  /** Small preview image as a data URL, when WhatsApp includes one. */
  thumb?: string;
  width?: number;
  height?: number;
  /** URL of the downloaded file (wapp-media://...), once downloaded. */
  url?: string;
  /** False when the app doesn't have the keys to download it (for example, very old messages). */
  downloadable: boolean;
}

/** The message a reply quotes. */
export interface QuotedMessage {
  id: string;
  /** Who wrote the quoted message; unset when it was us. */
  author?: string;
  authorName?: string;
  fromMe?: boolean;
  kind: MessageKind;
  body: string;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  /** True when one of these reactions is ours. */
  mine: boolean;
}

export interface PollOption {
  name: string;
  count: number;
  /** Names of the people who picked this option. */
  voters: string[];
  mine: boolean;
}

export interface PollInfo {
  options: PollOption[];
  /** 1 for single choice; 0 when any number of options can be picked. */
  selectableCount: number;
  totalVoters: number;
}

export interface LocationInfo {
  lat: number;
  lng: number;
  name?: string;
  address?: string;
  live?: boolean;
  /** Map preview image as a data URL, when included. */
  thumb?: string;
}

export interface ContactCard {
  name: string;
  phones: Array<{ number: string; /** WhatsApp ID, when the card says the number is on WhatsApp. */ jid?: string }>;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  fromMe: boolean;
  /** Sender ID in group chats. */
  author?: string;
  /** Sender's display name in group chats. */
  authorName?: string;
  kind: MessageKind;
  /** Text, or the caption / file name for media. */
  body: string;
  /** Unix time in seconds. */
  timestamp: number;
  ack?: MessageAck;
  edited?: boolean;
  media?: MediaInfo;
  quoted?: QuotedMessage;
  forwarded?: boolean;
  reactions?: ReactionSummary[];
  poll?: PollInfo;
  location?: LocationInfo;
  contacts?: ContactCard[];
}

export interface ChatSummary {
  id: string;
  name: string;
  isGroup: boolean;
  unreadCount: number;
  /** Last activity WhatsApp reported (Unix seconds), even when we have no messages. */
  lastActivity?: number;
  lastMessage?: Pick<ChatMessage, 'body' | 'kind' | 'fromMe' | 'timestamp'>;
  archived: boolean;
  pinned: boolean;
  /** Muted until this time (Unix ms); -1 when muted forever; 0 when not muted. */
  mutedUntil: number;
  /** IDs of the labels on this chat. */
  labels: number[];
}

export interface Label {
  id: number;
  name: string;
  /** Index into the label colour palette. */
  color: number;
  /** Chats with this label. */
  count: number;
}

export interface ChannelInfo {
  id: string;
  name: string;
  description?: string;
  subscribers?: number;
  verified: boolean;
  link?: string;
  muted: boolean;
  /** Unix seconds. */
  createdAt?: number;
}

export interface AccountSummary {
  id: string;
  name: string;
  phone?: string;
  status: ConnectionStatus;
  linked: boolean;
  /** Chats with unread messages (not counting muted or archived ones). */
  unreadChats: number;
  active: boolean;
}

export type MemberAction = 'add' | 'remove' | 'promote' | 'demote';

export type CallStatus = 'missed' | 'rejected' | 'answered' | 'outgoing' | 'auto-rejected';

export interface CallRecord {
  id: string;
  chatId: string;
  chatName: string;
  fromMe: boolean;
  isVideo: boolean;
  isGroup: boolean;
  status: CallStatus;
  /** Unix ms. */
  startedAt: number;
  endedAt?: number;
}

export interface SearchResult {
  chatId: string;
  chatName: string;
  messageId: string;
  fromMe: boolean;
  authorName?: string;
  kind: MessageKind;
  /** Unix seconds. */
  timestamp: number;
  /** Matching text, with matches wrapped in \u0002 and \u0003. */
  snippet: string;
}

/** Chat actions synced with WhatsApp (your phone shows the same). */
export type ChatAction =
  | { type: 'archive'; value: boolean }
  | { type: 'pin'; value: boolean }
  /** Mute until a time (Unix ms), -1 for always, or 0 to unmute. */
  | { type: 'mute'; until: number }
  | { type: 'markUnread' }
  | { type: 'delete' };

/** What to send besides plain text and files. */
export type RichContent =
  | { type: 'poll'; question: string; options: string[]; multiple: boolean }
  | { type: 'location'; lat: number; lng: number; name?: string; address?: string }
  | { type: 'contacts'; contacts: ContactCard[] };

export interface GroupParticipantInfo {
  id: string;
  name: string;
  /** Phone number in international format, when known. */
  phone?: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isMe: boolean;
}

export interface GroupInfo {
  id: string;
  subject: string;
  description?: string;
  createdAt?: number;
  /** Only admins can send messages. */
  announce: boolean;
  /** Only admins can edit group info. */
  restrict: boolean;
  /** Only admins can add members. */
  adminsAddMembers: boolean;
  /** Admins must approve people who join with the invite link. */
  joinApproval: boolean;
  /** Disappearing-message timer in seconds; 0 when off. */
  ephemeralSeconds: number;
  amAdmin: boolean;
  participants: GroupParticipantInfo[];
}

/** A change to a group's settings that can be scheduled. Applying it requires being an admin. */
export type GroupAction =
  | { type: 'announce'; enabled: boolean }
  | { type: 'restrict'; enabled: boolean }
  | { type: 'memberAdd'; adminsOnly: boolean }
  | { type: 'joinApproval'; enabled: boolean }
  | { type: 'ephemeral'; seconds: number }
  | { type: 'subject'; text: string }
  | { type: 'description'; text: string }
  | { type: 'revokeInvite' };

// --- Scheduling ---

export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';

export interface RepeatRule {
  repeat: Repeat;
  /** For 'custom': repeat every N units. */
  interval?: number;
  unit?: 'day' | 'week' | 'month';
  /** For custom weekly rules: days of the week, 0 = Sunday ... 6 = Saturday. */
  weekdays?: number[];
  /** Stop repeating after this time (Unix ms). */
  endAt?: number;
  /**
   * IANA time zone whose wall clock the times follow (for example the recipient's).
   * Unset: the computer's own time zone.
   */
  timeZone?: string;
}

export type AttachmentKind = 'image' | 'video' | 'audio' | 'document';

export interface AttachmentInfo {
  name: string;
  mimetype: string;
  kind: AttachmentKind;
  size: number;
}

/** 'chat' sends to a chat; 'status' posts to your status; 'group' changes a group's settings. */
export type ScheduleTarget = 'chat' | 'status' | 'group';

export type ScheduleStatus = 'pending' | 'sent' | 'failed' | 'missed' | 'cancelled';

export interface ScheduledMessage {
  id: number;
  target: ScheduleTarget;
  chatId: string;
  chatName: string;
  body: string;
  /** Next send time, Unix ms. */
  sendAt: number;
  rule: RepeatRule;
  status: ScheduleStatus;
  /** The time repeats are counted from (Unix ms). */
  anchorAt: number;
  attachment?: AttachmentInfo;
  /** For target 'group': the settings change to apply. */
  groupAction?: GroupAction;
  lastError?: string;
  lastSentAt?: number;
  sentCount: number;
  createdAt: number;
}

export interface ScheduleInput {
  target: ScheduleTarget;
  /** Chats to send to. Creating with several chats makes one scheduled message per chat. */
  chatIds: string[];
  body: string;
  sendAt: number;
  rule: RepeatRule;
  /**
   * A file to attach: a local path from the file picker. Null removes the attachment;
   * undefined keeps the current one when editing.
   */
  attachmentPath?: string | null;
  /** For target 'group': the settings change to apply. */
  groupAction?: GroupAction;
  /**
   * Send at a wall-clock time ("2026-11-20T09:00") in a time zone instead of at `sendAt`:
   * an IANA zone, or 'recipient' for each person's zone guessed from their number.
   */
  wallTime?: string;
  timeZone?: string;
  /**
   * For on/off group settings: also schedule the opposite change at this time (Unix ms),
   * with the same repeat rule. For example, lock at 22:00 and open again at 07:00.
   */
  revertAt?: number;
}

// --- Automation ---

export interface QuickReply {
  id: number;
  /** Typed after a slash in the message box, e.g. "thanks" for /thanks. */
  shortcut: string;
  body: string;
}

/** Days and hours, e.g. business hours Mon–Fri 09:00–18:00 (in the computer's time zone). */
export interface Hours {
  /** 0 = Sunday ... 6 = Saturday. */
  days: number[];
  /** "HH:MM". An end before the start runs past midnight. */
  start: string;
  end: string;
}

export type RuleTrigger = 'message' | 'firstMessage' | 'groupJoin';

export type RuleAction =
  | { type: 'reply'; text: string; quote?: boolean }
  | { type: 'label'; labelId: number }
  | { type: 'markRead' }
  | { type: 'notify' };

export interface RuleConfig {
  /** 'message': any incoming message; 'firstMessage': someone's first message ever; 'groupJoin': people join a group. */
  trigger: RuleTrigger;
  /** Who it applies to. Groups are only included when chosen, so auto-replies don't flood groups. */
  scope: 'people' | 'contacts' | 'unknown' | 'chats';
  chatIds?: string[];
  match?: { type: 'any' | 'contains' | 'exact' | 'starts' | 'regex'; text: string };
  /** When the rule is active: always, only inside these hours, or only outside them (away messages). */
  when: { mode: 'always' | 'inside' | 'outside'; hours?: Hours };
  actions: RuleAction[];
  /** Don't fire again for the same chat within this many minutes. */
  cooldownMinutes: number;
}

export interface AutomationRule {
  id: number;
  name: string;
  enabled: boolean;
  config: RuleConfig;
  createdAt: number;
  fires: number;
  lastFiredAt?: number;
}

export interface CallSettings {
  /** Decline incoming calls automatically and send a message. */
  autoReject: boolean;
  message: string;
  /** Everyone, or only numbers not in your contacts. */
  scope: 'everyone' | 'unknown';
  /** Only at these times (e.g. outside business hours); 'always' otherwise. */
  when: { mode: 'always' | 'inside' | 'outside'; hours?: Hours };
}

export interface AutomationSettings {
  /** At most this many automatic replies per hour across all rules (safety limit). */
  maxRepliesPerHour: number;
  /** Words that opt someone out of broadcasts when they send them on their own. */
  optOutKeywords: string[];
  /** Reply sent to confirm an opt-out (empty: no reply). */
  optOutReply: string;
}

export type ReminderStatus = 'pending' | 'done' | 'resolved' | 'cancelled';

export interface Reminder {
  id: number;
  chatId: string;
  chatName: string;
  messageId?: string;
  note: string;
  dueAt: number;
  /** Skip the reminder if they reply before it's due. */
  onlyIfNoReply: boolean;
  /** Send this message to them when due (instead of only reminding you). */
  followUp?: string;
  status: ReminderStatus;
  createdAt: number;
  doneAt?: number;
}

export interface ReminderInput {
  chatId: string;
  messageId?: string;
  note: string;
  dueAt: number;
  onlyIfNoReply: boolean;
  followUp?: string;
}

export interface ContactList {
  id: number;
  name: string;
  count: number;
  /** Extra columns from the CSV, usable as {column} in messages. */
  columns: string[];
  createdAt: number;
}

export interface ListMember {
  jid: string;
  name?: string;
  fields: Record<string, string>;
  optedOut: boolean;
}

/** A CSV file read for import, before it's saved as a list. */
export interface CsvPreview {
  columns: string[];
  phoneColumn: number;
  nameColumn: number;
  rows: string[][];
}

export interface ListImport {
  name: string;
  /** From a CSV: the rows with chosen columns. */
  csv?: { columns: string[]; phoneColumn: number; nameColumn: number; rows: string[][]; defaultCountryCode: string };
  /** From chats or group members. */
  members?: Array<{ jid: string; name?: string }>;
}

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'done' | 'cancelled';

export interface Campaign {
  id: number;
  name: string;
  listId: number;
  listName: string;
  body: string;
  attachment?: AttachmentInfo;
  status: CampaignStatus;
  /** Don't start before this time (Unix ms). */
  startAt?: number;
  /** Most messages per day, across all broadcasts. */
  dailyCap: number;
  /** Random pause between messages, in seconds. */
  minDelay: number;
  maxDelay: number;
  /** Adds "Reply STOP to stop these messages." */
  optOutFooter: boolean;
  /** Only send between these times of day ("HH:MM"). */
  sendFrom: string;
  sendUntil: string;
  counts: { total: number; pending: number; sent: number; failed: number; skipped: number };
  nextAt?: number;
  lastError?: string;
  createdAt: number;
  finishedAt?: number;
}

export interface CampaignInput {
  name: string;
  listId: number;
  body: string;
  attachmentPath?: string | null;
  startAt?: number;
  dailyCap: number;
  minDelay: number;
  maxDelay: number;
  optOutFooter: boolean;
  sendFrom: string;
  sendUntil: string;
}

export interface CampaignRecipient {
  jid: string;
  name?: string;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  sentAt?: number;
  error?: string;
}

export interface OptOut {
  jid: string;
  name: string;
  at: number;
  source: string;
}

export const WEBHOOK_EVENTS = [
  'message.received',
  'message.sent',
  'call.received',
  'scheduled.sent',
  'scheduled.failed',
  'broadcast.sent',
  'broadcast.finished',
  'optout',
  'reminder.due',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface Webhook {
  id: number;
  url: string;
  events: WebhookEvent[];
  enabled: boolean;
  /** Used to sign each request (X-WAPP-Signature: sha256=HMAC of the body). */
  secret: string;
  lastStatus?: string;
  lastAt?: number;
}

// --- Data ---

export type ExportFormat = 'txt' | 'html' | 'csv' | 'json';

export interface ReplyTimes {
  /** Median reply time in seconds; undefined without data. */
  median?: number;
  count: number;
  /** Replies within 5 minutes, 5–60 minutes, 1–6 hours, 6–24 hours. */
  buckets: [number, number, number, number];
}

export interface Insights {
  days: number;
  /** Start of the range (Unix ms). */
  from: number;
  totals: { sent: number; received: number; chats: number; autoReplies: number; broadcastSent: number; calls: number };
  /** The same totals for the period before, for comparison. */
  previous: { sent: number; received: number; chats: number };
  /** One entry per day, oldest first ("2026-11-16"). */
  daily: Array<{ day: string; sent: number; received: number }>;
  /** Messages by weekday (0 = Sunday) and hour, in this computer's time zone. */
  heatmap: number[][];
  topChats: Array<{ chatId: string; name: string; sent: number; received: number }>;
  /** Replies in one-to-one chats (within 24 hours). */
  replyTimes: { mine: ReplyTimes; theirs: ReplyTimes };
}

/** A file to send right away, either from disk or pasted bytes. */
export type OutgoingFile =
  | { path: string }
  | { data: Uint8Array; name: string; mimetype: string };

/** Events the main process pushes to the renderer. */
export type AppEvent =
  | { type: 'connection'; state: ConnectionState }
  | { type: 'chats-changed' }
  | { type: 'message'; message: ChatMessage }
  | { type: 'ack'; chatId: string; messageId: string; ack: MessageAck }
  | { type: 'scheduled-changed' }
  /** A profile picture changed; url null when there is none. */
  | { type: 'avatar'; id: string; url: string | null }
  | { type: 'labels-changed' }
  | { type: 'statuses-changed' }
  | { type: 'calls-changed' }
  /** A pairing code to type on the phone, when linking by phone number. */
  | { type: 'pairing-code'; code: string }
  /** Account list details changed (names, connection, unread counts). */
  | { type: 'accounts-changed' }
  /** A different account is now shown: the window reloads its data. */
  | { type: 'account-switched' }
  | { type: 'automation-changed' }
  | { type: 'update'; state: UpdateState }
  /** Open a chat (from a notification). */
  | { type: 'open-chat'; chatId: string }
  | { type: 'reminders-changed' }
  | { type: 'broadcasts-changed' };

export interface ContactInfo {
  id: string;
  name: string;
  phone?: string;
}

/** The API the preload script exposes to the renderer as window.wapp. */
export interface WappApi {
  platform: string;
  getConnection(): Promise<ConnectionState>;
  logout(): Promise<void>;

  listChats(): Promise<ChatSummary[]>;
  /** Newest messages first page, or older ones before a timestamp (seconds). */
  listMessages(chatId: string, before?: number): Promise<ChatMessage[]>;
  markRead(chatId: string): Promise<void>;
  /** Sends text, optionally as a reply to one of the chat's messages. */
  sendText(chatId: string, text: string, quotedId?: string): Promise<void>;
  sendRich(chatId: string, content: RichContent, quotedId?: string): Promise<void>;
  /** Reacts to a message; an empty emoji removes our reaction. */
  react(chatId: string, messageId: string, emoji: string): Promise<void>;
  forward(chatId: string, messageId: string, toChatIds: string[]): Promise<void>;
  editMessage(chatId: string, messageId: string, text: string): Promise<void>;
  deleteMessage(chatId: string, messageId: string, forEveryone: boolean): Promise<void>;
  votePoll(chatId: string, messageId: string, options: string[]): Promise<void>;
  /** Messages around one message (for jumping to a search result or a quoted message). */
  listMessagesAround(chatId: string, messageId: string): Promise<ChatMessage[]>;
  searchMessages(query: string, chatId?: string): Promise<SearchResult[]>;

  chatAction(chatId: string, action: ChatAction): Promise<void>;
  listLabels(): Promise<Label[]>;
  saveLabel(label: { id?: number; name: string; color: number }): Promise<void>;
  deleteLabel(id: number): Promise<void>;
  setChatLabel(chatId: string, labelId: number, on: boolean): Promise<void>;
  /** Cached profile picture URL (null when there is none); fetches it in the background when stale. */
  getAvatar(id: string): Promise<string | null>;
  listCalls(): Promise<CallRecord[]>;
  /** Starts linking by phone number instead of QR code; the code arrives as a 'pairing-code' event. */
  requestPairingCode(phone: string): Promise<string>;
  /** Checks which phone numbers use WhatsApp; returns their WhatsApp IDs. */
  checkNumbers(phones: string[]): Promise<Array<{ phone: string; jid?: string }>>;
  /** Saved contacts and people you've chatted with, for pickers. */
  listContacts(): Promise<ContactInfo[]>;
  /** Opens a chat with a phone number (after checking it's on WhatsApp); returns the chat ID. */
  startChat(phone: string): Promise<string>;

  listAccounts(): Promise<AccountSummary[]>;
  switchAccount(id: string): Promise<void>;
  addAccount(): Promise<void>;
  removeAccount(id: string): Promise<void>;

  /** Status updates from the last 24 hours (yours and your contacts'). */
  listStatuses(): Promise<ChatMessage[]>;
  postStatus(text: string, file?: OutgoingFile, backgroundColor?: string): Promise<void>;
  markStatusViewed(messageId: string, author: string): Promise<void>;

  followChannel(link: string): Promise<string>;
  unfollowChannel(id: string): Promise<void>;
  getChannelInfo(id: string): Promise<ChannelInfo>;
  muteChannel(id: string, muted: boolean): Promise<void>;

  // Automation
  listQuickReplies(): Promise<QuickReply[]>;
  saveQuickReply(reply: { id?: number; shortcut: string; body: string }): Promise<void>;
  deleteQuickReply(id: number): Promise<void>;
  listRules(): Promise<AutomationRule[]>;
  saveRule(rule: { id?: number; name: string; enabled: boolean; config: RuleConfig }): Promise<void>;
  setRuleEnabled(id: number, enabled: boolean): Promise<void>;
  deleteRule(id: number): Promise<void>;
  getCallSettings(): Promise<CallSettings>;
  saveCallSettings(settings: CallSettings): Promise<void>;
  getAutomationSettings(): Promise<AutomationSettings>;
  saveAutomationSettings(settings: AutomationSettings): Promise<void>;
  listReminders(): Promise<Reminder[]>;
  createReminder(input: ReminderInput): Promise<void>;
  cancelReminder(id: number): Promise<void>;
  deleteReminder(id: number): Promise<void>;

  // Broadcasts
  readCsv(path: string): Promise<CsvPreview>;
  listContactLists(): Promise<ContactList[]>;
  createContactList(input: ListImport): Promise<{ id: number; added: number; skipped: number }>;
  listListMembers(listId: number): Promise<ListMember[]>;
  removeListMember(listId: number, jid: string): Promise<void>;
  deleteContactList(id: number): Promise<void>;
  listCampaigns(): Promise<Campaign[]>;
  saveCampaign(id: number | undefined, input: CampaignInput): Promise<number>;
  startCampaign(id: number): Promise<void>;
  pauseCampaign(id: number): Promise<void>;
  cancelCampaign(id: number): Promise<void>;
  deleteCampaign(id: number): Promise<void>;
  listCampaignRecipients(id: number): Promise<CampaignRecipient[]>;
  /** Broadcast messages sent today, against the daily limit. */
  broadcastsSentToday(): Promise<number>;
  listOptOuts(): Promise<OptOut[]>;
  addOptOut(jid: string): Promise<void>;
  removeOptOut(jid: string): Promise<void>;

  // Data
  /** Exports a chat; asks where to save it. Returns the saved path, or null if cancelled. */
  exportChat(chatId: string, format: ExportFormat, includeMedia: boolean): Promise<string | null>;
  /** Exports every chat into a folder. */
  exportAllChats(format: ExportFormat, includeMedia: boolean): Promise<string | null>;
  /** Asks where to save a text file (e.g. a CSV) and saves it. */
  saveTextFile(defaultName: string, content: string): Promise<string | null>;
  getInsights(days: number): Promise<Insights>;

  // App settings and updates
  getAppSettings(): Promise<AppSettings>;
  saveAppSettings(settings: AppSettings): Promise<void>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<void>;
  /** Quits, installs the downloaded version and starts it again. */
  installUpdate(): Promise<void>;
  appVersion(): Promise<string>;

  // Webhooks
  listWebhooks(): Promise<Webhook[]>;
  saveWebhook(input: { id?: number; url: string; events: WebhookEvent[]; enabled: boolean }): Promise<void>;
  deleteWebhook(id: number): Promise<void>;
  /** Sends a test event; returns the response status. */
  testWebhook(id: number): Promise<string>;

  /** Changes a group setting now (admins only). */
  applyGroupAction(chatId: string, action: GroupAction): Promise<void>;
  updateMembers(groupId: string, ids: string[], action: MemberAction): Promise<Array<{ id: string; problem: string }>>;
  createGroup(subject: string, members: string[]): Promise<string>;
  leaveGroup(groupId: string): Promise<void>;
  sendFile(chatId: string, file: OutgoingFile, caption?: string): Promise<void>;
  /** Sends a voice note recorded as WebM/Opus; the app converts it to WhatsApp's format. */
  sendVoiceNote(chatId: string, webm: Uint8Array, seconds: number, waveform: number[]): Promise<void>;
  requestMicrophone(): Promise<boolean>;

  /** Asks the phone to re-send a chat's recent messages so older media becomes downloadable. */
  refreshChatMedia(chatId: string): Promise<boolean>;
  /** Downloads a message's media and returns a URL the window can display. */
  downloadMedia(chatId: string, messageId: string): Promise<string>;
  openMedia(chatId: string, messageId: string): Promise<void>;
  saveMedia(chatId: string, messageId: string): Promise<void>;

  getGroupInfo(chatId: string): Promise<GroupInfo>;
  getGroupInviteLink(chatId: string): Promise<string>;

  listScheduled(): Promise<ScheduledMessage[]>;
  createScheduled(input: ScheduleInput): Promise<void>;
  updateScheduled(id: number, input: ScheduleInput): Promise<void>;
  cancelScheduled(id: number): Promise<void>;
  deleteScheduled(id: number): Promise<void>;
  sendScheduledNow(id: number): Promise<void>;

  /**
   * Opens official WhatsApp Web in its own window, for voice and video calls.
   * With a chat ID of a person, opens straight into that chat.
   */
  openCallsWindow(chatId?: string): Promise<void>;

  /** Local path of a file chosen in a file input or dropped onto the window. */
  getPathForFile(file: File): string;
  onEvent(listener: (event: AppEvent) => void): () => void;
}

// --- Updates ---

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'manual'
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  current: string;
  latest?: string;
  /** Release notes (Markdown) of the latest version. */
  notes?: string;
  /** The release's page on GitHub. */
  url?: string;
  /** Download progress, 0–1. */
  progress?: number;
  error?: string;
  /** For 'manual': how to update (e.g. the install command for .deb installs). */
  instructions?: string;
  checkedAt?: number;
}

export interface AppSettings {
  /** Look for new versions on GitHub automatically. */
  autoCheckUpdates: boolean;
  /** Download new versions in the background, ready to install on restart. */
  autoDownloadUpdates: boolean;
}
