import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useState,
  useRef,
  type ReactNode,
} from 'react';
import type { MenuData, SessionResponse, ApiErrorBody } from '../shared/types';
export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  constructor(status: number, body: ApiErrorBody) {
    super(body.error?.message || '暂时无法完成，请稍后再试。');
    this.status = status;
    this.code = body.error?.code || 'ERROR';
    this.fields = body.error?.fields || {};
  }
}
export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(15000),
      credentials: 'same-origin',
      headers: {
        ...(init.body && typeof init.body === 'string'
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, {
      error: { code: 'NETWORK', message: '网络暂时断开，已保留当前内容，请重试。' },
    });
  }
  const body = await response.json().catch(() => null);
  if (body === null)
    throw new ApiError(502, {
      error: { code: 'INVALID_RESPONSE', message: '服务暂时不可用，请重试。' },
    });
  if (!response.ok) throw new ApiError(response.status, body as ApiErrorBody);
  return body as T;
}
export const json = (data: unknown, method = 'POST'): RequestInit => ({
  method,
  body: JSON.stringify(data),
});
interface AppState {
  session: SessionResponse;
  menu: MenuData | null;
  path: string;
  loading: boolean;
  navigate: (path: string) => void;
  notify: (text: string) => void;
  refresh: () => Promise<void>;
  reloadMenu: () => Promise<void>;
  registerGuard: (fn: (next: string) => boolean) => () => void;
}
const Context = createContext<AppState | null>(null);
export function useApp() {
  const c = useContext(Context);
  if (!c) throw new Error('AppProvider required');
  return c;
}
export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionResponse>({ user: null, owner: false });
  const [menu, setMenu] = useState<MenuData | null>(null);
  const [path, setPath] = useState(location.pathname);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [bootError, setBootError] = useState('');
  const guard = useRef<((next: string) => boolean) | null>(null);
  const currentPath = useRef(path);
  currentPath.current = path;
  const registerGuard = useCallback((fn: (next: string) => boolean) => {
    guard.current = fn;
    return () => {
      if (guard.current === fn) guard.current = null;
    };
  }, []);
  const notify = useCallback((text: string) => setMessage(text), []);
  const navigate = useCallback((path: string) => {
    if (path !== currentPath.current && guard.current && !guard.current(path)) return;
    history.pushState(null, '', path);
    setPath(path);
    window.scrollTo(0, 0);
  }, []);
  const reloadMenu = useCallback(async () => {
    setMenu(await api<MenuData>('/api/menu'));
  }, []);
  const refresh = useCallback(async () => {
    const [s, m] = await Promise.all([
      api<SessionResponse>('/api/session'),
      api<MenuData>('/api/menu'),
    ]);
    setSession(s);
    setMenu(m);
    setBootError('');
  }, []);
  useEffect(() => {
    refresh()
      .catch((e) => setBootError(e.message))
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    const fn = () => {
      const next = location.pathname;
      if (guard.current && !guard.current(next)) {
        history.pushState(null, '', currentPath.current);
        return;
      }
      setPath(next);
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', fn);
    return () => window.removeEventListener('popstate', fn);
  }, []);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(id);
  }, [message]);
  useEffect(() => {
    let active = true;
    const onVisible = () => {
      if (!document.hidden) refresh().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(() => {
      if (active && !document.hidden) reloadMenu().catch(() => {});
    }, 30000);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, reloadMenu]);
  return (
    <Context.Provider
      value={{ session, menu, path, loading, navigate, notify, refresh, reloadMenu, registerGuard }}
    >
      {bootError ? (
        <div className="startup-error" role="alert">
          <p>{bootError}</p>
          <button
            onClick={() => {
              setLoading(true);
              refresh()
                .catch((e) => setBootError(e.message))
                .finally(() => setLoading(false));
            }}
          >
            重新连接
          </button>
        </div>
      ) : (
        children
      )}
      <div className="toast" role="status" aria-live="polite">
        {message}
      </div>
    </Context.Provider>
  );
}
export function Link({
  to,
  children,
  ...props
}: { to: string; children: ReactNode } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
>) {
  const { navigate } = useApp();
  return (
    <a
      href={to}
      {...props}
      onClick={(e) => {
        props.onClick?.(e);
        if (!e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
          e.preventDefault();
          navigate(to);
        }
      }}
    >
      {children}
    </a>
  );
}
export function useRemote<T>(url: string | null, { poll = 0 }: { poll?: number } = {}) {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({
    data: null,
    error: '',
    loading: !!url,
  });
  const seq = useRef(0);
  const mounted = useRef(true);
  const reload = useCallback(async () => {
    if (!url) return null;
    const n = ++seq.current;
    try {
      const data = await api<T>(url);
      if (mounted.current && n === seq.current) setState({ data, error: '', loading: false });
      return data;
    } catch (e) {
      if (mounted.current && n === seq.current)
        setState((s) => ({ ...s, error: (e as Error).message, loading: false }));
      return null;
    }
  }, [url]);
  useEffect(() => {
    mounted.current = true;
    setState({ data: null, error: '', loading: !!url });
    void reload();
    return () => {
      mounted.current = false;
      ++seq.current;
    };
  }, [reload, url]);
  useEffect(() => {
    if (!poll || !url) return;
    const run = () => {
      if (!document.hidden) void reload();
    };
    const id = setInterval(run, poll);
    document.addEventListener('visibilitychange', run);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', run);
    };
  }, [poll, url, reload]);
  return { ...state, reload };
}

export function useNavigationGuard(dirty: boolean) {
  const { registerGuard, navigate } = useApp();
  const [pending, setPending] = useState<string | null>(null);
  const bypass = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    return registerGuard((next) => {
      if (bypass.current) return true;
      setPending(next);
      return false;
    });
  }, [dirty, registerGuard]);
  useEffect(() => {
    if (!dirty) return;
    const fn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [dirty]);
  return {
    pending,
    stay: () => setPending(null),
    leave: () => {
      if (!pending) return;
      bypass.current = true;
      const next = pending;
      setPending(null);
      navigate(next);
      bypass.current = false;
    },
  };
}
