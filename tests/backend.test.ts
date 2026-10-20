import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, type Env } from '../src/worker/index';
import initialSql from '../migrations/0001_init.sql?raw';
import realBeansSql from '../migrations/0002_real_beans.sql?raw';
import descriptionsSql from '../migrations/0003_bean_descriptions.sql?raw';
import brandNameSql from '../migrations/0004_brand_name.sql?raw';
const migrationSql =
  initialSql + '\n' + realBeansSql + '\n' + descriptionsSql + '\n' + brandNameSql;

const workerEnv = { DB: env.DB, OWNER_PASSPHRASE: 'test-owner-passphrase' } as Env;
const call = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`http://beixu.test${path}`, init), workerEnv);
const json = (
  value: unknown,
  method = 'POST',
  headers: Record<string, string> = {},
): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(value),
});
const read = async <T>(response: Response): Promise<T> => response.json() as Promise<T>;
const cookie = (response: Response, name: string) =>
  (response.headers.get('set-cookie') || '').split(';')[0].replace(`${name}=`, '');

async function resetDatabase() {
  const tables = [
    'reviews',
    'favorites',
    'sessions',
    'orders',
    'users',
    'media',
    'products',
    'beans',
    'ingredients',
    'categories',
    'shop',
  ];
  for (const table of tables) await env.DB.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  for (const statement of migrationSql.replace(/^--.*$/gm, '').split(';')) {
    const sql = statement.trim();
    if (sql && !sql.startsWith('--') && !/^PRAGMA\b/i.test(sql)) await env.DB.prepare(sql).run();
  }
}

describe('真实 workerd + D1 后端契约', () => {
  beforeEach(resetDatabase);
  it('真实豆单包含完整资料，五项评分及预测标记可保存，拒绝旧三项评分', async () => {
    type Menu = import('../src/shared/types').MenuData;
    const menu = await read<Menu>(await call('/api/menu'));
    expect(menu.shop.name).toBe('杯叙');
    expect(menu.beans).toHaveLength(8);
    expect(menu.beans.every((bean) => !/预测|预计|可能/.test(bean.body))).toBe(true);
    expect(menu.beans.every((bean) => bean.available && bean.scales.length === 5)).toBe(true);
    const expectedScales: Record<string, number[]> = {
      blend: [1, 2, 3, 5, 3],
      'sam-blend': [2, 4, 3, 4, 2],
      blue: [2, 4, 2, 4, 4],
      afu: [4, 5, 1, 3, 5],
      'peru-sl09': [3, 4, 1, 3, 4],
      'panama-geisha': [4, 4, 1, 2, 5],
      geisha: [4, 4, 1, 3, 5],
      'colombia-geisha': [4, 4, 1, 3, 4],
    };
    for (const bean of menu.beans) expect(bean.scales).toEqual(expectedScales[bean.id]);
    expect(menu.beans.filter((bean) => bean.predicted)).toHaveLength(5);
    expect(menu.beans.find((bean) => bean.id === 'peru-sl09')).toMatchObject({
      variety: 'SL-09',
      series: '瑰夏系列',
      category: '清甜花香',
    });
    const afu = menu.beans.find((bean) => bean.id === 'afu')!;
    expect(afu).toMatchObject({
      process: '72 小时暗房厌氧日晒',
      altitude: '2072m',
      variety: '74158',
    });
    for (const bean of menu.beans) {
      for (const [name, id] of [
        ['拿铁', 'latte'],
        ['Dirty', 'dirty'],
        ['手冲', 'pour'],
      ]) {
        if (bean.recommended?.includes(name))
          expect(menu.products.find((product) => product.id === id)?.beans).toContain(bean.id);
      }
    }
    const login = await call('/api/owner/login', json({ passphrase: 'test-owner-passphrase' }));
    const headers = { Cookie: `beixu_owner=${cookie(login, 'beixu_owner')}` };
    const updated = { ...afu, altitude: '2073m', scales: [3, 5, 1, 3, 5] };
    expect((await call('/api/owner/beans/afu', json(updated, 'PUT', headers))).status).toBe(200);
    expect(
      (await read<Menu>(await call('/api/menu'))).beans.find((bean) => bean.id === 'afu'),
    ).toEqual(updated);
    expect(
      (await call('/api/owner/beans/afu', json({ ...afu, scales: [1, 2, 3] }, 'PUT', headers)))
        .status,
    ).toBe(400);
  });

  it('注册、会话、菜单和配置校验可用', async () => {
    const id = 701;
    const register = await call(
      '/api/auth/register',
      json({ id: String(id), name: `测试朋友${id}` }),
    );
    expect(register.status).toBe(201);
    const friendCookie = cookie(register, 'beixu_friend');
    expect(friendCookie.length).toBeGreaterThan(20);
    const menu = await call('/api/menu');
    const menuBody = await read<{ products: { id: string }[]; categories: { id: string }[] }>(menu);
    expect(menu.status).toBe(200);
    expect(menuBody.products.map((item) => item.id)).toEqual(
      expect.arrayContaining(['latte', 'americano', 'dirty', 'pour']),
    );
    expect(menuBody.categories).toHaveLength(5);
    const profile = await call('/api/profile', {
      headers: { Cookie: `beixu_friend=${friendCookie}` },
    });
    expect(profile.status).toBe(200);
  });

  it('同一幂等键重放同一订单，payload 变化返回 409', async () => {
    const id = 501;
    const register = await call(
      '/api/auth/register',
      json({ id: String(id), name: `幂等朋友${id}` }),
    );
    const friendCookie = cookie(register, 'beixu_friend');
    const config = { bean: 'blend', temp: '热', milk: '牛奶', art: '不指定', note: '', extra: '' };
    const key = crypto.randomUUID();
    const first = await call(
      '/api/orders',
      json({ productId: 'latte', config }, 'POST', {
        Cookie: `beixu_friend=${friendCookie}`,
        'Idempotency-Key': key,
      }),
    );
    expect(first.status).toBe(201);
    const firstBody = await read<{ order: { id: string } }>(first);
    const replay = await call(
      '/api/orders',
      json({ productId: 'latte', config }, 'POST', {
        Cookie: `beixu_friend=${friendCookie}`,
        'Idempotency-Key': key,
      }),
    );
    expect(replay.status).toBe(200);
    expect((await read<{ order: { id: string } }>(replay)).order.id).toBe(firstBody.order.id);
    const conflict = await call(
      '/api/orders',
      json({ productId: 'americano', config: { ...config, milk: '' } }, 'POST', {
        Cookie: `beixu_friend=${friendCookie}`,
        'Idempotency-Key': key,
      }),
    );
    expect(conflict.status).toBe(409);
  });

  it('并发使用同一幂等键时只创建一张订单', async () => {
    const id = 301;
    const register = await call(
      '/api/auth/register',
      json({ id: String(id), name: `并发朋友${id}` }),
    );
    const friendCookie = cookie(register, 'beixu_friend');
    const key = crypto.randomUUID();
    const payload = json(
      {
        productId: 'latte',
        config: { bean: 'blend', temp: '热', milk: '牛奶', art: '不指定', note: '', extra: '' },
      },
      'POST',
      { Cookie: `beixu_friend=${friendCookie}`, 'Idempotency-Key': key },
    );
    const [first, second] = await Promise.all([
      call('/api/orders', payload),
      call('/api/orders', payload),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    const firstBody = await read<{ order: { id: string } }>(first);
    const secondBody = await read<{ order: { id: string } }>(second);
    expect(firstBody.order.id).toBe(secondBody.order.id);
  });

  it('店主状态条件更新与朋友取消存在竞争时只有一个成功', async () => {
    const id = 801;
    const register = await call(
      '/api/auth/register',
      json({ id: String(id), name: `竞争朋友${id}` }),
    );
    const friendCookie = cookie(register, 'beixu_friend');
    const orderResponse = await call(
      '/api/orders',
      json(
        {
          productId: 'americano',
          config: { bean: 'blend', temp: '冰', milk: '', art: '', note: '', extra: '' },
        },
        'POST',
        { Cookie: `beixu_friend=${friendCookie}`, 'Idempotency-Key': crypto.randomUUID() },
      ),
    );
    const order = await read<{ order: { id: string } }>(orderResponse);
    const ownerLogin = await call(
      '/api/owner/login',
      json({ passphrase: 'test-owner-passphrase' }),
    );
    const ownerCookie = cookie(ownerLogin, 'beixu_owner');
    const [cancel, making] = await Promise.all([
      call(
        `/api/orders/${order.order.id}/cancel`,
        json({}, 'POST', { Cookie: `beixu_friend=${friendCookie}` }),
      ),
      call(
        `/api/owner/orders/${order.order.id}`,
        json({ status: 'making' }, 'PATCH', { Cookie: `beixu_owner=${ownerCookie}` }),
      ),
    ]);
    expect(
      [cancel.status, making.status].filter((status) => status >= 200 && status < 300),
    ).toHaveLength(1);
    const latest = await call(`/api/orders/${order.order.id}`, {
      headers: { Cookie: `beixu_owner=${ownerCookie}` },
    });
    const latestBody = await read<{ order: { status: string } }>(latest);
    expect(['cancelled', 'making']).toContain(latestBody.order.status);
  });

  it('图片仅允许合法签名且限制大小', async () => {
    const ownerLogin = await call(
      '/api/owner/login',
      json({ passphrase: 'test-owner-passphrase' }),
    );
    const ownerCookie = cookie(ownerLogin, 'beixu_owner');
    const invalid = await call('/api/owner/media', {
      method: 'POST',
      headers: { Cookie: `beixu_owner=${ownerCookie}`, 'Content-Type': 'image/png' },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(invalid.status).toBe(415);
    const oversized = await call('/api/owner/media', {
      method: 'POST',
      headers: { Cookie: `beixu_owner=${ownerCookie}`, 'Content-Type': 'image/png' },
      body: new Uint8Array(256 * 1024 + 1),
    });
    expect(oversized.status).toBe(413);
  });

  it('店主管理输入限制图片、豆子和选项引用', async () => {
    const ownerLogin = await call(
      '/api/owner/login',
      json({ passphrase: 'test-owner-passphrase' }),
    );
    const ownerCookie = cookie(ownerLogin, 'beixu_owner');
    const base = {
      name: '测试饮品',
      english: 'Test',
      categoryId: 'espresso',
      desc: '',
      story: '',
      photo: 'builtin:0',
      beans: ['blend'],
      temps: ['热'],
      milks: ['牛奶'],
      arts: ['不指定'],
      extraLabel: '',
      extraOptions: [],
      available: true,
    };
    const created = await call(
      '/api/owner/products',
      json({ ...base, id: '' }, 'POST', { Cookie: `beixu_owner=${ownerCookie}` }),
    );
    expect(created.status).toBe(201);
    expect((await read<{ product: { id: string } }>(created)).product.id).toMatch(/^p-/);
    const invalidPhoto = await call(
      '/api/owner/products',
      json({ ...base, id: '', photo: 'https://example.com/image.jpg' }, 'POST', {
        Cookie: `beixu_owner=${ownerCookie}`,
      }),
    );
    expect(invalidPhoto.status).toBe(400);
    const invalidBean = await call(
      '/api/owner/products',
      json({ ...base, id: '', beans: ['missing'] }, 'POST', {
        Cookie: `beixu_owner=${ownerCookie}`,
      }),
    );
    expect(invalidBean.status).toBe(400);
  });
});

describe('上线验收：会话、归属、恢复与分页', () => {
  beforeEach(resetDatabase);
  const fixture = async (id: number) => {
    const response = await call(
      '/api/auth/register',
      json({ id: String(id), name: `验收朋友${id}` }),
    );
    expect(response.status).toBe(201);
    return { token: cookie(response, 'beixu_friend'), response };
  };
  const owner = async () => {
    const response = await call('/api/owner/login', json({ passphrase: 'test-owner-passphrase' }));
    expect(response.status).toBe(200);
    return cookie(response, 'beixu_owner');
  };
  const config = {
    bean: 'blend',
    temp: '热',
    milk: '牛奶',
    art: '不指定',
    note: '保留这份备注',
    extra: '',
  };
  const order = async (token: string) => {
    const response = await call(
      '/api/orders',
      json({ productId: 'latte', config }, 'POST', {
        Cookie: `beixu_friend=${token}`,
        'Idempotency-Key': crypto.randomUUID(),
      }),
    );
    expect(response.status).toBe(201);
    return (await read<{ order: import('../src/shared/types').Order }>(response)).order;
  };

  it('重复账号返回字段错误，过期和退出后的会话失效', async () => {
    const { token, response } = await fixture(101);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=2592000');
    const duplicateId = await call('/api/auth/register', json({ id: '101', name: '另一个朋友' }));
    expect(duplicateId.status).toBe(409);
    expect((await read<any>(duplicateId)).error.fields.id).toBeTruthy();
    const duplicateName = await call(
      '/api/auth/register',
      json({ id: '102', name: '验收朋友101' }),
    );
    expect(duplicateName.status).toBe(409);
    expect((await read<any>(duplicateName)).error.fields.name).toBeTruthy();
    await env.DB.prepare('UPDATE sessions SET expires_at=0 WHERE user_id=101').run();
    expect(
      (await call('/api/profile', { headers: { Cookie: `beixu_friend=${token}` } })).status,
    ).toBe(401);
    const login = await call('/api/auth/login', json({ identifier: '101' }));
    const newToken = cookie(login, 'beixu_friend');
    const out = await call(
      '/api/auth/logout',
      json({}, 'POST', { Cookie: `beixu_friend=${newToken}` }),
    );
    expect(out.status).toBe(200);
    expect(
      (await call('/api/profile', { headers: { Cookie: `beixu_friend=${newToken}` } })).status,
    ).toBe(401);
  });

  it('他人不能读取、取消或评价订单；本人完成后才可评价', async () => {
    const a = await fixture(111),
      b = await fixture(112);
    const o = await order(a.token);
    for (const response of [
      await call(`/api/orders/${o.id}`, { headers: { Cookie: `beixu_friend=${b.token}` } }),
      await call(
        `/api/orders/${o.id}/cancel`,
        json({}, 'POST', { Cookie: `beixu_friend=${b.token}` }),
      ),
      await call(
        `/api/orders/${o.id}/review`,
        json({ stars: 5, tags: [], text: '' }, 'PUT', { Cookie: `beixu_friend=${b.token}` }),
      ),
    ])
      expect([403, 404]).toContain(response.status);
    expect(
      (
        await call(
          `/api/orders/${o.id}/review`,
          json({ stars: 5, tags: [], text: '' }, 'PUT', { Cookie: `beixu_friend=${a.token}` }),
        )
      ).status,
    ).toBe(409);
    const admin = await owner();
    expect(
      (
        await call(
          `/api/owner/orders/${o.id}`,
          json({ status: 'making' }, 'PATCH', { Cookie: `beixu_owner=${admin}` }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          `/api/orders/${o.id}/cancel`,
          json({}, 'POST', { Cookie: `beixu_friend=${a.token}` }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await call(
          `/api/owner/orders/${o.id}`,
          json({ status: 'done', ownerNote: '店主纸条' }, 'PATCH', {
            Cookie: `beixu_owner=${admin}`,
          }),
        )
      ).status,
    ).toBe(200);
    const review = await call(
      `/api/orders/${o.id}/review`,
      json({ stars: 5, tags: ['奶香刚好'], text: '喜欢', favorite: true }, 'PUT', {
        Cookie: `beixu_friend=${a.token}`,
      }),
    );
    expect(review.status).toBe(200);
    const again = await call(
      `/api/orders/${o.id}/review`,
      json({ stars: 4, tags: [], text: '修改后', favorite: true }, 'PUT', {
        Cookie: `beixu_friend=${a.token}`,
      }),
    );
    expect((await read<any>(again)).order.review.stars).toBe(4);
    const profile = await read<any>(
      await call('/api/profile', { headers: { Cookie: `beixu_friend=${a.token}` } }),
    );
    expect(profile.stats).toMatchObject({ count: 1, visits: 1 });
    expect(profile.favorites).toHaveLength(1);
  });

  it('暂停和缺货由服务端阻止，菜单改名不改历史快照', async () => {
    const a = await fixture(121),
      admin = await owner();
    const o = await order(a.token);
    const headers = { Cookie: `beixu_owner=${admin}` };
    await call('/api/owner/shop', json({ open: false }, 'PATCH', headers));
    const paused = await call(
      '/api/orders',
      json({ productId: 'latte', config }, 'POST', {
        Cookie: `beixu_friend=${a.token}`,
        'Idempotency-Key': crypto.randomUUID(),
      }),
    );
    expect(paused.status).toBe(409);
    await call('/api/owner/shop', json({ open: true }, 'PATCH', headers));
    const menu = await read<import('../src/shared/types').MenuData>(await call('/api/menu'));
    const blend = menu.beans.find((b) => b.id === 'blend')!;
    await call('/api/owner/beans/blend', json({ ...blend, available: false }, 'PUT', headers));
    const unavailable = await call(
      '/api/orders',
      json({ productId: 'latte', config }, 'POST', {
        Cookie: `beixu_friend=${a.token}`,
        'Idempotency-Key': crypto.randomUUID(),
      }),
    );
    expect(unavailable.status).toBe(409);
    const latte = menu.products.find((p) => p.id === 'latte')!;
    await call(
      '/api/owner/products/latte',
      json({ ...latte, name: '更名拿铁', photo: 'builtin:3' }, 'PUT', headers),
    );
    const saved = await read<any>(
      await call(`/api/orders/${o.id}`, { headers: { Cookie: `beixu_friend=${a.token}` } }),
    );
    expect(saved.order.snapshot.productName).toBe('拿铁');
    expect(saved.order.snapshot.photo).toBe('builtin:0');
    expect(saved.order.snapshot.config.note).toBe(config.note);
  });

  it('历史每页20条，不泄露其它账号订单', async () => {
    const a = await fixture(131);
    const sample = await order(a.token);
    const completedAt = '2026-10-20T01:00:00.000Z';
    const rows = Array.from({ length: 21 }, (_, n) =>
      env.DB.prepare(
        "INSERT INTO orders (id,user_id,username_snapshot,product_id,snapshot_json,status,created_at,completed_at,owner_note,idempotency_key,payload_hash) VALUES (?,?,?,?,?,'done',?,?, '',?,?)",
      ).bind(
        `history-${n}`,
        131,
        '验收朋友131',
        'latte',
        JSON.stringify(sample.snapshot),
        new Date(Date.parse(completedAt) + n * 1000).toISOString(),
        completedAt,
        crypto.randomUUID(),
        'fixture',
      ),
    );
    await env.DB.batch(rows);
    const headers = { Cookie: `beixu_friend=${a.token}` };
    const first = await read<any>(await call('/api/orders?scope=history&offset=0', { headers }));
    const second = await read<any>(await call('/api/orders?scope=history&offset=20', { headers }));
    expect(first.orders).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    expect(second.orders).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.orders, ...second.orders].map((o: any) => o.id)).size).toBe(21);
  });

  it('合法图片可原样读取并缓存，未知接口与非法跨域请求可辨识', async () => {
    const admin = await owner();
    const bytes = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jcxkAAAAASUVORK5CYII=',
      ),
      (c) => c.charCodeAt(0),
    );
    const uploaded = await call('/api/owner/media', {
      method: 'POST',
      headers: { Cookie: `beixu_owner=${admin}`, 'Content-Type': 'image/png' },
      body: bytes,
    });
    expect(uploaded.status).toBe(201);
    const { url } = await read<any>(uploaded);
    const image = await call(url);
    expect(image.status).toBe(200);
    expect(image.headers.get('Content-Type')).toBe('image/png');
    expect(image.headers.get('Cache-Control')).toContain('immutable');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes);
    expect((await call('/api/unknown')).status).toBe(404);
    expect(
      (
        await call(
          '/api/auth/login',
          json({ identifier: '101' }, 'POST', { Origin: 'https://evil.example' }),
        )
      ).status,
    ).toBe(403);
    expect((await call('/api/auth/login', json(null))).status).toBe(400);
  });
});
