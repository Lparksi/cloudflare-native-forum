# Phase 2：认证与邮件

## 已实现

Better Auth **1.7.13** + `@better-auth/drizzle-adapter` **1.7.13**，使用现有 Drizzle D1 driver。密码哈希、签名 Session、邮箱验证 JWT 与密码重置令牌完全由 Better Auth 实现。

- 邮箱注册，密码长度 12–128；显示名称 1–80 字。
- 注册后发送验证邮件；未验证邮箱不能登录，不自动创建 Session。
- 重发邮箱验证，链接 1 小时有效；验证后仍需主动登录。
- 登录/退出、数据库 Session（7 天），HttpOnly、SameSite=Lax、Path=/；HTTPS 使用 Secure Cookie。未启用 Cookie Session 缓存，撤销与过期直接查库生效。
- 找回密码，重置链接 30 分钟有效、一次性消费；重置成功撤销全部已有 Session。
- `/settings` 仅允许登录用户查看自己的账户；页面与 API 均 no-store、no-referrer。
- 本机发帖也必须登录且邮箱已验证，作者由 Session 决定；旧开发身份及主题保留，不能作为认证入口。Test/Production 业务写入仍关闭。

## 文件与路由

- `src/auth/options.ts`：运行时/Schema CLI 共用配置。
- `src/auth/server.ts`：请求级 Better Auth 工厂，直接 D1 绑定；无跨请求身份缓存。
- `src/auth/handler.ts`：`/api/auth/*`，沿用 Better Auth 原生响应契约和客户端；不包装为业务 API 格式。
- `src/auth/mail.ts`：本地收件箱与 Cloudflare Email 原生绑定适配。
- `src/db/auth-schema.ts`：固定版本 CLI 生成的 user/account/session/verification/rate_limit 及关系。
- `0001_*.sql`：增量迁移，增加认证表、开发邮件表及 profiles.user_id 可空唯一外键，保留 Phase 1 数据。公开身份在首次发帖时按已验证 Session 用户幂等创建，不给已有开发作者分配登录凭据。
- `/register`、`/login`、`/verify-email`（重发）、`/forgot-password`、`/reset-password`、`/settings`。
- `/dev/mail` 和 `/api/v1/dev/mail?email=`：仅本机开发收件箱。

Schema 生成：`pnpm auth:schema`，然后审查 diff、执行 `pnpm db:generate`、应用增量迁移。不要执行 Better Auth 的 migrate 命令，也不要重建已有数据库。

## 本机使用

```sh
pnpm install --frozen-lockfile
pnpm auth:setup
pnpm cf:types
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`auth:setup` 只在不存在 `.dev.vars` 时创建随机 secret，文件权限 0600；已有文件不覆盖。若已有文件，请自行添加至少 32 字符随机 `BETTER_AUTH_SECRET`，不得提交 Git。认证原点默认 **http://127.0.0.1:4321**，请使用该地址，localhost 别名不被当作相同原点。换端口时也须同时修改 BETTER_AUTH_URL；禁止根据不可信 Host 自动推断邮件原点。

在 `/register` 注册 → `/dev/mail` 点击对应邮箱的验证链接 → `/login` 登录。在 `/forgot-password` 申请后，到同一收件箱打开重置链接。没有向真实邮箱发送消息。

本地收件箱包含敏感链接，仅在 `APP_ENV=local`、`AUTH_MAIL_MODE=local`、loopback hostname 且与 BETTER_AUTH_URL 原点完全相同时开放。不得暴露本机端口或反代到公网。收件箱只显示最近 1 小时的 20 封，发新邮件时清理过期记录。URL 参数和开发日志也可能含测试令牌，不应分享。

Cloudflare Vite 在 build 时会为本地 preview 将 `.dev.vars` 复制到 **dist/server/.dev.vars**。它被 dist 的 Git 忽略规则覆盖，不属于浏览器静态资源；已验证 HTTP `/.dev.vars` 返回 404。不要分享整个 dist 或将它作为公开制品；真正的远端 secret 只通过 Cloudflare Secrets 配置。客户端 bundle 不含 secret。

## 环境和真实邮件

| 配置               | Local                         | Test / Production 默认   |
| ------------------ | ----------------------------- | ------------------------ |
| APP_ENV            | local                         | test / production        |
| AUTH_MAIL_MODE     | local                         | disabled                 |
| BETTER_AUTH_URL    | http://127.0.0.1:4321         | 各自占位 HTTPS 域名      |
| AUTH_MAIL_FROM     | 本地不使用                    | 占位地址，启用前更换     |
| BETTER_AUTH_SECRET | .dev.vars 随机值              | 各环境 Cloudflare Secret |
| AUTH_EMAIL         | Wrangler 本地绑定，不调用发信 | 已声明绑定但没有启用发信 |

启用真实投递前，项目所有者需确认发信域名、Email Service 状态/费用、DNS 与投递权限，再更换 AUTH_MAIL_FROM / BETTER_AUTH_URL，配置独立 secret，显式把目标环境 AUTH_MAIL_MODE 设为 `cloudflare`。仅允许 HTTPS。应用使用 `AUTH_EMAIL.send()` 发送纯文本和 HTML 事务邮件，不在远端保存链接副本。远端发送走 waitUntil，失败仅记录不含 token/邮箱的事件；没有自动重试或投递结果保证。

本轮未创建服务、未改 DNS、未配置真实发信域名、未发送真实邮件、未部署。Cloudflare 原生发送已通过类型和绑定替身测试，真实投递与收件率尚未验证。`disabled` 环境认证 API 返回 503，开发收件箱返回 404。

## 安全与 D1 边界

- 可信原点固定为配置值，保留 Better Auth 的 CSRF/回调 URL 校验；显式 `disableOriginCheck:false`、`disableCSRFCheck:false`，避免库在测试环境默认放宽 Origin 检查。外层对写请求要求精确 Origin，并限制请求体 16 KiB。
- 数据库限流跨 Worker 实例持久化：每 IP 每 60 秒，注册 3 次、登录 5 次、重发验证与申请重置各 3 次，其他路径默认每 IP、每路径 60 次。IP 来源仅 cf-connecting-ip；正式请求依赖 Cloudflare 覆盖该头，不能把直连/不可信反代作为生产入口。本机 E2E 独立 IP 仅用于测试。
- 注册、重发、重置请求使用库的邮箱枚举保护与统一 UI 提示；不存在用户和错误密码返回相同登录提示。认证日志不记录邮箱、token 或底层 SQL。
- 业务发帖不接受客户端 authorId，且必须再次从服务端 Session 取真实作者。公开资料通过独立 API 编辑，继续禁用 Better Auth 默认 /update-user，防止绕过显示名称与头像契约。
- D1 不支持 Drizzle 交互式事务，显式 `transaction:false`，未伪称全流程可回滚。库对重置先原子消费 token，再撤销 Session，再保存新密码；若保存失败，旧密码保留、旧 Session 已撤销、原 token 已消费，需重新申请链接。故障注入测试覆盖了该行为。
- 注册 user/account 的多步创建同样不具备交互式事务回滚；上线前需完善异常账户诊断与恢复流程，不通过全库重置处理。当前未启用公开环境，不能声称生产就绪。
- Wrangler 关闭默认 invocation_logs 和 tracing，保留脱敏 console 事件，避免平台日志自动采集含认证令牌的路径或查询。不能仅脱敏 query，因为重置令牌在路径中。未来增加 CDN/代理/Logpush 等日志时须继续核对令牌排除规则。
- 邮箱验证令牌由库签名并校验时效，重复打开已验证邮箱的链接不产生额外身份授权；密码重置令牌则为单次消费。Session 撤销不依赖 Cookie 缓存。

## 验证

`pnpm test` 使用独立 Miniflare D1；`pnpm test:e2e` 使用独立临时 D1、本机构建预览和开发收件箱，创建测试账户与主题，不使用日常开发数据库。CI 在类型检查和 build 前运行 auth:setup，使用随机本地 secret，不读取生产凭据。

覆盖注册与验证门槛、重发、登录/退出、密码哈希、Cookie 属性、防篡改、Session 过期、重置时效/重放/并发/撤销、D1 保存故障、跨站请求和恶意回调、持久化限流、远端禁用与开发邮箱隔离、HTTPS Cookie 和发信绑定替身。桌面/手机均执行完整 UI 流程。

参考：[Better Auth Drizzle](https://better-auth.com/docs/adapters/drizzle)、[邮件与密码](https://better-auth.com/docs/authentication/email-password)、[限流](https://better-auth.com/docs/concepts/rate-limit)、[Cloudflare Email Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)。以固定版本发布包、官方文档和实际测试共同核实。

## Phase 4 补充

注册、登录、申请重置与重发验证在 Better Auth 前执行挑战校验及每 IP/动作每分钟 10 次尝试限流，库自身的更严格限流仍保留。邮件重置链接继续由库校验单次令牌。封禁会在同一数据库语句内撤销全部 Session，并通过 Session 插入触发器拒绝并发登录；每次取得 Session 也重新检查账户状态。角色在独立 account_access 表管理，不启用 Better Auth admin 插件的额外高权限端点。详见 [管理与安全](moderation.md)。
