import { Hono } from 'hono';
import type { D1Database, D1Result } from '@cloudflare/workers-types';
import { validateConfig, productAvailable } from '../shared/domain';
import {
  levelFor,
  shanghaiDate,
  type ApiErrorBody,
  type Bean,
  type BoardData,
  type Category,
  type Config,
  type CreateOrderRequest,
  type Favorite,
  type MenuData,
  type Order,
  type OrderPage,
  type OwnerStats,
  type Prefs,
  type Product,
  type ProfileData,
  type Review,
  type ReviewRequest,
  type SessionResponse,
  type Shop,
  type Snapshot,
  type User,
} from '../shared/types';

export interface Env {
  DB: D1Database;
  OWNER_PASSPHRASE: string;
  ASSETS?: Fetcher;
}

type AppEnv = { Bindings: Env };
export const app = new Hono<AppEnv>();

class ApiHttpError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const fail = (
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): never => {
  throw new ApiHttpError(status, code, message, fields);
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function body<T = any>(c: any): Promise<T> {
  let value: unknown;
  try {
    value = await (c.req as any).json();
  } catch {
    return fail(400, 'INVALID_JSON', '请求内容不是有效的 JSON。');
  }
  if (!isRecord(value)) return fail(400, 'INVALID_JSON', '请求内容需要是 JSON 对象。');
  return value as T;
}

function text(value: unknown, field: string, max = 300, required = false): string {
  if (typeof value !== 'string')
    fail(400, 'VALIDATION_ERROR', '请检查输入内容。', { [field]: '请输入文本。' });
  const output = String(value).trim();
  if (required && !output)
    fail(400, 'VALIDATION_ERROR', '请检查输入内容。', { [field]: '不能为空。' });
  if (output.length > max)
    fail(400, 'VALIDATION_ERROR', '请检查输入内容。', { [field]: `最多 ${max} 个字。` });
  return output;
}

function stringArray(value: unknown, field: string, maxItems = 32, maxLength = 80): string[] {
  if (
    !Array.isArray(value) ||
    value.length > maxItems ||
    value.some((item) => typeof item !== 'string' || item.length > maxLength)
  ) {
    fail(400, 'VALIDATION_ERROR', '请检查输入内容。', { [field]: '格式不正确。' });
  }
  return (value as unknown[]).map((item) => String(item));
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean')
    fail(400, 'VALIDATION_ERROR', '请检查输入内容。', { [field]: '必须是布尔值。' });
  return value as boolean;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

async function hashToken(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function constantTimeSecretMatch(value: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([hashToken(value), hashToken(expected)]);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= left.charCodeAt(index % left.length) ^ right.charCodeAt(index % right.length);
  }
  return difference === 0;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function cookie(req: Request, name: string): string | null {
  const header = req.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function setCookie(c: any, name: string, value: string, maxAge: number): void {
  const secure = new URL(c.req.url).protocol === 'https:' ? '; Secure' : '';
  const headers: string[] = (c as any).get('setCookies') || [];
  headers.push(
    `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
  (c as any).set('setCookies', headers);
}

function clearCookie(c: any, name: string): void {
  const secure = new URL(c.req.url).protocol === 'https:' ? '; Secure' : '';
  const headers: string[] = (c as any).get('setCookies') || [];
  headers.push(`${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`);
  (c as any).set('setCookies', headers);
}

function nowIso(): string {
  return new Date().toISOString();
}
function number(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

type CategoryRow = { id: string; name: string; enabled: number; position: number };
type BeanRow = {
  id: string;
  name: string;
  origin: string;
  variety: string;
  roast: string;
  tags_json: string;
  scales_json: string;
  metadata_json: string;
  front: string;
  body: string;
  finish: string;
  note: string;
  available: number;
};
type ProductRow = {
  id: string;
  name: string;
  english: string;
  category_id: string;
  desc: string;
  story: string;
  photo: string;
  beans_json: string;
  temps_json: string;
  milks_json: string;
  arts_json: string;
  extra_label: string;
  extra_options_json: string;
  available: number;
};
type ShopRow = {
  id: number;
  name: string;
  message: string;
  recommended_id: string;
  open: number;
  catalog_revision: number;
};
type OrderRow = {
  id: string;
  user_id: number;
  username_snapshot: string;
  product_id: string;
  snapshot_json: string;
  status: Order['status'];
  created_at: string;
  completed_at: string | null;
  owner_note: string;
  idempotency_key?: string;
  payload_hash?: string;
  review_stars: number | null;
  review_tags_json: string | null;
  review_text: string | null;
  review_updated_at: string | null;
};

function rowCategory(row: CategoryRow): Category {
  return { id: row.id, name: row.name, enabled: !!row.enabled, position: row.position };
}
function rowBean(row: BeanRow): Bean {
  return {
    id: row.id,
    name: row.name,
    origin: row.origin,
    variety: row.variety,
    roast: row.roast,
    tags: parseJson(row.tags_json, []),
    scales: parseJson(row.scales_json, []),
    ...parseJson<
      Pick<Bean, 'process' | 'altitude' | 'series' | 'category' | 'recommended' | 'predicted'>
    >(row.metadata_json, {}),
    front: row.front,
    body: row.body,
    finish: row.finish,
    note: row.note,
    available: !!row.available,
  };
}
function rowProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    english: row.english,
    categoryId: row.category_id,
    desc: row.desc,
    story: row.story,
    photo: row.photo,
    beans: parseJson(row.beans_json, []),
    temps: parseJson(row.temps_json, []),
    milks: parseJson(row.milks_json, []),
    arts: parseJson(row.arts_json, []),
    extraLabel: row.extra_label,
    extraOptions: parseJson(row.extra_options_json, []),
    available: !!row.available,
  };
}
function rowShop(row: ShopRow): Shop {
  return {
    name: row.name,
    message: row.message,
    recommendedId: row.recommended_id,
    open: !!row.open,
  };
}
function prefsFrom(value: string | null | undefined): Prefs {
  return parseJson(value, { temp: '', milk: '', art: '' });
}
function rowUser(row: { id: number; name: string; joined: string; prefs_json: string }): User {
  return { id: row.id, name: row.name, joined: row.joined, prefs: prefsFrom(row.prefs_json) };
}

async function menuData(db: D1Database): Promise<MenuData> {
  const [shop, categories, products, beans, ingredients, people] = await Promise.all([
    db
      .prepare('SELECT id,name,message,recommended_id,open,catalog_revision FROM shop WHERE id=1')
      .first<ShopRow>(),
    db
      .prepare('SELECT id,name,enabled,position FROM categories ORDER BY position,id')
      .all<CategoryRow>(),
    db
      .prepare(
        'SELECT id,name,english,category_id,desc,story,photo,beans_json,temps_json,milks_json,arts_json,extra_label,extra_options_json,available FROM products ORDER BY rowid',
      )
      .all<ProductRow>(),
    db
      .prepare(
        'SELECT id,name,origin,variety,roast,tags_json,scales_json,metadata_json,front,body,finish,note,available FROM beans ORDER BY rowid',
      )
      .all<BeanRow>(),
    db
      .prepare('SELECT name,available FROM ingredients ORDER BY name')
      .all<{ name: string; available: number }>(),
    db
      .prepare(
        "SELECT product_id,COUNT(DISTINCT user_id) AS count FROM orders WHERE status='done' GROUP BY product_id",
      )
      .all<{ product_id: string; count: number }>(),
  ]);
  if (!shop) return fail(500, 'DB_NOT_READY', '小店配置尚未准备好。');
  const peopleMap: Record<string, number> = {};
  for (const row of people.results || []) peopleMap[row.product_id] = number(row.count);
  const ingredientsMap: Record<string, boolean> = {};
  for (const row of ingredients.results || []) ingredientsMap[row.name] = !!row.available;
  return {
    shop: rowShop(shop),
    categories: (categories.results || []).map(rowCategory),
    products: (products.results || []).map(rowProduct),
    beans: (beans.results || []).map(rowBean),
    ingredients: ingredientsMap,
    people: peopleMap,
  };
}

function configOf(value: unknown): Config {
  if (!isRecord(value))
    fail(400, 'VALIDATION_ERROR', '请检查搭配配置。', { config: '格式不正确。' });
  const data = value as Record<string, unknown>;
  return {
    bean: text(data.bean, 'config.bean', 80),
    temp: text(data.temp, 'config.temp', 30),
    milk: text(data.milk, 'config.milk', 30),
    art: text(data.art, 'config.art', 30),
    note: text(data.note, 'config.note', 300),
    extra: text(data.extra ?? '', 'config.extra', 80),
  };
}

function createRequest(value: unknown): CreateOrderRequest {
  if (!isRecord(value)) fail(400, 'VALIDATION_ERROR', '请检查订单内容。');
  const data = value as Record<string, unknown>;
  const productId = text(data.productId, 'productId', 80, true);
  return { productId, config: configOf(data.config) };
}

async function getFriend(c: any): Promise<{ user: User; tokenHash: string } | null> {
  const token = cookie(c.req.raw, 'beixu_friend');
  if (!token) return null;
  const hash = await hashToken(token);
  const db = c.env.DB as D1Database;
  const row = await db
    .prepare(
      'SELECT s.token_hash,u.id,u.name,u.joined,u.prefs_json FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.owner=0 AND s.expires_at>?',
    )
    .bind(hash, Math.floor(Date.now() / 1000))
    .first<{ token_hash: string; id: number; name: string; joined: string; prefs_json: string }>();
  return row ? { user: rowUser(row), tokenHash: hash } : null;
}

async function getOwner(c: any): Promise<{ tokenHash: string } | null> {
  const token = cookie(c.req.raw, 'beixu_owner');
  if (!token) return null;
  const hash = await hashToken(token);
  const db = c.env.DB as D1Database;
  const row = await db
    .prepare('SELECT token_hash FROM sessions WHERE token_hash=? AND owner=1 AND expires_at>?')
    .bind(hash, Math.floor(Date.now() / 1000))
    .first<{ token_hash: string }>();
  return row ? { tokenHash: hash } : null;
}

async function requireFriend(c: any): Promise<{ user: User; tokenHash: string }> {
  const session = await getFriend(c);
  if (!session) fail(401, 'AUTH_REQUIRED', '请先登录。');
  return session as { user: User; tokenHash: string };
}
async function requireOwner(c: any): Promise<{ tokenHash: string }> {
  const session = await getOwner(c);
  if (!session) fail(401, 'OWNER_AUTH_REQUIRED', '请先登录店主账号。');
  return session as { tokenHash: string };
}

async function createSession(db: D1Database, owner: boolean, userId?: number): Promise<string> {
  const token = randomToken();
  const hash = await hashToken(token);
  const ttl = owner ? 12 * 60 * 60 : 30 * 24 * 60 * 60;
  await db
    .prepare(
      'INSERT INTO sessions (token_hash,user_id,owner,expires_at,created_at) VALUES (?,?,?,?,?)',
    )
    .bind(hash, userId ?? null, owner ? 1 : 0, Math.floor(Date.now() / 1000) + ttl, nowIso())
    .run();
  return token;
}

async function userById(db: D1Database, id: number): Promise<User | null> {
  const row = await db
    .prepare('SELECT id,name,joined,prefs_json FROM users WHERE id=?')
    .bind(id)
    .first<{ id: number; name: string; joined: string; prefs_json: string }>();
  return row ? rowUser(row) : null;
}

function snapshotFrom(value: string): Snapshot {
  const data = parseJson<Snapshot>(value, {
    productName: '',
    desc: '',
    photo: 'builtin:0',
    beanName: '',
    config: { bean: '', temp: '', milk: '', art: '', note: '', extra: '' },
  });
  return {
    productName: String(data.productName || ''),
    desc: String(data.desc || ''),
    photo: String(data.photo || 'builtin:0'),
    beanName: String(data.beanName || ''),
    config: { ...configOf(data.config), extra: data.config?.extra || '' },
  };
}
function rowOrder(row: OrderRow): Order {
  const review: Review | null =
    row.review_stars == null
      ? null
      : {
          stars: row.review_stars,
          tags: parseJson(row.review_tags_json, []),
          text: row.review_text || '',
          updatedAt: row.review_updated_at || '',
        };
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username_snapshot,
    productId: row.product_id,
    snapshot: snapshotFrom(row.snapshot_json),
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    ownerNote: row.owner_note,
    review,
  };
}

const orderSelect = `SELECT o.id,o.user_id,o.username_snapshot,o.product_id,o.snapshot_json,o.status,o.created_at,o.completed_at,o.owner_note,o.idempotency_key,o.payload_hash,r.stars AS review_stars,r.tags_json AS review_tags_json,r.text AS review_text,r.updated_at AS review_updated_at FROM orders o LEFT JOIN reviews r ON r.order_id=o.id`;
async function orderById(db: D1Database, id: string): Promise<Order | null> {
  const row = await db.prepare(`${orderSelect} WHERE o.id=?`).bind(id).first<OrderRow>();
  return row ? rowOrder(row) : null;
}

function ensureOrderId(id: unknown): string {
  return text(id, 'id', 120, true);
}
function inputId(value: unknown, fallback: string | undefined, prefix: string): string {
  const provided = typeof value === 'string' ? value.trim() : '';
  return text(provided || fallback || `${prefix}-${crypto.randomUUID()}`, 'id', 80, true);
}

const productTemps = new Set(['热', '冰', '冷饮']);
const productMilks = new Set(['牛奶', '燕麦奶']);
const productArts = new Set(['不指定', '爱心', '树叶', '郁金香']);

function ensureProductInput(value: unknown, idFallback?: string): Product {
  if (!isRecord(value)) fail(400, 'VALIDATION_ERROR', '请检查饮品内容。');
  const data = value as Record<string, unknown>;
  const id = inputId(data.id, idFallback, 'p');
  return {
    id,
    name: text(data.name, 'name', 80, true),
    english: text(data.english ?? '', 'english', 120),
    categoryId: text(data.categoryId, 'categoryId', 80, true),
    desc: text(data.desc ?? '', 'desc', 300),
    story: text(data.story ?? '', 'story', 1000),
    photo: text(data.photo ?? 'builtin:0', 'photo', 300),
    beans: stringArray(data.beans ?? [], 'beans'),
    temps: stringArray(data.temps ?? [], 'temps'),
    milks: stringArray(data.milks ?? [], 'milks'),
    arts: stringArray(data.arts ?? [], 'arts'),
    extraLabel: text(data.extraLabel ?? '', 'extraLabel', 80),
    extraOptions: stringArray(data.extraOptions ?? [], 'extraOptions'),
    available: bool(data.available, 'available'),
  };
}
function ensureBeanInput(value: unknown, idFallback?: string): Bean {
  if (!isRecord(value)) fail(400, 'VALIDATION_ERROR', '请检查咖啡豆内容。');
  const data = value as Record<string, unknown>;
  const rawScales = data.scales;
  const scales =
    Array.isArray(rawScales) &&
    rawScales.length === 5 &&
    rawScales.every(
      (item) => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 5,
    )
      ? rawScales
      : fail(400, 'VALIDATION_ERROR', '请检查咖啡豆内容。', {
          scales: '需要 5 个 0–5 的整数（酸度、甜度、苦味、醇厚、余韵）。',
        });
  return {
    id: inputId(data.id, idFallback, 'bean'),
    name: text(data.name, 'name', 80, true),
    origin: text(data.origin ?? '', 'origin', 160),
    variety: text(data.variety ?? '', 'variety', 160),
    roast: text(data.roast ?? '', 'roast', 80),
    tags: stringArray(data.tags ?? [], 'tags'),
    scales,
    process: text(data.process ?? '', 'process', 160),
    altitude: text(data.altitude ?? '', 'altitude', 160),
    series: text(data.series ?? '', 'series', 160),
    category: text(data.category ?? '', 'category', 160),
    recommended: stringArray(data.recommended ?? [], 'recommended'),
    predicted: data.predicted === undefined ? false : bool(data.predicted, 'predicted'),
    front: text(data.front ?? '', 'front', 300),
    body: text(data.body ?? '', 'body', 300),
    finish: text(data.finish ?? '', 'finish', 300),
    note: text(data.note ?? '', 'note', 600),
    available: bool(data.available, 'available'),
  };
}
function ensureCategoryInput(value: unknown, idFallback?: string): Category {
  if (!isRecord(value)) fail(400, 'VALIDATION_ERROR', '请检查分类内容。');
  const data = value as Record<string, unknown>;
  return {
    id: inputId(data.id, idFallback, 'cat'),
    name: text(data.name, 'name', 80, true),
    enabled: bool(data.enabled, 'enabled'),
    position: Math.max(0, Math.floor(number(data.position))),
  };
}

app.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (origin && origin !== new URL(c.req.url).origin)
      fail(403, 'CROSS_ORIGIN', '只接受同源请求。');
    if (
      c.req.header('Content-Type') &&
      c.req.path.startsWith('/api/') &&
      c.req.header('Content-Type')?.split(';')[0] !== 'application/json' &&
      !c.req.path.startsWith('/api/owner/media')
    )
      fail(415, 'UNSUPPORTED_MEDIA_TYPE', '接口需要 JSON 请求。');
  }
  await next();
  const setCookies: string[] = (c as any).get('setCookies') || [];
  for (const value of setCookies) c.res.headers.append('Set-Cookie', value);
});

app.onError((error, c) => {
  if (error instanceof ApiHttpError)
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        },
      } satisfies ApiErrorBody,
      error.status,
    );
  // Keep database details and bound values out of production logs.
  void error;
  return json({ error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后再试。' } }, 500);
});
app.notFound((c) => json({ error: { code: 'NOT_FOUND', message: '没有找到这个地址。' } }, 404));

app.get('/api/session', async (c) => {
  const friend = await getFriend(c);
  const owner = await getOwner(c);
  return json({ user: friend?.user || null, owner: !!owner } satisfies SessionResponse);
});

app.post('/api/auth/login', async (c) => {
  const value = await body<{ identifier?: unknown }>(c);
  const identifier = text(value.identifier, 'identifier', 80, true);
  const row = await c.env.DB.prepare(
    'SELECT id,name,joined,prefs_json FROM users WHERE (id=? AND ? GLOB "[0-9]*") OR name=? COLLATE NOCASE',
  )
    .bind(Number(identifier), identifier, identifier)
    .first<{ id: number; name: string; joined: string; prefs_json: string }>();
  if (
    !row ||
    (!/^\d{1,3}$/.test(identifier) &&
      row.name.toLocaleLowerCase() !== identifier.toLocaleLowerCase())
  )
    fail(401, 'INVALID_CREDENTIALS', '没有找到这个朋友账号。');
  const loginRow = row as { id: number; name: string; joined: string; prefs_json: string };
  const token = await createSession(c.env.DB, false, loginRow.id);
  setCookie(c, 'beixu_friend', token, 30 * 24 * 60 * 60);
  return json({ user: rowUser(loginRow), owner: !!(await getOwner(c)) } satisfies SessionResponse);
});

app.post('/api/auth/register', async (c) => {
  const value = await body<{ id?: unknown; name?: unknown }>(c);
  const idText = text(value.id, 'id', 3, true);
  if (!/^\d{1,3}$/.test(idText) || Number(idText) < 0 || Number(idText) > 999)
    fail(400, 'VALIDATION_ERROR', '朋友编号需要是 0–999 的数字。', { id: '请输入 0–999。' });
  const name = text(value.name, 'name', 40, true);
  if (/^\d+$/.test(name))
    fail(400, 'VALIDATION_ERROR', '昵称不能是纯数字。', { name: '请换一个昵称。' });
  const joined = shanghaiDate();
  try {
    await c.env.DB.prepare('INSERT INTO users (id,name,joined,prefs_json) VALUES (?,?,?,?)')
      .bind(Number(idText), name, joined, JSON.stringify({ temp: '', milk: '', art: '' }))
      .run();
  } catch (error) {
    const message = String(error).toLowerCase();
    if (message.includes('users.id'))
      fail(409, 'ACCOUNT_EXISTS', '这个编号已经被使用。', { id: '请换一个编号。' });
    if (message.includes('users.name'))
      fail(409, 'ACCOUNT_EXISTS', '这个昵称已经被使用。', { name: '请换一个昵称。' });
    if (message.includes('unique')) fail(409, 'ACCOUNT_EXISTS', '这个编号或昵称已经被使用。');
    throw error;
  }
  const user = await userById(c.env.DB, Number(idText));
  if (!user) fail(500, 'DB_NOT_READY', '账号创建失败。');
  const createdUser = user as User;
  const token = await createSession(c.env.DB, false, createdUser.id);
  setCookie(c, 'beixu_friend', token, 30 * 24 * 60 * 60);
  return json({ user: createdUser, owner: !!(await getOwner(c)) } satisfies SessionResponse, 201);
});

app.post('/api/auth/logout', async (c) => {
  const token = cookie(c.req.raw, 'beixu_friend');
  if (token)
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?')
      .bind(await hashToken(token))
      .run();
  clearCookie(c, 'beixu_friend');
  return json({ ok: true });
});

app.post('/api/owner/login', async (c) => {
  const value = await body<{ passphrase?: unknown }>(c);
  const passphrase = text(value.passphrase, 'passphrase', 200, true);
  const expected = c.env.OWNER_PASSPHRASE || '';
  const matches = expected ? await constantTimeSecretMatch(passphrase, expected) : false;
  if (!matches) fail(401, 'INVALID_CREDENTIALS', '店主口令不正确。');
  const token = await createSession(c.env.DB, true);
  setCookie(c, 'beixu_owner', token, 12 * 60 * 60);
  return json({ user: (await getFriend(c))?.user || null, owner: true } satisfies SessionResponse);
});

app.post('/api/owner/logout', async (c) => {
  const token = cookie(c.req.raw, 'beixu_owner');
  if (token)
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?')
      .bind(await hashToken(token))
      .run();
  clearCookie(c, 'beixu_owner');
  return json({ ok: true });
});

app.get('/api/menu', async (c) => json(await menuData(c.env.DB)));

app.get('/api/profile', async (c) => {
  const friend = await requireFriend(c);
  return json(await profileData(c.env.DB, friend.user));
});

async function profileData(db: D1Database, user: User): Promise<ProfileData> {
  const [statsRow, visitsRow, favorites] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) AS count FROM orders WHERE user_id=? AND status='done'")
      .bind(user.id)
      .first<{ count: number }>(),
    db
      .prepare(
        "SELECT COUNT(DISTINCT substr(datetime(completed_at,'+8 hours'),1,10)) AS visits FROM orders WHERE user_id=? AND status='done' AND completed_at IS NOT NULL",
      )
      .bind(user.id)
      .first<{ visits: number }>(),
    db
      .prepare(
        'SELECT id,product_id,config_json,product_name,photo,created_at FROM favorites WHERE user_id=? ORDER BY created_at DESC',
      )
      .bind(user.id)
      .all<{
        id: string;
        product_id: string;
        config_json: string;
        product_name: string;
        photo: string;
        created_at: string;
      }>(),
  ]);
  const visits = number(visitsRow?.visits);
  const count = number(statsRow?.count);
  return {
    user,
    stats: { count, visits, level: levelFor(visits) },
    favorites: (favorites.results || []).map((row) => ({
      id: row.id,
      productId: row.product_id,
      config: configOf(parseJson(row.config_json, {})),
      productName: row.product_name,
      photo: row.photo,
      createdAt: row.created_at,
    })),
  };
}

app.patch('/api/profile', async (c) => {
  const friend = await requireFriend(c);
  const value = await body<{ prefs?: unknown }>(c);
  if (!isRecord(value.prefs)) fail(400, 'VALIDATION_ERROR', '请检查偏好设置。');
  const prefsData = value.prefs as Record<string, unknown>;
  const prefs: Prefs = {
    temp: text(prefsData.temp, 'prefs.temp', 30),
    milk: text(prefsData.milk, 'prefs.milk', 30),
    art: text(prefsData.art, 'prefs.art', 30),
  };
  await c.env.DB.prepare('UPDATE users SET prefs_json=? WHERE id=?')
    .bind(JSON.stringify(prefs), friend.user.id)
    .run();
  const user = await userById(c.env.DB, friend.user.id);
  if (!user) fail(401, 'AUTH_REQUIRED', '请先登录。');
  return json(await profileData(c.env.DB, user as User));
});

app.post('/api/favorites', async (c) => {
  const friend = await requireFriend(c);
  const value = await body<{ orderId?: unknown }>(c);
  const orderId = ensureOrderId(value.orderId);
  const order = await c.env.DB.prepare(
    `${orderSelect} WHERE o.id=? AND o.user_id=? AND o.status='done'`,
  )
    .bind(orderId, friend.user.id)
    .first<OrderRow>();
  if (!order) fail(404, 'ORDER_NOT_FOUND', '只能收藏自己完成的订单。');
  const favoriteOrder = order as OrderRow;
  const snapshot = snapshotFrom(favoriteOrder.snapshot_json);
  const id = crypto.randomUUID();
  const configJson = canonical(snapshot.config);
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO favorites (id,user_id,product_id,config_json,product_name,photo,created_at) VALUES (?,?,?,?,?,?,?)',
  )
    .bind(
      id,
      friend.user.id,
      favoriteOrder.product_id,
      configJson,
      snapshot.productName,
      snapshot.photo,
      nowIso(),
    )
    .run();
  const user = await userById(c.env.DB, friend.user.id);
  if (!user) fail(401, 'AUTH_REQUIRED', '请先登录。');
  return json(await profileData(c.env.DB, user as User), 201);
});

app.delete('/api/favorites/:id', async (c) => {
  const friend = await requireFriend(c);
  const result = await c.env.DB.prepare('DELETE FROM favorites WHERE id=? AND user_id=?')
    .bind(ensureOrderId(c.req.param('id')), friend.user.id)
    .run();
  if (!result.meta.changes) fail(404, 'FAVORITE_NOT_FOUND', '没有找到这条收藏。');
  return json({ ok: true });
});

app.get('/api/orders', async (c) => {
  const friend = await requireFriend(c);
  const scope = c.req.query('scope') || 'active';
  const offset = Math.max(0, Math.floor(number(c.req.query('offset'), 0)));
  if (scope !== 'active' && scope !== 'history') fail(400, 'VALIDATION_ERROR', '订单范围不正确。');
  const where =
    scope === 'active' ? "o.status IN ('queued','making')" : "o.status IN ('done','cancelled')";
  const limit = scope === 'history' ? 21 : 1000;
  const result = await c.env.DB.prepare(
    `${orderSelect} WHERE o.user_id=? AND ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(friend.user.id, limit, offset)
    .all<OrderRow>();
  const rows = result.results || [];
  const hasMore = scope === 'history' && rows.length > 20;
  return json({ orders: rows.slice(0, 20).map(rowOrder), hasMore } satisfies OrderPage);
});

app.get('/api/orders/:id', async (c) => {
  const id = ensureOrderId(c.req.param('id'));
  const owner = await getOwner(c);
  const friend = await getFriend(c);
  const order = await orderById(c.env.DB, id);
  if (!order || (!owner && (!friend || friend.user.id !== order.userId)))
    fail(404, 'ORDER_NOT_FOUND', '没有找到这张订单。');
  return json({ order });
});

app.get('/api/products/:id/last-order', async (c) => {
  const friend = await requireFriend(c);
  const productId = ensureProductId(c.req.param('id'));
  const row = await c.env.DB.prepare(
    `${orderSelect} WHERE o.user_id=? AND o.product_id=? AND o.status!='cancelled' ORDER BY o.created_at DESC LIMIT 1`,
  )
    .bind(friend.user.id, productId)
    .first<OrderRow>();
  return json({ order: row ? rowOrder(row) : null });
});

function ensureProductId(value: unknown): string {
  return text(value, 'productId', 80, true);
}

const orderInsertCondition = `
  INSERT INTO orders (id,user_id,username_snapshot,product_id,snapshot_json,status,created_at,completed_at,owner_note,idempotency_key,payload_hash)
  SELECT ?,?,?,?,?, 'queued', ?, NULL, '', ?, ?
  WHERE EXISTS (SELECT 1 FROM shop s WHERE s.id=1 AND s.open=1 AND s.catalog_revision=?)
    AND EXISTS (
      SELECT 1 FROM products p JOIN categories c ON c.id=p.category_id
      WHERE p.id=? AND p.available=1 AND c.enabled=1
        AND (json_array_length(p.beans_json)=0 AND ?=''
             OR json_array_length(p.beans_json)>0 AND EXISTS (SELECT 1 FROM json_each(p.beans_json) j WHERE j.value=?) AND EXISTS (SELECT 1 FROM beans b WHERE b.id=? AND b.available=1))
        AND (json_array_length(p.temps_json)=0 AND ?=''
             OR json_array_length(p.temps_json)>0 AND EXISTS (SELECT 1 FROM json_each(p.temps_json) j WHERE j.value=?))
        AND (json_array_length(p.milks_json)=0 AND ?=''
             OR json_array_length(p.milks_json)>0 AND EXISTS (SELECT 1 FROM json_each(p.milks_json) j WHERE j.value=?) AND EXISTS (SELECT 1 FROM ingredients i WHERE i.name=? AND i.available=1))
        AND (?='' OR (?='热' AND ?='牛奶' AND EXISTS (SELECT 1 FROM json_each(p.arts_json) j WHERE j.value=?)))
        AND (json_array_length(p.extra_options_json)=0 AND ?=''
             OR json_array_length(p.extra_options_json)>0 AND EXISTS (SELECT 1 FROM json_each(p.extra_options_json) j WHERE j.value=?))
    )`;

app.post('/api/orders', async (c) => {
  const friend = await requireFriend(c);
  const key = c.req.header('Idempotency-Key') || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))
    fail(400, 'INVALID_IDEMPOTENCY_KEY', '请提供有效的 Idempotency-Key。');
  const payload = createRequest(await body(c));
  const payloadHash = await hashToken(canonical(payload));
  const previous = await c.env.DB.prepare(
    `${orderSelect} WHERE o.user_id=? AND o.idempotency_key=?`,
  )
    .bind(friend.user.id, key)
    .first<OrderRow>();
  if (previous) {
    if (previous.payload_hash !== payloadHash)
      fail(409, 'IDEMPOTENCY_CONFLICT', '这个请求编号已经用于另一杯搭配。');
    return json({ order: rowOrder(previous) });
  }
  // Read the revision before loading the menu snapshot. The conditional INSERT
  // below rejects the write if any catalog mutation occurs in between.
  const catalogRevisionRow = await c.env.DB.prepare(
    'SELECT catalog_revision FROM shop WHERE id=1',
  ).first<{ catalog_revision: number }>();
  if (!catalogRevisionRow) fail(500, 'DB_NOT_READY', '小店配置尚未准备好。');
  const menu = await menuData(c.env.DB);
  const productFound = menu.products.find((item) => item.id === payload.productId);
  if (!productFound) fail(404, 'PRODUCT_NOT_FOUND', '没有找到这款饮品。');
  const product = productFound as Product;
  const configError = validateConfig(product, payload.config, menu);
  if (configError) fail(409, 'INVALID_CONFIGURATION', configError);
  if (!productAvailable(product, menu))
    fail(409, 'UNAVAILABLE', '这杯暂时无法供应，请选择其他饮品。');
  const beanName = menu.beans.find((bean) => bean.id === payload.config.bean)?.name || '';
  const snapshot: Snapshot = {
    productName: product.name,
    desc: product.desc,
    photo: product.photo,
    beanName,
    config: payload.config,
  };
  const revision = catalogRevisionRow as { catalog_revision: number };
  const id = `BEX-${crypto.randomUUID()}`;
  const createdAt = nowIso();
  let result: D1Result;
  try {
    result = await c.env.DB.prepare(orderInsertCondition)
      .bind(
        id,
        friend.user.id,
        friend.user.name,
        payload.productId,
        JSON.stringify(snapshot),
        createdAt,
        key,
        payloadHash,
        revision.catalog_revision,
        payload.productId,
        product.beans.length ? 'x' : '',
        payload.config.bean,
        payload.config.bean,
        product.temps.length ? 'x' : '',
        payload.config.temp,
        product.milks.length ? 'x' : '',
        payload.config.milk,
        payload.config.milk,
        payload.config.art,
        payload.config.temp,
        payload.config.milk,
        payload.config.art,
        product.extraOptions.length ? 'x' : '',
        payload.config.extra || '',
      )
      .run();
  } catch (error) {
    // A concurrent request with the same key can win the unique constraint
    // between the preflight lookup and this INSERT. Treat it as a replay.
    if (!String(error).toLowerCase().includes('unique')) throw error;
    const retry = await c.env.DB.prepare(`${orderSelect} WHERE o.user_id=? AND o.idempotency_key=?`)
      .bind(friend.user.id, key)
      .first<OrderRow>();
    if (retry && retry.payload_hash === payloadHash) return json({ order: rowOrder(retry) });
    if (retry) fail(409, 'IDEMPOTENCY_CONFLICT', '这个请求编号已经用于另一杯搭配。');
    throw error;
  }
  if (!result.meta.changes) {
    const retry = await c.env.DB.prepare(`${orderSelect} WHERE o.user_id=? AND o.idempotency_key=?`)
      .bind(friend.user.id, key)
      .first<OrderRow>();
    if (retry && retry.payload_hash === payloadHash) return json({ order: rowOrder(retry) });
    fail(409, 'CATALOG_CHANGED', '菜单刚刚发生变化，请重新确认这杯搭配。');
  }
  const order = await orderById(c.env.DB, id);
  if (!order) fail(500, 'DB_NOT_READY', '订单创建失败。');
  return json({ order: order as Order }, 201);
});

async function cancelOrder(c: any, ownerRoute = false) {
  const id = ensureOrderId(c.req.param('id'));
  const owner = await getOwner(c);
  const friend = await getFriend(c);
  if (ownerRoute && !owner) fail(401, 'OWNER_AUTH_REQUIRED', '请先登录店主账号。');
  if (!owner && !friend) fail(401, 'AUTH_REQUIRED', '请先登录。');
  const orderFound = await orderById(c.env.DB, id);
  if (!orderFound) fail(404, 'ORDER_NOT_FOUND', '没有找到这张订单。');
  const order = orderFound as Order;
  if (!owner && (!friend || friend.user.id !== order.userId))
    fail(403, 'FORBIDDEN', '你不能操作这张订单。');
  const statuses = owner ? ['queued', 'making'] : ['queued'];
  const result = await c.env.DB.prepare(
    `UPDATE orders SET status='cancelled' WHERE id=? AND status IN (${statuses.map(() => '?').join(',')})`,
  )
    .bind(id, ...statuses)
    .run();
  if (!result.meta.changes) fail(409, 'ORDER_STATE_CONFLICT', '订单状态已经变化，请刷新后重试。');
  const updated = await orderById(c.env.DB, id);
  return json({ order: updated });
}
app.post('/api/orders/:id/cancel', (c) => cancelOrder(c));

app.put('/api/orders/:id/review', async (c) => {
  const friend = await requireFriend(c);
  const id = ensureOrderId(c.req.param('id'));
  const value = await body<ReviewRequest>(c);
  const stars = Math.floor(number(value.stars));
  if (stars < 1 || stars > 5)
    fail(400, 'VALIDATION_ERROR', '星级需要是 1–5。', { stars: '请选择 1–5 星。' });
  const tags = stringArray(value.tags ?? [], 'tags', 10, 40);
  const reviewText = text(value.text ?? '', 'text', 500);
  const order = await c.env.DB.prepare(`${orderSelect} WHERE o.id=? AND o.user_id=?`)
    .bind(id, friend.user.id)
    .first<OrderRow>();
  if (!order) fail(404, 'ORDER_NOT_FOUND', '没有找到这张订单。');
  const reviewOrder = order as OrderRow;
  if (reviewOrder.status !== 'done') fail(409, 'ORDER_NOT_DONE', '完成后才能评价这杯。');
  const updatedAt = nowIso();
  await c.env.DB.prepare(
    'INSERT INTO reviews (order_id,stars,tags_json,text,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET stars=excluded.stars,tags_json=excluded.tags_json,text=excluded.text,updated_at=excluded.updated_at',
  )
    .bind(id, stars, JSON.stringify(tags), reviewText, updatedAt)
    .run();
  if (value.favorite) {
    const snapshot = snapshotFrom(reviewOrder.snapshot_json);
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO favorites (id,user_id,product_id,config_json,product_name,photo,created_at) VALUES (?,?,?,?,?,?,?)',
    )
      .bind(
        crypto.randomUUID(),
        friend.user.id,
        reviewOrder.product_id,
        canonical(snapshot.config),
        snapshot.productName,
        snapshot.photo,
        updatedAt,
      )
      .run();
  }
  const result = await orderById(c.env.DB, id);
  return json({ order: result });
});

app.get('/api/owner/board', async (c) => {
  await requireOwner(c);
  const today = shanghaiDate();
  const rows = await c.env.DB.prepare(
    `${orderSelect} WHERE o.status IN ('queued','making') OR (o.status='done' AND substr(datetime(o.completed_at,'+8 hours'),1,10)=?) ORDER BY CASE o.status WHEN 'queued' THEN 0 WHEN 'making' THEN 1 ELSE 2 END,o.created_at`,
  )
    .bind(today)
    .all<OrderRow>();
  const orders = (rows.results || []).map(rowOrder);
  const counts: BoardData['counts'] = { queued: 0, making: 0, done: 0 };
  for (const order of orders) if (order.status !== 'cancelled') counts[order.status]++;
  return json({ orders, counts } satisfies BoardData);
});

app.patch('/api/owner/orders/:id', async (c) => {
  await requireOwner(c);
  const id = ensureOrderId(c.req.param('id'));
  const value = await body<{ status?: unknown; ownerNote?: unknown }>(c);
  const status = value.status;
  if (status !== 'making' && status !== 'done')
    fail(400, 'VALIDATION_ERROR', '制作状态不正确。', { status: '只能更新为制作中或已完成。' });
  const ownerNote = value.ownerNote === undefined ? null : text(value.ownerNote, 'ownerNote', 300);
  const expected = status === 'making' ? 'queued' : 'making';
  const result =
    status === 'done'
      ? await c.env.DB.prepare(
          "UPDATE orders SET status='done',completed_at=?,owner_note=COALESCE(?,owner_note) WHERE id=? AND status=?",
        )
          .bind(nowIso(), ownerNote, id, expected)
          .run()
      : await c.env.DB.prepare(
          "UPDATE orders SET status='making',owner_note=COALESCE(?,owner_note) WHERE id=? AND status=?",
        )
          .bind(ownerNote, id, expected)
          .run();
  if (!result.meta.changes) fail(409, 'ORDER_STATE_CONFLICT', '订单状态已经变化，请刷新后重试。');
  return json({ order: await orderById(c.env.DB, id) });
});

app.post('/api/owner/products', async (c) => {
  await requireOwner(c);
  const product = ensureProductInput(await body(c));
  await saveProduct(c.env.DB, product, false);
  return json({ product }, 201);
});
app.put('/api/owner/products/:id', async (c) => {
  await requireOwner(c);
  const id = ensureProductId(c.req.param('id'));
  const product = ensureProductInput(await body(c), id);
  if (product.id !== id) fail(400, 'VALIDATION_ERROR', '路径 ID 与内容不一致。');
  await saveProduct(c.env.DB, product, true);
  return json({ product });
});
const mediaIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uniqueValues(values: string[]): boolean {
  return new Set(values).size === values.length;
}
async function validateProductForSave(db: D1Database, product: Product): Promise<void> {
  if (!/^builtin:[0-3]$/.test(product.photo)) {
    const match = /^\/media\/([^/]+)$/.exec(product.photo);
    if (!match || !mediaIdPattern.test(match[1]))
      fail(400, 'VALIDATION_ERROR', '饮品图片地址不正确。', {
        photo: '请选择内置图片或已上传图片。',
      });
    const media = await db.prepare('SELECT id FROM media WHERE id=?').bind(match![1]).first();
    if (!media) fail(400, 'VALIDATION_ERROR', '饮品图片不存在。', { photo: '请重新上传图片。' });
  }
  if (
    !uniqueValues(product.beans) ||
    !uniqueValues(product.temps) ||
    !uniqueValues(product.milks) ||
    !uniqueValues(product.arts) ||
    !uniqueValues(product.extraOptions)
  ) {
    fail(400, 'VALIDATION_ERROR', '饮品选项不能重复。');
  }
  const invalid = (values: string[], allowed: Set<string>, field: string) => {
    if (values.some((value) => !allowed.has(value)))
      fail(400, 'VALIDATION_ERROR', '饮品选项不正确。', { [field]: '包含不支持的选项。' });
  };
  invalid(product.temps, productTemps, 'temps');
  invalid(product.milks, productMilks, 'milks');
  invalid(product.arts, productArts, 'arts');
  if (product.extraOptions.length === 0 && product.extraLabel)
    fail(400, 'VALIDATION_ERROR', '附加选项配置不完整。', { extraLabel: '没有附加选项时请留空。' });
  if (product.extraOptions.length > 0 && !product.extraLabel)
    fail(400, 'VALIDATION_ERROR', '附加选项配置不完整。', { extraLabel: '请填写附加选项名称。' });
  if (product.extraOptions.some((value) => !value.trim()))
    fail(400, 'VALIDATION_ERROR', '附加选项配置不完整。', { extraOptions: '选项不能为空。' });
  const beans = await db.prepare('SELECT id FROM beans').all<{ id: string }>();
  const existing = new Set((beans.results || []).map((row) => row.id));
  if (product.beans.some((id) => !existing.has(id)))
    fail(400, 'VALIDATION_ERROR', '饮品引用了不存在的咖啡豆。', { beans: '请选择有效咖啡豆。' });
}
async function saveProduct(db: D1Database, product: Product, update: boolean): Promise<void> {
  await validateProductForSave(db, product);
  const category = await db
    .prepare('SELECT id FROM categories WHERE id=?')
    .bind(product.categoryId)
    .first();
  if (!category) fail(400, 'VALIDATION_ERROR', '分类不存在。', { categoryId: '请选择有效分类。' });
  try {
    const sql = update
      ? 'UPDATE products SET name=?,english=?,category_id=?,desc=?,story=?,photo=?,beans_json=?,temps_json=?,milks_json=?,arts_json=?,extra_label=?,extra_options_json=?,available=? WHERE id=?'
      : 'INSERT INTO products (id,name,english,category_id,desc,story,photo,beans_json,temps_json,milks_json,arts_json,extra_label,extra_options_json,available) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
    const args = update
      ? [
          product.name,
          product.english,
          product.categoryId,
          product.desc,
          product.story,
          product.photo,
          JSON.stringify(product.beans),
          JSON.stringify(product.temps),
          JSON.stringify(product.milks),
          JSON.stringify(product.arts),
          product.extraLabel,
          JSON.stringify(product.extraOptions),
          product.available ? 1 : 0,
          product.id,
        ]
      : [
          product.id,
          product.name,
          product.english,
          product.categoryId,
          product.desc,
          product.story,
          product.photo,
          JSON.stringify(product.beans),
          JSON.stringify(product.temps),
          JSON.stringify(product.milks),
          JSON.stringify(product.arts),
          product.extraLabel,
          JSON.stringify(product.extraOptions),
          product.available ? 1 : 0,
        ];
    const [result] = await db.batch([
      db.prepare(sql).bind(...args),
      db.prepare('UPDATE shop SET catalog_revision=catalog_revision+1 WHERE id=1'),
    ]);
    if (update && !result.meta.changes) fail(404, 'PRODUCT_NOT_FOUND', '没有找到这款饮品。');
  } catch (error) {
    if (String(error).toLowerCase().includes('unique'))
      fail(409, 'DUPLICATE_ID', '这个饮品编号已被使用。');
    throw error;
  }
}

app.post('/api/owner/beans', async (c) => {
  await requireOwner(c);
  const bean = ensureBeanInput(await body(c));
  await saveBean(c.env.DB, bean, false);
  return json({ bean }, 201);
});
app.put('/api/owner/beans/:id', async (c) => {
  await requireOwner(c);
  const id = ensureProductId(c.req.param('id'));
  const bean = ensureBeanInput(await body(c), id);
  if (bean.id !== id) fail(400, 'VALIDATION_ERROR', '路径 ID 与内容不一致。');
  await saveBean(c.env.DB, bean, true);
  return json({ bean });
});
async function saveBean(db: D1Database, bean: Bean, update: boolean): Promise<void> {
  try {
    const sql = update
      ? 'UPDATE beans SET name=?,origin=?,variety=?,roast=?,tags_json=?,scales_json=?,metadata_json=?,front=?,body=?,finish=?,note=?,available=? WHERE id=?'
      : 'INSERT INTO beans (id,name,origin,variety,roast,tags_json,scales_json,metadata_json,front,body,finish,note,available) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)';
    const args = update
      ? [
          bean.name,
          bean.origin,
          bean.variety,
          bean.roast,
          JSON.stringify(bean.tags),
          JSON.stringify(bean.scales),
          JSON.stringify({
            process: bean.process,
            altitude: bean.altitude,
            series: bean.series,
            category: bean.category,
            recommended: bean.recommended,
            predicted: bean.predicted,
          }),
          bean.front,
          bean.body,
          bean.finish,
          bean.note,
          bean.available ? 1 : 0,
          bean.id,
        ]
      : [
          bean.id,
          bean.name,
          bean.origin,
          bean.variety,
          bean.roast,
          JSON.stringify(bean.tags),
          JSON.stringify(bean.scales),
          JSON.stringify({
            process: bean.process,
            altitude: bean.altitude,
            series: bean.series,
            category: bean.category,
            recommended: bean.recommended,
            predicted: bean.predicted,
          }),
          bean.front,
          bean.body,
          bean.finish,
          bean.note,
          bean.available ? 1 : 0,
        ];
    const [result] = await db.batch([
      db.prepare(sql).bind(...args),
      db.prepare('UPDATE shop SET catalog_revision=catalog_revision+1 WHERE id=1'),
    ]);
    if (update && !result.meta.changes) fail(404, 'BEAN_NOT_FOUND', '没有找到这款咖啡豆。');
  } catch (error) {
    if (String(error).toLowerCase().includes('unique'))
      fail(409, 'DUPLICATE_ID', '这个咖啡豆编号已被使用。');
    throw error;
  }
}

app.post('/api/owner/categories', async (c) => {
  await requireOwner(c);
  const category = ensureCategoryInput(await body(c));
  await saveCategory(c.env.DB, category, false);
  return json({ category }, 201);
});
// Keep the full reorder route before /:id so "order" is never interpreted as a category ID.
app.put('/api/owner/categories/order', async (c) => {
  await requireOwner(c);
  const value = await body<{ ids?: unknown }>(c);
  const ids = stringArray(value.ids, 'ids', 200, 80);
  const rows = await c.env.DB.prepare('SELECT id FROM categories ORDER BY position,id').all<{
    id: string;
  }>();
  const existing = (rows.results || []).map((row) => row.id);
  if (
    ids.length !== existing.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !existing.includes(id))
  )
    fail(400, 'VALIDATION_ERROR', '分类顺序必须包含全部分类。', {
      ids: '请提供完整且不重复的分类 ID 列表。',
    });
  const statements = ids.map((id, position) =>
    c.env.DB.prepare('UPDATE categories SET position=? WHERE id=?').bind(position, id),
  );
  await c.env.DB.batch([
    ...statements,
    c.env.DB.prepare('UPDATE shop SET catalog_revision=catalog_revision+1 WHERE id=1'),
  ]);
  return json({ ok: true });
});
app.put('/api/owner/categories/:id', async (c) => {
  await requireOwner(c);
  const id = ensureProductId(c.req.param('id'));
  const category = ensureCategoryInput(await body(c), id);
  if (category.id !== id) fail(400, 'VALIDATION_ERROR', '路径 ID 与内容不一致。');
  await saveCategory(c.env.DB, category, true);
  return json({ category });
});
async function saveCategory(db: D1Database, category: Category, update: boolean): Promise<void> {
  try {
    const sql = update
      ? 'UPDATE categories SET name=?,enabled=?,position=? WHERE id=?'
      : 'INSERT INTO categories (id,name,enabled,position) VALUES (?,?,?,?)';
    const args = update
      ? [category.name, category.enabled ? 1 : 0, category.position, category.id]
      : [category.id, category.name, category.enabled ? 1 : 0, category.position];
    if (
      update &&
      !(await db.prepare('SELECT id FROM categories WHERE id=?').bind(category.id).first())
    )
      fail(404, 'CATEGORY_NOT_FOUND', '没有找到这个分类。');
    await db.batch([
      db.prepare(sql).bind(...args),
      db.prepare('UPDATE shop SET catalog_revision=catalog_revision+1 WHERE id=1'),
    ]);
  } catch (error) {
    if (String(error).toLowerCase().includes('unique'))
      fail(409, 'DUPLICATE_NAME', '分类名称已经存在。');
    throw error;
  }
}

app.patch('/api/owner/ingredients', async (c) => {
  await requireOwner(c);
  const value = await body<Record<string, unknown>>(c);
  const allowed = ['牛奶', '燕麦奶'];
  const statements = [];
  for (const [name, enabled] of Object.entries(value)) {
    if (!allowed.includes(name) || typeof enabled !== 'boolean')
      fail(400, 'VALIDATION_ERROR', '只支持牛奶和燕麦奶供应开关。');
    statements.push(
      c.env.DB.prepare('UPDATE ingredients SET available=? WHERE name=?').bind(
        enabled ? 1 : 0,
        name,
      ),
    );
  }
  if (statements.length)
    await c.env.DB.batch([
      ...statements,
      c.env.DB.prepare('UPDATE shop SET catalog_revision=catalog_revision+1 WHERE id=1'),
    ]);
  return json({ ok: true });
});

app.patch('/api/owner/shop', async (c) => {
  await requireOwner(c);
  const value = await body<Record<string, unknown>>(c);
  const current = await c.env.DB.prepare(
    'SELECT id,name,message,recommended_id,open,catalog_revision FROM shop WHERE id=1',
  ).first<ShopRow>();
  if (!current) fail(500, 'DB_NOT_READY', '小店配置尚未准备好。');
  const shopCurrent = current as ShopRow;
  const assignments: string[] = [];
  const args: unknown[] = [];
  if (value.name !== undefined) {
    assignments.push('name=?');
    args.push(text(value.name, 'name', 80, true));
  }
  if (value.message !== undefined) {
    assignments.push('message=?');
    args.push(text(value.message, 'message', 300, true));
  }
  if (value.recommendedId !== undefined) {
    const recommendedId = text(value.recommendedId, 'recommendedId', 80);
    if (
      recommendedId &&
      !(await c.env.DB.prepare('SELECT id FROM products WHERE id=?').bind(recommendedId).first())
    )
      fail(400, 'VALIDATION_ERROR', '推荐饮品不存在。', { recommendedId: '请选择有效饮品。' });
    assignments.push('recommended_id=?');
    args.push(recommendedId);
  }
  if (value.open !== undefined) {
    assignments.push('open=?');
    args.push(bool(value.open, 'open') ? 1 : 0);
  }
  if (assignments.length) {
    assignments.push('catalog_revision=catalog_revision+1');
    await c.env.DB.prepare(`UPDATE shop SET ${assignments.join(',')} WHERE id=1`)
      .bind(...args)
      .run();
  }
  const shop = await c.env.DB.prepare(
    'SELECT id,name,message,recommended_id,open,catalog_revision FROM shop WHERE id=1',
  ).first<ShopRow>();
  if (!shop) fail(500, 'DB_NOT_READY', '小店配置尚未准备好。');
  const saved = shop as ShopRow;
  return json({ shop: rowShop(saved) satisfies Shop });
});

app.get('/api/owner/users', async (c) => {
  await requireOwner(c);
  const q = (c.req.query('q') || '').trim().slice(0, 50);
  if (!q) return json({ users: [] });
  const rows = /^\d+$/.test(q)
    ? await c.env.DB.prepare('SELECT id,name,joined,prefs_json FROM users WHERE id=? LIMIT 20')
        .bind(Number(q))
        .all<{ id: number; name: string; joined: string; prefs_json: string }>()
    : await c.env.DB.prepare(
        'SELECT id,name,joined,prefs_json FROM users WHERE name LIKE ? COLLATE NOCASE ORDER BY name LIMIT 20',
      )
        .bind(`%${q}%`)
        .all<{ id: number; name: string; joined: string; prefs_json: string }>();
  return json({ users: (rows.results || []).map(rowUser) });
});

app.patch('/api/owner/users/:id', async (c) => {
  await requireOwner(c);
  const id = Math.floor(number(c.req.param('id'), -1));
  if (id < 0 || id > 999) fail(400, 'VALIDATION_ERROR', '朋友编号不正确。');
  const value = await body<{ name?: unknown }>(c);
  const name = text(value.name, 'name', 40, true);
  if (/^\d+$/.test(name))
    fail(400, 'VALIDATION_ERROR', '昵称不能是纯数字。', { name: '请换一个昵称。' });
  try {
    const result = await c.env.DB.prepare('UPDATE users SET name=? WHERE id=?')
      .bind(name, id)
      .run();
    if (!result.meta.changes) fail(404, 'USER_NOT_FOUND', '没有找到这个朋友。');
  } catch (error) {
    if (String(error).toLowerCase().includes('unique'))
      fail(409, 'DUPLICATE_NAME', '昵称已经存在。');
    throw error;
  }
  const user = await userById(c.env.DB, id);
  return json({ user });
});

app.get('/api/owner/stats', async (c) => {
  await requireOwner(c);
  const today = shanghaiDate();
  const [completedRow, visitorsRow, averageRow, rows] = await Promise.all([
    c.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM orders WHERE status='done' AND substr(datetime(completed_at,'+8 hours'),1,10)=?",
    )
      .bind(today)
      .first<{ count: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(DISTINCT user_id) AS count FROM orders WHERE status='done' AND substr(datetime(completed_at,'+8 hours'),1,10)=?",
    )
      .bind(today)
      .first<{ count: number }>(),
    c.env.DB.prepare(
      "SELECT AVG(r.stars) AS average FROM reviews r JOIN orders o ON o.id=r.order_id WHERE o.status='done' AND substr(datetime(o.completed_at,'+8 hours'),1,10)=?",
    )
      .bind(today)
      .first<{ average: number | null }>(),
    c.env.DB.prepare(
      `${orderSelect} WHERE r.order_id IS NOT NULL ORDER BY r.updated_at DESC LIMIT 20`,
    ).all<OrderRow>(),
  ]);
  const reviews = (rows.results || []).map((row) => {
    const order = rowOrder(row);
    return {
      ...(order.review as Review),
      username: order.username,
      productName: order.snapshot.productName,
      orderId: order.id,
    };
  });
  return json({
    completed: number(completedRow?.count),
    visitors: number(visitorsRow?.count),
    average: averageRow?.average == null ? null : Number(averageRow.average),
    reviews,
  } satisfies OwnerStats);
});

app.post('/api/owner/media', async (c) => {
  await requireOwner(c);
  const type = (c.req.header('Content-Type') || '').split(';')[0].toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type))
    fail(415, 'UNSUPPORTED_MEDIA_TYPE', '只支持 JPEG、PNG 或 WebP 图片。');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > 256 * 1024) fail(413, 'IMAGE_TOO_LARGE', '图片不能超过 256 KiB。');
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const webp =
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!(type === 'image/jpeg' ? jpeg : type === 'image/png' ? png : webp))
    fail(415, 'INVALID_IMAGE', '图片文件内容与类型不匹配。');
  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO media (id,mime,blob,created_at) VALUES (?,?,?,?)')
    .bind(id, type, bytes, nowIso())
    .run();
  return json({ url: `/media/${id}` }, 201);
});

app.get('/media/:id', async (c) => {
  const id = ensureProductId(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT mime,blob FROM media WHERE id=?')
    .bind(id)
    .first<{ mime: string; blob: ArrayBuffer | number[] }>();
  if (!row) return new Response('Not found', { status: 404 });
  return new Response(Array.isArray(row.blob) ? new Uint8Array(row.blob) : row.blob, {
    headers: {
      'Content-Type': row.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

app.all('*', async (c) => {
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/media/'))
    return json({ error: { code: 'NOT_FOUND', message: '没有找到这个地址。' } }, 404);
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.notFound();
});

export default { fetch: app.fetch };
