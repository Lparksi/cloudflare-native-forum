# Cloudflare Native Forum：交接给 ChatGPT dots

交接日期：2026-10-26。仓库：[Lparksi/cloudflare-native-forum](https://github.com/Lparksi/cloudflare-native-forum)。请先核对当前代码及根目录 AGENTS.md，再继续工作。

## 当前状态

- Phase 1–6 已完成本地实现。Phase 6 业务提交：`abe93d601b0e2a230afda29ce8714958f06e8a06`；后续交接文档提交不改变业务实现。
- 单 Worker：Astro SSR + React Islands + Hono + TypeScript strict；Better Auth + Drizzle D1，R2 原生绑定。没有 VPS、Redis 或外部数据库。
- 账户：注册、登录、Session、邮箱验证、重置密码及旧 Session 撤销。
- 讨论：安全 Markdown、预览、线性回复/引用、作者编辑/软删除、revision 冲突、点赞/收藏。
- 管理：管理员/版主、封禁、节点及内容审核、举报、原子审核日志、Turnstile 适配、发帖/回复限流。
- 资料/图片：公开主页、显示名称/简介/头像；前端 Canvas 压缩转 WebP，服务端实际解码/尺寸/大小/元数据校验，R2 存储与本人图片管理。
- 社区：普通文本 @ 用户、安全链接、提及/回复通知、私有已读/未读、中文/英文基础搜索、最新/热门/活跃排序与游标分页。

## 已验证

本机最终通过 **80 项单元/D1/R2 集成测试、18 项 Chromium 桌面/iPhone viewport E2E**。类型、Lint、格式、build、许可证、构建元信息、基础 Secret 和完整 Git 历史 Gitleaks 检查通过。详见 [验证记录](validation.md)。不能把本机通过当成远端 CI、原生 Safari 或生产验收成功。

正常本地数据库迁移到 0007，旧 20 条主题及手工触发器保留，当前 11 个触发器。E2E 每轮使用独立状态目录，不能重置或拿日常数据库跑测试。迁移前 SQL 备份在本机临时目录，不能从 GitHub 获得，也不要上传；已验证独立 SQLite 恢复，目标 D1 恢复仍待演练。

## 必须保持的边界

- **暂不部署生产。** 没有创建真实 Cloudflare D1/R2、发信域名或 Turnstile widget；不创建收费资源、不改 DNS、不合并 PR、不扩大权限。
- 业务写入仍只允许 APP_ENV=local、loopback、精确 Origin、已验证且未封禁 Session。Test/Production 写入关闭，认证/真实邮件/Turnstile 默认 disabled。
- `.dev.vars`、dist/server/.dev.vars、`.wrangler`、用户数据和备份不在仓库；新环境用 `pnpm auth:setup` 生成自己的本地 Secret，绝不能索取或复制本机 Secret。
- 已应用迁移不能修改。D1 不支持交互式事务，原子多步用 batch。0002/0003/0004/0007 的手工触发器不能因重建表丢失。
- 通知只能由当前 Session 收件人读取/标记；列表、计数和已读都重新过滤隐藏来源。内容与通知同一 batch，去重不能只依赖前端。
- 图片是独立公开 URL，帖子隐藏不会自动撤销；R2/D1 无跨服务事务，清理失败的 pending/deleted 记录需要人工处理。
- 搜索是 LIKE 子串，排序是实时游标，未做大型数据量成本/性能验收。通知在刷新页面时更新，不包含邮件/推送。
- MIT 是用户指定的开源许可，允许商业使用；不得擅自改许可。版权持有人已由项目所有者确认为 GitHub 用户 Lparksi，GitHub noreply 邮箱见根目录 LICENSE。保留 vendor WebP WASM 及全部第三方许可。

## 从新环境启动

```sh
git clone https://github.com/Lparksi/cloudflare-native-forum.git
cd cloudflare-native-forum
pnpm install --frozen-lockfile
pnpm auth:setup
pnpm cf:types
pnpm db:migrate
pnpm db:seed
pnpm dev --ignore-lock
```

默认地址 http://127.0.0.1:4321；新账户在开发收件箱 `/dev/mail` 验证邮箱。首次管理员需先注册验证，然后 `pnpm admin:bootstrap verified-email@example.com`，只操作本机库。运行 E2E 前停止占用 4321 的服务，先 build，再 `pnpm test:e2e`；它自行启动隔离预览。

## 优先阅读与后续工作

先读 [README](../README.md)、[架构](architecture.md)、[环境与部署](operations.md)，按任务再读 [认证](auth.md)、[讨论](discussions.md)、[管理](moderation.md)、[资料/图片](profiles-uploads.md)、[社区功能](community.md)。不要为了接手无目的地全仓重读。

尚未完成：真实邮件/Turnstile/D1/R2 的目标环境验收与备份恢复、媒体审核运营/故障回收、SEO/RSS/Sitemap、更大规模搜索与缓存等。下一阶段具体范围由用户指定；本次交接本身不授权自动实现这些功能或部署。接手后先确认已读代码与当前边界，并向用户给出简短状态，不重复创建已经存在的资源。
