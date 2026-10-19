import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Coffee,
  Eye,
  EyeOff,
  Leaf,
  LogOut,
  MessageCircle,
  Plus,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { ApiError, api, json, Link, useApp, useNavigationGuard, useRemote } from './core';
import {
  Button,
  Choices,
  Empty,
  ErrorMessage,
  Field,
  Loading,
  MemoField,
  Nav,
  Photo,
  Sheet,
  Tabs,
  Top,
  Toggle,
} from './ui';
import type {
  ApiErrorBody,
  Bean,
  BoardData,
  Category,
  MenuData,
  OwnerStats,
  Product,
  Shop,
  User,
} from '../shared/types';
import './admin.css';

type AdminTab = 'products' | 'beans' | 'categories';
type EditorKind = AdminTab;
type Errors = Record<string, string>;

function errorText(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : '暂时无法完成，请稍后再试。';
}

function errorFields(error: unknown): Errors {
  return error instanceof ApiError ? error.fields : {};
}

function idForOrder(id: string) {
  return id.length > 14 ? id.slice(-8) : id;
}

function timeText(value: string | null) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function OwnerHeader({ title }: { title: string }) {
  return <Top title={title} back={title === '店主制作台' ? '/menu' : '/owner/board'} />;
}

function OwnerLayout({
  active,
  title,
  children,
}: {
  active: 'board' | 'manage' | 'settings';
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <OwnerHeader title={title} />
      <main className="admin-content">{children}</main>
      <Nav owner active={active} />
    </>
  );
}

function OwnerLogin() {
  const { navigate, notify, refresh } = useApp();
  const [passphrase, setPassphrase] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFieldError('');
    setFormError('');
    if (!passphrase.trim()) {
      setFieldError('请输入店主口令。');
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>('#owner-passphrase')?.focus(),
      );
      return;
    }
    setBusy(true);
    try {
      await api('/api/owner/login', json({ passphrase }));
      await refresh();
      navigate('/owner/board');
      notify('已进入制作台。');
    } catch (error) {
      const fields = errorFields(error);
      setFieldError(fields.passphrase || '');
      setFormError(fields.passphrase ? '' : errorText(error));
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus(),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Top title="店主入口" back="/login" />
      <section className="admin-login page-content">
        <div className="admin-login-mark" aria-hidden="true">
          <Coffee size={38} strokeWidth={1.35} />
        </div>
        <h1>照看一下小店。</h1>
        <form noValidate onSubmit={submit}>
          <div className="admin-secret-field">
            <label htmlFor="owner-passphrase">店主口令</label>
            <div className="password-wrap">
              <input
                id="owner-passphrase"
                name="passphrase"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                aria-invalid={!!fieldError}
                aria-describedby={fieldError ? 'owner-passphrase-error' : undefined}
                className={fieldError ? 'invalid' : undefined}
              />
              <button
                type="button"
                aria-label={show ? '隐藏口令' : '显示口令'}
                aria-pressed={show}
                onClick={() => setShow((value) => !value)}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {fieldError ? (
              <span id="owner-passphrase-error" className="error">
                {fieldError}
              </span>
            ) : null}
          </div>
          {formError ? <ErrorMessage message={formError} /> : null}
          <Button busy={busy} type="submit">
            进入制作台
          </Button>
        </form>
        <Link className="admin-friend-link" to="/login">
          返回登录
        </Link>
      </section>
    </>
  );
}

function Board() {
  const { data, error, loading, reload } = useRemote<BoardData>('/api/owner/board', { poll: 5000 });
  const { notify } = useApp();
  const [tab, setTab] = useState<'queued' | 'making' | 'done'>('queued');
  const [reminders, setReminders] = useState(() => {
    try {
      return localStorage.getItem('beixu-owner-notify') !== 'off';
    } catch {
      return true;
    }
  });
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [transitionBusy, setTransitionBusy] = useState<Record<string, boolean>>({});
  const transitionKeys = useRef(new Set<string>());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const dirtyNotes = useRef(new Set<string>());
  const seenIds = useRef(new Set<string>());
  const initialized = useRef(false);

  useEffect(() => {
    if (!data) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const order of data.orders) {
        if (!dirtyNotes.current.has(order.id) && !(order.id in next))
          next[order.id] = order.ownerNote || '';
      }
      return next;
    });
    const ids = new Set(data.orders.map((order) => order.id));
    if (!initialized.current) {
      seenIds.current = ids;
      initialized.current = true;
      return;
    }
    if (!reminders) {
      seenIds.current = ids;
      return;
    }
    const fresh = [...ids].filter((id) => !seenIds.current.has(id));
    if (fresh.length) notify(`有 ${fresh.length} 杯新订单进入队列。`);
    seenIds.current = ids;
  }, [data, notify, reminders]);

  const list = useMemo(() => {
    const source = data?.orders || [];
    if (tab === 'done') return source.filter((order) => order.status === 'done');
    return source.filter((order) => order.status === tab);
  }, [data?.orders, tab]);

  const toggleReminders = (value: boolean) => {
    setReminders(value);
    try {
      localStorage.setItem('beixu-owner-notify', value ? 'on' : 'off');
    } catch {
      // Private browsing may reject localStorage; the control still works for this page.
    }
  };

  const updateNote = (id: string, value: string) => {
    dirtyNotes.current.add(id);
    setDrafts((current) => ({ ...current, [id]: value }));
  };

  const mutateOrder = async (id: string, status: 'making' | 'done') => {
    if (transitionKeys.current.has(id)) return;
    transitionKeys.current.add(id);
    setTransitionBusy((current) => ({ ...current, [id]: true }));
    const order = data?.orders.find((item) => item.id === id);
    try {
      await api(
        `/api/owner/orders/${encodeURIComponent(id)}`,
        json({ status, ownerNote: drafts[id] || '' }, 'PATCH'),
      );
      dirtyNotes.current.delete(id);
      notify(status === 'making' ? '已开始制作。' : '已标记完成。');
      await reload();
    } catch (actionError) {
      notify(errorText(actionError));
      if (order) setDrafts((current) => ({ ...current, [id]: current[id] ?? order.ownerNote }));
    } finally {
      transitionKeys.current.delete(id);
      setTransitionBusy((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  };

  const cancelOrder = async () => {
    if (!cancelId || cancelBusy) return;
    setCancelBusy(true);
    try {
      await api(`/api/orders/${encodeURIComponent(cancelId)}/cancel`, json({}));
      notify('订单已取消，记录会保留。');
      setCancelId(null);
      await reload();
    } catch (actionError) {
      notify(errorText(actionError));
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <OwnerLayout active="board" title="店主制作台">
      <div className="admin-page-heading">
        <div>
          <h1>制作台</h1>
          <p>慢慢做，一杯一杯来。</p>
        </div>
        <span className="admin-date-label">上海时间</span>
      </div>
      <div className="admin-board-tools">
        <div>
          <strong>新订单提醒</strong>
          <span>页面保持打开时提示新的一杯</span>
        </div>
        <Toggle label="新订单提醒" value={reminders} onChange={toggleReminders} />
      </div>
      <Tabs
        items={[
          `排队中${data ? ` ${data.counts.queued}` : ''}`,
          `制作中${data ? ` ${data.counts.making}` : ''}`,
          `今日完成${data ? ` ${data.counts.done}` : ''}`,
        ]}
        value={
          tab === 'queued'
            ? `排队中${data ? ` ${data.counts.queued}` : ''}`
            : tab === 'making'
              ? `制作中${data ? ` ${data.counts.making}` : ''}`
              : `今日完成${data ? ` ${data.counts.done}` : ''}`
        }
        onChange={(value) =>
          setTab(
            value.startsWith('排队中') ? 'queued' : value.startsWith('制作中') ? 'making' : 'done',
          )
        }
      />
      {loading && !data ? <Loading /> : null}
      {error ? <ErrorMessage message={error} onRetry={() => void reload()} /> : null}
      {!loading && !error && !list.length ? (
        <Empty
          title={tab === 'done' ? '今天的第一杯，还在路上' : '这会儿，歇一歇。'}
          text={
            tab === 'queued' ? '没有待制作订单，新的一杯会出现在这里。' : '这里还没有订单记录。'
          }
        />
      ) : null}
      {list.map((order) => (
        <QueueCard
          key={order.id}
          order={order}
          note={drafts[order.id] ?? order.ownerNote}
          busy={!!transitionBusy[order.id]}
          onNote={(value) => updateNote(order.id, value)}
          onAdvance={(status) => void mutateOrder(order.id, status)}
          onCancel={() => setCancelId(order.id)}
        />
      ))}
      {data && data.counts.done > 0 ? (
        <button type="button" className="admin-recent-link" onClick={() => setTab('done')}>
          查看今天完成的 {data.counts.done} 杯 <ArrowRight size={14} />
        </button>
      ) : null}
      {cancelId ? (
        <Sheet title="取消这杯？" onClose={() => setCancelId(null)}>
          <p className="admin-sheet-copy">订单记录会保留，朋友将看到这杯已取消。</p>
          <div className="admin-sheet-actions">
            <button type="button" className="text-action" onClick={() => setCancelId(null)}>
              继续制作
            </button>
            <button
              type="button"
              className="admin-danger-action"
              disabled={cancelBusy}
              onClick={() => void cancelOrder()}
            >
              确认取消
            </button>
          </div>
        </Sheet>
      ) : null}
    </OwnerLayout>
  );
}

function QueueCard({
  order,
  note,
  busy,
  onNote,
  onAdvance,
  onCancel,
}: {
  order: BoardData['orders'][number];
  note: string;
  busy: boolean;
  onNote: (value: string) => void;
  onAdvance: (status: 'making' | 'done') => void;
  onCancel: () => void;
}) {
  return (
    <article className="queue-card admin-queue-card">
      <div className="queue-person">
        <div>
          <strong className="mono">NO. {String(order.userId).padStart(3, '0')}</strong>
          <h2>{order.username}</h2>
        </div>
        <span className={`admin-status ${order.status}`}>
          {order.status === 'queued' ? '排队中' : order.status === 'making' ? '制作中' : '已完成'}
        </span>
      </div>
      <div className="queue-drink">
        <Photo src={order.snapshot.photo} label={order.snapshot.productName} />
        <div>
          <h3>
            {order.snapshot.config.temp}
            {order.snapshot.productName}
          </h3>
          <p>
            {[
              order.snapshot.beanName,
              order.snapshot.config.milk,
              order.snapshot.config.art && `${order.snapshot.config.art}拉花`,
              order.snapshot.config.extra,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {order.snapshot.config.note ? (
            <div className="queue-note">备注：{order.snapshot.config.note}</div>
          ) : null}
        </div>
      </div>
      {order.status === 'making' ? (
        <MemoField
          label="附一张店主小纸条（选填）"
          value={note}
          onChange={onNote}
          maxLength={140}
        />
      ) : null}
      {order.status === 'done' && order.ownerNote ? (
        <p className="admin-owner-note">店主留言：{order.ownerNote}</p>
      ) : null}
      <div className="queue-card-actions">
        <small>
          <Clock3 size={14} /> {timeText(order.createdAt)} 下单
        </small>
        {order.status === 'queued' ? (
          <Button busy={busy} onClick={() => onAdvance('making')}>
            开始制作
          </Button>
        ) : order.status === 'making' ? (
          <Button busy={busy} onClick={() => onAdvance('done')}>
            <Check size={15} /> 标记完成
          </Button>
        ) : (
          <span className="admin-completed-copy">
            {order.review ? `★ ${order.review.stars} · 已评价` : '还没有留下评价'}
          </span>
        )}
      </div>
      {order.status === 'queued' || order.status === 'making' ? (
        <button type="button" className="admin-cancel-link" onClick={onCancel}>
          取消订单
        </button>
      ) : null}
    </article>
  );
}

function blankProduct(menu: MenuData): Product {
  return {
    id: '',
    name: '',
    english: '',
    categoryId: menu.categories[0]?.id || '',
    desc: '',
    story: '',
    photo: 'builtin:0',
    beans: [],
    temps: ['热'],
    milks: ['牛奶'],
    arts: ['不指定'],
    extraLabel: '',
    extraOptions: [],
    available: true,
  };
}

function blankBean(): Bean {
  return {
    id: '',
    name: '',
    origin: '',
    variety: '',
    roast: '中烘焙',
    tags: [],
    scales: [2, 3, 3],
    front: '',
    body: '',
    finish: '',
    note: '',
    available: true,
  };
}

function blankCategory(position: number): Category {
  return { id: '', name: '', enabled: true, position };
}

function Manage() {
  const { menu, reloadMenu, notify } = useApp();
  const [tab, setTab] = useState<AdminTab>('products');
  const [editor, setEditor] = useState<{
    kind: EditorKind;
    data: Product | Bean | Category;
    dirty: boolean;
  } | null>(null);
  const [pendingEditor, setPendingEditor] = useState<{
    kind: EditorKind;
    data: Product | Bean | Category;
  } | null>(null);
  const [editorError, setEditorError] = useState('');
  const [editorFields, setEditorFields] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [pendingLeave, setPendingLeave] = useState(false);
  const [pendingTab, setPendingTab] = useState<AdminTab | null>(null);
  const editorRef = useRef<HTMLElement>(null);
  const navGuard = useNavigationGuard(!!editor?.dirty);
  const mutationKeys = useRef(new Set<string>());

  const runMutation = async <T,>(key: string, work: () => Promise<T>) => {
    if (mutationKeys.current.has(key)) return null;
    mutationKeys.current.add(key);
    try {
      return await work();
    } finally {
      mutationKeys.current.delete(key);
    }
  };

  const closeEditor = () => {
    if (editor?.dirty) setPendingLeave(true);
    else setEditor(null);
  };

  const openEditor = (kind: EditorKind, data: Product | Bean | Category) => {
    setEditor({ kind, data, dirty: false });
    setEditorError('');
    setEditorFields({});
    requestAnimationFrame(() =>
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };

  const begin = (kind: EditorKind, value?: Product | Bean | Category) => {
    if (!menu) return;
    const data = value
      ? structuredClone(value)
      : kind === 'products'
        ? blankProduct(menu)
        : kind === 'beans'
          ? blankBean()
          : blankCategory(menu.categories.length);
    if (editor?.dirty) {
      setPendingEditor({ kind, data });
      setPendingLeave(true);
      return;
    }
    openEditor(kind, data);
  };

  const patchEditor = (patch: Partial<Product> | Partial<Bean> | Partial<Category>) => {
    setEditor((current) =>
      current
        ? {
            ...current,
            data: { ...current.data, ...patch } as Product | Bean | Category,
            dirty: true,
          }
        : current,
    );
    setEditorError('');
  };

  const validate = () => {
    if (!editor || !menu) return false;
    const extraInput =
      editor.kind === 'products'
        ? editorRef.current?.querySelector<HTMLInputElement>('input[name="extraOptions"]')
        : null;
    const data =
      editor.kind === 'products' && extraInput
        ? ({
            ...editor.data,
            extraOptions: extraInput.value
              .split('、')
              .map((value) => value.trim())
              .filter(Boolean),
          } as Product)
        : editor.data;
    const errors: Errors = {};
    if (!data.name.trim()) errors.name = '请填写名称。';
    const currentList =
      editor.kind === 'products'
        ? menu.products
        : editor.kind === 'beans'
          ? menu.beans
          : menu.categories;
    if (currentList.some((item) => item.id !== data.id && item.name.trim() === data.name.trim()))
      errors.name = '这个名称已存在，请换一个。';
    if (editor.kind === 'products') {
      const product = data as Product;
      if (!product.categoryId) errors.categoryId = '请选择一个分类。';
      if (!product.temps.length) errors.temps = '至少选择一种温度。';
      if (product.extraLabel && !product.extraOptions.length)
        errors.extraOptions = '填写额外配方名称后，请至少添加一个选项。';
      if (!product.extraLabel && product.extraOptions.length)
        errors.extraLabel = '请填写额外配方的名称。';
      if (!product.desc.trim()) errors.desc = '请补一句口感介绍。';
    }
    setEditorFields(errors);
    if (Object.keys(errors).length) {
      setEditorError('请先修正标红字段。');
      requestAnimationFrame(() =>
        editorRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return false;
    }
    return true;
  };

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (saving || imageUploading || !editor || !validate()) return;
    const extraInput =
      editor.kind === 'products'
        ? editorRef.current?.querySelector<HTMLInputElement>('input[name="extraOptions"]')
        : null;
    const data =
      editor.kind === 'products' && extraInput
        ? ({
            ...editor.data,
            extraOptions: extraInput.value
              .split('、')
              .map((value) => value.trim())
              .filter(Boolean),
          } as Product)
        : editor.data;
    setSaving(true);
    try {
      const endpoint = `/api/owner/${editor.kind}`;
      const isNew = !data.id;
      const url = isNew ? endpoint : `${endpoint}/${encodeURIComponent(data.id)}`;
      const method = isNew ? 'POST' : 'PUT';
      await api(url, json(data, method));
      await reloadMenu();
      notify('已经保存，朋友端也更新啦。');
      setEditor(null);
    } catch (error) {
      setEditorError(errorText(error));
      setEditorFields(errorFields(error));
      requestAnimationFrame(() =>
        editorRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleIngredient = async (name: string, value: boolean) => {
    await runMutation(`ingredient:${name}`, async () => {
      try {
        await api('/api/owner/ingredients', json({ [name]: value }, 'PATCH'));
        await reloadMenu();
        notify(value ? `${name}已恢复供应。` : `${name}已标记暂缺。`);
      } catch (error) {
        notify(errorText(error));
      }
    });
  };

  const toggleRow = async (
    kind: 'products' | 'beans' | 'categories',
    item: Product | Bean | Category,
  ) => {
    const next = {
      ...item,
      ...(kind === 'categories'
        ? { enabled: !(item as Category).enabled }
        : { available: !(item as Product | Bean).available }),
    };
    await runMutation(`row:${kind}:${item.id}`, async () => {
      try {
        await api(`/api/owner/${kind}/${encodeURIComponent(item.id)}`, json(next, 'PUT'));
        await reloadMenu();
      } catch (error) {
        notify(errorText(error));
      }
    });
  };

  const moveCategory = async (index: number, delta: -1 | 1) => {
    if (!menu) return;
    const categories = [...menu.categories];
    const target = index + delta;
    if (target < 0 || target >= categories.length) return;
    [categories[index], categories[target]] = [categories[target], categories[index]];
    await runMutation('categories:order', async () => {
      try {
        await api(
          '/api/owner/categories/order',
          json({ ids: categories.map((category) => category.id) }, 'PUT'),
        );
        await reloadMenu();
      } catch (error) {
        notify(errorText(error));
      }
    });
  };

  if (!menu) return <Loading />;
  const activeItems =
    tab === 'products' ? menu.products : tab === 'beans' ? menu.beans : menu.categories;

  return (
    <OwnerLayout active="manage" title="菜单与豆单">
      <div className="admin-page-heading compact">
        <div>
          <h1>菜单与豆单</h1>
        </div>
        {!editor ? (
          <button type="button" className="text-action" onClick={() => begin(tab)}>
            <Plus size={16} /> 新增
          </button>
        ) : null}
      </div>
      <Tabs
        items={['饮品', '咖啡豆', '分类']}
        value={tab === 'products' ? '饮品' : tab === 'beans' ? '咖啡豆' : '分类'}
        onChange={(value) => {
          const nextTab =
            value === '饮品' ? 'products' : value === '咖啡豆' ? 'beans' : 'categories';
          if (editor?.dirty) {
            setPendingTab(nextTab);
            setPendingLeave(true);
            return;
          }
          setTab(nextTab);
          setEditor(null);
        }}
      />
      {!editor ? (
        <>
          <div className="admin-section-heading">
            <h2>{tab === 'products' ? '饮品菜单' : tab === 'beans' ? '咖啡豆' : '分类'}</h2>
            <span>{activeItems.length} 项</span>
          </div>
          <div className="admin-management-list">
            {activeItems.map((item, index) => (
              <ManageRow
                key={item.id}
                kind={tab}
                item={item}
                index={index}
                total={activeItems.length}
                onEdit={() => begin(tab, item)}
                onToggle={() => void toggleRow(tab, item)}
                onMove={(delta) => void moveCategory(index, delta)}
                menu={menu}
              />
            ))}
          </div>
          {tab === 'products' ? (
            <section className="admin-ingredient-box">
              <h2>
                <Leaf size={16} /> 奶类供应
              </h2>
              {['牛奶', '燕麦奶'].map((name) => (
                <div className="admin-setting-row" key={name}>
                  <div>
                    <strong>{name}</strong>
                    <p>{menu.ingredients[name] ? '今天还有' : '今天用完了'}</p>
                  </div>
                  <Toggle
                    label={`${name}供应`}
                    value={!!menu.ingredients[name]}
                    onChange={(value) => void toggleIngredient(name, value)}
                  />
                </div>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
      {editor ? (
        <section className="admin-editor" ref={editorRef}>
          <div className="admin-editor-heading">
            <h2>
              {editor.data.id ? '编辑' : '新增'}
              {editor.kind === 'products' ? '饮品' : editor.kind === 'beans' ? '咖啡豆' : '分类'}
            </h2>
            <button
              type="button"
              className="admin-icon-button"
              aria-label="关闭编辑"
              onClick={closeEditor}
            >
              <X size={18} />
            </button>
          </div>
          {editorError ? <ErrorMessage message={editorError} /> : null}
          <form noValidate onSubmit={(event) => void save(event)}>
            <Field
              label="名称"
              value={editor.data.name}
              maxLength={30}
              error={editorFields.name}
              onChange={(event) => patchEditor({ name: event.target.value })}
            />
            {editor.kind === 'products' ? (
              <ProductEditor
                key={editor.data.id || 'new'}
                onUploadState={setImageUploading}
                data={editor.data as Product}
                menu={menu}
                errors={editorFields}
                onChange={patchEditor}
              />
            ) : null}
            {editor.kind === 'beans' ? (
              <BeanEditor data={editor.data as Bean} errors={editorFields} onChange={patchEditor} />
            ) : null}
            {editor.kind === 'categories' ? (
              <Toggle
                label="在朋友端显示"
                value={(editor.data as Category).enabled}
                onChange={(value) => patchEditor({ enabled: value })}
              />
            ) : null}
            <div className="admin-form-actions">
              <button type="button" className="text-action" onClick={closeEditor}>
                放弃修改
              </button>
              <Button busy={saving || imageUploading} type="submit">
                <Check size={16} /> 保存修改
              </Button>
            </div>
          </form>
        </section>
      ) : null}
      {navGuard.pending ? (
        <Sheet title="放弃未保存的修改？" onClose={navGuard.stay}>
          <p className="admin-sheet-copy">当前编辑内容还没有保存，离开后会丢失。</p>
          <div className="admin-sheet-actions">
            <button type="button" className="text-action" onClick={navGuard.stay}>
              继续编辑
            </button>
            <button type="button" className="admin-danger-action" onClick={navGuard.leave}>
              放弃修改
            </button>
          </div>
        </Sheet>
      ) : pendingLeave ? (
        <Sheet title="放弃未保存的修改？" onClose={() => setPendingLeave(false)}>
          <p className="admin-sheet-copy">当前编辑内容还没有保存，离开后会丢失。</p>
          <div className="admin-sheet-actions">
            <button type="button" className="text-action" onClick={() => setPendingLeave(false)}>
              继续编辑
            </button>
            <button
              type="button"
              className="admin-danger-action"
              onClick={() => {
                const nextTab = pendingTab;
                const nextEditor = pendingEditor;
                setPendingLeave(false);
                setPendingTab(null);
                setPendingEditor(null);
                if (nextEditor) openEditor(nextEditor.kind, nextEditor.data);
                else setEditor(null);
                if (nextTab) setTab(nextTab);
              }}
            >
              放弃修改
            </button>
          </div>
        </Sheet>
      ) : null}
    </OwnerLayout>
  );
}

function ManageRow({
  kind,
  item,
  index,
  total,
  onEdit,
  onToggle,
  onMove,
  menu,
}: {
  kind: AdminTab;
  item: Product | Bean | Category;
  index: number;
  total: number;
  onEdit: () => void;
  onToggle: () => void;
  onMove: (delta: -1 | 1) => void;
  menu: MenuData;
}) {
  if (kind === 'categories') {
    const category = item as Category;
    return (
      <article className="admin-category-row">
        <span className="admin-category-index">{String(index + 1).padStart(2, '0')}</span>
        <button type="button" className="admin-row-main" onClick={onEdit}>
          <strong>{category.name || '未命名分类'}</strong>
          <small>{category.enabled ? '显示在朋友端' : '朋友端已隐藏'}</small>
        </button>
        <div className="admin-category-move">
          <button
            type="button"
            aria-label={`上移${category.name}`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ChevronUp size={17} />
          </button>
          <button
            type="button"
            aria-label={`下移${category.name}`}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <ChevronDown size={17} />
          </button>
        </div>
        <Toggle
          label={`${category.name}显示`}
          value={category.enabled}
          onChange={() => onToggle()}
        />
      </article>
    );
  }
  if (kind === 'beans') {
    const bean = item as Bean;
    return (
      <article className="admin-management-row">
        <span className="admin-bean-icon">
          <Leaf size={21} />
        </span>
        <button type="button" className="admin-row-main" onClick={onEdit}>
          <strong>{bean.name || '未命名咖啡豆'}</strong>
          <small>
            {bean.roast} · {bean.available ? '可用' : '已用完'}
          </small>
        </button>
        <Toggle label={`${bean.name}供应`} value={bean.available} onChange={() => onToggle()} />
      </article>
    );
  }
  const product = item as Product;
  const categoryName =
    menu.categories.find((category) => category.id === product.categoryId)?.name || '未分类';
  return (
    <article className="admin-management-row">
      <Photo src={product.photo} label={product.name} />
      <button type="button" className="admin-row-main" onClick={onEdit}>
        <strong>{product.name || '未命名饮品'}</strong>
        <small>
          {categoryName} · {product.available ? '供应中' : '暂缺'}
        </small>
      </button>
      <Toggle label={`${product.name}供应`} value={product.available} onChange={() => onToggle()} />
    </article>
  );
}

function ProductEditor({
  data,
  menu,
  errors,
  onChange,
  onUploadState,
}: {
  data: Product;
  menu: MenuData;
  errors: Errors;
  onChange: (patch: Partial<Product>) => void;
  onUploadState: (busy: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const alive = useRef(true),
    uploadAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      uploadAbort.current?.abort();
      onUploadState(false);
    };
  }, [onUploadState]);
  const [uploadError, setUploadError] = useState('');
  const [extraText, setExtraText] = useState(data.extraOptions.join('、'));
  useEffect(() => setExtraText(data.extraOptions.join('、')), [data.id]);
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file || uploading) return;
    setUploading(true);
    onUploadState(true);
    setUploadError('');
    try {
      const blob = await compressImage(file);
      if (!alive.current) return;
      uploadAbort.current = new AbortController();
      const response = await fetch('/api/owner/media', {
        method: 'POST',
        signal: AbortSignal.any([uploadAbort.current.signal, AbortSignal.timeout(15000)]),
        credentials: 'same-origin',
        headers: { 'Content-Type': blob.type },
        body: blob,
      });
      const body = (await response.json().catch(() => ({}))) as {
        url?: string;
      } & Partial<ApiErrorBody>;
      if (!response.ok) throw new ApiError(response.status, body as ApiErrorBody);
      if (!body.url) throw new Error('图片上传失败，请重试。');
      if (alive.current) onChange({ photo: body.url });
    } catch (error) {
      if (alive.current) setUploadError(errorText(error));
    } finally {
      if (alive.current) {
        setUploading(false);
        onUploadState(false);
      }
    }
  };
  const beanNames = data.beans
    .map((id) => menu.beans.find((bean) => bean.id === id)?.name)
    .filter(Boolean) as string[];
  const setBeans = (names: string[]) =>
    onChange({
      beans: menu.beans.filter((bean) => names.includes(bean.name)).map((bean) => bean.id),
    });
  const commitExtraOptions = () =>
    onChange({
      extraOptions: extraText
        .split('、')
        .map((value) => value.trim())
        .filter(Boolean),
    });
  return (
    <>
      <Field
        label="英文副标题（选填）"
        value={data.english}
        onChange={(event) => onChange({ english: event.target.value })}
      />
      <Field
        label="一句口感介绍"
        value={data.desc}
        error={errors.desc}
        onChange={(event) => onChange({ desc: event.target.value })}
      />
      <MemoField
        label="饮品详细介绍"
        value={data.story}
        onChange={(value) => onChange({ story: value })}
        maxLength={500}
      />
      <label className="field">
        <span>所属分类</span>
        <select
          value={data.categoryId}
          aria-invalid={!!errors.categoryId}
          onChange={(event) => onChange({ categoryId: event.target.value })}
        >
          {menu.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {errors.categoryId ? <span className="error">{errors.categoryId}</span> : null}
      </label>
      <fieldset className="admin-photo-picker">
        <legend>饮品图片</legend>
        <div className="admin-photo-options">
          {[0, 1, 2, 3].map((index) => {
            const value = `builtin:${index}`;
            return (
              <button
                type="button"
                key={value}
                className={data.photo === value ? 'selected' : ''}
                aria-label={`选用演示图片${index + 1}`}
                onClick={() => onChange({ photo: value })}
              >
                <Photo src={value} label={data.name} />
              </button>
            );
          })}
        </div>
        <label className="admin-upload-button">
          <Upload size={16} /> {uploading ? '正在处理…' : '上传图片'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => void onFile(event)}
            disabled={uploading}
          />
        </label>
        {uploadError ? (
          <span className="error" role="alert">
            {uploadError}
          </span>
        ) : null}
      </fieldset>
      <Choices
        label="适配咖啡豆（无咖啡可不选）"
        options={menu.beans.map((bean) => bean.name)}
        value={beanNames}
        onChange={setBeans}
        multiple
      />
      <Choices
        label="可选温度"
        options={['热', '冰', '冷饮']}
        value={data.temps}
        onChange={(value) => onChange({ temps: value })}
        multiple
      />
      <Choices
        label="配方允许的奶类"
        options={['牛奶', '燕麦奶']}
        value={data.milks}
        onChange={(value) => onChange({ milks: value })}
        multiple
      />
      <Choices
        label="可选拉花（热饮＋牛奶时展示）"
        options={['不指定', '爱心', '树叶', '郁金香']}
        value={data.arts}
        onChange={(value) => onChange({ arts: value })}
        multiple
      />
      <Field
        label="额外配方选项名称（选填）"
        value={data.extraLabel}
        error={errors.extraLabel}
        placeholder="例如 甜度、冰量"
        onChange={(event) => onChange({ extraLabel: event.target.value })}
      />
      <Field
        name="extraOptions"
        label="额外配方选项（以顿号分隔）"
        value={extraText}
        error={errors.extraOptions}
        placeholder="不额外加糖、微甜"
        onChange={(event) => setExtraText(event.target.value)}
        onBlur={commitExtraOptions}
      />
      <Toggle
        label="饮品供应中"
        value={data.available}
        onChange={(value) => onChange({ available: value })}
      />
    </>
  );
}

function BeanEditor({
  data,
  errors,
  onChange,
}: {
  data: Bean;
  errors: Errors;
  onChange: (patch: Partial<Bean>) => void;
}) {
  const [tagText, setTagText] = useState(data.tags.join('、'));
  useEffect(() => setTagText(data.tags.join('、')), [data.id]);
  return (
    <>
      <Field
        label="产地"
        value={data.origin}
        onChange={(event) => onChange({ origin: event.target.value })}
      />
      <Field
        label="品种"
        value={data.variety}
        onChange={(event) => onChange({ variety: event.target.value })}
      />
      <Field
        label="烘焙度"
        value={data.roast}
        onChange={(event) => onChange({ roast: event.target.value })}
      />
      <Field
        label="风味标签（以顿号分隔）"
        value={tagText}
        onChange={(event) => {
          setTagText(event.target.value);
          onChange({
            tags: event.target.value
              .split('、')
              .map((value) => value.trim())
              .filter(Boolean),
          });
        }}
      />
      <div className="admin-scale-grid">
        <label>
          酸度
          <input
            type="number"
            min={1}
            max={5}
            value={data.scales[0] || 1}
            onChange={(event) =>
              onChange({
                scales: [Number(event.target.value), data.scales[1] || 1, data.scales[2] || 1],
              })
            }
          />
        </label>
        <label>
          苦度
          <input
            type="number"
            min={1}
            max={5}
            value={data.scales[1] || 1}
            onChange={(event) =>
              onChange({
                scales: [data.scales[0] || 1, Number(event.target.value), data.scales[2] || 1],
              })
            }
          />
        </label>
        <label>
          醇厚
          <input
            type="number"
            min={1}
            max={5}
            value={data.scales[2] || 1}
            onChange={(event) =>
              onChange({
                scales: [data.scales[0] || 1, data.scales[1] || 1, Number(event.target.value)],
              })
            }
          />
        </label>
      </div>
      <Field
        label="前段风味"
        value={data.front}
        onChange={(event) => onChange({ front: event.target.value })}
      />
      <Field
        label="中段风味"
        value={data.body}
        onChange={(event) => onChange({ body: event.target.value })}
      />
      <Field
        label="尾韵"
        value={data.finish}
        onChange={(event) => onChange({ finish: event.target.value })}
      />
      <MemoField
        label="店主备注"
        value={data.note}
        onChange={(value) => onChange({ note: value })}
        maxLength={300}
      />
      <Toggle
        label="咖啡豆可用"
        value={data.available}
        onChange={(value) => onChange({ available: value })}
      />
      {errors.name ? <span className="error">{errors.name}</span> : null}
    </>
  );
}

async function compressImage(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type))
    throw new Error('仅支持 JPEG、PNG 或 WebP 图片。');
  const source = await createImageBitmap(file);
  try {
    let width = source.width;
    let height = source.height;
    const max = 1280;
    if (Math.max(width, height) > max) {
      const ratio = max / Math.max(width, height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器暂不支持图片处理。');
      context.drawImage(source, 0, 0, width, height);
      const quality = [0.84, 0.72, 0.6, 0.48][Math.min(attempt, 3)];
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', quality),
      );
      if (blob && blob.size <= 256 * 1024) return blob;
      width = Math.max(320, Math.round(width * 0.82));
      height = Math.max(320, Math.round(height * 0.82));
    }
  } finally {
    source.close();
  }
  throw new Error('图片压缩后仍超过 256 KiB，请换一张图片。');
}

function Settings() {
  const { menu, reloadMenu, notify, refresh, navigate } = useApp();
  const statsRemote = useRemote<OwnerStats>('/api/owner/stats');
  const [shopDraft, setShopDraft] = useState<Shop | null>(null);
  const [shopDirty, setShopDirty] = useState(false);
  const [shopError, setShopError] = useState('');
  const [shopFields, setShopFields] = useState<Errors>({});
  const [savingShop, setSavingShop] = useState(false);
  const [openBusy, setOpenBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const searchSeq = useRef(0);
  const [editingUser, setEditingUser] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [originalName, setOriginalName] = useState('');
  const [nameError, setNameError] = useState('');
  const [savingUser, setSavingUser] = useState(false);
  const [pendingUserCancel, setPendingUserCancel] = useState(false);
  const [pendingLogout, setPendingLogout] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const settingsDirty = shopDirty || (editingUser !== null && nameDraft !== originalName);
  const navGuard = useNavigationGuard(settingsDirty);

  useEffect(() => {
    if (!menu || shopDirty) return;
    setShopDraft({ ...menu.shop });
  }, [menu, shopDirty]);

  useEffect(() => {
    if (composing) return;
    const value = query.trim();
    if (!value) {
      setUsers([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    setSearchError('');
    const timer = window.setTimeout(() => {
      api<{ users: User[] }>(`/api/owner/users?q=${encodeURIComponent(value)}`)
        .then((result) => {
          if (seq === searchSeq.current) setUsers(result.users);
        })
        .catch((error) => {
          if (seq === searchSeq.current) setSearchError(errorText(error));
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [composing, query]);

  useEffect(() => {
    if (!pendingLogout || settingsDirty) return;
    setPendingLogout(false);
    void (async () => {
      if (logoutBusy) return;
      setLogoutBusy(true);
      try {
        await api('/api/owner/logout', json({}));
        await refresh();
        navigate('/owner/login');
      } catch (error) {
        notify(errorText(error));
      } finally {
        setLogoutBusy(false);
      }
    })();
  }, [navigate, notify, pendingLogout, refresh, settingsDirty, logoutBusy]);

  if (!menu || !shopDraft) return <Loading />;

  const saveShop = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingShop) return;
    const fields: Errors = {};
    if (!shopDraft.name.trim()) fields.name = '请填写小店名称。';
    if (Object.keys(fields).length) {
      setShopFields(fields);
      setShopError('请先修正标红字段。');
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    setSavingShop(true);
    setShopError('');
    setShopFields({});
    try {
      await api(
        '/api/owner/shop',
        json(
          {
            name: shopDraft.name,
            message: shopDraft.message,
            recommendedId: shopDraft.recommendedId,
          },
          'PATCH',
        ),
      );
      setShopDirty(false);
      await reloadMenu();
      notify('小店内容已保存。');
    } catch (error) {
      setShopError(errorText(error));
      setShopFields(errorFields(error));
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
    } finally {
      setSavingShop(false);
    }
  };

  const toggleOpen = async (value: boolean) => {
    setOpenBusy(true);
    try {
      await api('/api/owner/shop', json({ open: value }, 'PATCH'));
      await reloadMenu();
      notify(value ? '已恢复接单。' : '已暂停接单，已有订单继续制作。');
    } catch (error) {
      notify(errorText(error));
    } finally {
      setOpenBusy(false);
    }
  };

  const saveUser = async (user: User) => {
    if (savingUser) return;
    if (!nameDraft.trim()) {
      setNameError('请填写昵称。');
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    setSavingUser(true);
    setNameError('');
    try {
      await api(`/api/owner/users/${user.id}`, json({ name: nameDraft.trim() }, 'PATCH'));
      setEditingUser(null);
      setOriginalName(nameDraft.trim());
      setQuery(nameDraft.trim());
      notify('昵称已更新。');
    } catch (error) {
      setNameError(errorFields(error).name || errorText(error));
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
    } finally {
      setSavingUser(false);
    }
  };

  return (
    <OwnerLayout active="settings" title="小店设置">
      <div className="admin-page-heading">
        <div>
          <h1>小店设置</h1>
        </div>
      </div>
      <section className="admin-settings-section">
        <div className="admin-setting-row admin-open-row">
          <div>
            <strong>{menu.shop.open ? '接单中' : '暂停接单'}</strong>
            <p>{menu.shop.open ? '朋友可以点单' : '已有订单继续制作'}</p>
          </div>
          <Toggle
            label="小店接单状态"
            value={menu.shop.open}
            onChange={(value) => void toggleOpen(value)}
            disabled={openBusy}
          />
        </div>
      </section>
      <section className="admin-settings-section">
        <h2 className="admin-section-title">小店内容</h2>
        <form noValidate onSubmit={(event) => void saveShop(event)}>
          {shopError ? <ErrorMessage message={shopError} /> : null}
          <Field
            label="小店名称"
            value={shopDraft.name}
            error={shopFields.name}
            onChange={(event) => {
              setShopDirty(true);
              setShopError('');
              setShopDraft((current) =>
                current ? { ...current, name: event.target.value } : current,
              );
            }}
          />
          <MemoField
            label="今日留言"
            value={shopDraft.message}
            onChange={(value) => {
              setShopDirty(true);
              setShopError('');
              setShopDraft((current) => (current ? { ...current, message: value } : current));
            }}
            maxLength={200}
          />
          <label className="field">
            <span>今日推荐</span>
            <select
              value={shopDraft.recommendedId}
              onChange={(event) => {
                setShopDirty(true);
                setShopError('');
                setShopDraft((current) =>
                  current ? { ...current, recommendedId: event.target.value } : current,
                );
              }}
            >
              <option value="">暂不推荐</option>
              {menu.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <Button busy={savingShop} type="submit">
            保存设置
          </Button>
        </form>
      </section>
      <section className="admin-settings-section">
        <h2 className="admin-section-title">朋友账号</h2>
        <div className="admin-search-field">
          <Search size={18} />
          <input
            aria-label="查找朋友"
            placeholder="输入数字 ID 或昵称"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onCompositionStart={() => {
              searchSeq.current += 1;
              setComposing(true);
            }}
            onCompositionEnd={(event) => {
              setComposing(false);
              setQuery(event.currentTarget.value);
            }}
          />
          <button
            type="button"
            tabIndex={query ? 0 : -1}
            aria-hidden={!query}
            aria-label="清除查找"
            className={query ? 'visible' : ''}
            onClick={() => {
              searchSeq.current += 1;
              setQuery('');
              setUsers([]);
              requestAnimationFrame(() =>
                document.querySelector<HTMLInputElement>('.admin-search-field input')?.focus(),
              );
            }}
          >
            <X size={17} />
          </button>
        </div>
        {searching ? <p className="admin-search-state">正在查找…</p> : null}
        {searchError ? <ErrorMessage message={searchError} /> : null}
        {users.map((user) => (
          <div className="admin-user-result" key={user.id}>
            {editingUser === user.id ? (
              <div className="admin-user-edit">
                <Field
                  label="昵称"
                  value={nameDraft}
                  error={nameError}
                  onChange={(event) => {
                    setNameDraft(event.target.value);
                    setNameError('');
                  }}
                  autoFocus
                />
                <div>
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => {
                      if (nameDraft !== originalName) setPendingUserCancel(true);
                      else setEditingUser(null);
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="text-action"
                    disabled={savingUser}
                    onClick={() => void saveUser(user)}
                  >
                    保存
                  </button>
                </div>
              </div>
            ) : (
              <>
                <span>
                  {user.name} <small className="mono">NO. {String(user.id).padStart(3, '0')}</small>
                </span>
                <button
                  type="button"
                  className="text-action"
                  onClick={() => {
                    setEditingUser(user.id);
                    setNameDraft(user.name);
                    setOriginalName(user.name);
                    setNameError('');
                  }}
                >
                  修改昵称
                </button>
              </>
            )}
          </div>
        ))}
        {!searching && query && !users.length && !searchError ? (
          <p className="admin-search-state">没有找到匹配的朋友。</p>
        ) : null}
      </section>
      <section className="admin-settings-section">
        <h2 className="admin-section-title">今天的小店</h2>
        {statsRemote.error ? (
          <ErrorMessage message={statsRemote.error} onRetry={() => void statsRemote.reload()} />
        ) : null}
        {statsRemote.data ? (
          <>
            <div className="admin-metrics">
              <div>
                <strong>{statsRemote.data.completed}</strong>
                <small>已完成</small>
              </div>
              <div>
                <strong>{statsRemote.data.visitors}</strong>
                <small>来访朋友</small>
              </div>
              <div>
                <strong>
                  {statsRemote.data.average == null ? '—' : statsRemote.data.average.toFixed(1)}
                </strong>
                <small>平均评价</small>
              </div>
            </div>
            <div className="admin-reviews">
              {statsRemote.data.reviews.length ? (
                statsRemote.data.reviews.map((review) => (
                  <article key={review.orderId}>
                    <div>
                      <span>
                        {review.username} · {review.productName}
                      </span>
                      <span className="admin-review-stars">{'★'.repeat(review.stars)}</span>
                    </div>
                    {review.text ? <p>{review.text}</p> : null}
                    <small>{timeText(review.updatedAt)}</small>
                  </article>
                ))
              ) : (
                <p className="admin-search-state">还没有评价。</p>
              )}
            </div>
          </>
        ) : statsRemote.loading ? (
          <Loading />
        ) : null}
      </section>
      <div className="admin-settings-footer">
        <button
          type="button"
          className="admin-logout-link"
          disabled={logoutBusy}
          onClick={() => {
            setPendingLogout(true);
            if (!settingsDirty) setShopDirty(false);
          }}
        >
          <LogOut size={15} /> 退出店主账号
        </button>
      </div>
      {navGuard.pending ? (
        <Sheet title="放弃未保存的修改？" onClose={navGuard.stay}>
          <p className="admin-sheet-copy">当前编辑内容还没有保存，离开后会丢失。</p>
          <div className="admin-sheet-actions">
            <button type="button" className="text-action" onClick={navGuard.stay}>
              继续编辑
            </button>
            <button type="button" className="admin-danger-action" onClick={navGuard.leave}>
              放弃修改
            </button>
          </div>
        </Sheet>
      ) : null}
      {pendingUserCancel ? (
        <Sheet title="放弃未保存的昵称？" onClose={() => setPendingUserCancel(false)}>
          <p className="admin-sheet-copy">当前昵称修改还没有保存，离开编辑后会丢失。</p>
          <div className="admin-sheet-actions">
            <button
              type="button"
              className="text-action"
              onClick={() => setPendingUserCancel(false)}
            >
              继续编辑
            </button>
            <button
              type="button"
              className="admin-danger-action"
              onClick={() => {
                setPendingUserCancel(false);
                setEditingUser(null);
                setNameDraft('');
                setNameError('');
              }}
            >
              放弃修改
            </button>
          </div>
        </Sheet>
      ) : null}
      {pendingLogout && settingsDirty ? (
        <Sheet title="放弃未保存的修改？" onClose={() => setPendingLogout(false)}>
          <p className="admin-sheet-copy">退出店主账号前，当前修改需要先放弃。</p>
          <div className="admin-sheet-actions">
            <button type="button" className="text-action" onClick={() => setPendingLogout(false)}>
              继续编辑
            </button>
            <button
              type="button"
              className="admin-danger-action"
              onClick={() => {
                setShopDirty(false);
                setEditingUser(null);
                setNameDraft(originalName);
              }}
            >
              退出并放弃
            </button>
          </div>
        </Sheet>
      ) : null}
    </OwnerLayout>
  );
}

export default function AdminRoutes() {
  const { path, session, navigate } = useApp();
  useEffect(() => {
    if (!session.owner && path !== '/owner/login') navigate('/owner/login');
    if (session.owner && path === '/owner/login') navigate('/owner/board');
  }, [navigate, path, session.owner]);
  if (path === '/owner/login') return <OwnerLogin />;
  if (!session.owner) return <Loading />;
  if (path === '/owner/manage') return <Manage />;
  if (path === '/owner/settings') return <Settings />;
  return <Board />;
}
