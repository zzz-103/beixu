# 杯叙 · 私人咖啡馆

手机优先的私人点单系统：朋友无密码登录、选配点单、查看制作状态、评价及收藏；店主制作台、菜单/豆单/分类/供应管理、小店设置和统计。

**一个项目、一个 Worker、一个 D1。** React + TypeScript + Vite，Hono API，参数化 SQL，无 ORM、R2、短信或邮件服务。

## 本地运行

需要 Node.js 22.12+（推荐24 LTS）和 npm。

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate
npm run dev
```

在 `.dev.vars` 设置仅供本地使用的 `OWNER_PASSPHRASE`。打开终端输出的本地地址。第一次使用请注册账号；店主从登录页的店主入口进入，使用上述本地口令。D1本地数据存于 `.wrangler/`，重启保留。

需要有历史记录的本地演示时，先迁移再运行 `npm run db:demo`。此命令只操作本地，不会在生产部署时执行。演示账号为 `007` / `小林`、`020` / `阿宇`，数据见 `scripts/demo.sql`。

## 常用命令

| 命令                 | 用途                               |
| -------------------- | ---------------------------------- |
| `npm run dev`        | 前端和Worker同源开发，本地D1       |
| `npm run db:migrate` | 本地迁移及基础菜单                 |
| `npm run typecheck`  | TypeScript检查                     |
| `npm test`           | 领域与真实Worker/D1接口测试        |
| `npm run test:e2e`   | 浏览器跨会话测试，需本地开发服务器 |
| `npm run build`      | 构建页面和Worker                   |
| `npm run preview`    | Workers运行时预览构建产物          |
| `npm run deploy:dry` | 生成部署包，不发布                 |
| `npm run deploy`     | 构建并发布Worker，需先完成云端配置 |

端到端测试需要可用的 Chromium（`npx playwright install chromium`）或本机Chrome；它会在**本地**D1建立测试账号和订单，不应指向生产站点。默认连接 http://127.0.0.1:5173；如果开发服务使用其他端口，运行 `BEIXU_TEST_URL=http://127.0.0.1:5176 npm run test:e2e`。可用 `BEIXU_TEST_OWNER` 覆盖本地测试口令，测试脚本不会打印口令。

## Cloudflare部署

按 [DEPLOY.md](DEPLOY.md) 创建 D1、写入数据库ID、执行远程迁移、设置店主Secret，再部署。生产不预置朋友账号/订单/评价；菜单与小店信息在迁移中初始化。生产口令和Cloudflare凭据不得写进源码。

## 目录

- `src/client/`：页面、共享UI、API访问、CSS与令牌。
- `src/worker/`：接口、会话、权限、D1访问。
- `src/shared/`：前后端数据类型和选配领域规则。
- `migrations/`：D1结构和基础菜单，按编号应用。
- `tests/`：领域、后端和浏览器验证。
- `API.md`：接口契约；`DESIGN.md`、`UX-CONTRACT.md`：视觉和行为。

## 产品约定

- 朋友ID为0–999，昵称唯一。无密码登录是熟人账号选择：知道他人ID/昵称即可进入其账号；不会验证真实身份。
- 店主独立Cookie与口令，朋友会话不拥有管理权限。朋友会话30天，店主12小时。
- 每单一杯；仅排队订单可由朋友取消，店主也可取消制作中的订单。历史快照保留。
- 页面可见时每5秒更新制作状态；后台暂停，恢复前台立即刷新。不做离线下单或系统推送。
- 图片上传压缩至最长边1280px、256KiB以内，存于D1；更换后保留旧图以展示历史订单。
- 全站简体中文和上海时间。数据库存ISO时间，统计使用上海日期。

## 素材

内置摄影复用本项目已确认的 `drinks.png`（四格饮品图）；上传图片由店主提供。使用系统中文字体和 Lucide 图标，无外部字体/CDN依赖。
