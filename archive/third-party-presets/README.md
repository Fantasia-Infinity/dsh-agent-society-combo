# 第三方 preset 集成归档

Combo 不再维护 `dsh-anchored-standard` 和 `dsh-opencode-full` 的安装或兼容性。当前维护的源码组件只有 DeepSeek Harness 与 AgentSociety。

最后纳入 Combo 的记录来自 commit `06c921a`：

- `dsh-anchored-standard`：`https://github.com/xiaobright/dsh-anchored-standard.git`，commit `dda23ef119e3715f417d73f72eca407732846d1a`。
- `dsh-opencode-full`：`https://github.com/Fantasia-Infinity/dsh-opencode-full.git`，commit `f4d4dda7c2ab8032ed169a770db3594cf98ea638`。

`sources.lock.json` 保存原有组件版本记录。它们当时没有独立 patch 或 overlay 文件；`combo-integration.patch` 保存本次从安装器、诊断、CI 和文档移除集成的差异，仅供历史查阅。

已退出维护的行为包括：clone、构建、默认 anchored-standard 安装、preset 复制、OpenCode Full bundle 挂载、LSP 依赖链接与本机 LSP 探测、profile LSP 配置生成。

源码模式默认 Web preset 现在使用 dsh 自带的 `standard`；`--preset` 仅接受当前列出的 dsh 内置 preset。`--with-opencode-full` 与这两个组件的 `--source name=path` 覆盖入口均已移除，显式使用时会报错。`COMBO_OPENCODE_FULL` 不再读取。

已有 checkout、state、`$DSH_HOME/.agent-presets/anchored-standard` 和 `opencode-full` 不会自动删除或清理。需要继续使用时请按对应上游说明自行安装与配置；后续 dsh 更新不再以这两个 preset 的兼容性为验收条件。

两者的上游地址和许可记录保留在根目录 `NOTICE`。此归档不包含任何上游完整源码、用户配置或凭据。
