# dsh-agent-society-combo

以 dsh 为唯一主运行时安装 AgentSociety：

- [deepseek-harness（上游）](https://github.com/Fantasia-Infinity/deepseek-harness)
- [dsh-TUI（上游）](https://github.com/Fantasia-Infinity/dsh-TUI)
- [AgentSociety](https://github.com/Fantasia-Infinity/AgentSociety)
- [dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)
- [dsh-opencode-full](https://github.com/Fantasia-Infinity/dsh-opencode-full)（可选，`--with-opencode-full`）

发布版用户只需要安装 dsh 和 AgentSociety dsh 插件；本仓库默认是一个薄安装器，
不 clone、patch 或构建任何源码。`--source` 才启用下方 lock 文件所描述的源码开发
模式，用于适配上游变动和开发验证。源码模式会把 patch 应用到受管 checkout，绝不
修改 dsh-TUI 上游仓库本身。

## 版本矩阵

精确 SHA 与 patch 校验和见 [`sources.lock.json`](sources.lock.json)。

| 组件 | 固定 commit |
|---|---|
| deepseek-harness | `600c416d7f471ac9b54f2506702c6958e01014e2` |
| dsh-TUI | `3cf843f502550b98fa03330cdb045024ab0204c8` |
| AgentSociety | `15f6c324afc538f0f0fd18f1d02ceca6950b6825` |
| dsh-anchored-standard | `0a38616c1b7ce4219b6d94d95c89f34a90741616` |
| dsh-opencode-full（可选） | `f4d4dda7c2ab8032ed169a770db3594cf98ea638` |

发布版运行时绑定：`@deepseek-ai/dsh@0.1.2-alpha.5`，来源为
`Fantasia-Infinity/deepseek-harness`；AgentSociety 插件为
`@agent-society/dsh-agent-society`。Combo 会检查 dsh 版本，不会让 npm 模式和
源码模式静默使用不同的 dsh 实现。

默认 TUI preset：`anchored-standard`。`standard` / `ptc` / `minimal` /
`cordis` 仍保留可选（安装时 `--preset standard`，或 TUI 内 `/preset`）。

## 最近更新：跨设备 DSH Web

当前组合已集成 AgentSociety 的原生 DSH Web 远程访问能力：

- `agent web-bridge` 通过设备主动出站的 WebSocket 隧道把本地 DSH Web 接入 Hub，不需要把设备的 `3080` 端口暴露到公网。
- 浏览器访问 `https://<hub>/v1/web/<node_id>/`；Hub 负责认证、节点权限和透明 HTTP/WS 转发，不改写 HTML、不注入全局运行时脚本。
- DSH Web 使用原生相对 URL，API/RPC、插件、静态资源、manifest、favicon、HMR，以及 `remote.mux` 双向 WebSocket 都支持节点挂载路径。
- npm 模式 bridge 默认自动启动标准 `web` profile；source 模式兼容 `agent-society-web`。
  已有 `dsh web` 时复用现有服务，bridge 只会停止自己启动的子进程。
- bridge 启动时会幂等创建默认 workspace（默认当前用户 home），并在浏览器加载后自动进入该 workspace。

安装或更新完成后，在已配置 Hub 的设备上运行：

```bash
agent web-bridge
```

常用配置：

```bash
AGENT_DSH_WEB_TARGET=http://127.0.0.1:3080
AGENT_DSH_WEB_DEFAULT_WORKSPACE=/path/to/workspace
AGENT_DSH_WEB_BRIDGE_START=0  # 禁用自动启动，要求已有 DSH Web
```

同一 `node_id` 只运行一个 bridge；多个 bridge 会互相替换隧道。完整协议和安全边界见 AgentSociety 的 [`docs/dsh-web-hub-bridge.md`](https://github.com/Fantasia-Infinity/AgentSociety/blob/main/docs/dsh-web-hub-bridge.md)。


## 推荐安装：dsh-first npm 模式

先安装当前 fork 对应的 dsh 发布包：

```bash
npm install -g @deepseek-ai/dsh@0.1.2-alpha.5
```

然后添加 AgentSociety 插件到三个彼此隔离的 profile：

```bash
dsh plugin --profile web add @agent-society/dsh-agent-society
dsh plugin --profile headless add @agent-society/dsh-agent-society
dsh plugin --profile agent-society-worker add @agent-society/dsh-agent-society
```

也可以使用 Combo 薄安装器完成版本检查、插件安装和 worker profile 初始化：

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/Fantasia-Infinity/dsh-agent-society-combo/main/install.sh | bash
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/Fantasia-Infinity/dsh-agent-society-combo/main/install.ps1 | iex
```

### 手动 clone 后安装

```bash
git clone https://github.com/Fantasia-Infinity/dsh-agent-society-combo.git
cd dsh-agent-society-combo
bash install.sh
```

Windows：

```powershell
git clone https://github.com/Fantasia-Infinity/dsh-agent-society-combo.git
cd dsh-agent-society-combo
.\install.ps1
```

默认 `install.sh` / `install.ps1` 进入 npm 模式，不会 clone AgentSociety、dsh 或
dsh-TUI 源码。脚本检测到自己位于 combo checkout 内时，只直接使用当前 checkout
的安装器；等价命令：

```bash
node scripts/install.mjs --update
```

需要适配上游或开发源码时显式使用：

```bash
node scripts/install.mjs --source
node scripts/install.mjs --source --update
```

### 参数

```bash
curl -fsSL .../install.sh | bash -s -- \
  --root ~/.local/share/dsh-agent-society-combo \
  --preset anchored-standard
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--mode npm|source` | `npm` | npm 发布模式；`source` 为锁定源码开发模式 |
| `--root <dir>` | `~/.local/share/dsh-agent-society-combo` | Combo 状态目录；仅 source 模式保存源码 |
| `--with-host` | 关闭 | 同时全局安装可选的 `@agent-society/agent-host` 管理层 |
| `--without-host` | 关闭 | 明确不安装可选 Host |
| `--dsh-package <spec>` | `@deepseek-ai/dsh` | npm 模式的 dsh 包名 |
| `--plugin <spec>` | `@agent-society/dsh-agent-society` | npm 模式的 AgentSociety 插件 |
| `--preset <id>` | `anchored-standard` | 默认 preset |
| `--patch-only` | 关闭 | 只 clone + patch + 文件覆盖，适合 CI |
| `--skip-deps` | 关闭 | 跳过 npm/pnpm install |
| `--skip-build` | 关闭 | 跳过构建 |
| `--skip-links` | 关闭 | 不写 `~/.dsh` 与 bin 链接 |
| `--skip-config` | 关闭 | 不写 `~/.dsh-tui/agent-preset.json` |
| `--force-build` | 关闭 | 即使已有构建产物也重新构建 |
| `--update` | 关闭 | 按当前 lock 更新已安装组件，变化项自动重装依赖与构建 |
| `--with-ssh [spec]` | 关闭 | 向 `web` profile 追加 SSH 插件；source 模式使用兼容的 `agent-society-web` |
| `--with-opencode-full` | 关闭 | 安装 dsh-opencode-full bundle，并把 web profile 默认 preset 切换为 `opencode-full` |
| `--dry-run` | 关闭 | 只打印安装计划 |

环境变量：

```bash
COMBO_ROOT=~/.local/share/dsh-agent-society-combo
COMBO_PRESET=anchored-standard
COMBO_BIN=~/.local/bin
COMBO_OPENCODE_FULL=0
DSH_HOME=~/.dsh
COMBO_MODE=npm
COMBO_WITH_HOST=0
```

## 安装后

```bash
export PATH="$HOME/.local/bin:$PATH"   # Windows 加入用户 PATH
agent setup --mode local               # 可选 Host；选择 local / hub-worker / dispatch-only
agent doctor                           # 静态检查；需要网络时加 --live
dsh web                                # dsh 主 Web 入口
dsh --profile headless                 # 无头 dsh profile
dsh --profile agent-society-worker     # 单独启动 Hub worker
```

如果安装了可选的 `@agent-society/agent-host`，配置向导无需先进入 AgentSociety
源码目录，并保留这些兼容入口：

```bash
agent setup | agent configure
agent connect
agent doctor [--live] [--json]
agent update
agent web
agent worker
agent bootstrap | agent repair
```

非敏感配置默认保存在 `$DSH_HOME/.env`（默认 `~/.dsh/.env`；Windows 为
`%USERPROFILE%\\.dsh\\.env`），也可以用 `agent setup --config /path/to/agent.env`
或 `AGENT_ENV_FILE` 覆盖。优先级为：进程环境变量、显式配置文件、
`$DSH_HOME/.env`、legacy 文件。旧的 `.private/env/agent.env`、`.env.agent` 和旧的
`~/.config/agentsociety/agent.env` 会被自动发现，迁移时不删除也不覆盖。
`agent configure` 是 `agent setup` 的同义别名。

默认向导会优先使用系统钥匙串、Credential Manager 或 Secret Service。
无头环境没有可用钥匙串时只读取环境变量，不会自动把 secret 写入磁盘；
只有显式运行 `agent setup --credentials file` 才会在用户配置目录写入权限为
`0600` 的凭据文件，并由 `agent doctor` 持续提示这一风险。非交互模式请使用
环境变量或显式凭据文件，不要把 API key / 密码放到命令行参数中。

TUI 与 Web 是同一个 dsh core 上的两个 UI adapter，共享 `$DSH_HOME/sessions`、
profile 插件、preset 与 dsh 模型凭据；TUI 不由本次 dsh-first 改动管理。


## AgentSociety Web Bridge 使用方式

在 npm 模式下 Combo 向标准 `web` profile 安装 AgentSociety 核心插件；
`dsh web`、`agent web` 和 `agent web-bridge` 共享同一份 `$DSH_HOME`、session、插件
和模型配置。source 模式仍保留 `agent-society-web` 作为兼容 profile。只需先完成一次
Hub 配置：

```bash
agent setup --mode hub-worker       # 配置模型、Hub，并注册 worker 节点
agent setup --mode dispatch-only    # 配置 Hub，但明确不接收远程任务
agent connect                       # 需要时重新注册/轮换节点凭据
dsh web          # 启动本机 Web
agent web-bridge # 可选：启动本机 Web，并通过 Hub 发布
```

如果希望让 bridge 使用另一个本地端口，必须确保目标仍然是 loopback 地址：

```bash
AGENT_DSH_WEB_TARGET=http://127.0.0.1:3090 agent web-bridge
```

bridge 会等待本地 DSH Web 就绪、注册 `dsh_web` 节点能力，并转发浏览器的 DSH RPC 和事件 WebSocket。默认 workspace 来自 `AGENT_DSH_WEB_DEFAULT_WORKSPACE`；未设置时使用当前用户 home。要完全由外部进程管理 DSH Web，可设置 `AGENT_DSH_WEB_BRIDGE_START=0`。


## 更新

npm 模式下更新由 dsh/npm 管理，不在 `node_modules` 或安装目录执行 Git 更新：

```bash
npm install -g @deepseek-ai/dsh@0.1.2-alpha.5 @agent-society/agent-host
agent update                         # 更新 dsh、Host、三个 dsh profile 插件
combo install --update               # 也可以只更新 AgentSociety 插件
```

source 模式仍通过 Combo lock 更新；它会先拉取 combo repo 的最新
`sources.lock.json`：

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/Fantasia-Infinity/dsh-agent-society-combo/main/install.sh \
  | bash -s -- --update --root "$HOME/.local/share/dsh-agent-society-combo"

# Windows PowerShell
irm https://raw.githubusercontent.com/Fantasia-Infinity/dsh-agent-society-combo/main/install.ps1 | iex
```

source 更新逻辑：

1. 对比每个组件的 `commit + patch SHA + overlay file SHA`；
2. 仅对变化组件执行 `fetch/checkout → reset --hard → patch → overlay`；
3. 变化组件的依赖会重新 `pnpm install` / `npm ci`；
4. 变化组件的构建产物会强制重建，不再因旧 `lib/` 存在而跳过；
5. 删除已经从 manifest 移除的旧 overlay 文件；
6. 重新建立 source profile 与 bin 链接（`--with-ssh` 时把 SSH 插件一并写回）。

受管源码目录如有本地改动，更新时会把旧 checkout 完整备份为
`sources/<组件>.pre-update-<时间戳>`，再从 lock 重新 clone；不会覆盖删除。
只预览：

```bash
curl -fsSL https://raw.githubusercontent.com/Fantasia-Infinity/dsh-agent-society-combo/main/install.sh \
  | bash -s -- --dry-run --root "$HOME/.local/share/dsh-agent-society-combo"
```

## OpenCode Full 插件

可选安装 [dsh-opencode-full](https://github.com/Fantasia-Infinity/dsh-opencode-full)：

```bash
curl -fsSL https://raw.githubusercontent.com/Fantasia-Infinity/dsh-agent-society-combo/main/install.sh \
  | bash -s -- --with-opencode-full
```

安装后 npm `web`（source 模式为兼容的 `agent-society-web`）默认使用
`opencode-full` preset，补齐：

- `web_fetch`：抓取并阅读网页正文
- `lsp`：`goToDefinition` / `findReferences` / `goToImplementation` / `hover`
- `apply_patch`：OpenCode 风格 patch，基于 `git apply --check/apply`
- 全量工具默认常驻，不再需要 `dev_tool_search` 解锁
- 只读 `subagent_explore`

安装器会探测本机的 `typescript-language-server` / `pyright-langserver` /
`vscode-json-languageserver` 并写入 profile patch；没有 language server 时
`lsp` 工具会返回 `LSP_UNAVAILABLE`，但 profile 可以正常启动。
`--with-opencode-full` 与 `--with-ssh` 可叠加。

## 可选 SSH 运维插件

安装器默认就会创建 Web core profile：

```text
web（source 模式兼容名为 `agent-society-web`）:
  @deepseek-ai/dsh-base
  @deepseek-ai/dsh-web-app
  @agent-society/dsh-agent-society   # AgentSociety 核心（Hub 工具 / web_search guard）
```

它和 `headless`、`agent-society-worker`、TUI 外部 bundle 消费同一份 AgentSociety 插件，
session 也共用 `$DSH_HOME/sessions`。npm 模式用 `dsh web`；source 模式保留
`agent web` / `dsh-web` 兼容入口。
安装器管理的 profile patch 会把 session 压缩默认设为 `zstd`，与共享
session 根目录里已有的 zstd session 保持一致；机器级覆盖请写
`~/.dsh/cordis.patch.yml`，不要改 profile 自己的 `cordis.patch.yml`
（重跑安装器会重建它，旧内容自动备份为 `*.combo-backup-*`）。

DeepSeek Harness 上游没有内置 SSH 工具；combo 可选向该 profile 追加社区维护的
SSH 插件：

```bash
curl -fsSL https://raw.githubusercontent.com/Fantasia-Infinity/dsh-agent-society-combo/main/install.sh \
  | bash -s -- --with-ssh
```

默认追加：

```text
dsh-ssh-ops@0.2.1 → bundles of the `web` profile（source 模式为 `agent-society-web`）
```

启动（npm 模式使用 `dsh web`；source 模式保留 `agent web` 兼容入口；SSH 插件只在
带 `--with-ssh` 安装时存在）：

```bash
dsh web             # npm 模式 core Web UI
agent web           # 可选 Host/source 模式兼容入口
dsh-web             # source 模式直接启动 profile
dsh-web-ops         # source 模式；--with-ssh 后可用
```

切换插件版本：

```bash
# 另一个实现：@linxin666/dsh-ssh
curl -fsSL .../install.sh | bash -s -- --with-ssh '@linxin666/dsh-ssh@0.1.18'
```

说明：

- 两者都面向 dsh Web GUI，不进入 dsh-TUI / worker profile；
- `dsh-ssh-ops` 把秘密保存在 dsh 官方凭据库，并对 Agent 输出做脱敏；
- `@linxin666/dsh-ssh` 支持 `~/.ssh/config` 导入、ProxyJump、集群执行等；
- SSH 密码/私钥仍属于本机敏感数据，profile 安装不保存任何真实凭据；
- 重新执行不带 `--with-ssh` 的安装会移除 profile 里的 SSH bundle。

## 诊断

```bash
combo doctor
# 或
combo install --dry-run
```

## 数据归属

安装后 TUI / Web / worker 三个入口共享同一 `$DSH_HOME`：

- session 日志：`~/.dsh/sessions`
- 凭据与设置：`~/.dsh/.credentials.yaml` / `~/.dsh/settings.yaml`
- TUI 偏好：`~/.dsh-tui`
- 外部插件：`~/.dsh/plugins`
- AgentSociety 非敏感配置：`$DSH_HOME/.env`；旧 `~/.config/agentsociety/agent.env`、项目 `.env.agent` / `.private/env/agent.env` 只读兼容
- AgentSociety 凭据：系统凭据库；显式 `--credentials file` 时为用户配置目录下的 0600 凭据文件，`env` 模式只读环境变量

本仓库和安装器不保存 API Key / Hub token。

## 开发

```bash
node scripts/install.mjs --patch-only --root /tmp/combo-patch-test
node scripts/doctor.mjs --root /tmp/combo-patch-test
```

更新 lock：

- 修改 `sources.lock.json` 中的 commit；
- 用 `sha256` 更新 patch/file 校验和；
- 提交前执行 `git diff --check`。

## 边界

- 不修改 deepseek-harness / dsh-TUI 上游仓库；
- patch 只保留运行时必需差异，不携带个人 notes、文档草稿；
- 升级组合前先在 macOS / Linux / Windows CI 上验证 `--patch-only`，
  并在 macOS / Linux 上验证完整安装。
