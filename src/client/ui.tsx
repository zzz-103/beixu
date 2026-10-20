import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type InputHTMLAttributes,
  type ButtonHTMLAttributes,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Coffee,
  ClipboardList,
  UserRound,
  Settings,
  Check,
  X,
  Clock,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Link, useApp } from './core';
import { statusLabels, type Status } from '../shared/types';
export function Button({
  children,
  busy = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy}
      className={'primary ' + className}
    >
      <span>{children}</span>
      {busy ? <span className="busy-dot" aria-label="正在处理" /> : <ArrowRight size={18} />}
    </button>
  );
}
export function TextButton({
  children,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="text-action" {...props} onClick={onClick}>
      {children}
    </button>
  );
}
export function BrandLogo({ full = false, name = '杯叙' }: { full?: boolean; name?: string }) {
  return (
    <span
      className={`brand-logo ${full ? 'brand-logo-full' : 'brand-logo-compact'}`}
      role="img"
      aria-label={`${name}标志`}
    >
      <img src="/assets/brand-logo.png" width={1254} height={1254} alt="" />
    </span>
  );
}
export function Top({ title, back = '/menu' }: { title: string; back?: string }) {
  const { menu } = useApp();
  return (
    <header className="top">
      <Link to={back} className="back" aria-label="返回">
        <ArrowLeft />
      </Link>
      {![
        '我的订单',
        '我的熟客卡',
        '店主制作台',
        '制作台',
        '菜单与豆单',
        '小店设置',
        '编辑饮品',
      ].includes(title) ? (
        <span>{title}</span>
      ) : null}
      <Link to="/menu" className="brand brand-lockup">
        <BrandLogo name={menu?.shop.name} />
        {menu?.shop.name || '杯叙'}
      </Link>
    </header>
  );
}
export function Nav({ owner = false, active = 'menu' }: { owner?: boolean; active?: string }) {
  const items = owner
    ? ([
        ['board', '/owner/board', '制作台', ClipboardList],
        ['manage', '/owner/manage', '菜单', Coffee],
        ['settings', '/owner/settings', '小店设置', Settings],
      ] as const)
    : ([
        ['menu', '/menu', '点一杯', Coffee],
        ['orders', '/orders', '我的订单', ClipboardList],
        ['profile', '/profile', '熟客卡', UserRound],
      ] as const);
  return (
    <nav className="bottom-nav" aria-label={owner ? '店主导航' : '朋友导航'}>
      {items.map(([key, to, title, Icon]) => (
        <Link
          key={key}
          to={to}
          className={'nav-item ' + (active === key ? 'active' : '')}
          aria-current={active === key ? 'page' : undefined}
        >
          <Icon />
          <span>{title}</span>
        </Link>
      ))}
    </nav>
  );
}
export function Photo({ src = 'builtin:0', label = '饮品' }: { src?: string; label?: string }) {
  const builtin = src.startsWith('builtin:');
  return builtin ? (
    <div role="img" aria-label={label} className={'photo photo-' + src.split(':')[1]} />
  ) : (
    <img className="photo uploaded-photo" src={src} alt={label} loading="lazy" />
  );
}
export function Field({
  label,
  error,
  type = 'text',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={type === 'password' ? 'password-wrap' : ''}>
        <input
          {...props}
          id={id}
          type={type === 'password' ? (show ? 'text' : 'password') : type}
          aria-invalid={!!error}
          aria-describedby={error ? id + '-error' : props['aria-describedby']}
          className={error ? 'invalid' : undefined}
        />
        {type === 'password' ? (
          <button
            type="button"
            aria-label={show ? '隐藏口令' : '显示口令'}
            aria-pressed={show}
            onClick={() => setShow((v) => !v)}
          >
            {show ? <EyeOff /> : <Eye />}
          </button>
        ) : null}
      </div>
      {error ? (
        <span id={id + '-error'} className="error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
export function MemoField({
  label,
  value,
  onChange,
  maxLength = 300,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        className="resize-none"
        id={id}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
      />
    </div>
  );
}
export function Choices({
  label,
  options,
  value,
  onChange,
  multiple = false,
}: {
  label: string;
  options: string[];
  value: string | string[];
  onChange: (value: any) => void;
  multiple?: boolean;
}) {
  return (
    <div className="option-group inline-choice" role="group" aria-label={label}>
      <h2 className="choice-label">{label}</h2>
      <div className="options">
        {options.map((s) => {
          const selected = Array.isArray(value) ? value.includes(s) : s === value;
          return (
            <button
              key={s}
              type="button"
              className={'option ' + (selected ? 'selected' : '')}
              aria-pressed={selected}
              onClick={() =>
                onChange(
                  multiple
                    ? selected
                      ? (value as string[]).filter((v) => v !== s)
                      : [...(value as string[]), s]
                    : s,
                )
              }
            >
              {s}
              {selected ? <Check size={12} /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
export function Toggle({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="switch-target"
      role="switch"
      aria-label={label}
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
    >
      <span className={'switch ' + (value ? 'on' : '')} />
    </button>
  );
}
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <nav className="tabs" aria-label="筛选">
      {items.map((v) => (
        <button
          type="button"
          key={v}
          className={v === value ? 'active' : ''}
          aria-pressed={v === value}
          onClick={() => onChange(v)}
        >
          {v}
        </button>
      ))}
    </nav>
  );
}
export function Sheet({
  title,
  className = '',
  onClose,
  children,
}: {
  title: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement;
    dialog.showModal();
    const fn = (e: Event) => {
      e.preventDefault();
      close.current();
    };
    dialog.addEventListener('cancel', fn);
    document.body.classList.add('modal-open');
    return () => {
      dialog.removeEventListener('cancel', fn);
      dialog.close();
      document.body.classList.remove('modal-open');
      previous?.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className={`sheet ${className}`} aria-labelledby={id}>
      <div className="sheet-handle" />
      <header className="sheet-header">
        <h2 id={id}>{title}</h2>
        <button type="button" onClick={onClose} aria-label="关闭">
          <X />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Empty({
  title,
  text,
  children,
}: {
  title: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Coffee />
      <h2>{title}</h2>
      {text ? <p>{text}</p> : null}
      {children}
    </div>
  );
}
export function StatusLabel({ status }: { status: Status }) {
  return (
    <span className={'status ' + (status === 'done' ? 'done' : '')}>
      {status === 'done' ? <Check /> : <Clock />}
      {statusLabels[status]}
    </span>
  );
}
export function ErrorMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return message ? (
    <div className="inline-error" role="alert">
      {message}
      {onRetry ? (
        <button type="button" className="text-action" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div role="status" className="loading-state">
      <span className="busy-dot" /> 正在准备这一页…
    </div>
  );
}
export function focusInvalid(form: HTMLFormElement | null) {
  requestAnimationFrame(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}
export { ChevronRight, Coffee, Check };
