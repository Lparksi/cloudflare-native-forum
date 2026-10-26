# CI 浏览器依赖下载

`verify` 使用 GitHub 托管的 Ubuntu 24.04，保持 15 分钟总时限、原有检查、Chromium E2E、独立截图和实际字体 CDP 断言。

## 原因与选择

2026-10-26 的 main `d5beece`，run [40315150783](https://github.com/Lparksi/cloudflare-native-forum/actions/runs/40315150783) 首次运行下载 25.9 MB 系统依赖耗时 3 分 43 秒（116 kB/s）；其后 61.2 MB 的 `fonts-noto-cjk` 下载持续约 9 分 40 秒，直到 job 超时取消。第二次运行在同一 Azure HTTP 源下载系统依赖时耗尽时限。旧 main run [40311464423](https://github.com/Lparksi/cloudflare-native-forum/actions/runs/40311464423) 同样下载 25.9 MB 耗时 11 分 9 秒。首次运行的浏览器 CDN 下载及解压约 7 秒，缓存浏览器不能解决此系统包瓶颈。

[GitHub runner 镜像配置](https://github.com/actions/runner-images/blob/ubuntu24/20261012.334/images/ubuntu/scripts/build/configure-apt-sources.sh) 已提供 Azure HTTP 首选及 Ubuntu 官方 HTTPS 备用源。CI 仅在临时 runner 中删除该 Azure 入口，保留 `archive.ubuntu.com`、`security.ubuntu.com` 官方备用源、原 suite/component、APT 签名及 TLS 校验。先检查预期配置，runner 格式变化时明确失败。未修改防火墙、代理、网络权限、凭据或用户机器。

APT 下载最多重试两次，连接及无数据等待各设 30 秒；这不能检测所有低速传输，因此浏览器和系统依赖步骤另限 5 分钟，字体步骤限 3 分钟。失败不跳过测试，不无限重试，不拉长 job 总时限。保留现有 pnpm 缓存，不新增浏览器或系统包缓存。

[Playwright 官方 CI 文档](https://playwright.dev/docs/ci) 支持 CLI 安装系统依赖，并指出 Linux 系统依赖不能用浏览器缓存替代。[官方容器文档](https://playwright.dev/docs/docker) 要求镜像与项目 Playwright 版本匹配。项目锁定 `1.64.1`；2026-10-26 核查 `mcr.microsoft.com/v2/playwright/manifests/v1.64.1-noble` 返回 404，因此本次保留锁文件与官方 CLI，不使用近似版本镜像，也不构建或发布新镜像。后续若采用容器须重新核查匹配版本及来源。

## 字体与许可

字体仍由 Ubuntu Noble 官方 APT 仓库提供 `fonts-noto-cjk`，不是新增网页字体或外部 CDN。CI 继续输出实际包版本、包内 copyright、fontconfig 信息，并在真实 Chromium 中断言 `Noto Sans CJK SC`。Noto CJK 字体采用 SIL OFL 1.1，Ubuntu 打包文件另有许可；项目 MIT 与第三方通知均保持。完整来源、版权与分发边界见 [许可与素材](licenses.md#字体与-ci-截图)。本次未使用容器镜像或新增持久外部资源。

这项修复避开已观测到的慢速路径，不能保证 Ubuntu 官方源、GitHub 或 Playwright CDN 永不发生网络故障。

## 与许可任务协调

本分支基于 main `d5beece`。并行 draft PR #3 `chore/license-governance` 已在 `ci.yml` 的 `check:licenses` 后新增 `check:notices`；本次不修改该区域或其分支。父协调合并两项工作时应保留该新增入口和独立许可 workflow。
