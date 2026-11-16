// Insights: message volume, busiest times, top chats and reply times, computed from the
// local database (times in this computer's time zone).

import type { Insights, ReplyTimes } from '../shared/types.ts';
import { fallbackName, STATUS_CHAT, type Store } from './store.ts';

const DAY_S = 86_400;
/** Messages that count: not statuses, channels or deleted messages. */
const COUNTED = `chat_id != '${STATUS_CHAT}' AND chat_id NOT LIKE '%@newsletter' AND kind != 'deleted'`;

function localDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function replyTimes(gaps: number[]): ReplyTimes {
  const buckets: ReplyTimes['buckets'] = [0, 0, 0, 0];
  for (const g of gaps) buckets[g < 300 ? 0 : g < 3600 ? 1 : g < 6 * 3600 ? 2 : 3]++;
  return { median: median(gaps), count: gaps.length, buckets };
}

export function computeInsights(store: Store, days: number, now = Date.now()): Insights {
  const db = store.db;
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1)).getTime();
  const prevStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (2 * days - 1)).getTime();
  const fromS = Math.floor(start / 1000);
  const prevFromS = Math.floor(prevStart / 1000);

  const totalsBetween = (a: number, b: number) =>
    db
      .prepare(
        `SELECT COALESCE(SUM(from_me), 0) AS sent, COALESCE(SUM(1 - from_me), 0) AS received, COUNT(DISTINCT chat_id) AS chats
         FROM messages WHERE ${COUNTED} AND timestamp >= ? AND timestamp < ?`,
      )
      .get(a, b) as { sent: number; received: number; chats: number };
  const totals = totalsBetween(fromS, Math.floor(now / 1000) + DAY_S);
  const previous = totalsBetween(prevFromS, fromS);

  const byDay = new Map(
    (
      db
        .prepare(
          `SELECT date(timestamp, 'unixepoch', 'localtime') AS day, SUM(from_me) AS sent, SUM(1 - from_me) AS received
           FROM messages WHERE ${COUNTED} AND timestamp >= ? GROUP BY day`,
        )
        .all(fromS) as Array<{ day: string; sent: number; received: number }>
    ).map((r) => [r.day, r]),
  );
  const daily: Insights['daily'] = [];
  for (let i = 0; i < days; i++) {
    const day = localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1) + i).getTime());
    const row = byDay.get(day);
    daily.push({ day, sent: row?.sent ?? 0, received: row?.received ?? 0 });
  }

  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const cells = db
    .prepare(
      `SELECT CAST(strftime('%w', timestamp, 'unixepoch', 'localtime') AS INTEGER) AS wd,
              CAST(strftime('%H', timestamp, 'unixepoch', 'localtime') AS INTEGER) AS h, COUNT(*) AS n
       FROM messages WHERE ${COUNTED} AND timestamp >= ? GROUP BY wd, h`,
    )
    .all(fromS) as Array<{ wd: number; h: number; n: number }>;
  for (const c of cells) heatmap[c.wd]![c.h] = c.n;

  const topChats = (
    db
      .prepare(
        `SELECT chat_id, SUM(from_me) AS sent, SUM(1 - from_me) AS received, COUNT(*) AS n
         FROM messages WHERE ${COUNTED} AND timestamp >= ? GROUP BY chat_id ORDER BY n DESC LIMIT 10`,
      )
      .all(fromS) as Array<{ chat_id: string; sent: number; received: number }>
  ).map((r) => ({ chatId: r.chat_id, name: store.chatName(r.chat_id) || fallbackName(r.chat_id), sent: r.sent, received: r.received }));

  // Time between someone's message and the other side's next message, in one-to-one chats.
  const gaps = db
    .prepare(
      `SELECT from_me, timestamp - prev_ts AS gap FROM (
         SELECT from_me, timestamp,
                LAG(from_me) OVER w AS prev_from_me,
                LAG(timestamp) OVER w AS prev_ts
         FROM messages
         WHERE chat_id LIKE '%@s.whatsapp.net' AND kind != 'deleted' AND timestamp >= ?
         WINDOW w AS (PARTITION BY chat_id ORDER BY timestamp)
       )
       WHERE timestamp >= ? AND prev_from_me IS NOT NULL AND prev_from_me != from_me AND timestamp - prev_ts BETWEEN 0 AND ?`,
    )
    .all(fromS - DAY_S, fromS, DAY_S) as Array<{ from_me: number; gap: number }>;

  const count = (sql: string, ...args: number[]) => (db.prepare(sql).get(...args) as { n: number }).n;
  return {
    days,
    from: start,
    totals: {
      ...totals,
      autoReplies: count('SELECT COUNT(*) AS n FROM rule_fires WHERE at >= ?', start),
      broadcastSent: count(`SELECT COUNT(*) AS n FROM campaign_recipients WHERE status = 'sent' AND sent_at >= ?`, start),
      calls: count('SELECT COUNT(*) AS n FROM calls WHERE started_at >= ?', start),
    },
    previous,
    daily,
    heatmap,
    topChats,
    replyTimes: {
      mine: replyTimes(gaps.filter((g) => g.from_me === 1).map((g) => g.gap)),
      theirs: replyTimes(gaps.filter((g) => g.from_me === 0).map((g) => g.gap)),
    },
  };
}
