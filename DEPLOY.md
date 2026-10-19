# Cloudflare部署与维护

本项目最终发布到 Workers Static Assets + Worker + D1，同域提供页面、接口与图片。下面命令均在 beixu-app 文件夹执行。首次部署由你在自己的 Cloudflare 账号完成。

## 1. 安装与登录

```sh
npm ci
npx wrangler login
```

## 2. 创建数据库

```sh
npx wrangler d1 create beixu-db
```

将返回的 `database_id` 填入 `wrangler.jsonc` 的 `d1_databases[0].database_id`，保留 binding 为 `DB`。示例的全零ID仅为占位符，不能用于正式部署。

```sh
npm run db:migrate:remote
```

这会创建表并初始化五类、四款饮品、三款豆子和杯序小店；不会导入原型虚构账号和历史。不要向远程执行 `scripts/demo.sql`。

## 3. 设置店主口令

```sh
npx wrangler secret put OWNER_PASSPHRASE
```

在终端提示中输入你自己的长口令，不放进命令参数、Git或前端环境变量。`.dev.vars` 仅用于本地，上传生产不会自动携带。

## 4. 检查并发布

```sh
npm run typecheck
npm test
npm run deploy:dry
npm run deploy
```

部署将前端静态资源和后端Worker一起发布。打开返回的 workers.dev 地址，注册一个朋友账号，验证登录、点单、店主制作和评价。D1数据库ID变更后要重新build；Wrangler读取构建时生成的Worker配置。

如需自己的域名，在 Cloudflare 控制台 **Workers & Pages → beixu → Settings → Domains & Routes → Add → Custom Domain** 添加域名。页面和API保持同域，不需要额外CORS配置；启用HTTPS。

## 5. 日常更新

一般饮品、供应、照片和文案可直接在店主界面维护，无需重新发布。更改源码时先本地验证；若有新的SQL迁移，先备份，再远程迁移，最后发布应用。

```sh
npm run db:migrate:remote
npm run deploy
```

迁移不得修改已经发布过的编号脚本。后续结构变更新增编号文件，尽量让新旧Worker在发布期间都能使用。

## 6. 备份与恢复

每次结构变更前或需要保留记录时导出：

```sh
npx wrangler d1 export beixu-db --remote --output ./beixu-backup.sql
```

SQL备份包含账号、订单、评价、会话及图片，属于私人数据。请放到私人备份位置，不提交Git。恢复先创建**新的**D1数据库，再将备份导入新库：

```sh
npx wrangler d1 create beixu-restore
node scripts/prepare-backup.mjs ./beixu-backup.sql ./beixu-backup-ready.sql
npx wrangler d1 execute beixu-restore --remote --file ./beixu-backup-ready.sql
```

转换脚本将较大图片的十六进制 SQL 拆为小于 100 KB 的语句，保留完整字节，避免触及 D1 单条 SQL 长度限制。原始备份不会被覆盖。验证后将项目数据库名称与ID指向恢复库并重新构建部署。不要在当前生产库重复导入整份备份。Cloudflare D1控制台的Time Travel也可用于平台保留期内恢复，操作前核对回退时间与影响。

## 7. 排查

- **店主无法登录：** 核对生产Secret是否存在；不要使用原型口令。设置新口令后再登录。
- **数据库错误：** 核对 `DB` binding、数据库ID及远程迁移。用 `npx wrangler tail` 查看服务端错误；日志不应记录口令、Cookie、备注等私人内容。
- **页面刷新404：** 保留 `not_found_handling: single-page-application`；`/api/*`、`/media/*` 必须优先交给Worker，未知API应返回JSON错误。
- **状态暂未同步：** 保持页面在前台；错误时点重试，避免把失败当作完成。朋友只能取消仍排队的订单。
- **图片上传失败：** 使用可解码的JPEG/PNG/WebP；前端压缩后仍超限会提示，原图片选择和表单不应丢失。
- **无法在本地启动：** 检查Node版本、依赖安装及是否先执行本地迁移。

## 8. 搬迁项目

整个文件夹可复制到新位置。不需要携带 `node_modules/`、`dist/` 或 `.git/`；在新位置运行 `npm ci`。本地数据库如需迁移，另行保留 `.wrangler/`；生产D1不在你的电脑中。另行安全保存本地 `.dev.vars` 和必要备份。

备份格式与导入限制参阅 [Cloudflare 官方导入导出文档](https://developers.cloudflare.com/d1/best-practices/import-export-data/)。
