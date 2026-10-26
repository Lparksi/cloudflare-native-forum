# Cloudflare Native Forum · 边集

一个 Workers 原生的技术论坛工程，以简单、可靠、低成本为目标。MIT 开源，允许商业使用。

**当前已完成 Phase 4 本地管理与安全功能，尚不能公开运营。** 支持 Markdown 与安全预览、线性回复、主题/回复编辑和软删除、点赞收藏，以及已实现的账户认证。本地邮件进入开发收件箱；尚未配置真实投递。内容真实存储于 D1。

## 本地启动

需要 Git、Node.js **22.23.4+（推荐 24 LTS）**、pnpm **12.9.1**。安装依赖不会创建任何云资源。

```sh
# 远端仓库尚未创建；以后从项目实际仓库克隆，再进入其目录。
# git clone <实际仓库地址>
# cd <克隆目录>
pnpm install --frozen-lockfile
pnpm auth:setup
pnpm cf:types
pnpm db:migrate
pnpm db:seed
pnpm dev
```

访问 [本地首页](http://127.0.0.1:4321)。在「发起讨论」填写标题、节点、正文，先注册，在 [开发收件箱](http://127.0.0.1:4321/dev/mail) 验证邮箱并登录后发布；可刷新、回首页验证持久化。`db:seed` 仅添加开发身份与三个节点，可重复执行，不插入主题。

Astro 在检测到 AI Agent 时会自动后台运行；受限执行环境可用 `pnpm dev --ignore-lock` 保持前台。Wrangler 需要写入其本机 registry，沙盒环境可能需要授予该目录写权限。日志可通过 `WRANGLER_LOG_PATH=.wrangler/logs` 留在工程内。

```sh
pnpm build
pnpm preview --ignore-lock
```

## 技术架构

Astro 7 + TypeScript strict、Cloudflare adapter、React Islands、Tailwind v4、Hono、Drizzle/D1、Zod、Better Auth。单 Worker、扁平目录，SSR 直接复用 Repository，浏览器通过 Hono API 写入。没有引入 Docker、VPS、Redis、KV 或 R2 服务。

- `src/worker.ts`：Workers 入口、Hono 分流、响应计时与安全头。
- `src/lib/api.ts`：API、Zod 校验、同源与本机写入限制。
- `src/db/schema.ts` / `repository.ts` / `discussions.ts` / `moderation.ts`：公开身份、节点、主题、回复、互动及权限查询。
- `db/migrations/`：Drizzle 版本化迁移；`db/seed.sql`：明确的本机 fixtures。
- `src/layouts/Layout.astro`：共享布局、Footer；`scripts/build-info.mjs`：构建元信息。
- `tests/`：Miniflare D1 集成测试、构建/计时测试、桌面/移动端 E2E。

[管理、权限与反滥用](docs/moderation.md) · [讨论功能与API](docs/discussions.md) · [认证配置与本地邮件流程](docs/auth.md) · [架构、兼容性与后续顺序](docs/architecture.md) · [环境隔离与部署流程](docs/operations.md) · [许可证与素材](docs/licenses.md)

## 当前功能

- 首页与节点导航、节点讨论列表、主题详情，全部 SSR；列表 20 条游标分页。
- 邮箱注册、强制验证后登录、退出、数据库 Session、密码重置及全部旧会话撤销。
- 本机已登录用户创建主题、刷新后保留；幂等键处理重复及并发提交，冲突返回 409。
- 明暗/跟随系统主题、响应式布局、键盘焦点和跳到正文链接。
- Markdown 编辑、同源服务端预览、安全 SSR、GFM 表格与代码高亮；禁止原始 HTML。
- 线性回复、稳定楼层与游标分页、Markdown 引用。
- 作者编辑/软删除及 revision 冲突保护，删除回复保留不含正文的占位。
- 点赞/取消与私有收藏/取消；唯一约束去重，数据库原子更新计数。
- 隐藏/删除主题和隐藏节点同时限制子回复、互动和收藏列表。
- 管理员/版主后台、角色管理、封禁/解封、内容隐藏/恢复、节点管理、举报处理及原子审核日志。
- Turnstile 服务端严格验证适配、本地一次性模拟挑战、D1 持久化发帖/回复与举报限流。
- Footer 版本、真实构建 SHA（无 Git 为 dev）、服务端测量值和 Server-Timing。
- GitHub Actions 验证流程，**不包含部署或资源创建步骤**。

API：`GET /api/v1/health`、`GET /api/v1/nodes`、`GET /api/v1/topics?cursor=&node=`、`GET /api/v1/topics/:id`、`POST /api/v1/topics`。成功响应 `{ data }`，失败 `{ error: { code, message } }`。新增编辑、删除、回复和互动 API 详见 [讨论接口](docs/discussions.md#api)。

## 构建信息与缓存

版本唯一来源为 package.json。SHA 优先 GITHUB_SHA，否则构建时读取 Git；请求期间不执行 Git。本地首次无提交显示 dev，创建提交后重新 build 才反映该提交。可选公开仓库链接：

```sh
PUBLIC_REPOSITORY_URL=https://github.com/OWNER/REPO pnpm build
```

仅在确有公开仓库时设置，Hash 点击打开对应 Commit，悬停显示全长 SHA。

Server 数值测量 Worker 请求入口至 SSR 正文完整读取结束，不包括最终字符串替换和网络传输。当前 SSR/API 返回 `private, no-store`；适配器静态资源独立缓存。未启用 CDN 页面缓存；后续启用时须将耗时显示为 `Server —`，不得缓存上次测量值。详见架构文档。

## 验证命令

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm check:licenses
pnpm check:metadata
pnpm check:secrets
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

E2E 每轮在 `.cache/e2e/` 创建独立本机 D1，自动迁移和 seed，不使用日常开发数据库。运行前停止占用 4321 的服务；测试自己启动构建预览。请勿对生产执行。Miniflare API 测试使用临时独立数据库并自行初始化。CI 还运行 Gitleaks Git 历史扫描；本机 `check:secrets` 只是有限模式扫描，不宣称覆盖全部凭据类型。

## Cloudflare 配置

根配置仅供 Local：DB 绑定到本机 SQLite，APP_ENV=local。`env.test`、`env.production` 提供隔离配置，DB ID 为明确的占位 UUID，**没有创建远端数据库**。无部署脚本，无凭据要求。不要把本地配置直接发布。

认证需要 BETTER_AUTH_SECRET。pnpm auth:setup 为本地生成被忽略的随机 secret；邮件默认只写本地收件箱。AUTH_EMAIL 绑定适配已实现，真实 Email Service 域名和投递尚未配置。Test/Production 的 AUTH_MAIL_MODE 默认 disabled；不得将本地邮箱模式上线。Turnstile 本机默认模拟，真实站点 key/secret 和投递域名均未配置。业务写入继续仅限本机；R2 留待后续。密钥不得写入 wrangler.jsonc 或 Git。详见 docs/auth.md。

## 未完成与下一阶段

1. 配置并验证真实邮件投递、真实 Turnstile 域名与密钥；完善异常账户诊断与恢复，演练备份恢复。
2. 用户主页/资料、@ 用户解析与通知、审核运营流程。
3. R2 上传与文件校验。
4. 搜索、热门/活跃排序、RSS/Sitemap、SEO、英语语言包、缓存和实际 Test 部署验收。

本轮只有基础 SEO title/description/lang、明暗模式和简体中文。Schema 未预建未实现业务的空表。Production 部署、付费资源、仓库可见性修改与 PR 合并均需项目所有者明确授权。

## License

[MIT](LICENSE)。允许使用、修改、分发和商业利用，需保留声明。版权持有人保留明确待填写项，请项目所有者在公开前填写。名称、Logo 和商标权不由代码许可授予。[第三方许可说明](docs/licenses.md) 与 [完整依赖通知](THIRD_PARTY_NOTICES.txt) 单独保留。
