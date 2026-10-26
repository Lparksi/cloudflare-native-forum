# 首轮验证记录

日期：2026-10-26。范围为本机与本机 workerd；没有远端资源或部署。

- `pnpm install`、`pnpm peers check`：依赖安装及 peer 约束通过。TypeScript 从不兼容的 7.0.2 调整为 6.0.3。
- `pnpm cf:types`：从 Wrangler 配置生成 Env 与运行时类型。
- `pnpm db:generate`：生成 profiles、nodes、topics 的初始 SQL 与 Drizzle snapshot；再次生成无 Schema 变更。
- `pnpm db:migrate`、`pnpm db:seed`：本机 D1 迁移与显式开发身份/节点初始化成功。
- `pnpm typecheck`：Astro 检查及工具/测试 tsc 通过，0 errors / warnings / hints。
- `pnpm lint`、`pnpm format:check`：通过。
- `pnpm test`：11 项通过。真实 Miniflare D1，覆盖持久化、6 个并发重复请求、幂等内容冲突、Test/Production/跨源写拒绝、非法输入/JSON/大小/NUL、不可见内容、同毫秒游标分页；另覆盖构建元信息与完整 HTML 正文读取后的计时。
- `pnpm build`：Astro SSR/客户端单次构建成功。
- `pnpm dev --ignore-lock`：本机开发服务启动；health API 返回 D1 connected。
- `pnpm preview --ignore-lock`：构建产物在本机 workerd 启动。
- `pnpm test:e2e`：开发模式及构建预览模式分别通过 4 项（Chromium desktop + iPhone 13 viewport）。验证发布 → D1 → SSR 详情 → 刷新 → 首页、XSS 纯文本转义、明暗切换与持久化、移动端无水平溢出、节点页和 404。
- Footer / Server-Timing：浏览器校验有效数值；后续增强断言为首个 SSR 响应头与 Footer 数值完全一致，并比对构建 SHA 与 Git。
- 构建 HTML 检查：未包含 `/Users/` 或开发 source 属性。
- `pnpm check:licenses`：项目 MIT 与 422 条依赖许可记录通过；构建工具 LGPL/MPL 例外详见 licenses.md，459 个已安装包版本的许可证/NOTICE 已保留。
- `pnpm check:metadata`：版本、完整 SHA 格式、CI SHA 优先、无 Git dev 回退与 Commit URL 规则通过。无提交时构建实际成功，显示 dev。
- `pnpm check:secrets`：源码有限模式检查通过。Gitleaks 8.30.0 对 Git 待跟踪源码集合的副本扫描，约 1.76 MB，无泄露。依赖、浏览器缓存和本机运行日志未作为交付源码。

本机受限沙盒不能写 Wrangler registry，且禁止 Chromium Mach 注册；授予本机验证进程相应访问后通过。没有改变论坛代码来绕过这些运行环境限制。

独立只读审查未发现阻塞项，定位到 NUL 输入通过 JS 长度校验、触发 SQLite length CHECK 的问题，已在边界拒绝并加入 API 回归断言。首次 SQL INSERT…SELECT 的 ON CONFLICT 解析问题和开发模式 Astro 属性导致 Footer 标记不匹配的问题，也均已修复并通过测试。

GitHub Actions 已编写但尚未在远端运行；D1 云端行为、Test/Production 部署、备份恢复演练、正式身份与权限均未验证，不能声称生产就绪。页面缓存当前禁用，没有将缓存命中伪装成实测请求耗时。

## Phase 2 认证验证（2026-10-26）

- Better Auth 与 Drizzle adapter 固定 1.7.13；`auth@1.7.13 generate` 生成认证 Schema，随后 Drizzle 生成 0001 增量迁移。本机应用成功，既有主题与开发作者保留。
- `pnpm test`：**23 项通过**。新增邮箱验证门槛、哈希持久化、Cookie、会话过期/篡改/退出、重发/未知邮箱统一响应、重置一次性/过期/并发消费/全部旧会话撤销、D1 写入故障、CSRF/回调/体积/密码校验、数据库限流、邮箱隔离、HTTPS 与发信绑定替身、默认资料更新入口关闭。
- `pnpm test:e2e`：**6 项通过**，桌面与 iPhone 13 viewport 均完成注册 → 开发收件箱验证 → 登录 → 退出 → 重置密码 → 旧密码失败/新密码成功 → 已消费链接失败；论坛 E2E 改为已验证真实账户发帖。
- `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm build`、`pnpm peers check` 通过。新增 auth:setup 与 Env 自动生成，CI 已补本地随机 Secret 初始化。
- `pnpm check:licenses`：513 条依赖许可记录通过；554 个已安装包版本的通知已重新生成。`check:metadata`、`check:secrets` 通过。
- 独立 Astra High 只读审查发现默认 update-user 绕过名称契约、平台 invocation logs 可采集 token URL，两者已修复；补充 update-user 的实际回归测试，并关闭 invocation logs/tracing。修正文档限流为每 IP、每路径默认值。
- 核对构建产物：本地 Secret 仅出现在适配器为 preview 复制的 dist/server/.dev.vars，不进入客户端 bundle；HTTP /.dev.vars 返回 404。该本地文件与整个 dist 均被 Git 忽略，不应公开分发。
- 尚未配置真实邮件域名/投递，未发送真实邮件、未创建远端资源、未部署；Test/Production 默认认证关闭。GitHub Actions 尚未远端运行。D1 多步注册不具有交互式事务回滚，重置故障行为已测试并在 auth.md 说明。

## Phase 3 讨论验证（2026-10-26）

- `pnpm test`：**39 项通过**（7 个文件），包括原认证回归。新增 Markdown GFM/高亮/未知语言、脚本与危险协议、HTML/DOM clobber/Footer 伪造清理，预览认证，主题/回复作者所有权，乐观版本冲突，稳定楼层并发分配，重复回复幂等，软删除正文隐藏，计数/最后回复时间，计数故障时原插入回滚，楼层游标，点赞去重，收藏隔离和不可见父级的全部操作拒绝。
- `tests/migrations.test.ts` 从 Phase 2 Schema 和已有主题/作者记录开始应用 0002，验证数据、外键与新增默认值保留。没有重置数据库或修改旧迁移。本机执行前通过 Wrangler export 备份，再应用增量迁移成功。
- `pnpm test:e2e`：**8 项通过**，桌面与 iPhone 13 viewport 均通过完整 Markdown 预览 → 发布 → 点赞/收藏 → 编辑主题 → 回复/引用 → 编辑回复 → 软删除回复占位 → 取消互动 → 软删除主题流程；保留认证、基础论坛及 Footer 元信息/计时断言。
- 首次浏览器回归定位到预填 Markdown 的 textarea 隐式 label 文本匹配问题，增加明确 aria-label 后重跑完整流程通过。没有靠延长超时绕过失败。
- `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm build`、`pnpm peers check` 通过。构建产物在本机 workerd 实际运行，Markdown 管线没有 Node-only 兼容补丁。
- `pnpm check:licenses`：567 条许可记录通过，609 个已安装包版本的通知已更新；构建信息与基础 Secret 检查通过。
- 独立 Astra High 只读安全审查未发现阻塞项，核对了 SQL 所有权/父级可见性、删除正文不泄露、Markdown 链、原子楼层/计数和收藏 Session 隔离；按其指出的覆盖缺口补充了隐藏父级下主题 PATCH/DELETE 与互动 DELETE 的测试断言。
- 仍未部署或验证远端 D1；Test/Production 写入限制保留。没有实现管理员/版主、Turnstile、业务限流、@ 用户解析/通知和真实邮件投递，不能据此声称生产就绪。

## Phase 4 管理与安全验证（2026-10-26）

- `pnpm test`：**58 项通过**（9 个文件）。新增管理员/版主矩阵、旧 Session 降权生效、自身/同级封禁拒绝、最后管理员并发保护、封禁撤销 Session 与并发插入防线、业务 SQL 再检查封禁、隐藏恢复及回复计数、举报去重与处理、节点管理、Origin/输入边界。
- 故障注入验证管理变更与审核日志 D1 batch 原子回滚，封禁失败时 Session 撤销也回滚；首次管理员 bootstrap 授权与日志同一语句原子提交，重复初始化拒绝。迁移回归确认旧主题/作者、既有认证 Session 保留，旧账户回填 member，外键检查通过。
- 挑战测试覆盖本地 action/IP/过期/单次消费、API 缺失/伪造/重放拒绝；managed Siteverify 严格 action/hostname、失败/异常/非 JSON/非 2xx 关闭。限流覆盖并发 15 次只通过 3 次、过期窗口恢复、用户跨 IP 限额、主题/回复额度独立与 Retry-After。
- `pnpm test:e2e`：**12 项通过**，桌面和 iPhone 13 viewport 均覆盖管理员初始化、授予版主、举报处理、隐藏恢复、封禁/解封后重新登录、节点创建、审核日志和移动端宽度；保留前阶段讨论及认证回归。managed widget 用浏览器脚本替身验证过期清除、请求后 reset 和卸载 remove。
- E2E 改为每轮独立本机 D1，自动迁移与 seed，不使用日常开发数据库。首次回归发现 bootstrap CLI 依赖本地 Wrangler 未返回的 meta.changes，已改为单语句 RETURNING 与 0004 触发器，并补故障回滚测试；日志同名记录断言改为明确匹配首项。
- `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm build`、`pnpm peers check` 通过；`cf:types` 从配置重新生成。567 条许可记录、构建元信息和基础 Secret 检查通过。Gitleaks 对包含新增文件的交付源码副本扫描约 2.42 MB，无泄露。
- 独立 Astra High 只读审查未发现阻塞项，核对认证路径归一、封禁并发、SQL 权限与审计原子性、首次管理员和挑战生命周期；安装版本路由器的 9 种路径验证没有出现挑战绕过。
- 正常本机迁移前已导出备份，0003/0004 增量迁移成功；未修改已应用迁移。未在正常开发库指定管理员，需操作者为自己已验证的账户执行本地 bootstrap。
- 本轮没有真实 Turnstile 密钥或站点，没有验证真实挑战签发/重放、真实邮件或远端 D1；Test/Production 保持禁用，没有部署、推送或创建收费资源。不能据此声称生产就绪。
