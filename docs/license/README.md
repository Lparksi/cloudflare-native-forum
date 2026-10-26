# 轻量许可审查

本流程是风险筛查和人工审查辅助，不是法律保证。保留原 MIT 版权 `Lparksi <parksi@lparksi.com>`，第三方代码不重标 MIT。不使用 ORT、SaaS、外部上传或额外账号。

## 三层检查

1. `pnpm check:licenses`：保留 pnpm 许可表达式允许清单硬门禁。`exceptions.json` 只允许精确包名、版本、许可与 `build-only` 用途；版本或用途改变必须重审。源码映射中发现这些包进入浏览器或 Worker 时失败。
2. `pnpm check:notices`：逐版本比对实际安装包内（包括嵌套目录）的 LICENSE/COPYING/NOTICE 全文及 vendor 通知，不只检查包名。`pnpm notices:write` 更新正文和哈希索引。仅允许保留有 os/cpu 声明的其他平台条目，且其全文必须匹配已提交索引；普通过期条目会使校验失败。新平台需重新生成、审查并提交，不能凭 Linux 成功声称覆盖其他平台。
3. 固定 ScanCode Toolkit 32.4.1 对选定源码、vendor、实际构建产物扫描许可、版权和文件信息。新发现进入报告，不按未核实表达式自动封禁；进程失败、文件扫描错误、空报告、遗漏或额外文件均失败。`scan-baseline.json` 是首次观察记录，全部待人工审查，不是自动豁免。

## 本地复现（Linux x86_64、Python 3.12）

```sh
pnpm install --frozen-lockfile
pnpm check:licenses
pnpm check:notices
LICENSE_AUDIT=1 pnpm build
pnpm license:prepare
RUNNER_TEMP=/tmp/forum-license-tools scripts/license/install-scancode.sh
export SCANCODE_CACHE=/tmp/forum-scancode-cache
/tmp/forum-license-tools/scancode-toolkit/venv/bin/python scripts/license/validate-spdx.py .cache/license/reports/sbom.spdx.json
/tmp/forum-license-tools/scancode-toolkit/scancode --license --copyright --info --processes 2 --json-pp .cache/license/reports/scancode.json .cache/license/input
pnpm license:report
```

`LICENSE_AUDIT=1` 生成隐藏 source maps，只在本地用于识别浏览器/Worker 包归属，不上传 source maps。常规构建不改变 source map 设置。扫描的 JS/CSS/WASM 就是该次构建输出，不以源码替代。`coverage.json` 保存文件 SHA-256、浏览器/Worker 包归属、未观察到的构建工具或运行时候选、未安装可选平台包及排除项。归属是保守证据，不证明二进制来源完整；未知发布文件类型或未知 WASM 要先审查，不能静默跳过。

SPDX 2.3 SBOM 从 pnpm 实际安装清单生成，包含构建工具和 vendor，非最小运行时依赖图。另用 `pnpm list --depth Infinity --json` 核对安装树和所有直接依赖，防止空/缺失报告。未安装可选平台包单列，不声称已扫描。用固定 ScanCode 发行包自带的官方 `spdx-tools 0.8.2` 解析并验证 SPDX。`licenseConcluded: NOASSERTION`；元数据声明不是法律结论。vendor 的综合许可也保留 NOASSERTION，不把包含专利/NCSA/未知匹配的上游文本简化成 MIT。包中没有独立许可文件的版本会明确列入 `missingLicenseTexts`，不能把已有元数据当成完整再分发通知。pnpm 12.9.1 根锁文件是双 YAML 文档；GitHub 官方 dependency graph/dependency-review 当前不支持该格式，不能替代现有硬门禁。本实现不依赖其锁文件解析。

## 数据与 CI 边界

只选择 Git 跟踪的 `src` 中经过允许类型的源码/vendor、根 LICENSE/package.json/pnpm-lock.yaml/THIRD_PARTY_NOTICES，以及 `dist/client`、`dist/server` 的 JS/MJS/CSS/WASM、`_headers` 和 `.assetsignore`。不复制 `.env*`、`.dev.vars*`、数据库、SQL、密钥、缓存、用户数据、node_modules、Git 历史、生成的 wrangler 配置和 source maps。新目录/发布文件必须明确审查。请勿把机密放入源码或公开构建常量；此选择机制不等于通用 DLP。

独立 `License audit` workflow 使用 `push`/`pull_request`，无 secrets、无部署/云资源步骤，`contents: read`，checkout 不保留凭据。所有新增 Action 引用固定 commit SHA；不改现有 Action 版本。ScanCode 使用官方自包含发行包及上游资产 SHA-256，离线安装其中 wheel；校验失败立即退出。只上传明确列出的五份报告，保留 7 天，不上传输入目录或整个 dist。报告含选定文件路径和许可证据，仍需审查其公开范围。PR 代码不与秘密凭据一起运行。

CI 上传的 `license-reports` 内含 `summary.md`、`review.json`、`coverage.json`、`scancode.json` 和 `sbom.spdx.json`。失败时也尝试保留已生成报告，失败状态不会被 `continue-on-error` 隐藏。产物不是发布压缩包；实际发布时应随发布结果附上完整 THIRD_PARTY_NOTICES 与 vendor 许可。变更依赖、vendor 或发布方式后重跑并人工复核。

## 人工审查

- 审查 `review.json` 的新观察与原始 `scancode.json` 的匹配位置；低置信度/未知/多许可表达式可能来自文档、压缩代码或工具特征，不能仅凭名称下法律结论。
- 复核 vendor 的上游来源、保留通知和 WASM 的固定哈希；浏览器 JS/WASM 与服务端分发分别考虑。
- LGPL/MPL 构建工具未随运行时发布不代表可随意再分发工具二进制。若将其打包给用户，重新评估对应源码、通知与其他义务。
- 初始基线全部保持 `pending-human-review`。只有所有者完成审查后再单独记录决定、理由和证据；本轮不替所有者批准法律结论。

官方资料：[ScanCode CLI](https://scancode-toolkit.readthedocs.io/en/stable/reference/scancode-cli/index.html)、[固定发行包](https://github.com/aboutcode-org/scancode-toolkit/releases/tag/v32.4.1)、[SPDX Python tools](https://github.com/spdx/tools-python)、[SPDX 2.3](https://spdx.github.io/spdx-spec/v2.3/)、[pnpm licenses](https://pnpm.io/cli/licenses)、[GitHub 支持的包生态](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-the-dependency-graph#supported-package-ecosystems)。

首次本地扫描发现 vendor WebP/Emscripten 通知含 `unknown`、NCSA 和专利许可匹配，聚合 NOTICE 还含 LGPL/MPL/GPL 或 BSD 选项等多许可文本。它们需要按上游原文和实际分发用途人工核实；没有新增全局放行或自动封禁。

## 版本绑定的补充许可来源

`docs/license/sources.json` 记录原来缺少独立许可文件的 32 个精确版本。此次从 npm 官方重新下载并核对锁文件 integrity 的 3208 个包文件，不复用旧容器证据。25 个版本已收集许可正文；`text-collected` 只表示材料已收集，不是法律结论、组件闭包完整证明或扫描批准。其余 7 个仍为 `pending-source-review`，见 [残留项](source-review.md)。所有 ScanCode 基线继续保持待人工审查。

正文逐字保存在 `texts/<sha256>.txt`；生成器通过 `inventory.mjs` 自动加入对应版本的 NOTICE 段落，包含来源 URL 和哈希，重新生成不会丢失。离线校验检查锁文件版本/integrity、原包文件 SHA-256、发布证明的 subject 摘要与源码 commit、正文 SHA-256。workerd 的安装脚本会用平台二进制替换包内启动文件，显式记录 Linux x64 替换关系并校验对应平台包与替换后文件，未将这一差异静默忽略。该新增二进制验证当前只覆盖 Linux x64；其他平台必须补充对应证据后运行。

```sh
pnpm license:sources            # 离线校验来源清单
pnpm license:sources --fetch    # 从官方重新下载包、发布证明与正文，验证哈希
pnpm notices:write
pnpm check:notices
```

来源绑定优先使用 npm 官方发布证明中的 SLSA resolvedDependencies gitCommit；无证明时使用 npm gitHead，`@vscode/l10n` 与 process-ancestry 使用官方确切版本 tag 的 commit。清单保留解码后的官方 statement 与原证明响应哈希；在线重核比对 statement，不要求签名容器永远不变。本机制没有独立执行 Sigstore 签名验证，不声称完成供应链证明认证。在线重核失败应调查来源变化，不能自动改哈希或更换版本。

`packageFiles` 保存原 tarball 各文件哈希，不包含安装后新生成的文件；这不是所有平台原生库的完整版权/许可证扫描。补充来源只扩展通知材料，没有扩大 SPDX 允许清单，也没有将 metadata 缺文件推断为无授权。新增/升级版本需重新收集确切来源，不能复用别的版本的材料。

补充来源还支持两种显式证据：boolbase 的同版本后续许可提交，以原包运行文件的逐字 SHA-256 匹配绑定；natural-compare 的原 README 所链接作者正文，以原 README、确切链接、获取日期和正文哈希绑定。两者都保留其时间与来源限制，详见 source-review.md。在线重核需 Node 24；使用显式 HTTP(S) 代理的环境可设置 `NODE_USE_ENV_PROXY=1`，不会绕过来源或哈希校验。
