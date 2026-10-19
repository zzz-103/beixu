import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { app, type Env } from '../src/worker/index';

const workerEnv = { DB: env.DB, OWNER_PASSPHRASE: 'test-owner-passphrase' } as Env;
const call = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://beixu.test${path}`, init), workerEnv);
const json = (value: unknown, method = 'POST', headers: Record<string, string> = {}): RequestInit => ({ method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
const read = async <T>(response: Response): Promise<T> => response.json() as Promise<T>;
const cookie = (response: Response, name: string) => (response.headers.get('set-cookie') || '').split(';')[0].replace(`${name}=`, '');

describe('真实 workerd + D1 后端契约', () => {
  it('注册、会话、菜单和配置校验可用', async () => {
    const id = 700 + Math.floor(Math.random() * 200);
    const register = await call('/api/auth/register', json({ id: String(id), name: `测试朋友${id}` }));
    expect(register.status).toBe(201);
    const friendCookie = cookie(register, 'beixu_friend');
    expect(friendCookie.length).toBeGreaterThan(20);
    const menu = await call('/api/menu');
    const menuBody = await read<{ products: { id: string }[]; categories: { id: string }[] }>(menu);
    expect(menu.status).toBe(200);
    expect(menuBody.products.map(item => item.id)).toEqual(expect.arrayContaining(['latte', 'americano', 'dirty', 'pour']));
    expect(menuBody.categories).toHaveLength(5);
    const profile = await call('/api/profile', { headers: { Cookie: `beixu_friend=${friendCookie}` } });
    expect(profile.status).toBe(200);
  });

  it('同一幂等键重放同一订单，payload 变化返回 409', async () => {
    const id = 500 + Math.floor(Math.random() * 150);
    const register = await call('/api/auth/register', json({ id: String(id), name: `幂等朋友${id}` }));
    const friendCookie = cookie(register, 'beixu_friend');
    const config = { bean: 'blend', temp: '热', milk: '牛奶', art: '不指定', note: '', extra: '' };
    const key = crypto.randomUUID();
    const first = await call('/api/orders', json({ productId: 'latte', config }, 'POST', { Cookie: `beixu_friend=${friendCookie}`, 'Idempotency-Key': key }));
    expect(first.status).toBe(201);
    const firstBody = await read<{ order: { id: string } }>(first);
    const replay = await call('/api/orders', json({ productId: 'latte', config }, 'POST', { Cookie: `beixu_friend=${friendCookie}`, 'Idempotency-Key': key }));
    expect(replay.status).toBe(200);
    expect((await read<{ order: { id: string } }>(replay)).order.id).toBe(firstBody.order.id);
    const conflict = await call('/api/orders', json({ productId: 'americano', config: { ...config, milk: '' } }, 'POST', { Cookie: `beixu_friend=${friendCookie}`, 'Idempotency-Key': key }));
    expect(conflict.status).toBe(409);
  });

  it('店主状态条件更新与朋友取消存在竞争时只有一个成功', async () => {
    const id = 800 + Math.floor(Math.random() * 100);
    const register = await call('/api/auth/register', json({ id: String(id), name: `竞争朋友${id}` }));
    const friendCookie = cookie(register, 'beixu_friend');
    const orderResponse = await call('/api/orders', json({ productId: 'americano', config: { bean: 'blend', temp: '冰', milk: '', art: '', note: '', extra: '' } }, 'POST', { Cookie: `beixu_friend=${friendCookie}`, 'Idempotency-Key': crypto.randomUUID() }));
    const order = await read<{ order: { id: string } }>(orderResponse);
    const ownerLogin = await call('/api/owner/login', json({ passphrase: 'test-owner-passphrase' }));
    const ownerCookie = cookie(ownerLogin, 'beixu_owner');
    const [cancel, making] = await Promise.all([
      call(`/api/orders/${order.order.id}/cancel`, json({}, 'POST', { Cookie: `beixu_friend=${friendCookie}` })),
      call(`/api/owner/orders/${order.order.id}`, json({ status: 'making' }, 'PATCH', { Cookie: `beixu_owner=${ownerCookie}` })),
    ]);
    expect([cancel.status, making.status].filter(status => status >= 200 && status < 300)).toHaveLength(1);
    const latest = await call(`/api/orders/${order.order.id}`, { headers: { Cookie: `beixu_owner=${ownerCookie}` } });
    const latestBody = await read<{ order: { status: string } }>(latest);
    expect(['cancelled', 'making']).toContain(latestBody.order.status);
  });

  it('图片仅允许合法签名且限制大小', async () => {
    const ownerLogin = await call('/api/owner/login', json({ passphrase: 'test-owner-passphrase' }));
    const ownerCookie = cookie(ownerLogin, 'beixu_owner');
    const invalid = await call('/api/owner/media', { method: 'POST', headers: { Cookie: `beixu_owner=${ownerCookie}`, 'Content-Type': 'image/png' }, body: new Uint8Array([1, 2, 3]) });
    expect(invalid.status).toBe(415);
    const oversized = await call('/api/owner/media', { method: 'POST', headers: { Cookie: `beixu_owner=${ownerCookie}`, 'Content-Type': 'image/png' }, body: new Uint8Array(256 * 1024 + 1) });
    expect(oversized.status).toBe(413);
  });
});
