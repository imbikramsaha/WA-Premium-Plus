// A searchable list for picking chats or contacts.

import { useMemo, useState } from 'react';
import { Avatar } from './Avatar';
import { SearchIcon } from './Icons';

export interface PickerEntry {
  id: string;
  name: string;
  detail?: string;
}

export function ChatPicker({
  entries,
  selected,
  onToggle,
  max,
  placeholder = 'Search',
  emptyText = 'Nothing found.',
  single,
}: {
  entries: PickerEntry[];
  selected: string[];
  onToggle: (id: string) => void;
  max?: number;
  placeholder?: string;
  emptyText?: string;
  /** Picks one: no checkboxes. */
  single?: boolean;
}) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return entries
      .filter((e) => !q || e.name.toLowerCase().includes(q) || (digits.length > 2 && e.id.includes(digits)))
      .slice(0, 300);
  }, [entries, query]);
  const full = max !== undefined && selected.length >= max;

  return (
    <div className="picker">
      <div className="search">
        <SearchIcon size={16} />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} />
      </div>
      <ul className="picker-list">
        {matches.map((entry) => {
          const isSelected = selected.includes(entry.id);
          return (
            <li key={entry.id}>
              <button
                type="button"
                className={`picker-row${isSelected ? ' selected' : ''}`}
                disabled={!isSelected && full && !single}
                onClick={() => onToggle(entry.id)}
              >
                {!single && <input type="checkbox" readOnly checked={isSelected} tabIndex={-1} />}
                <Avatar id={entry.id} name={entry.name} size={28} />
                <span>{entry.name}</span>
                {entry.detail && <small className="muted">{entry.detail}</small>}
              </button>
            </li>
          );
        })}
        {matches.length === 0 && <li className="list-empty">{emptyText}</li>}
      </ul>
    </div>
  );
}
