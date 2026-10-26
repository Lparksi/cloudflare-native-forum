# 许可与素材

项目代码采用根目录完整 MIT License，允许商业使用与商业衍生版本。项目所有者须填写 LICENSE 中明确标记的版权持有人；未推断其身份。名称、Logo 与商标权不由代码 MIT 许可授予。

本版本使用系统字体栈，无下载字体、第三方图片或外部图标；文字标志为项目原创排版。以后添加素材须独立登记来源与许可。

`pnpm check:licenses` 检查已安装直接和传递依赖的 SPDX 许可，以及项目 MIT 声明。新许可默认使检查失败。`THIRD_PARTY_NOTICES.txt` 保留本次安装包中的许可证和 NOTICE 全文；通过 `node scripts/third-party-notices.mjs` 重新生成。平台可选包会随系统不同而变化，分发其他平台原生二进制前须基于实际安装重新核对通知和源代码义务。

绝大多数依赖为 MIT、Apache-2.0、BSD、ISC 等宽松许可。例外仅限明确列出的构建工具：

- `@img/sharp-libvips-*`：LGPL-3.0-or-later，Astro/Sharp 的本机图片编译依赖。本工程将 imageService 设为 compile，无图片处理端点，也不将 libvips 原生二进制部署到 Workers。若另行分发该二进制，需遵循上游 LGPL 及其所含库的许可、通知、对应源码和可重链接要求。上游：[libvips](https://github.com/libvips/libvips)、[sharp-libvips](https://github.com/lovell/sharp-libvips)。
- `lightningcss`、`lightningcss-*`：MPL-2.0，CSS 构建工具；其原生二进制不进入 Worker。修改并分发其 MPL 文件时，应遵守文件级源代码提供义务。上游：[Lightning CSS](https://github.com/parcel-bundler/lightningcss)。

这些工具未被重新标记为 MIT。未经重新审查，不可把该例外扩大到业务运行时依赖。发布 Worker 时须同时保留随附的第三方通知；公开源码仓库应包含本文件与 THIRD_PARTY_NOTICES.txt。

运行时还随附 Playwright v1.64.1 发布的 libwebp WASM，许可为 Apache-2.0 / libwebp BSD / Emscripten 通知，完整文件与二进制来源见 [vendor 记录](../src/vendor/webp/README.md)。该制品不依赖新增 npm 解码包，`check:licenses` 单独验证其固定哈希与许可保留。测试目录中的纯色 WebP 是本项目生成的 fixtures。
