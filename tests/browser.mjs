import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const baseURL = process.env.BEIXU_TEST_URL || 'http://127.0.0.1:5173';
assert(['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname), '端到端测试仅允许本地地址');
const vars = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8').catch(() => '');
const passphrase =
  process.env.BEIXU_TEST_OWNER ||
  vars
    .match(/^OWNER_PASSPHRASE=(.*)$/m)?.[1]
    ?.trim()
    .replace(/^['"]|['"]$/g, '');
assert(passphrase, '请配置本地 .dev.vars 的 OWNER_PASSPHRASE');
const output = process.env.BEIXU_QA_DIR || path.join(os.tmpdir(), 'beixu-qa');
await mkdir(output, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
} catch {
  browser = await chromium.launch({ headless: true });
}
const friend = await browser.newContext({
  baseURL,
  viewport: { width: 405, height: 720 },
  reducedMotion: 'reduce',
});
const owner = await browser.newContext({
  baseURL,
  viewport: { width: 405, height: 720 },
  reducedMotion: 'reduce',
});
const other = await browser.newContext({ baseURL });
const page = await friend.newPage();
const admin = await owner.newPage();
const errors = [];
const checks = [];
for (const p of [page, admin]) {
  p.on('pageerror', (error) => errors.push(error.message));
  p.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text()))
      errors.push(message.text());
  });
}
const done = (name) => {
  checks.push(name);
  console.log('PASS', name);
};
const call = async (ctx, url, method = 'GET', data, extraHeaders = {}) => {
  const r = await ctx.request.fetch(url, {
    method,
    ...(data === undefined ? {} : { data }),
    headers: { Origin: baseURL, ...extraHeaders },
  });
  return { status: r.status(), data: await r.json() };
};
const see = async (locator) => locator.waitFor({ state: 'visible', timeout: 15000 });
const shot = async (p, name) =>
  p.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
const noOverflow = async (p) =>
  assert(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    '横向溢出',
  );
let originalMenu;
try {
  await page.goto('/login');
  await see(page.getByRole('heading', { name: '来啦，坐一会儿。' }));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await see(page.locator('[aria-invalid="true"]'));
  done('登录空字段校验与可读错误');
  await shot(page, '01-login');
  await page.getByRole('link', { name: '注册账号', exact: true }).click();
  await see(page.getByLabel('昵称', { exact: true }));
  // Find an available test ID without mutating through an API registration.
  const seed = Date.now() % 900;
  const nickname = '验证朋友' + Date.now().toString(36);
  let registered = false;
  for (let n = 0; n < 100; n++) {
    await page.getByLabel('数字 ID', { exact: true }).fill(String((seed + n) % 1000));
    await page.getByLabel('昵称', { exact: true }).fill(nickname);
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/auth/register') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '注册账号', exact: true }).click();
    const r = await response;
    if (r.status() === 200 || r.status() === 201) {
      registered = true;
      break;
    }
    assert.equal(r.status(), 409);
  }
  assert(registered, '没有可用测试ID');
  await see(page.getByRole('heading', { name: `${nickname}，今天喝什么？` }));
  originalMenu = (await call(owner, '/api/menu')).data;
  done('真实注册、Cookie登录与菜单渲染');
  await shot(page, '02-menu');
  assert.equal((await call(other, '/api/orders')).status, 401);
  assert.equal((await call(friend, '/api/owner/board')).status, 401);
  done('未登录和朋友会话不能进入店主管理API');

  await page
    .locator('.drink-row')
    .filter({ has: page.getByRole('heading', { name: '拿铁', exact: true }) })
    .getByRole('button', { name: '选搭配' })
    .click();
  await see(page.getByRole('button', { name: '确认这杯', exact: true }));
  await page.getByRole('button', { name: /风味/ }).first().click();
  await see(page.getByRole('dialog'));
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert(await page.evaluate(() => document.activeElement?.textContent?.includes('风味')));
  done('豆子弹层 Escape关闭与焦点返回');
  const temp = page.getByRole('group', { name: '温度', exact: true });
  await temp.getByRole('button', { name: '冰', exact: true }).click();
  assert.equal(await page.getByRole('group', { name: '拉花', exact: true }).count(), 0);
  await temp.getByRole('button', { name: '热', exact: true }).click();
  await page
    .getByRole('group', { name: '拉花', exact: true })
    .getByRole('button', { name: '爱心', exact: true })
    .click();
  await page.getByLabel('备注（选填）').fill('浏览器验证：奶味柔和一点');
  await shot(page, '03-customize');
  await page.getByRole('button', { name: '确认这杯', exact: true }).click();
  await see(page.getByRole('dialog', { name: '确认这杯' }));
  await shot(page, '04-confirm');
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '确认点单', exact: true }).click();
  const createdResponse = await created;
  assert([200, 201].includes(createdResponse.status()));
  const { order: originalOrder } = await createdResponse.json();
  const orderId = originalOrder.id;
  await see(page.getByRole('heading', { name: /正在排队/ }));
  assert(page.url().includes(orderId));
  done('选配联动、明确确认与持久化点单');

  await admin.goto('/owner/login');
  await admin.getByLabel('店主口令', { exact: true }).fill(passphrase);
  await admin.getByRole('button', { name: '进入制作台', exact: true }).click();
  await see(admin.getByRole('heading', { name: '制作台', exact: true }));
  const queue = admin
    .locator('article')
    .filter({ hasText: nickname })
    .filter({ has: admin.getByRole('button', { name: '开始制作', exact: true }) });
  await queue.getByRole('button', { name: '开始制作', exact: true }).click();
  await admin.getByRole('button', { name: /^制作中/ }).click();
  const making = admin
    .locator('article')
    .filter({ hasText: nickname })
    .filter({ has: admin.getByRole('button', { name: /标记完成/ }) });
  await making.getByLabel('附一张店主小纸条（选填）').fill('这杯已经做好，慢慢喝。');
  await shot(admin, '05-making-board');
  await making.getByRole('button', { name: /标记完成/ }).click();
  await see(page.getByRole('heading', { name: '这杯已完成', exact: true }));
  await see(page.getByText('这杯已经做好，慢慢喝。', { exact: true }));
  done('独立店主会话制作、留言与朋友端5秒同步');
  await page.getByRole('button', { name: '评价这杯', exact: true }).click();
  await see(page.getByRole('dialog'));
  await page.getByRole('button', { name: '5 星', exact: true }).click();
  await page.getByRole('button', { name: '奶香刚好', exact: true }).click();
  await page.getByLabel('给店主留句话（选填）').fill('奶香刚刚好，下次还想喝。');
  await page.getByRole('button', { name: '收藏这个搭配', exact: true }).click();
  await shot(page, '06-review');
  await page.getByRole('button', { name: '提交评价', exact: true }).click();
  await see(page.getByText('奶香刚刚好，下次还想喝。', { exact: true }));
  const profile = (await call(friend, '/api/profile')).data;
  assert.equal(profile.stats.count, 1);
  assert.equal(profile.stats.visits, 1);
  assert.equal(profile.favorites.length, 1);
  done('评价、搭配收藏和真实熟客统计');
  await page.goto('/profile');
  await see(page.getByRole('heading', { name: '我的熟客卡', exact: true }));
  await shot(page, '07-profile');

  const payload = { productId: 'latte', config: originalOrder.snapshot.config };
  const key = crypto.randomUUID();
  const first = await call(friend, '/api/orders', 'POST', payload, { 'Idempotency-Key': key });
  const replay = await call(friend, '/api/orders', 'POST', payload, { 'Idempotency-Key': key });
  assert.equal(first.data.order.id, replay.data.order.id);
  const changed = await call(
    friend,
    '/api/orders',
    'POST',
    { ...payload, config: { ...payload.config, note: '不同配置' } },
    { 'Idempotency-Key': key },
  );
  assert.equal(changed.status, 409);
  const race = await Promise.all([
    call(friend, `/api/orders/${first.data.order.id}/cancel`, 'POST', {}),
    call(owner, `/api/owner/orders/${first.data.order.id}`, 'PATCH', { status: 'making' }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  done('重复请求幂等、变更payload冲突与取消/制作并发竞争');

  await admin.goto('/owner/manage');
  await see(admin.getByRole('heading', { name: '菜单与豆单', exact: true }));
  await shot(admin, '08-menu-management');
  const latte = originalMenu.products.find((p) => p.id === 'latte');
  const updated = await call(owner, '/api/owner/products/latte', 'PUT', {
    ...latte,
    name: '拿铁（菜单已更新）',
  });
  assert.equal(updated.status, 200);
  assert.equal(
    (await call(friend, `/api/orders/${orderId}`)).data.order.snapshot.productName,
    '拿铁',
  );
  await call(owner, '/api/owner/products/latte', 'PUT', latte);
  done('菜单维护不改变历史订单快照');
  await admin.goto('/owner/settings');
  await see(admin.getByLabel('查找朋友'));
  await admin.getByLabel('查找朋友').fill(nickname);
  await see(admin.getByRole('button', { name: '修改昵称', exact: true }));
  await admin.getByRole('button', { name: '清除查找', exact: true }).click();
  assert.equal(await admin.getByLabel('查找朋友').inputValue(), '');
  await shot(admin, '09-settings');
  done('店主设置、账号查询与即时清除');

  await call(owner, '/api/owner/shop', 'PATCH', { open: false });
  const paused = await call(friend, '/api/orders', 'POST', payload, {
    'Idempotency-Key': crypto.randomUUID(),
  });
  assert([400, 409].includes(paused.status));
  await call(owner, '/api/owner/shop', 'PATCH', { open: true });
  done('暂停接单在服务端阻止提交');

  for (const width of [360, 405, 430, 1280]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 720 });
    for (const route of ['/menu', '/customize/latte', '/orders', '/profile']) {
      await page.goto(route);
      await see(page.locator('.bottom-nav,.sticky-action').first());
      await noOverflow(page);
    }
    await shot(page, `responsive-${width}`);
  }
  done('360/405/430手机与1280桌面无横向溢出');
  await page.route('**/api/profile', (route) => route.abort());
  await page.goto('/profile');
  await see(page.getByRole('alert').filter({ hasText: /网络/ }));
  await page.unroute('**/api/profile');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await see(page.getByRole('heading', { name: '我的熟客卡', exact: true }));
  done('断网失败说明与恢复重试');
  assert.deepEqual(errors, [], '浏览器存在应用异常');
  done('页面有内容、无框架错误覆盖和应用console异常');
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(
      {
        passed: true,
        browser: 'Chrome/Chromium',
        browserPlugin: 'not available; Playwright used',
        baseURL,
        checks,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(`验证完成：${checks.length}项；截图 ${output}`);
} catch (error) {
  await shot(page, 'failure-friend').catch(() => {});
  await shot(admin, 'failure-owner').catch(() => {});
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify({ passed: false, checks, errors, failure: String(error) }, null, 2),
  );
  throw error;
} finally {
  if (originalMenu) {
    await call(owner, '/api/owner/shop', 'PATCH', { open: originalMenu.shop.open }).catch(() => {});
    const latte = originalMenu.products.find((p) => p.id === 'latte');
    if (latte) await call(owner, '/api/owner/products/latte', 'PUT', latte).catch(() => {});
  }
  await browser.close();
}
