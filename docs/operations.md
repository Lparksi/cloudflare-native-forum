# 环境、数据与部署

## 已存在的配置

| 环境       | Worker 名称                        | D1                         | APP_ENV    | 写入                                  |
| ---------- | ---------------------------------- | -------------------------- | ---------- | ------------------------------------- |
| Local      | cloudflare-native-forum-local      | 本机 .wrangler/state/v3/d1 | local      | loopback + 同源 JSON + 已验证 Session |
| Test       | cloudflare-native-forum-test       | 独立占位 ID，未创建        | test       | 403                                   |
| Production | cloudflare-native-forum-production | 独立占位 ID，未创建        | production | 403                                   |

`workers_dev=false`、`preview_urls=false`，未绑定域名；占位 ID 不应被当成真实资源。请勿把根 Local 配置部署到 Cloudflare。不同环境绝不共用 D1、R2、Secrets。当前无 R2/KV 或远端资源访问；Turnstile 仅本地模拟与 Siteverify 适配，未创建真实站点。认证需要本地随机 Secret 和开发收件箱；AUTH_EMAIL 绑定已声明但尚未配置真实投递，Test/Production 的 AUTH_MAIL_MODE 默认 disabled。详见 [认证配置](auth.md)。

## 数据库迁移

```sh
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

前两项分别生成迁移和应用到本机；seed 明确仅供本地。Schema 修改后创建增量迁移，审查 SQL，不修改已应用迁移。SQL CHECK / 外键和唯一约束属于数据完整性契约，不用应用层检查替代。0002包含手工维护的计数触发器，0003/0004包含账户状态、最后管理员和初始化授权触发器；今后修改或重建关联表时必须审查并保留，不能盲用Drizzle重建SQL。详见 [讨论设计](discussions.md)。

## 以后部署 Test 的流程（本轮未执行）

1. 经项目所有者确认账号、资源和成本，手工创建独立的 Test D1；将真实 ID 写入 env.test。不要用本机 UUID 自动创建。
2. 在未部署/无数据环境验证迁移。已有数据先备份，再查看 pending migrations。
3. 使用 CLOUDFLARE_ENV=test 构建，确保构建产物配置的名称、APP_ENV、DB ID 均指向 Test；核对 `dist/server/wrangler.json`（以适配器实际输出为准）。
4. 显式使用 `--env test` 应用远端迁移。禁止对远端执行 db/seed.sql。权限与业务限流已实现，但真实 Turnstile、邮件和部署隔离验收前公共写入维持关闭。
5. 检查类型、测试、许可、Secret、构建元信息和 dry-run 产物。仅在授权环境发布，之后验证读取、404、Footer SHA、计时和数据库隔离。

真实远端命令必须在资源 ID 确认后按当前 Wrangler 文档执行；此文档不含可误执行的默认部署脚本。

## Production

本轮没有 Production 授权，**不得部署**。本地正式认证流程已实现；未来上线仍至少要求真实邮箱投递、角色与所有权校验、Turnstile、限流、审核、Cookie/CSRF 安全、备份恢复演练、测试与生产资源隔离通过验收。不要将本机作者 ID 或本机模式作为公开账户体系。

生产流水线不得自动重置数据库；迁移和发布应经过显式审批，不自动合并 PR，不改变仓库公开性。

## 备份与恢复方案（尚未做远端演练）

- 本机可通过 `pnpm exec wrangler d1 export DB --local --output /private/tmp/forum-local-backup.sql` 导出 SQL；迁移前保存副本。备份包含内容，不提交 Git。
- 未来远端迁移前，对目标环境显式执行 D1 export，保存到受访问控制的存储。记录导出时间、数据库 ID、迁移版本与当前 Worker SHA；不要记录密钥。
- 验证备份可在**新建的隔离恢复数据库**导入，检查 schema、行数、约束与代表性主题读取，再制定切换方案。不要删除原库或用重建代替正式数据迁移。
- 可评估 D1 Time Travel 的当时可用恢复窗口与权限，不能用未验证的恢复承诺替代 SQL 备份演练。
- 后续 R2 上传落地后单独制定对象备份、生命周期与数据库附件引用的一致性策略。

## CI 和本机验证的区别

GitHub Actions 只做安装、类型、Lint、格式、测试、许可证、构建元信息、基础 Secret 和 Gitleaks 扫描、构建及本机 E2E。尚未推送远端，因此不能将本机命令通过等同于 GitHub Actions 成功。Action 依赖的固定主版本后续可更新为经核验的 commit pin。

## 本地管理员

先注册并验证邮箱，再执行 `pnpm admin:bootstrap <邮箱>`。命令只操作本机 D1；已有活跃管理员时拒绝再次初始化。常规角色调整从 `/admin` 完成，详见 [管理配置](moderation.md)。不得将 E2E 的隔离数据库或本机模拟挑战模式用于公开环境。
