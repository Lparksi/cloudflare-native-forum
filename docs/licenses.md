# 许可与素材

项目代码采用根目录完整 MIT License，允许商业使用与商业衍生版本。版权持有人已由项目所有者确认为 GitHub 用户 Lparksi，项目所有者指定的联系邮箱见 [LICENSE](../LICENSE)。名称、Logo 与商标权不由代码 MIT 许可授予。

网页使用系统字体栈，不分发字体文件，也不使用字体 CDN、第三方图片或外部图标；文字标志为项目原创排版。以后添加素材须独立登记来源与许可。

## 字体与 CI 截图

- CSS 中的 `PingFang SC`（苹方）和 `Microsoft YaHei`（微软雅黑）只是本机已安装字体的名称回退；本项目不复制、托管或重新分发这两种专有字体，也不授予其字体文件的使用或分发权。
- 截图 runner 通过 Ubuntu 官方软件源安装 `fonts-noto-cjk`，使用 `Noto Sans CJK SC`。Noble 包索引版本为 `1:20230817+repack1-3`；每次 CI 在日志中记录实际安装版本及 `/usr/share/doc/fonts-noto-cjk/copyright`，并以浏览器 CDP 核对实际渲染字体，而不是只检查 CSS 声明。
- Noto CJK 上游字体采用 **SIL Open Font License 1.1**，不是项目的 MIT 许可。字体仅安装在 CI 环境中用于生成 PNG，不进入仓库、Worker 或网页资源。保留 Ubuntu 包自带的版权与许可文件；如以后分发字体文件，必须另行随附对应版权声明和 OFL 全文，并重新核对修改、命名及分发条件。
- 已核对上述 Ubuntu 版本的 [copyright 文件](https://changelogs.ubuntu.com/changelogs/pool/main/f/fonts-noto-cjk/fonts-noto-cjk_20230817+repack1-3/copyright)：字体条目为 `2010-2012, Google Corporation`、`SIL-1.1`；`debian/*` 打包文件另列维护者版权及 `GPL-3+`。不能把整个系统包一概标为 MIT 或 OFL。本项目不分发这个系统包或其打包文件。
- OFL 允许使用字体生成图形；截图本身不会因此改为 OFL 许可。本记录是针对当前来源与使用方式的许可核查，不是对所有未来素材或商标风险的保证。

依据：[Noto CJK 上游](https://github.com/notofonts/noto-cjk)、[Noto Sans CJK LICENSE](https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE)、[Ubuntu Noble 包](https://packages.ubuntu.com/noble/fonts-noto-cjk)、[OFL 官方 FAQ 1.1–1.1.2](https://openfontlicense.org/ofl-faq/)。

## 代码与依赖

`pnpm check:licenses` 检查已安装直接和传递依赖的 SPDX 许可，以及项目 MIT 声明。新许可默认使检查失败。`THIRD_PARTY_NOTICES.txt` 保留实际安装包、版本绑定的补充来源及 vendor 的许可证和 NOTICE 正文；通过 `pnpm notices:write` 重新生成，`pnpm check:notices` 校验正文与平台条目索引。平台可选包会随系统不同而变化，分发其他平台原生二进制前须基于实际安装重新核对通知和源代码义务。

绝大多数依赖为 MIT、Apache-2.0、BSD、ISC 等宽松许可。例外仅限明确列出的构建工具：

- `@img/sharp-libvips-*`：LGPL-3.0-or-later，Astro/Sharp 的本机图片编译依赖。本工程将 imageService 设为 compile，无图片处理端点，也不将 libvips 原生二进制部署到 Workers。若另行分发该二进制，需遵循上游 LGPL 及其所含库的许可、通知、对应源码和可重链接要求。上游：[libvips](https://github.com/libvips/libvips)、[sharp-libvips](https://github.com/lovell/sharp-libvips)。
- `lightningcss`、`lightningcss-*`：MPL-2.0，CSS 构建工具；其原生二进制不进入 Worker。修改并分发其 MPL 文件时，应遵守文件级源代码提供义务。上游：[Lightning CSS](https://github.com/parcel-bundler/lightningcss)。

这些工具未被重新标记为 MIT。未经重新审查，不可把该例外扩大到业务运行时依赖。发布 Worker 时须同时保留随附的第三方通知；公开源码仓库应包含本文件与 THIRD_PARTY_NOTICES.txt。

Worker 运行时还随附 Playwright v1.64.1 发布的 libwebp WASM，保留 Apache-2.0 / libwebp BSD / Emscripten 通知；实际编译器版本和链接组件溯源仍待核实，见 [核实记录与残留项](license/source-review.md)。文件与二进制来源见 [vendor 记录](../src/vendor/webp/README.md)。该制品不依赖新增 npm 解码包，`check:licenses` 单独验证其固定哈希与许可保留。测试目录中的纯色 WebP 是本项目生成的 fixtures。

## 扫描与发布清单

新增的 [轻量许可审查流程](license/README.md) 说明固定版本 ScanCode、SPDX 2.3 SBOM、源码/浏览器/Worker/构建工具覆盖、报告排除范围和人工审查基线。扫描不是法律保证，未核实发现只报告；扫描执行失败、覆盖缺失和 NOTICE 漂移会使 CI 失败。依赖许可允许清单继续作为硬门禁，不使用 dependency-review 替代。

补充许可材料由 `docs/license/sources.json` 绑定精确版本、锁文件 integrity、官方来源和正文 SHA-256，自动加入通知生成和校验；23 个版本已收集正文，9 个仍缺完整材料。`pnpm license:sources --fetch` 可重新下载官方来源核对；这不代表批准发布或完成所有原生组件义务，具体限制见 [来源机制](license/README.md#版本绑定的补充许可来源)。
