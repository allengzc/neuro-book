---
name: RP目录初始化
description: 用于给当前 NeuroBook Project Workspace 安装或补齐 roleplay/ 目录模板，使 RP 模式可以由 leader.rp 读取配置、cast、GM 规则、writer 规则和 actor 文件启动。
when_to_use:
  - 用户要求初始化 RP 目录、创建 roleplay/、安装 RP 模板、补齐 RP 配置
  - RP模式 前置检查发现当前 Project Workspace 缺少 roleplay/ 运行目录
---

# RP目录初始化

用于把 `roleplay-directory-templates` 安装到当前 Project Workspace。它只补齐缺失文件，不负责导入 SillyTavern 卡，也不启动 runtime。

## 命令

从仓库根或 Workspace Root 都使用同一个稳定入口：

```powershell
bun assets/workspace/.nbook/agent/scripts/workspace.ts project create "<project>" --target "<project-workspace-path>" --template roleplay-directory-templates --json
```

常见写法：

```powershell
bun assets/workspace/.nbook/agent/scripts/workspace.ts project create "gong-li-yu-lu-xue-yuan" --target "workspace/gong-li-yu-lu-xue-yuan" --template roleplay-directory-templates --json
```

Agent runtime 中如果 `.nbook/agent/bin` 已注入 PATH，应优先使用：

```bash
workspace project create "gong-li-yu-lu-xue-yuan" --target "workspace/gong-li-yu-lu-xue-yuan" --template roleplay-directory-templates --json
```

## 生成结构

```text
roleplay/
|-- AGENTS.md
|-- config.yaml
|-- cast.yaml
|-- gm.md
|-- writer.md
`-- actors/
    |-- player/
    |   |-- actor.md
    |   `-- knowledge.md
    `-- sample-npc/
        |-- actor.md
        `-- knowledge.md
```

## 初始化后检查

1. 确认命令输出中的 `mode` 是 `created` 或 `updated`。
2. 确认 `createdFiles` 包含缺失的 `roleplay/...` 文件；已有文件会出现在 `skippedFiles`，不要覆盖用户手写配置。
3. 读取 `roleplay/cast.yaml`，确认 player actor 存在。
4. 如需从 SillyTavern 卡迁移设定，再运行 `SillyTavern角色卡导入`。
5. 准备开始 RP 时，切换或创建 `leader.rp` 会话。

## 边界

- 不修改已有 `roleplay/` 文件。
- 不创建完整持久化 session。
- 不自动从 SillyTavern worldbook 生成 actor 配置；第一版只提供可运行模板。
- 不直接启动 `leader.rp`，只准备它要读取的目录。
