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
  | 'other';

export type MessageAck = 'error' | 'pending' | 'sent' | 'delivered' | 'read' | 'played';

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
}

export interface ChatSummary {
  id: string;
  name: string;
  isGroup: boolean;
  unreadCount: number;
  lastMessage?: Pick<ChatMessage, 'body' | 'kind' | 'fromMe' | 'timestamp'>;
}

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly';

export type ScheduleStatus = 'pending' | 'sent' | 'failed' | 'missed' | 'cancelled';

export interface ScheduledMessage {
  id: number;
  chatId: string;
  chatName: string;
  body: string;
  /** Next send time, Unix ms. */
  sendAt: number;
  repeat: Repeat;
  status: ScheduleStatus;
  lastError?: string;
  lastSentAt?: number;
  createdAt: number;
}

export interface ScheduleInput {
  chatId: string;
  body: string;
  sendAt: number;
  repeat: Repeat;
}

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
  listMessages(chatId: string): Promise<ChatMessage[]>;
  markRead(chatId: string): Promise<void>;
  sendText(chatId: string, text: string): Promise<void>;
  listScheduled(): Promise<ScheduledMessage[]>;
  createScheduled(input: ScheduleInput): Promise<void>;
  updateScheduled(id: number, input: ScheduleInput): Promise<void>;
  cancelScheduled(id: number): Promise<void>;
  deleteScheduled(id: number): Promise<void>;
  sendScheduledNow(id: number): Promise<void>;
  onEvent(listener: (event: AppEvent) => void): () => void;
}
