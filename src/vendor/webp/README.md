# 固定 WebP WASM 来源

来源：Microsoft Playwright **v1.64.1** 的 `packages/utils/webp/webp_codec.js` / `webp_codec.wasm`，与已安装 `playwright-core@1.64.1/lib/webp_codec.wasm` 字节一致。不是项目自行编写的图片解码算法。

- [固定版本源码及制品](https://github.com/microsoft/playwright/tree/v1.64.1/packages/utils/webp)
- [构建脚本与 C 包装](https://github.com/microsoft/playwright/tree/v1.64.1/utils/libwebp-wasm)
- 上游构建固定 libwebp commit `3757b8afeb54e305eaef18502812a9a88b7ed662`（1.6.0 后的 SIMD 构建修复），Emscripten 测试版本 6.0.2。上游脚本默认下载 latest 工具链，复现时应显式固定 6.0.2；本项目没有重新编译。
- WASM SHA-256：`164cd9583a3e4d081f767d3b41ff0a730443dc7535fcc5caff83561463384b79`。
- 保留 `LICENSE.playwright`（Apache-2.0）和 `LICENSE.libwebp-emscripten`（libwebp BSD 与 Emscripten 通知）。分发 Worker 时同时保留本目录的许可文件。

仅对生成 JS 做三项平台适配：CommonJS 导出改为 `export default Module`；`ENVIRONMENT_IS_NODE` 固定 false，避免生成代码尝试读取本机文件；初始化时等待 instantiateWasm hook 返回的 Promise（原同步构建仅默认加载路径同步，hook 路径仍返回 Promise）。通过编译后的 WASM 模块与 `instantiateWasm` 注入，不使用网络加载或运行时编译。WASM 未修改。`codec.d.ts` 是本项目用到的 C ABI 声明。

`src/lib/webp-codec.ts` 仅调用原生解码、读取尺寸和释放所有 C 分配，不使用编码器；前端使用浏览器 Canvas 编码。升级时须同时核对 JS/WASM ABI、固定源码与哈希、许可和损坏输入/重复解码回归。旧候选 `@jsquash/webp@1.5.0` 实测内置 libwebp 1.1.0，已移除，不用于不可信上传。
