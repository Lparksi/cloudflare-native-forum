# Phase 4：管理与反滥用

当前仅开放本机 loopback、精确 Origin、已验证邮箱 Session 的业务写入。Test/Production 继续关闭认证和业务写入；本轮没有创建线上资源或部署。

## 角色与后台

角色存于 `account_access`，Better Auth 负责认证，不启用其 admin 插件。新用户默认 member；旧账户通过 0003 迁移回填。每次获取 Session 都重新查询账户状态，管理 SQL 执行时再次检查当前角色。

| 操作                                 | member | moderator | admin |
| ------------------------------------ | ------ | --------- | ----- |
| 举报公开主题/回复                    | 是     | 是        | 是    |
| 查看后台、举报、审核日志             | 否     | 是        | 是    |
| 隐藏/恢复主题与回复、处理举报        | 否     | 是        | 是    |
| 封禁/解封 member                     | 否     | 是        | 是    |
| 封禁/解封 moderator                  | 否     | 否        | 是    |
| 调整其他账户角色、创建/编辑/隐藏节点 | 否     | 否        | 是    |

禁止封禁自己或管理员，禁止修改自己的角色；调整角色要求目标已验证且未封禁。最后一名活跃管理员受 SQL 与触发器保护。后台入口 `/admin`，账户设置页按权限显示链接。列表每页 30 项，按 ID 游标分页；审核正文只作为转义文本显示。

首次管理员需先注册并验证邮箱，再由本机操作者执行：

```sh
pnpm admin:bootstrap verified-email@example.com
```

命令固定 `--local`，已有活跃管理员时拒绝初始化。0004 将首次授权嵌入审核日志 INSERT 的触发器，授权与日志同一语句提交；不会通过公开注册自动授予管理员。本轮未在日常开发库中指定管理员。后续授权从后台完成。

## 封禁、审核和举报

- 封禁在同一 SQL 语句的触发器内撤销所有 Session；Session 插入触发器阻止并发登录。解封后必须重新登录，不恢复旧会话。业务写入 SQL 也检查账户未封禁。封禁不自动隐藏历史内容，内容审核单独操作。
- 主题/回复隐藏与恢复只允许 published ↔ hidden，不能恢复作者软删除内容；要求 revision，冲突返回 409。隐藏父主题/节点后，公开详情、回复和互动均不可访问。
- 管理变更与日志使用 D1 batch 原子提交，日志失败则变更回滚；无变更不插入日志。角色、封禁、内容审核、节点变更与举报处理均要求 3–500 字操作原因。节点沿用原 Schema，无 revision，最后一次有效保存生效。
- 已验证用户可举报可见主题或回复；同一用户对同一目标只允许一条未处理举报。管理员/版主可标记 resolved 或 dismissed，保存处理人和原因。举报不自动隐藏内容。
- `0003`、`0004` 及 `0002` 的手工触发器属于数据库契约，今后重建表必须保留。已应用迁移不可修改。

管理 API 位于 `/api/v1/admin`：GET users/topics/replies/nodes/reports/logs；PATCH users/:id/role、users/:id/ban、topics/:id/visibility、replies/:id/visibility、reports/:id；POST nodes 和 PATCH nodes/:id。举报为 POST `/api/v1/reports`，提交 kind、targetId、reason。请求 Schema 见 `src/lib/contracts.ts`，数据访问见 `src/db/moderation.ts`。

## Turnstile

注册、登录、申请重置、重发验证、新主题、新回复和举报分别绑定 signup/login/password_reset/verify_email/topic/reply/report action。客户端通过 `x-turnstile-token` 提交，每次尝试后重新验证；过期、错误和卸载清理 token 与 widget。编辑、删除不要求新挑战，仍执行认证、Origin 和权限检查。

| 模式     | 行为                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| local    | 仅 APP_ENV=local、loopback 且精确配置原点，签发绑定 action/IP 的 5 分钟一次性随机挑战，D1 DELETE RETURNING 原子消费；界面明确标注本地模拟 |
| managed  | 调用官方 Siteverify，严格检查 success=true、预期 action、BETTER_AUTH_URL hostname；缺 Secret、网络/JSON 错误或超时均拒绝                  |
| disabled | 所有要求挑战的操作失败关闭；Test/Production 默认值                                                                                        |

本地模拟不代表机器人防护，禁止将开发端口转发公网。真实模式需要所有者配置允许域名的 Turnstile widget，将公开 sitekey 写入 TURNSTILE_SITE_KEY，TURNSTILE_SECRET 存入对应环境的 Cloudflare Secrets，并显式设置 TURNSTILE_MODE=managed。不能把 Secret 放在 PUBLIC 变量或 Git 中，也不能自动解除现有远端业务写入门槛。

本轮未创建 widget、未配置真实密钥；managed 服务端分支以 fetch 替身验证，客户端生命周期以浏览器脚本替身验证。真实 token 的签发、过期和二次 Siteverify 拒绝仍需目标域名验收。官方 dummy key 的元数据不满足本应用 action/hostname 契约，不能为它放宽检查。

参考：[Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)、[客户端渲染](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/)、[测试说明](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)。

## 限流

`write_limits` 使用单条 UPSERT RETURNING 原子消费每分钟固定窗口额度，跨 Worker 实例共享 D1 状态。429 返回 Retry-After；按尝试计数，挑战失败或业务冲突也计入。主题、回复、举报分别计数，同时检查用户与 IP；用户换 IP 不重置用户额度。

| 操作         | 每用户/分钟               | 每 IP/分钟                                |
| ------------ | ------------------------- | ----------------------------------------- |
| 新主题       | TOPIC_RATE_LIMIT，默认 5  | 用户额度 × 3                              |
| 新回复       | REPLY_RATE_LIMIT，默认 20 | 用户额度 × 3                              |
| 举报         | 5                         | 15                                        |
| 认证挑战尝试 | —                         | 每 action 10，另保留 Better Auth 自身限流 |
| 本地挑战签发 | —                         | 100                                       |

只信任 Cloudflare 覆盖的 cf-connecting-ip；本机无此头时使用 loopback IP。不得将不可信直连代理作为生产入口。同一个 key 在新窗口复用，历史不同身份的过期限流行后续可定期清理；当前未增加定时任务。

## 测试边界

独立 Miniflare D1 覆盖角色层级、最后管理员并发保护、封禁与 Session、审计失败回滚、举报唯一约束、隐藏父级、bootstrap 原子性、限流并发与挑战重放。E2E 每轮独立本机 D1，自动迁移/seed，不污染日常开发库；运行前需停止占用 4321 的服务。没有验证远端 D1、真实邮件或真实 Turnstile 站点。
