// Pop-up menus (context menus and "more" menus) and a small dialog frame.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CheckIcon, ChevronRightIcon, CloseIcon } from './Icons';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  /** Shown as a submenu when hovered or clicked. */
  submenu?: MenuItem[];
  /** Draws a separator above this item. */
  separator?: boolean;
}

/** A menu shown at a screen position, closed by clicking outside or pressing Escape. */
export function Menu({
  items,
  x,
  y,
  alignRight,
  onClose,
}: {
  items: MenuItem[];
  /** Left edge; with alignRight, the right edge. */
  x: number;
  y: number;
  alignRight?: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [open, setOpen] = useState<number | null>(null);

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = alignRight ? x - width : x;
    setPos({
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
  }, [x, y, alignRight]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div className="menu" ref={ref} style={pos} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) => (
        <div key={`${item.label}-${i}`} className="menu-entry" onMouseEnter={() => setOpen(item.submenu ? i : null)}>
          {item.separator && <div className="menu-separator" />}
          <button
            role="menuitem"
            className={`menu-item${item.danger ? ' danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.submenu) {
                setOpen(open === i ? null : i);
                return;
              }
              onClose();
              item.onClick?.();
            }}
          >
            <span className="menu-icon">{item.checked ? <CheckIcon size={15} /> : item.icon}</span>
            <span className="menu-label">{item.label}</span>
            {item.submenu && <ChevronRightIcon size={14} />}
          </button>
          {item.submenu && open === i && (
            <div className="menu submenu" role="menu">
              {item.submenu.map((sub, j) => (
                <div key={`${sub.label}-${j}`}>
                  {sub.separator && <div className="menu-separator" />}
                  <button
                    role="menuitem"
                    className={`menu-item${sub.danger ? ' danger' : ''}`}
                    disabled={sub.disabled}
                    onClick={() => {
                      onClose();
                      sub.onClick?.();
                    }}
                  >
                    <span className="menu-icon">{sub.checked ? <CheckIcon size={15} /> : sub.icon}</span>
                    <span className="menu-label">{sub.label}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** State helper: open a menu at the mouse, or under a button. */
export function useMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; alignRight?: boolean } | null>(null);
  return {
    menu,
    close: () => setMenu(null),
    openAt: (e: { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuItem[]) => {
      e.preventDefault?.();
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    openUnder: (el: HTMLElement, items: MenuItem[], align: 'left' | 'right' = 'right') => {
      const r = el.getBoundingClientRect();
      setMenu({ x: align === 'right' ? r.right : r.left, y: r.bottom + 4, items, alignRight: align === 'right' });
    },
  };
}

/** A centred dialog with a title and a close button. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  narrow,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  narrow?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog modal${wide ? ' wide' : ''}${narrow ? ' narrow' : ''}`} role="dialog" aria-modal="true">
        <header className="dialog-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} title="Close">
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-footer">{footer}</footer>}
      </div>
    </div>
  );
}
