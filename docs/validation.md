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
