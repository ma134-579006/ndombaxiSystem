import React, {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';

const cx = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(' ');

/* ---------- Ícones internos mínimos ---------- */
type IconProps = { size?: number };
const Svg = ({ size = 18, children }: IconProps & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
export const XIcon = (p: IconProps) => <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>;
export const InboxIcon = (p: IconProps) => <Svg {...p}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></Svg>;
export const AlertIcon = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></Svg>;

/* ---------- Button ---------- */
export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'channel';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  block?: boolean;
  iconOnly?: boolean;
};
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, block, iconOnly, className, disabled, children, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('nx-btn', variant, size !== 'md' && size, block && 'block', iconOnly && 'icon', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="nx-spin" aria-hidden="true" />}
      {children}
    </button>
  );
});

/* ---------- Field (label + controlo + ajuda/erro) ---------- */
type FieldCtl = { id: string; describedBy?: string; invalid: boolean };
const FieldContext = createContext<FieldCtl | null>(null);

export function Field({ label, hint, error, required, children, className }: {
  label?: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; required?: boolean;
  children: React.ReactNode; className?: string;
}) {
  const id = useId();
  const descId = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <FieldContext.Provider value={{ id, describedBy: descId, invalid: !!error }}>
      <div className={cx('nx-field', className)}>
        {label && <label className="nx-label" htmlFor={id}>{label}{required && <span className="req" aria-hidden="true">*</span>}</label>}
        {children}
        {error ? <span id={`${id}-err`} className="nx-error-text" role="alert">{error}</span>
          : hint ? <span id={`${id}-hint`} className="nx-hint">{hint}</span> : null}
      </div>
    </FieldContext.Provider>
  );
}
function useFieldProps() {
  const f = useContext(FieldContext);
  return f ? { id: f.id, 'aria-describedby': f.describedBy, 'aria-invalid': f.invalid || undefined } : {};
}

export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: 'sm' | 'md' | 'lg'; leading?: React.ReactNode; trailing?: React.ReactNode; invalid?: boolean;
};
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', leading, trailing, invalid, className, ...rest }, ref,
) {
  const fp = useFieldProps();
  const el = (
    <input ref={ref} className={cx('nx-input', size !== 'md' && size, className)} {...fp} {...(invalid ? { 'aria-invalid': true } : {})} {...rest} />
  );
  if (!leading && !trailing) return el;
  return (
    <div className={cx('nx-input-wrap', leading && 'has-lead', trailing && 'has-trail')}>
      {leading && <span className="lead">{leading}</span>}
      {el}
      {trailing && <span className="trail">{trailing}</span>}
    </div>
  );
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ invalid, className, children, ...rest }, ref) {
    const fp = useFieldProps();
    return <select ref={ref} className={cx('nx-select', className)} {...fp} {...(invalid ? { 'aria-invalid': true } : {})} {...rest}>{children}</select>;
  },
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ invalid, className, ...rest }, ref) {
    const fp = useFieldProps();
    return <textarea ref={ref} className={cx('nx-textarea', className)} {...fp} {...(invalid ? { 'aria-invalid': true } : {})} {...rest} />;
  },
);

export const Checkbox = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { label?: React.ReactNode }>(
  function Checkbox({ label, className, ...rest }, ref) {
    return <label className={cx('nx-check', className)}><input ref={ref} type="checkbox" {...rest} />{label && <span>{label}</span>}</label>;
  },
);
export const Radio = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { label?: React.ReactNode }>(
  function Radio({ label, className, ...rest }, ref) {
    return <label className={cx('nx-check', className)}><input ref={ref} type="radio" {...rest} />{label && <span>{label}</span>}</label>;
  },
);
export const Switch = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { label?: React.ReactNode }>(
  function Switch({ label, className, ...rest }, ref) {
    return <label className={cx('nx-switch', className)}><input ref={ref} type="checkbox" role="switch" {...rest} />{label && <span>{label}</span>}</label>;
  },
);

/* ---------- Card ---------- */
export function Card({ pad, interactive, className, children, ...rest }: React.HTMLAttributes<HTMLDivElement> & { pad?: boolean; interactive?: boolean }) {
  return <div className={cx('nx-card', pad && 'pad', interactive && 'interactive', className)} {...rest}>{children}</div>;
}
export function CardHeader({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) {
  return <div className="nx-card-head"><h3>{title}</h3>{actions}</div>;
}
export const CardBody = ({ children }: { children: React.ReactNode }) => <div className="nx-card-body">{children}</div>;

/* ---------- Badge / Avatar ---------- */
export function Badge({ tone = 'neutral', dot, children }: { tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'channel'; dot?: boolean; children: React.ReactNode }) {
  return <span className={cx('nx-badge', tone !== 'neutral' && tone)}>{dot && <span className="dot" />}{children}</span>;
}
export function Avatar({ name, src, size = 'md' }: { name: string; src?: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  return <span className={cx('nx-avatar', size !== 'md' && size)} role="img" aria-label={name}>{src ? <img src={src} alt="" /> : initials}</span>;
}

/* ---------- Tabs (teclado: setas, Home, End) ---------- */
export function Tabs({ tabs, value, onChange, label }: { tabs: Array<{ id: string; label: React.ReactNode; disabled?: boolean }>; value: string; onChange(id: string): void; label?: string }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = tabs.length;
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? 1 : e.key === 'End' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    let j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + step + n) % n;
    for (let k = 0; k < n && tabs[j].disabled; k++) j = (j + step + n) % n;
    if (tabs[j].disabled) return;
    onChange(tabs[j].id);
    refs.current[j]?.focus();
  };
  return (
    <div className="nx-tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id} ref={(el) => { refs.current[i] = el; }} role="tab" type="button" className="nx-tab"
          aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} disabled={t.disabled}
          onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}
        >{t.label}</button>
      ))}
    </div>
  );
}

/* ---------- Alert / Skeleton / EmptyState / ErrorState ---------- */
export function Alert({ tone = 'info', title, children }: { tone?: 'info' | 'success' | 'warning' | 'danger'; title?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className={cx('nx-alert', tone !== 'info' && tone)} role={tone === 'danger' ? 'alert' : 'status'}>
      <AlertIcon />
      <div>{title && <strong>{title}</strong>}{children}</div>
    </div>
  );
}
export function Skeleton({ width = '100%', height = 14, radius }: { width?: number | string; height?: number | string; radius?: number | string }) {
  return <span className="nx-skel" style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}
export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="nx-state">
      <span className="ico">{icon ?? <InboxIcon size={26} />}</span>
      <h4>{title}</h4>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function ErrorState({ title = 'Algo correu mal', description, onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  return (
    <div className="nx-state error" role="alert">
      <span className="ico"><AlertIcon size={26} /></span>
      <h4>{title}</h4>
      {description && <p>{description}</p>}
      {onRetry && <Button variant="secondary" onClick={onRetry}>Tentar novamente</Button>}
    </div>
  );
}

/* ---------- Overlays: foco preso, Escape, bloqueio de scroll ---------- */
const FOCUSABLE = 'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
function useOverlay(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const root = ref.current;
    (root?.querySelector<HTMLElement>('[autofocus],[data-autofocus]') ?? root?.querySelector<HTMLElement>(FOCUSABLE) ?? root)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !root) return;
      const els = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!els.length) { e.preventDefault(); return; }
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; prev?.focus?.(); };
  }, [open, onClose, ref]);
}

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose(): void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const tid = useId();
  useOverlay(open, onClose, ref);
  if (!open) return null;
  return createPortal(
    <div className="nx-scrim nx-root" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={cx('nx-modal', wide && 'wide')} role="dialog" aria-modal="true" aria-labelledby={tid} tabIndex={-1}>
        <div className="nx-modal-head"><h3 id={tid}>{title}</h3><Button variant="ghost" size="sm" iconOnly aria-label="Fechar" onClick={onClose}><XIcon /></Button></div>
        <div className="nx-modal-body">{children}</div>
        {footer && <div className="nx-modal-foot">{footer}</div>}
      </div>
    </div>, document.body,
  );
}

export function Drawer({ open, title, onClose, children, footer, side = 'right' }: { open: boolean; title: string; onClose(): void; children: React.ReactNode; footer?: React.ReactNode; side?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  const tid = useId();
  useOverlay(open, onClose, ref);
  if (!open) return null;
  return createPortal(
    <div className="nx-root" style={{ background: 'transparent' }}>
      <div className="nx-drawer-scrim" onMouseDown={onClose} />
      <aside ref={ref} className={cx('nx-drawer', side === 'left' && 'left')} role="dialog" aria-modal="true" aria-labelledby={tid} tabIndex={-1}>
        <div className="nx-modal-head"><h3 id={tid}>{title}</h3><Button variant="ghost" size="sm" iconOnly aria-label="Fechar" onClick={onClose}><XIcon /></Button></div>
        <div className="nx-modal-body" style={{ flex: 1 }}>{children}</div>
        {footer && <div className="nx-modal-foot">{footer}</div>}
      </aside>
    </div>, document.body,
  );
}

/* ---------- Toast ---------- */
type ToastItem = { id: number; tone: 'info' | 'success' | 'warning' | 'danger'; message: React.ReactNode };
const ToastContext = createContext<((t: Omit<ToastItem, 'id'>) => void) | null>(null);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = ++seq.current;
    setItems((l) => [...l, { ...t, id }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      {createPortal(
        <div className="nx-toasts nx-root" style={{ background: 'transparent' }} role="region" aria-label="Notificações" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className={cx('nx-toast', t.tone !== 'info' && t.tone)}>
              <span className="msg">{t.message}</span>
              <Button variant="ghost" size="sm" iconOnly aria-label="Fechar notificação" onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))}><XIcon size={14} /></Button>
            </div>
          ))}
        </div>, document.body,
      )}
    </ToastContext.Provider>
  );
}
export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error('useToast requer <ToastProvider>');
  return push;
}

/* ---------- Tooltip / Dropdown ---------- */
export function Tooltip({ label, children }: { label: string; children: React.ReactElement }) {
  const id = useId();
  return (
    <span className="nx-tip">
      {React.cloneElement(children, { 'aria-describedby': id })}
      <span id={id} role="tooltip" className="nx-tip-bubble">{label}</span>
    </span>
  );
}

export function Dropdown({ trigger, items, align = 'right' }: {
  trigger: (p: { onClick(): void; 'aria-haspopup': 'menu'; 'aria-expanded': boolean }) => React.ReactNode;
  items: Array<{ label: React.ReactNode; onSelect(): void; danger?: boolean; disabled?: boolean }>;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector<HTMLElement>('button')?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const els = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
      if (!els.length) return;
      e.preventDefault();
      const i = els.indexOf(document.activeElement as HTMLElement);
      els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length].focus();
    };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="nx-dd" ref={ref}>
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-haspopup': 'menu', 'aria-expanded': open })}
      {open && (
        <div className={cx('nx-menu', align === 'left' && 'left')} role="menu">
          {items.map((it, i) => (
            <button key={i} type="button" role="menuitem" disabled={it.disabled} className={cx('nx-menu-item', it.danger && 'danger')}
              onClick={() => { setOpen(false); it.onSelect(); }}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Navegação ---------- */
export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Localização">
      <ol className="nx-crumbs">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return <li key={i}>{it.href && !last ? <a href={it.href}>{it.label}</a> : <span aria-current={last ? 'page' : undefined}>{it.label}</span>}</li>;
        })}
      </ol>
    </nav>
  );
}
export function PageHeader({ title, description, actions, breadcrumb }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; breadcrumb?: React.ReactNode }) {
  return (
    <header>
      {breadcrumb && <div style={{ marginBottom: 8 }}>{breadcrumb}</div>}
      <div className="nx-pagehead">
        <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
        {actions && <div className="actions">{actions}</div>}
      </div>
    </header>
  );
}
export function NavList({ items, current, onSelect, label }: { items: Array<{ id: string; label: React.ReactNode; icon?: React.ReactNode }>; current: string; onSelect(id: string): void; label?: string }) {
  return (
    <nav className="nx-nav" aria-label={label}>
      {items.map((it) => (
        <button key={it.id} type="button" className="nx-nav-item" aria-current={it.id === current ? 'page' : undefined} onClick={() => onSelect(it.id)}>
          {it.icon}{it.label}
        </button>
      ))}
    </nav>
  );
}

/* ---------- DataTable ---------- */
export type Column<T> = { key: string; header: React.ReactNode; render?: (row: T) => React.ReactNode; numeric?: boolean; sortable?: boolean; sortValue?: (row: T) => string | number };
export function DataTable<T>({ columns, rows, rowKey, caption, loading, empty, error, onRetry, onRowClick }: {
  columns: Array<Column<T>>; rows: T[]; rowKey: (r: T) => string; caption: string; loading?: boolean;
  empty?: React.ReactNode; error?: string; onRetry?: () => void; onRowClick?: (r: T) => void;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
  const data = col && sort
    ? [...rows].sort((a, b) => {
        const va = col.sortValue ? col.sortValue(a) : ((a as any)[col.key] as any);
        const vb = col.sortValue ? col.sortValue(b) : ((b as any)[col.key] as any);
        return (va > vb ? 1 : va < vb ? -1 : 0) * sort.dir;
      })
    : rows;
  if (error) return <div className="nx-table-wrap"><ErrorState description={error} onRetry={onRetry} /></div>;
  return (
    <div className="nx-table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="nx-table">
        <caption className="nx-sr">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'num' : undefined}
                aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                {c.sortable
                  ? <button type="button" onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key: c.key, dir: 1 }))}>
                      {c.header}<span aria-hidden="true">{sort?.key === c.key ? (sort.dir === 1 ? '↑' : '↓') : '↕'}</span>
                    </button>
                  : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>{columns.map((c) => <td key={c.key}><Skeleton width={c.numeric ? 60 : '80%'} /></td>)}</tr>
              ))
            : data.map((r) => (
                <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} style={onRowClick ? { cursor: 'pointer' } : undefined}>
                  {columns.map((c) => <td key={c.key} className={c.numeric ? 'num' : undefined}>{c.render ? c.render(r) : String((r as any)[c.key] ?? '')}</td>)}
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && data.length === 0 && (empty ?? <EmptyState title="Sem resultados" description="Ainda não há registos para mostrar." />)}
    </div>
  );
}
