# 补充来源核实与残留项

本轮收集 25/32 个精确版本的正文，不据此批准发布；没有修改业务代码、上传校验或第三方许可。

| 精确版本                             | 尚缺证据                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@humanfs/types@0.15.0`              | Package declares Apache-2.0; no LICENSE in packages/types or root at gitHead. Sibling-package LICENSE not assigned without evidence.                                                       |
| `@img/sharp-libvips-linux-x64@1.3.1` | Binary declares LGPL-3.0-or-later; sharp-libvips root Apache license covers build tooling, not libvips and linked libraries. Exact component notices/source obligations remain to collect. |
| `@img/sharp-libvips-linux-x64@1.3.4` | Binary declares LGPL-3.0-or-later; sharp-libvips root Apache license covers build tooling, not libvips and linked libraries. Exact component notices/source obligations remain to collect. |
| `am-i-vibing@0.5.0`                  | Exact-version metadata is not a substitute for license text.                                                                                                                               |
| `drizzle-kit@0.31.11`                | Package declares MIT; repository root LICENSE at the publication commit is Apache-2.0. Do not assign root license to this package without resolving the conflict.                          |
| `piccolore@0.1.3`                    | Published source commit and package declare ISC but contain no full license. README identifies a picocolors fork; upstream authorship and fork grant remain unresolved.                    |
| `process-ancestry@0.1.0`             | Official exact-version tag has no LICENSE; README only declares MIT and author Matt Kane, without grant/disclaimer.                                                                        |

上述缺口不能用通用 MIT/ISC 模板填入，也不能用其他版本或相邻包的许可替代。drizzle-orm 0.45.4 的 Apache-2.0 正文已从 npm 发布证明关联的 `eab8bedbb65d5429c54e612ddbd88aa23091d398` 根 LICENSE 收集；仓库树未发现独立 NOTICE，不制造版权占位内容。原正文中的 Apache 附录占位文字按原样保留。

WebP 另见 `webp-evidence.json`：重新从 Playwright v1.64.1 获取 WASM 与完整通知，逐字/哈希匹配仓库；libwebp 指定 commit 的 COPYING/PATENTS 与 Emscripten 6.0.2 LICENSE 均是保留通知中的原文。实际编译器版本和链接组件闭包仍缺构建证明，未声称问题已闭合。WASM 无自定义 producer 节。上游脚本链接 libwebp、sharpyuv，采用 emmalloc；仅据脚本无法证明发布制品的全部链接来源。第 170 行 unknown 对应 Emscripten 的第三方目录许可说明，保留原文；不将其自动批准。

这些 npm 证据与 WebP 核实只涉及公开官方来源、新容器和独立仓库副本。没有读取旧机器、数据库、秘密或编辑器待验收分支。原 CI artifact 的 403 未绕过；本轮 CI/本地结果单独记录，不沿用之前扫描计数。

## 后续核实与决定边界

已补充的 boolbase 1.0.0：作者于 `be0bcd8a4e917a0a5895e95b523fbbed05a64871` 加入完整 ISC 正文；该提交仍标识 1.0.0，`index.js`（全部运行代码）和 README 与锁定 npm 包逐字一致。package.json 的 test script 不同，故记录为等价源码证据，不声称它是原发布 commit。在线重核会检查源码文件、版本声明和正文哈希。

已补充的 natural-compare 1.4.0：原包 README 保留 `2012-2015 Lauri Rooden` 版权并明确链接作者的 MIT 全文。保存原 README 和从作者站 HTTPS 取回的原文，不修改两处版权，也不冒称作者网页是历史不可变文件；获取日期为 2026-10-26，哈希变化会使重核失败。

| 残留版本/制品                         | 已检查的官方路线                                                                                                                                                      | 可继续路径与是否需要决定                                                                                                                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @humanfs/types 0.15.0                 | npm 原包、gitHead 源码、root 与 packages/types 的许可文件历史；只有 Apache 声明，完整许可出现在相邻包                                                                 | 需要上游明确适用于该包的正文/版权材料，或所有者选择带完整材料的工具版本。相邻包不能直接移植。当前未观察到进入运行时产物。                                                                                                                                                 |
| am-i-vibing 0.5.0                     | 发布证明关联源码、原包 README、完整仓库许可文件历史                                                                                                                   | README 仅列 MIT 与 Matt Kane 版权，没有完整授予/免责声明；需要上游补充或替换开发工具链中的该包。不替换 Astro 架构。                                                                                                                                                       |
| process-ancestry 0.1.0                | 确切官方 tag、原包和完整许可文件历史                                                                                                                                  | 只有 MIT/作者声明；需要上游补充，或与依赖它的开发工具一起选择有完整材料的版本。                                                                                                                                                                                           |
| drizzle-kit 0.31.11                   | 发布证明 commit、包与源码 manifest、root LICENSE、包 README                                                                                                           | MIT 声明与仓库 Apache 正文冲突，不能自行决定。需要上游澄清包的实际许可，或选择声明与正文一致的工具版本。                                                                                                                                                                  |
| piccolore 0.1.3                       | 发布证明 commit、原包、README 指向的 picocolors、仓库完整许可文件历史                                                                                                 | 仍在 Worker，是运行时残留。需上游补全 fork/原作者通知；另一条路线是评估许可明确的 picocolors 兼容适配，但必须验证 ESM、Workers 的 process 环境与全部颜色 API。未实施替换。                                                                                                |
| sharp-libvips linux-x64 1.3.1 / 1.3.4 | 原包版本清单、固定 build 源码；额外下载官方 v1.3.4 npm-workspace.tar.xz 并验证 GitHub 资产 SHA-256 `a40fc59e3aa3635177613fa63f29ceecb28b5ad99e7919def47a61f6ca06f0ee` | 发行归档中的 dev/THIRD-PARTY-NOTICES 仍是库/许可表，不含完整正文。可按 versions.json 与固定构建配方整理实际组件的许可、版权及对应源码；不应仅收集 LGPL 通用正文便称完成。这是工具二进制再分发材料，不在当前 Worker/浏览器产物中；若不再分发工具二进制，可先保留明确限制。 |
| WebP WASM                             | 官方 v1.64.1 字节、原通知、固定 libwebp 源码、上游引入制品 commit `f3114b3e9f1aea9f0c123551ebf67ded08dddca2` 与 PR 41152、关联 workflow 列表                          | 上游 PR 未补足编译器版本/链接清单，且制品无 producer 节。需要与制品匹配的构建日志/证明，或另行评估固定 Emscripten、libwebp 和链接映射的可审计重建。重建将改变运行时二进制，需单独评估兼容性、真实解码安全与性能；本轮未执行。                                             |

本轮已完成可独立审查的材料保存、版本绑定、生成/校验机制及测试修复。继续收集构建工具组件材料不要求改变生产架构；但无需无限搜索没有许可正文的仓库。未获准联系维护者，因此上述需要上游确认的路线停在证据缺口，不发送 issue、邮件或其他消息。所有者可以独立审查本补丁；这不等于当前运行时许可已全部闭合，也不是合并/部署授权。

## 限流测试时间边界

首轮 push CI `40330829461` 在 uploads.test.ts 的预期 429、实际 201 处失败。`consumeLimit` 使用整分钟固定窗口，测试依赖墙钟，因此跨分钟允许恢复请求。通过受控时钟把前 10 次请求固定在边界前 1ms、最后一次放到边界，确定性重现相同失败；原测试文件随后恢复，再做最小修复。

修复仅固定该测试的 Date.now：同窗口第 11 次断言 429 与 Retry-After，然后推进到下一分钟断言 201，并在 finally 恢复时钟。未修改生产限流函数、阈值或图片解码。原 HEAD `4117a2b423789f980ac4a8a7669dc7dfbee2d656` 的 PR CI 与一次 push 失败 job 重跑最终均成功，但这不能代替对时序问题的修复。
