# 从 Combo 源码运行时迁移到普通插件

目标是让官方 npm DSH、AgentSociety 插件和可选 Host 各自独立安装。继续使用原来的
`DSH_HOME`；不重建会话、工作区或 SSH anchor，不搬走旧源码目录。旧会话可能仍以源码目录为 cwd。

## 生成预构建产物

在隔离开发目录应用 `sources.lock.json` 中的 AgentSociety 补丁并构建
`agent-config`、`dsh-plugin`、`agent-host`，然后运行：

```bash
node scripts/package-standalone.mjs --source /built/AgentSociety --output /new/release
```

保存整个 release 目录及 `artifacts.json`。发布或安装生成的 `.tgz`，不要直接发布源码
package 目录：源码仍保留开发期共享配置依赖，预构建步骤才会内嵌它并移除未发布依赖。
包不包含 node_modules、用户配置、源码 checkout 或 source maps。安装不运行构建脚本。

## 隔离验收

先用独立 npm prefix 安装与生产相同版本的官方 DSH，不更改现有启动器。使用临时
`DSH_HOME` 安装预构建插件、Codex 和 SSH Remote，不连接生产 Hub 身份，也不启动生产 worker。
验证纯 DSH、加入 AgentSociety、移除 AgentSociety 三种状态。

```bash
node scripts/smoke-source.mjs --dsh-package /runtime/node_modules/@deepseek-ai/dsh \
  --plugin /profile/node_modules/@agent-society/dsh-agent-society \
  --web-profile /profile
```

只有纯 DSH profile 才使用 `--without-agent-society`。带 `--web-profile` 时，测试复制现有
依赖树并检查 Codex/SSH 插件状态；不安装或更新它们。mock 覆盖 Web preload、Hub MCP、
headless 模型回合，以及 worker 领取/完成任务和 transcript。真实 provider 登录和旧会话
续聊仍需单独验收，mock 成功不能替代这部分。

## 冷备份和切换

1. 停止 DSH、worker、bridge 和其他可能写入同一个 `DSH_HOME` 的进程。
2. 在用户私有目录完整归档 `DSH_HOME`，验证归档可读取并记录 SHA-256。
   备份目录 `0700`、文件 `0600`；它可能包含凭据，绝不能提交 Git。
3. 记录所有会话文件的相对路径、字节数和 SHA-256，以及工作区注册表、SSH 映射和原启动器目标。
   系统钥匙串继续保留在系统内，不导出 secret。
4. 用官方 `dsh plugin --profile <name> add /durable/release/plugin.tgz` 替换开发依赖。
   检查 package manifest、lockfile 和实际安装目录，不能只检查 manifest。
5. 某些旧 `link:` 依赖会在 pnpm lockfile 中残留。冷备份后、进程停止时，必要时使用官方
   `remove` 再 `add`，保留同 profile 中的其他插件和用户配置。不要批量删除 profile。
6. 将 PATH 中所有生效的 `dsh` 入口原子切换到独立 npm 安装；可选 `agent` 指向预构建 Host。
   校验旧目标未被其他进程改动。不覆盖未知普通文件。
7. 核对旧会话和工作区哈希，启动 Web。确认 Hub 工具、Codex/SSH 插件、旧会话读取和远端只读命令。
   Web 不应激活 worker。需要 worker 时单独启动 `dsh --profile agent-society-worker`。
8. 移除临时验收 overlay，使用正常 `dsh web` 启动。抽查旧会话实际续聊、附件及已有 provider 登录。

AgentSociety 不再默认设置 DSH 的模型密钥、sandbox、搜索或会话压缩。模型由 DSH 自己的
settings/credential 管理。已有配置不自动清空；Hub 401 使用 `agent connect` 重新登录同一身份。

## 更新与回滚

DSH 由用户独立升级；`agent update` 仅更新 Host 和已有 AgentSociety profile，不安装其他插件。
本地 tarball 发行版应先生成新的版本包，再显式安装新包；未发布的版本不能靠 npm `latest` 获取。
安装包路径应持久保存，不能指向临时构建目录。

失败时先停止新进程，恢复原入口和配套 profile 配置。若新 DSH 已迁移持久数据，应从完整
冷备份恢复，不能假定旧版可读。恢复前另行保留切换后的新增数据，不直接用旧备份覆盖。
稳定运行几天后再清理旧开发链接；源码目录和历史会话不自动删除。
