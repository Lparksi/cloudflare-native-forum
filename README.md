# Cloudflare Native Forum · 边集

一个 Workers 原生的技术论坛工程，以简单、可靠、低成本为目标。MIT 开源，允许商业使用。

**当前已完成 Phase 2 认证基础，尚不能公开运营。** 已实现注册、登录、数据库 Session、邮箱验证与密码重置，以及 SSR 首页、节点和主题。本地邮件进入开发收件箱；尚未配置真实投递。主题来自真实 D1。

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
- `src/db/schema.ts` / `repository.ts`：公开身份、节点、主题及查询。
- `db/migrations/`：Drizzle 版本化迁移；`db/seed.sql`：明确的本机 fixtures。
- `src/layouts/Layout.astro`：共享布局、Footer；`scripts/build-info.mjs`：构建元信息。
- `tests/`：Miniflare D1 集成测试、构建/计时测试、桌面/移动端 E2E。

[认证配置与本地邮件流程](docs/auth.md) · [架构、兼容性与后续顺序](docs/architecture.md) · [环境隔离与部署流程](docs/operations.md) · [许可证与素材](docs/licenses.md)

## 当前功能

- 首页与节点导航、节点讨论列表、主题详情，全部 SSR；列表 20 条游标分页。
- 邮箱注册、强制验证后登录、退出、数据库 Session、密码重置及全部旧会话撤销。
- 本机已登录用户创建主题、刷新后保留；幂等键处理重复及并发提交，冲突返回 409。
- 明暗/跟随系统主题、响应式布局、键盘焦点和跳到正文链接。
- 纯文本转义展示，隐藏/删除主题和隐藏节点不对游客读取。
- Footer 版本、真实构建 SHA（无 Git 为 dev）、服务端测量值和 Server-Timing。
- GitHub Actions 验证流程，**不包含部署或资源创建步骤**。

API：`GET /api/v1/health`、`GET /api/v1/nodes`、`GET /api/v1/topics?cursor=&node=`、`GET /api/v1/topics/:id`、`POST /api/v1/topics`。成功响应 `{ data }`，失败 `{ error: { code, message } }`。

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

E2E 使用已迁移和 seed 的本机 D1，会添加测试主题。请勿对生产执行。Miniflare API 测试使用临时独立数据库并自行初始化。CI 还运行 Gitleaks Git 历史扫描；本机 `check:secrets` 只是有限模式扫描，不宣称覆盖全部凭据类型。

## Cloudflare 配置

根配置仅供 Local：DB 绑定到本机 SQLite，APP_ENV=local。`env.test`、`env.production` 提供隔离配置，DB ID 为明确的占位 UUID，**没有创建远端数据库**。无部署脚本，无凭据要求。不要把本地配置直接发布。

认证需要 BETTER_AUTH_SECRET。pnpm auth:setup 为本地生成被忽略的随机 secret；邮件默认只写本地收件箱。AUTH_EMAIL 绑定适配已实现，真实 Email Service 域名和投递尚未配置。Test/Production 的 AUTH_MAIL_MODE 默认 disabled；不得将本地邮箱模式上线。R2、Turnstile 与业务限流留待后续。密钥不得写入 wrangler.jsonc 或 Git。详见 docs/auth.md。

## 未完成与下一阶段

1. 配置并验证真实邮件投递；完善角色、用户状态、异常账户诊断与恢复。
2. Turnstile、业务发帖限流、封禁与资源所有权检查；认证限流已落地，解除公共写入门槛前仍须完成其余措施。
3. 回复、编辑/软删除 UI、Markdown 安全渲染和代码高亮、点赞收藏。
4. 管理审核/举报/日志、通知、用户资料、R2 上传与文件校验。
5. 搜索、热门/活跃排序、RSS/Sitemap、SEO、英语语言包、缓存和实际 Test 部署验收。

本轮只有基础 SEO title/description/lang、明暗模式和简体中文。Schema 未预建未实现业务的空表。Production 部署、付费资源、仓库可见性修改与 PR 合并均需项目所有者明确授权。

## License

[MIT](LICENSE)。允许使用、修改、分发和商业利用，需保留声明。版权持有人保留明确待填写项，请项目所有者在公开前填写。名称、Logo 和商标权不由代码许可授予。[第三方许可说明](docs/licenses.md) 与 [完整依赖通知](THIRD_PARTY_NOTICES.txt) 单独保留。
