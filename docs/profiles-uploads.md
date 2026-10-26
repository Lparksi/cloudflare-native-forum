# Phase 5：用户资料与 R2 图片

本阶段只操作本机 D1/R2；未创建云端 Bucket、未部署。Test/Production 写入仍关闭。

## 用户主页与资料

- `/member/:username` 展示显示名称、简介、头像、加入日期和该作者公开主题，复用 20 条游标分页；隐藏节点、隐藏/删除主题不进入列表。主题与回复作者名称链接到主页。
- `/settings` 编辑自己的显示名称（1–80 字）、简介（最多 500 字）和头像。简介作为纯文本转义，不能注入 HTML。用户名沿用 `u_<认证ID>`，是固定链接标识，本阶段不支持改名；显示名称可以修改。
- 公开查询不返回邮箱、认证 userId、Session 或收藏。账户注册名称仍留在 Better Auth，论坛公开显示统一使用 profiles.displayName；不启用 Better Auth 的默认 update-user 入口。
- PATCH `/api/v1/me/profile` 仅按当前 Session 修改，要求 revision；过期版本或非法头像返回 409。头像必须是本人上传、kind=avatar、state=ready，条件在同一 SQL 检查。传入 userId、对象 key、任意头像 URL 均不接受。

## 前端压缩与服务端校验

选择 PNG/JPEG/WebP，原文件最大 10 MiB、2400 万像素。浏览器原生解码处理 EXIF 方向，再通过 Canvas 转 WebP，质量 0.82：头像居中裁剪到 256×256；正文最长边 1600，等比缩小且不放大小图。压缩后显示尺寸、WebP 类型和大小，点击上传后才发送。Canvas 导出不保留原文件名和 EXIF 等元数据；动图输入经浏览器解码后成为静态图片。

浏览器若不能解码或不能编码 WebP，明确提示失败，不能把 PNG 当成 WebP 上传。当前实际浏览器验收为 Chromium 桌面和 iPhone 13 viewport，未验证原生 Safari/iOS；不支持 WebP 编码的浏览器需更换浏览器。本阶段没有增加 WASM 客户端编码回退。

上传 API 接收原始二进制，不接收 Base64 或 multipart：

| 请求                          | 用途                     |
| ----------------------------- | ------------------------ |
| POST `/api/v1/uploads/avatar` | 头像                     |
| POST `/api/v1/uploads/image`  | 正文图片                 |
| GET `/api/v1/media/:id`       | 独立公开图片 URL         |
| GET `/api/v1/me/uploads`      | 本人最近 50 张已完成图片 |
| DELETE `/api/v1/uploads/:id`  | 本人删除图片，可重试     |

POST 必须为 `Content-Type: image/webp`，服务端按流读取并计数，最大 **2 MiB**，不信任 Content-Length。先检查 RIFF 长度、chunk 边界、静态 VP8/VP8L、帧尺寸和 VP8X canvas 一致性，最长边 1600；头像须为 256×256。拒绝动画、多帧、未知 chunk、超尺寸、尾随数据、伪造类型和截断文件。移除 ICC/EXIF/XMP，再使用真实 libwebp 解码验证压缩像素数据，不仅检查文件头。

解码采用 Microsoft Playwright v1.64.1 的固定 WASM 制品，内含上游固定的现代 libwebp commit；保留二进制哈希、来源和许可，见 [vendor 记录](../src/vendor/webp/README.md)。Worker 使用编译后模块，不在请求时下载或编译 WASM；C 分配在 finally 释放。只验证解码，不在服务端再次有损编码。旧候选包内置 libwebp 1.1.0，已经移除。

Markdown 编辑器上传后插入同源图片 URL；预览与 SSR 仍经过统一安全渲染管线。直接读取 R2 使用流式响应，固定 image/webp、nosniff、sandbox CSP 和无客户端文件名的 Content-Disposition；对象 key 由服务端生成 UUID。当前无页面或媒体公共缓存。

## 权限、额度与公开性

写请求沿用 APP_ENV=local、loopback、精确 Origin、已验证邮箱且未封禁 Session。上传每用户每分钟 10 次、每 IP 30 次尝试，限流在读取/解码正文前执行。每账户逻辑存储额度 20 MiB，D1 INSERT 条件原子检查，pending 也占额度；删除图片可释放额度。头像/资料编辑和删除文件都在 SQL 再检查本人身份及封禁状态。

**上传成功的图片链接是独立公开资源。** 界面在上传前提示；它不随帖子隐藏、删除或账户封禁自动撤销，知道链接的人仍可读取。不要上传私密资料。所有者可以在设置中删除图片使链接失效，这也会破坏既有正文引用。此阶段没有媒体举报与管理员下架流程；未来公开运营前需要补充。

## D1 / R2 一致性与故障恢复

D1 与 R2 没有跨服务事务。流程为：D1 原子预留 pending 记录和额度 → R2 put → D1 检查账户仍可写并标记 ready。只有 ready 可读和用作头像；存储或最终标记失败时先删除对象，再删除 pending。清理也失败时保留 pending，避免未追踪对象及公开泄露，不伪称已回滚。

正常删除先在 D1 标记 deleted，并在同一个 batch 清空仍引用它的本人头像、推进资料 revision，再删除 R2。即使 R2 删除失败，URL 已失效；同一所有者再次 DELETE 可以重试清理。删除记录保留对象 key 供排查，不复用对象标识。

进程中断、清理失败可能留下 pending 或 deleted 对象。当前没有自动后台回收；pending 继续占额度且不在用户已完成列表中。操作者需按数据库记录核对 R2，确认对象状态后重试清理，不能只删 D1 行而遗失对象 key。尚未验证远端故障恢复或设置 R2 生命周期，不应据本地测试声称生产就绪。

## 配置与数据

`UPLOADS` 为原生 R2Bucket 绑定，根配置 `forum-local-uploads`、remote=false，仅模拟器持久化在 `.wrangler/state`；Test/Production 配置使用独立未创建的 Bucket 名，也未启用 remote。远端资源必须经所有者授权后显式创建与配置，禁止把本地模拟当线上存储。

0005 增加 uploads 表和 profiles.avatar_id/revision；0006 增加按作者、状态和时间查询的索引。未重建旧表，不改变旧计数、封禁或管理员触发器。迁移前 SQL 备份已恢复到独立 SQLite 并通过外键检查。原始 Wrangler 导出直接导入空 D1 的尝试因表顺序报错，不能据此宣称已完成 D1 恢复演练；远端启用前须验证目标 D1 的恢复步骤。

单元/API 测试使用独立 Miniflare D1/R2 和真实解码 WASM，E2E 使用每轮隔离的本机状态目录，同时覆盖正常上传和权限/失败路径。没有访问真实云端 R2。
