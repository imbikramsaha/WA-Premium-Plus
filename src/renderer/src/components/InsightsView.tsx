// Insights: KPI tiles, messages per day (two lines), busiest times (heatmap), most active chats
// (ranked bars) and reply times (grouped bars). Every chart has a hover layer and a table view.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Insights } from '../../../shared/types';
import { errorMessage } from '../format';
import { ChartIcon } from './Icons';

const RANGES = [7, 30, 90, 365] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const number = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const dayLabel = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const dayLong = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return '–';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const h = seconds / 3600;
  return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
}

/** Width of an element, kept up to date. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Round axis maximum and tick step. */
function niceScale(max: number, ticks = 4): { max: number; step: number } {
  if (max <= 0) return { max: ticks, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  return { max: Math.ceil(max / step) * step, step };
}

function tick(n: number, max: number): string {
  return max >= 10_000 ? compact.format(n) : number.format(n);
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x + 14, 8), width - 190);
  return (
    <div className="viz-tooltip" style={{ left, top: Math.max(0, y - 10) }}>
      {children}
    </div>
  );
}

function Card({ title, subtitle, table, children }: { title: string; subtitle?: string; table?: ReactNode; children: ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="viz-card">
      <header>
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {table && (
          <button className="button small ghost" onClick={() => setShowTable((v) => !v)}>
            {showTable ? 'Chart' : 'Table'}
          </button>
        )}
      </header>
      {showTable ? <div className="table-wrap">{table}</div> : children}
    </section>
  );
}

function StatTile({ label, value, delta, hint }: { label: string; value: string; delta?: string; hint?: string }) {
  return (
    <div className="stat-tile" title={hint}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {delta && <span className="stat-delta">{delta}</span>}
    </div>
  );
}

function change(now: number, before: number, days: number): string | undefined {
  if (before === 0) return now === 0 ? undefined : `New vs the previous ${days} days`;
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct)}% vs the previous ${days} days`;
}

// --- Messages per day: two lines ---

function DailyChart({ data }: { data: Insights['daily'] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 220;
  const pad = { top: 12, right: 64, bottom: 26, left: 40 };
  const innerW = Math.max(10, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const peak = Math.max(1, ...data.map((d) => Math.max(d.sent, d.received)));
  const { max, step } = niceScale(peak);
  const x = (i: number) => pad.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const path = (key: 'sent' | 'received') => data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join('');
  const area = (key: 'sent' | 'received') => `${path(key)}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const last = data[data.length - 1];
  const labelsFit = last ? Math.abs(y(last.sent) - y(last.received)) >= 14 : false;
  const every = Math.ceil(data.length / Math.max(2, Math.floor(innerW / 70)));
  const series = [
    { key: 'received' as const, name: 'Received', cls: 'viz-1' },
    { key: 'sent' as const, name: 'Sent', cls: 'viz-2' },
  ];

  return (
    <div className="viz-plot" ref={ref}>
      <div className="viz-legend">
        {series.map((s) => (
          <span key={s.key}>
            <i className={`key-line ${s.cls}`} />
            {s.name}
          </span>
        ))}
      </div>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Messages sent and received per day"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - r.left;
            const i = Math.round(((px - pad.left) / innerW) * (data.length - 1));
            setHover(Math.max(0, Math.min(data.length - 1, i)));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step).map((v) => (
            <g key={v}>
              <line className={v === 0 ? 'viz-baseline' : 'viz-grid'} x1={pad.left} x2={pad.left + innerW} y1={y(v)} y2={y(v)} />
              <text className="viz-tick" x={pad.left - 8} y={y(v)} dy="0.32em" textAnchor="end">
                {tick(v, max)}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            i % every === 0 || i === data.length - 1 ? (
              <text key={d.day} className="viz-tick" x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>
                {dayLabel.format(parseDay(d.day))}
              </text>
            ) : null,
          )}
          {series.map((s) => (
            <g key={s.key} className={s.cls}>
              <path className="viz-area" d={area(s.key)} />
              <path className="viz-line" d={path(s.key)} />
              {last && <circle className="viz-dot" cx={x(data.length - 1)} cy={y(last[s.key])} r={4} />}
              {last && labelsFit && (
                <text className="viz-end-label" x={x(data.length - 1) + 10} y={y(last[s.key])} dy="0.32em">
                  {s.name} {number.format(last[s.key])}
                </text>
              )}
            </g>
          ))}
          {hover !== null && (
            <g>
              <line className="viz-crosshair" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} />
              {series.map((s) => (
                <circle key={s.key} className={`viz-dot ${s.cls}`} cx={x(hover)} cy={y(data[hover]![s.key])} r={4} />
              ))}
            </g>
          )}
        </svg>
      )}
      {hover !== null && data[hover] && (
        <Tooltip x={x(hover)} y={pad.top} width={width}>
          <div className="viz-tooltip-title">{dayLong.format(parseDay(data[hover].day))}</div>
          {series.map((s) => (
            <div key={s.key} className="viz-tooltip-row">
              <i className={`key-line ${s.cls}`} />
              <strong>{number.format(data[hover]![s.key])}</strong>
              <span>{s.name.toLowerCase()}</span>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

// --- Busiest times: heatmap ---

function Heatmap({ grid }: { grid: number[][] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const peak = Math.max(1, ...grid.flat());
  const left = 40;
  const gap = 2;
  const cell = Math.max(8, Math.min(28, (width - left - 4) / 24 - gap));
  const height = 7 * (cell + gap) + 22;
  // Monday first: most people's week.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const level = (n: number) => (n === 0 ? 0 : Math.min(7, 1 + Math.floor((n / peak) * 6.999)));
  return (
    <div className="viz-plot" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Messages by day of the week and hour" onPointerLeave={() => setHover(null)}>
          {order.map((d, row) => (
            <g key={d}>
              <text className="viz-tick" x={left - 8} y={row * (cell + gap) + cell / 2} dy="0.32em" textAnchor="end">
                {WEEKDAYS[d]}
              </text>
              {grid[d]!.map((n, h) => (
                <rect
                  key={h}
                  className={`heat heat-${level(n)}${hover?.d === d && hover.h === h ? ' hover' : ''}`}
                  x={left + h * (cell + gap)}
                  y={row * (cell + gap)}
                  width={cell}
                  height={cell}
                  rx={3}
                  onPointerEnter={() => setHover({ d, h })}
                />
              ))}
            </g>
          ))}
          {[0, 6, 12, 18, 23].map((h) => (
            <text key={h} className="viz-tick" x={left + h * (cell + gap) + cell / 2} y={height - 4} textAnchor="middle">
              {String(h).padStart(2, '0')}:00
            </text>
          ))}
        </svg>
      )}
      <div className="viz-scale">
        <span>Fewer</span>
        {[1, 2, 3, 4, 5, 6, 7].map((l) => (
          <i key={l} className={`heat-${l}`} />
        ))}
        <span>More</span>
      </div>
      {hover && (
        <Tooltip x={left + hover.h * (cell + gap) + cell} y={order.indexOf(hover.d) * (cell + gap)} width={width}>
          <div className="viz-tooltip-row">
            <strong>{number.format(grid[hover.d]![hover.h]!)}</strong>
            <span>messages</span>
          </div>
          <div className="viz-tooltip-title">
            {WEEKDAYS[hover.d]} {String(hover.h).padStart(2, '0')}:00–{String((hover.h + 1) % 24).padStart(2, '0')}:00
          </div>
        </Tooltip>
      )}
    </div>
  );
}

// --- Ranked horizontal bars ---

function RankedBars({ rows, onPick }: { rows: Array<{ id: string; label: string; value: number; detail: string }>; onPick?: (id: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="ranked">
      {rows.map((r) => (
        <li key={r.id}>
          <button className="ranked-row" title={r.detail} onClick={() => onPick?.(r.id)} disabled={!onPick}>
            <span className="ranked-label">{r.label}</span>
            <span className="ranked-track">
              <span className="ranked-bar viz-1-fill" style={{ width: `${(r.value / max) * 100}%` }} />
              <span className="ranked-value">{number.format(r.value)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// --- Reply times: grouped bars ---

const BUCKETS = ['Within 5 minutes', '5 to 60 minutes', '1 to 6 hours', '6 to 24 hours'];

function ReplyBars({ data }: { data: Insights['replyTimes'] }) {
  const mineTotal = Math.max(1, data.mine.count);
  const theirTotal = Math.max(1, data.theirs.count);
  const share = (n: number, total: number) => Math.round((n / total) * 100);
  return (
    <div className="reply-bars">
      <div className="viz-legend">
        <span>
          <i className="key-rect viz-1-fill" />
          You
        </span>
        <span>
          <i className="key-rect viz-2-fill" />
          Them
        </span>
      </div>
      {BUCKETS.map((label, i) => (
        <div key={label} className="reply-row">
          <span className="ranked-label">{label}</span>
          <div className="reply-pair">
            {[
              { cls: 'viz-1-fill', pct: share(data.mine.buckets[i]!, mineTotal), n: data.mine.buckets[i]!, who: 'You' },
              { cls: 'viz-2-fill', pct: share(data.theirs.buckets[i]!, theirTotal), n: data.theirs.buckets[i]!, who: 'Them' },
            ].map((b) => (
              <span key={b.who} className="ranked-track thin" title={`${b.who}: ${b.n} replies (${b.pct}%)`}>
                <span className={`ranked-bar ${b.cls}`} style={{ width: `${b.pct}%` }} />
                <span className="ranked-value">{b.pct}%</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function InsightsView({ onOpenChat }: { onOpenChat: (chatId: string) => void }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    window.wapp
      .getInsights(days)
      .then((d) => {
        if (!active) return;
        setData(d);
        setError(null);
      })
      .catch((err) => active && setError(errorMessage(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [days]);

  const top = useMemo(
    () =>
      (data?.topChats ?? []).map((c) => ({
        id: c.chatId,
        label: c.name,
        value: c.sent + c.received,
        detail: `${c.name}: ${number.format(c.received)} received, ${number.format(c.sent)} sent`,
      })),
    [data],
  );

  const busiest = useMemo(() => {
    if (!data) return undefined;
    let best = { d: 0, h: 0, n: 0 };
    data.heatmap.forEach((row, d) => row.forEach((n, h) => n > best.n && (best = { d, h, n })));
    const plural = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
    return best.n ? `Busiest: ${plural[best.d]} around ${String(best.h).padStart(2, '0')}:00` : undefined;
  }, [data]);

  return (
    <div className="scheduled insights">
      <header className="content-header">
        <div>
          <h2>Insights</h2>
          <p className="muted">From the messages on this computer. Statuses and channels aren't counted.</p>
        </div>
      </header>
      <div className="filters padded">
        {RANGES.map((r) => (
          <button key={r} className={`chip${days === r ? ' active' : ''}`} onClick={() => setDays(r)}>
            {r === 365 ? 'Last year' : `Last ${r} days`}
          </button>
        ))}
      </div>
      <div className={`scheduled-body${loading && data ? ' refreshing' : ''}`}>
        {error && <p className="error">{error}</p>}
        {!data && loading && <div className="spinner" />}
        {data && (
          <>
            <div className="stat-row">
              <StatTile label="Messages received" value={number.format(data.totals.received)} delta={change(data.totals.received, data.previous.received, days)} />
              <StatTile label="Messages sent" value={number.format(data.totals.sent)} delta={change(data.totals.sent, data.previous.sent, days)} />
              <StatTile label="Active chats" value={number.format(data.totals.chats)} delta={change(data.totals.chats, data.previous.chats, days)} />
              <StatTile
                label="Your typical reply time"
                value={formatDuration(data.replyTimes.mine.median)}
                delta={data.replyTimes.mine.count ? `Median of ${number.format(data.replyTimes.mine.count)} replies` : 'No replies yet'}
                hint="Time from someone's message to your next message, in one-to-one chats, within a day"
              />
              <StatTile label="Automatic replies" value={number.format(data.totals.autoReplies)} delta="From automation rules" />
              <StatTile label="Broadcast messages" value={number.format(data.totals.broadcastSent)} delta={`${number.format(data.totals.calls)} calls logged`} />
            </div>

            <Card
              title="Messages per day"
              subtitle={`Received and sent, last ${days} days`}
              table={
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Received</th>
                      <th>Sent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.daily].reverse().map((d) => (
                      <tr key={d.day}>
                        <td>{dayLong.format(parseDay(d.day))}</td>
                        <td className="num">{number.format(d.received)}</td>
                        <td className="num">{number.format(d.sent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <DailyChart data={data.daily} />
            </Card>

            <div className="viz-grid-2">
              <Card
                title="Busiest times"
                subtitle={busiest ?? 'Messages by day and hour'}
                table={
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Hour</th>
                        {WEEKDAYS.map((d) => (
                          <th key={d}>{d}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: 24 }, (_, h) => (
                        <tr key={h}>
                          <td>{String(h).padStart(2, '0')}:00</td>
                          {WEEKDAYS.map((_, d) => (
                            <td key={d} className="num">
                              {data.heatmap[d]![h]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                }
              >
                <Heatmap grid={data.heatmap} />
              </Card>
              <Card
                title="Reply times"
                subtitle={`Their typical reply: ${formatDuration(data.replyTimes.theirs.median)} · yours: ${formatDuration(data.replyTimes.mine.median)}`}
                table={
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Reply within</th>
                        <th>You</th>
                        <th>Them</th>
                      </tr>
                    </thead>
                    <tbody>
                      {BUCKETS.map((b, i) => (
                        <tr key={b}>
                          <td>{b}</td>
                          <td className="num">{data.replyTimes.mine.buckets[i]}</td>
                          <td className="num">{data.replyTimes.theirs.buckets[i]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                }
              >
                <ReplyBars data={data.replyTimes} />
              </Card>
            </div>

            <Card title="Most active chats" subtitle="Messages in the period · click a chat to open it">
              {top.length ? <RankedBars rows={top} onPick={onOpenChat} /> : <p className="muted">No messages in this period.</p>}
            </Card>
          </>
        )}
        {data && data.totals.sent + data.totals.received === 0 && (
          <div className="empty-inline">
            <ChartIcon size={28} />
            <p>No messages in this period yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
