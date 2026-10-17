# dsh-TUI 适配归档

此目录保存 Combo 曾经维护的 dsh-TUI 适配，不参与当前安装、更新、构建、诊断或 CI 补丁重放。
后续只跟进 dsh 本身与 AgentSociety 的集成；需要 TUI 的用户自行安装和更新上游 dsh-TUI，兼容性由上游维护。

最后验证的组合来自 Combo commit `b5eac4d`：

- dsh `0.2.1-alpha.2`，commit `1b316d0444450d484ade4c1da76f9224d33251bc`。
- dsh-TUI `0.15.0`，commit `ab9f139457d5931079e8d19d05ba3e35c1ca058d`。
- 当时的构建、版本检查、源码类型、Web 共存、真实终端启动与退出验证见该提交及其历史。

归档内容：

- `patches/dsh-tui/`：原有全部 5 份兼容补丁与 `files/bin/dsh-tui-local.js`，保留原始内容。
- `sources.lock.json`：最后一版 TUI 组件、上游 commit 和文件校验和；路径已指向归档。
- `combo-integration.patch`：从当前安装器等文件移除 TUI 集成的差异，供历史查阅，不能单独作为安装入口。

旧安装曾负责 TUI 的 clone、子模块、依赖、sibling Harness 构建与启动、Hub 凭据包装器、Linux 大小写目录别名、默认 `~/.dsh-tui/agent-preset.json`、doctor 和 CI 检查。当前流程均已停止维护这些行为。
`--preset` 继续设置源码模式的 Web preset；旧参数 `--skip-config` 接受为兼容 no-op。

已有本地 `sources/dsh-tui`、大小写别名、状态文件、启动器、profile、偏好与 session 不会自动删除或重写。
旧启动器可能继续引用旧 checkout；归档不代表它已适配后续 dsh 更新。需要再次使用时请按上游安装说明独立配置。

AgentSociety 历史补丁可能含有 TUI 或旧 Pi 交互命令的兼容代码。这些补丁仍是 AgentSociety 完整补丁链的一部分，不修改其历史内容；Combo 不再为它们提供 TUI checkout、构建或启动器。

原有第三方许可声明仍见仓库根目录 `NOTICE`。归档补丁沿用相应上游项目的许可。
