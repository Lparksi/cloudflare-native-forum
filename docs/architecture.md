# 架构与边界

Phase 4 更新：认证、讨论与本地管理安全闭环已落地。详见 [认证说明](auth.md) 与 [讨论设计](discussions.md) 及 [管理安全](moderation.md)。

浏览器 → Cloudflare Workers 单入口 `src/worker.ts`。`/api/*` 交给 Hono，其余交给 Astro Cloudflare handler。SSR 与 API 复用 `src/db/repository.ts` / `discussions.ts`，通过 Drizzle D1 driver 使用 DB 绑定。React Islands 用于外观、账户表单、Markdown 编辑预览和讨论交互；Tailwind v4 使用 Vite 插件，视觉 token 与响应式规则位于 global.css。

采用扁平工程，避免尚无共享消费者时引入 monorepo。没有 VPS、Redis、Docker 后端或外部数据库。未配置自动创建的 Images/KV：图片用 compile 模式，Astro session 关闭。当前无 R2 上传与资源。AUTH_EMAIL 已声明为本地绑定和未来远端投递适配，尚未配置真实发送。

## 版本与兼容性（2026-10-26）

实际 npm 稳定版本：Astro 7.4.2、Cloudflare adapter 14.4.2、React integration 7.1.1、Hono 4.13.13、Drizzle 0.45.4、Tailwind 4.3.3。依赖解析以 pnpm-lock.yaml 为准。没有采用 Drizzle 文档示例中的 RC。TypeScript 最新 7.0.2 超出 Astro checker 和 typescript-eslint 的 peer 范围，实际固定 `~6.0.0`，安装 6.0.3；`pnpm peers check` 验证。

参考官方接口：[Astro Cloudflare](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)、[Workers 最佳实践](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)、[Drizzle D1](https://orm.drizzle.team/docs/connect-cloudflare-d1)、[Hono Workers](https://hono.dev/docs/getting-started/cloudflare-workers)。Context7 本次额度耗尽，使用官方文档与安装包类型复核。

Better Auth 1.7.13 通过固定版本 CLI 生成认证 Schema，使用 Drizzle adapter 的 SQLite 模式与 transaction:false。认证账户与公开 profiles 通过可空唯一 user_id 关联，旧主题作者保留。profiles 不存密码、邮箱或 Session。

## 最小写入闭环

本机明确执行 db:seed，生成三个节点与开发身份，不插入任何主题。发布表单 → 同源 JSON API → Zod 校验 → Drizzle 参数化 SQL → D1 → 主题详情 SSR / 首页列表。

写入门槛为 APP_ENV=local、loopback URL、精确 Origin，以及 Better Auth 的已验证邮箱 Session。作者由 Session 映射到公开 profile，旧本地开发身份不再用于创建主题。Test/Production 写入禁用；不得公开开发端口。角色权限、审核与业务限流已实现，真实邮件及 Turnstile 尚未验收，本阶段不能正式上线。

主题 UUID、复合索引、外键、状态 CHECK、正文长度 CHECK、作者+请求 UUID 唯一约束。使用同一 INSERT…SELECT 检查可见节点并插入，消除检查与写入的间隙。幂等重试返回同一主题；同一请求标识对应不同内容返回 409。测试覆盖并发重复、隐藏/删除内容和相同毫秒的游标分页。回复楼层与计数、最后回复时间、点赞计数由同一SQL语句内的触发器维护，避免应用多步写入不一致。编辑/删除同时检查作者与revision，软删除保留数据。

正文通过统一的 remark/rehype 管线渲染，禁用原始 HTML，sanitize 后由可信插件高亮。主题列表每页20、回复每页30，标题最长120、正文最长20000；SSR数据有界，不在一次请求载入全部回复。

## 构建信息与计时

`scripts/build-info.mjs` 在 Astro 配置加载时读取唯一 package.json 版本、GITHUB_SHA 或 git rev-parse HEAD；无 Git 为 dev。构建时注入常量供同一次 SSR/客户端构建使用，请求期间不运行 Git。通过 PUBLIC_REPOSITORY_URL 提供已公开 GitHub 仓库 HTTPS 地址时，Footer Hash 可链接到 Commit；未配置远端时不虚构链接。

计时边界：Worker fetch 入口 → Astro handle → 完整读取有界 HTML 正文 → 采样 performance.now。Footer 占位标记被同一数值替换，Server-Timing 使用 app;dur。该数值不含之后的字符串替换、响应传输或网络 RTT。API 的计时边界是生成 Response，JSON 响应不消费正文流。未缓存 SSR，统一 private,no-store；静态资源走适配器的 immutable 缓存。未来引入 CDN 页面缓存时须移除旧计时并显示 Server —，不能直接缓存当前 HTML。

只对 HTML 执行有界缓冲，后续增加附件下载、大结果或 streaming SSR 时必须重新设计计时，不可复用当前方案。当前不提供完整 streaming 响应耗时承诺。

## 后续顺序

1. 完成真实邮件投递验证和异常账户恢复流程；认证本地闭环已完成。
2. 配置真实 Turnstile 站点与 Secret，验收真实 token、域名、action 和重放拒绝。
3. 用户主页/资料、@用户解析与通知。
4. 审核运营流程，再推进搜索。
5. R2 类型/实际内容/大小校验，SEO/RSS/Sitemap 与经过隔离验证的公共缓存；申请 Test 部署权限后验证。
