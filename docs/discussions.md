# Phase 3：讨论、Markdown 与互动

## 已实现的范围

- 主题和回复共用 Markdown 编辑器，显式服务端预览；GFM 表格、删除线、引用与 fenced code 高亮。
- 线性回复，每页 30 条、按稳定楼层递增的游标分页；引用按钮插入 Markdown 引文与楼层链接，不建立嵌套评论树。
- 主题作者可编辑标题/正文、软删除整个主题；回复作者可编辑/软删除自己的回复。主题删除后整个讨论不可读，回复记录保留。
- 主题点赞/取消点赞、收藏/取消收藏；单用户单主题唯一约束，重复 PUT/DELETE 不重复计数。当前允许给自己的主题点赞。
- `/bookmarks` 为登录用户的私有收藏列表，20 条游标分页，隐藏/删除主题和隐藏节点被过滤。
- 主题列表显示回复数/点赞数，详情显示有效回复数及最后有效回复时间。

当前依然只允许 Local loopback + 精确同源 JSON + 已验证邮箱 Session 写入。Test/Production 业务写入仍关闭，未部署。

## 安全与权限

`src/lib/markdown.ts` 使用统一的服务端 ESM 管线：

```
remark-parse → remark-gfm → remark-rehype → rehype-sanitize
→ rehype-highlight → rehype-stringify
```

不启用原始 HTML；使用 sanitizer 默认 tag/attribute/protocol/clobber 规则，再由可信的 highlighter 生成代码 token spans。未知语言作为普通转义代码处理，不做自动语言检测。UI 的 set:html/dangerouslySetInnerHTML 只能消费此管线输出；数据库保存 Markdown 源文。预览与 SSR 使用同一个函数，浏览器测试比较两者 HTML 一致。

Markdown 图片只按 sanitizer 允许的协议输出；外部图片由浏览器直接加载，没有上传、代理或 R2 存储。全局 no-referrer。未实现自动 @ 用户解析或通知；引用中的 @username 是文本。引用内容是用户可编辑的文本快照，原回复删除不会追溯删除其他用户已引用的文字。

所有写方法共用环境、Origin、JSON Content-Type、体积和 Session 校验。客户端不能提交 authorId、权限或状态。SQL 更新条件同时包含作者、可见状态/父主题/节点与 revision，服务端权限不依赖 UI 按钮隐藏。不可见内容返回 404，修改他人公开内容返回 403，过期 revision 返回 409。私有收藏只从当前 Session 取身份，不接受其他用户 ID。

软删除回复保留楼层、作者与时间占位，但公开列表和 SSR 不再返回正文，API body 为 null；数据库仍保留原文。隐藏主题后，其全部回复/互动读写入口以及收藏列表都不可见。没有管理员恢复或删除恢复 UI；管理员/版主权限、审核、封禁、Turnstile 和业务限流属于后续阶段。

## D1 一致性和迁移

`0002_sour_komodo.sql` 是本阶段的新增迁移。Drizzle 初始生成的重建 topics 语句在应用前已改为增量 ALTER ADD COLUMN，保留旧主题、外键与索引；迁移回归测试从 Phase 2 数据开始验证保留结果。实际本机应用前已导出备份到 `/private/tmp/forum-before-phase3-20261026.sql`（包含本地内容，不提交 Git）。

新增 replies、topic_votes、bookmarks；topics 新增 revision、reply_count、next_reply_floor、last_replied_at、vote_count。

回复创建是单条 INSERT…SELECT：在同一语句读取 next_reply_floor+1，并检查父主题与节点可见。SQLite AFTER INSERT 触发器同步推进楼层、回复数和最后回复时间。重复 requestId 受 (author_id, request_id) 唯一约束保护，不触发重复计数；同一 key 对应不同内容/主题返回 409。软删除不复用楼层；状态变更触发器更新有效回复数和最后有效回复时间。

点赞由复合主键去重，插入/删除触发器同步 vote_count。上述触发器和用户写操作属于同一 SQLite 语句；若计数更新失败，原始插入也回滚，测试已用故障触发器验证。没有依赖不受支持的交互式事务，也没有分离的异步计数修复。

触发器是手工维护的迁移内容，不会由 Drizzle Schema 自动生成。后续涉及 topics/replies 重建的迁移必须审查并重建相关触发器，且保留已有计数；不得盲目应用 DROP/重建 SQL。Schema snapshot 仍用于后续增量比较。

编辑与删除必须提供正整数 revision；成功增加版本号。两个标签页基于同一版本同时编辑时仅一个成功，另一个收到 409，编辑器保留其输入供复制/重新编辑。不会静默覆盖新内容。

## API

基础前缀 `/api/v1`，写请求需 application/json 和精确 Origin。

| 方法         | 路径                        | 内容                                 |
| ------------ | --------------------------- | ------------------------------------ |
| POST         | /markdown/preview           | `{ body }`，返回安全 HTML            |
| PATCH        | /topics/:id                 | `{ title, body, revision }`          |
| DELETE       | /topics/:id                 | `{ revision }`                       |
| GET          | /topics/:id/replies?after=0 | 30 条，nextCursor 为最后楼层         |
| POST         | /topics/:id/replies         | `{ body, requestId }`                |
| PATCH        | /replies/:id                | `{ body, revision }`                 |
| DELETE       | /replies/:id                | `{ revision }`                       |
| GET          | /topics/:id/interactions    | 计数与当前用户状态；游客状态为 false |
| PUT / DELETE | /topics/:id/vote            | 点赞 / 取消，幂等                    |
| PUT / DELETE | /topics/:id/bookmark        | 收藏 / 取消，幂等                    |
| GET          | /bookmarks?cursor=          | 当前用户私有收藏                     |

正文 1–20000 字符，主题标题 3–120 字符，拒绝 NUL。请求体上限 100000 bytes。回复和主题列表均有页大小限制；SSR 不加载全部回复，也没有逐楼查询作者的 N+1。

## 验证与边界

测试覆盖 XSS/危险协议/伪造 Footer、预览与 SSR、陌生用户写拒绝、跨作者越权、旧版本冲突、重复与并发回复、楼层游标、删除占位、计数及故障回滚、点赞去重、收藏隔离、隐藏父级传播，以及已有数据的迁移保留。实际浏览器覆盖桌面和移动端完整流程。

尚未做远端 D1、Cloudflare Test 或 Production 验证；真实邮件投递仍未配置。当前没有新增管理员/版主权限，没有公开写入授权。

参考安全顺序：[rehype-sanitize](https://github.com/rehypejs/rehype-sanitize)、[rehype-highlight](https://github.com/rehypejs/rehype-highlight#example-sanitization)、[remark-rehype](https://github.com/remarkjs/remark-rehype#security)。
