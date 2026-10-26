# 补充来源核实与残留项

本轮收集 23/32 个精确版本的正文，不据此批准发布；没有修改业务代码、上传校验或第三方许可。

| 精确版本                             | 尚缺证据                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@humanfs/types@0.15.0`              | Package declares Apache-2.0; no LICENSE in packages/types or root at gitHead. Sibling-package LICENSE not assigned without evidence.                                                       |
| `@img/sharp-libvips-linux-x64@1.3.1` | Binary declares LGPL-3.0-or-later; sharp-libvips root Apache license covers build tooling, not libvips and linked libraries. Exact component notices/source obligations remain to collect. |
| `@img/sharp-libvips-linux-x64@1.3.4` | Binary declares LGPL-3.0-or-later; sharp-libvips root Apache license covers build tooling, not libvips and linked libraries. Exact component notices/source obligations remain to collect. |
| `am-i-vibing@0.5.0`                  | Exact-version metadata is not a substitute for license text.                                                                                                                               |
| `boolbase@1.0.0`                     | Exact-version metadata is not a substitute for license text.                                                                                                                               |
| `drizzle-kit@0.31.11`                | Package declares MIT; repository root LICENSE at the publication commit is Apache-2.0. Do not assign root license to this package without resolving the conflict.                          |
| `natural-compare@1.4.0`              | Exact-version metadata is not a substitute for license text.                                                                                                                               |
| `piccolore@0.1.3`                    | Published source commit and package declare ISC but contain no full license. README identifies a picocolors fork; upstream authorship and fork grant remain unresolved.                    |
| `process-ancestry@0.1.0`             | Official exact-version tag has no LICENSE; README only declares MIT and author Matt Kane, without grant/disclaimer.                                                                        |

上述缺口不能用通用 MIT/ISC 模板填入，也不能用其他版本或相邻包的许可替代。drizzle-orm 0.45.4 的 Apache-2.0 正文已从 npm 发布证明关联的 `eab8bedbb65d5429c54e612ddbd88aa23091d398` 根 LICENSE 收集；仓库树未发现独立 NOTICE，不制造版权占位内容。原正文中的 Apache 附录占位文字按原样保留。

WebP 另见 `webp-evidence.json`：重新从 Playwright v1.64.1 获取 WASM 与完整通知，逐字/哈希匹配仓库；libwebp 指定 commit 的 COPYING/PATENTS 与 Emscripten 6.0.2 LICENSE 均是保留通知中的原文。实际编译器版本和链接组件闭包仍缺构建证明，未声称问题已闭合。WASM 无自定义 producer 节。上游脚本链接 libwebp、sharpyuv，采用 emmalloc；仅据脚本无法证明发布制品的全部链接来源。第 170 行 unknown 对应 Emscripten 的第三方目录许可说明，保留原文；不将其自动批准。

这些 npm 证据与 WebP 核实只涉及公开官方来源、新容器和独立仓库副本。没有读取旧机器、数据库、秘密或编辑器待验收分支。原 CI artifact 的 403 未绕过；本轮 CI/本地结果单独记录，不沿用之前扫描计数。
