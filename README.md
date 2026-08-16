# dsh-agent-society-combo

一条命令安装并组合：

- [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- [dsh-TUI](https://github.com/Fantasia-Infinity/dsh-TUI)
- [AgentSociety](https://github.com/Fantasia-Infinity/AgentSociety)
- [dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)

本仓库不包含上述仓库的源码，只记录经过验证的 commit、必要的 patch、
文件覆盖层和安装器。所有 patch 都在安装时应用到受管 checkout，上游仓库
本身不被修改。

## 版本矩阵

精确 SHA 与 patch 校验和见 [`sources.lock.json`](sources.lock.json)。

| 组件 | 固定 commit |
|---|---|
| deepseek-harness | `47f943859b` |
| dsh-TUI | `0e7a899` |
| AgentSociety | `aeb321c` |
| dsh-anchored-standard | `d97bec9` |

默认 TUI preset：`anchored-standard`。`standard` / `code` / `minimal` /
`cordis` 仍保留可选（安装时 `--preset standard`，或 TUI 内 `/preset`）。

## 一条命令安装

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/Fantasia-Infinity/dsh-agent-society-combo/main/install.sh | bash
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/Fantasia-Infinity/dsh-agent-society-combo/main/install.ps1 | iex
```

### 参数

```bash
curl -fsSL .../install.sh | bash -s -- \
  --root ~/.local/share/dsh-agent-society-combo \
  --preset anchored-standard
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--root <dir>` | `~/.local/share/dsh-agent-society-combo` | 受管源码目录 |
| `--preset <id>` | `anchored-standard` | 默认 preset |
| `--patch-only` | 关闭 | 只 clone + patch + 文件覆盖，适合 CI |
| `--skip-deps` | 关闭 | 跳过 npm/pnpm install |
| `--skip-build` | 关闭 | 跳过构建 |
| `--skip-links` | 关闭 | 不写 `~/.dsh` 与 bin 链接 |
| `--skip-config` | 关闭 | 不写 `~/.dsh-tui/agent-preset.json` |
| `--force-build` | 关闭 | 即使已有构建产物也重新构建 |
| `--update` | 关闭 | 按当前 lock 更新已安装组件，变化项自动重装依赖与构建 |
| `--dry-run` | 关闭 | 只打印安装计划 |

环境变量：

```bash
COMBO_ROOT=~/.local/share/dsh-agent-society-combo
COMBO_PRESET=anchored-standard
COMBO_BIN=~/.local/bin
DSH_HOME=~/.dsh
```

## 安装后

```bash
export PATH="$HOME/.local/bin:$PATH"   # Windows 加入用户 PATH
agent doctor
agent setup                            # 模型 / Hub 凭据（只写本机）
agent                                  # dsh-TUI，回退 Pi
agent worker                           # dsh plugin worker，回退 Pi
dsh-tui                                # 直接启动 dsh-TUI
```

## 更新组合

一条命令更新，其实就是重新跑安装器；它会先拉取 combo repo 的最新
`sources.lock.json`：

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/Fantasia-Infinity/dsh-agent-society-combo/main/install.sh \
  | bash -s -- --update --root "$HOME/.local/share/dsh-agent-society-combo"

# Windows PowerShell
irm https://raw.githubusercontent.com/Fantasia-Infinity/dsh-agent-society-combo/main/install.ps1 | iex
```

更新逻辑：

1. 对比每个组件的 `commit + patch SHA + overlay file SHA`；
2. 仅对变化组件执行 `fetch/checkout → reset --hard → patch → overlay`；
3. 变化组件的依赖会重新 `pnpm install` / `npm ci`；
4. 变化组件的构建产物会强制重建，不再因旧 `lib/` 存在而跳过；
5. 删除已经从 manifest 移除的旧 overlay 文件；
6. 重新建立 `~/.dsh` 与 bin 链接。

受管源码目录如有本地改动会拒绝覆盖。只预览：

```bash
curl -fsSL https://raw.githubusercontent.com/Fantasia-Infinity/dsh-agent-society-combo/main/install.sh \
  | bash -s -- --dry-run --root "$HOME/.local/share/dsh-agent-society-combo"
```

## 诊断

```bash
node ~/.local/share/dsh-agent-society-combo/scripts/doctor.mjs
# 或
node ~/.local/share/dsh-agent-society-combo/scripts/install.mjs --dry-run
```

## 数据归属

安装后三个入口共享同一 `$DSH_HOME`：

- session 日志：`~/.dsh/sessions`
- 凭据与设置：`~/.dsh/.credentials.yaml` / `~/.dsh/settings.yaml`
- TUI 偏好：`~/.dsh-tui`
- 外部插件：`~/.dsh/plugins`
- AgentSociety 本地配置：AgentSociety 仓库 `.private/env/agent.env` 与系统凭据库

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
