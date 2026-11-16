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
}

export interface ChatSummary {
  id: string;
  name: string;
  isGroup: boolean;
  unreadCount: number;
  /** Last activity WhatsApp reported (Unix seconds), even when we have no messages. */
  lastActivity?: number;
  lastMessage?: Pick<ChatMessage, 'body' | 'kind' | 'fromMe' | 'timestamp'>;
}

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
  | { type: 'scheduled-changed' };

/** The API the preload script exposes to the renderer as window.wapp. */
export interface WappApi {
  platform: string;
  getConnection(): Promise<ConnectionState>;
  logout(): Promise<void>;

  listChats(): Promise<ChatSummary[]>;
  /** Newest messages first page, or older ones before a timestamp (seconds). */
  listMessages(chatId: string, before?: number): Promise<ChatMessage[]>;
  markRead(chatId: string): Promise<void>;
  sendText(chatId: string, text: string): Promise<void>;
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
