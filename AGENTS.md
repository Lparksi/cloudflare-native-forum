# 工程规范

- 使用简体中文沟通。修改前读取直接相关代码，复用现有契约，保持最小正确实现。
- Cloudflare Workers 原生优先；单 Worker、Astro SSR、React Islands、Hono、D1 + Drizzle。保持 TypeScript strict。不要提前引入微服务、Redis、VPS 或复杂抽象。
- MIT 开源，允许商业使用。保留第三方许可声明；字体、图标、图片单独管理许可。版权持有人待项目所有者确认，不猜测名称。
- 优先低成本。不擅自创建收费服务、修改无关资源、部署生产、合并 PR 或改变仓库可见性。
- 不覆盖用户工作，不修改 Git 配置，不提交 Secret；云端密钥只用 Cloudflare Secrets。本地敏感配置使用被忽略的 `.dev.vars`。
- API 使用 `/api/v1`，成功 `{ data }`，失败 `{ error: { code, message } }`。不将数据库错误或内部路径返回客户端。
- 数据访问集中在 `src/db/repository.ts`；用参数化查询、外键、唯一约束和游标分页。D1 多步原子写使用 batch，不能假设支持交互式事务。
- Schema 在 `src/db/schema.ts`；使用 `pnpm db:generate` 生成并提交版本化迁移。不得修改已应用迁移，生产不得重置。迁移前备份、检查计划并验证恢复。
- 认证使用 Better Auth + Drizzle D1，版本和 Schema 由固定 CLI 生成，详见 docs/auth.md。业务写入仅允许 APP_ENV=local + loopback URL + 精确 Origin，并要求已验证邮箱的真实 Session；旧开发作者不是登录身份。Test/Production 业务写入继续关闭，直到权限、Turnstile 和业务限流落地。
- 本地邮件只进受 loopback、APP_ENV 与精确原点限制的开发收件箱；Test/Production 默认 AUTH_MAIL_MODE=disabled。不得将本地收件箱、.dev.vars 或 dist/server/.dev.vars 对外发布。真实邮件需事先配置域名/Secret，不能用日志输出验证或重置 token。
- D1 认证 adapter 显式 transaction:false，不声称多步事务可回滚。密码重置单次消费、旧 Session 撤销和失败行为必须测试；不要自行实现密码哈希或 Session 协议。
- 公开内容输出必须转义；Markdown 上线前采用安全渲染。权限、文件上传、用户数据和并发写入需要针对性测试。
- 不启用公共页面缓存，直到有明确缓存键、用户隔离和 Footer 耗时处理。静态资源可以缓存。
- `package.json` 是版本号唯一来源。构建 SHA 来自 GITHUB_SHA 或构建时 Git；无 Git 显示 dev。前后端使用同一次构建元信息。可选公开仓库地址才能生成 Commit 链接。
- Footer 每个正常网页展示版本、SHA 和真实 Server 耗时。当前边界为 Worker 请求入口至有界 SSR 正文读取完成，不包含替换和网络传输。`Server-Timing` 与 Footer 同值。缓存命中不可复用旧耗时；未来缓存页面显示 Server —。
- Workers Env 类型通过 `pnpm cf:types` 生成，不手写绑定类型。
- 完成修改后运行与风险匹配的测试；提交前执行 typecheck、lint、test、build、许可证和 Secret 检查。核心 UI 改动执行 Playwright。不得虚报结果。
