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
  | { type: 'account-switched' };

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
