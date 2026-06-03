---
name: SillyTavern角色卡导入
description: 兼容旧中文入口。用于把本地 SillyTavern PNG/JSON 角色卡、世界书或预设素材 inspect、unpack 并导入当前 NeuroBook Project Workspace；新任务优先使用 novel-import-silly-tavern-card。
when_to_use:
  - 用户要求导入、分析、转换 SillyTavern 角色卡、酒馆角色卡、世界书或预设
  - 用户给出 .png、.json、.raw.json 角色卡文件，希望用于当前小说写作或 RP
---

# SillyTavern角色卡导入

这是旧中文兼容入口。新任务优先使用 `novel-import-silly-tavern-card`，本入口保留相同 CLI 和基本边界，避免旧提示、旧文档或旧 Agent 调用失效。

## Use The New Contract

读取并遵守系统 skill：

```text
assets/workspace/.nbook/agent/skills/novel-import-silly-tavern-card/SKILL.md
```

该合同定义当前分类目标、信息控制边界、`simulation-migration/` 迁移候选和 report 审查流程。

## CLI

脚本仍位于旧目录：

```powershell
bun assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/scripts/silly-tavern-card.ts --help
```

常用命令：

```powershell
bun assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/scripts/silly-tavern-card.ts inspect ".agent/workspace/cards/命定之诗/v4.2.1.raw.json"
bun assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/scripts/silly-tavern-card.ts unpack ".agent/workspace/cards/公立育露学园/2.28_v1--reload.raw.json" --project "current-novel" --force
bun assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/scripts/silly-tavern-card.ts import "reference/silly-tavern/2.28-尝鲜版v1-全裸登校-育露学园的第一天-reload" --project "current-novel" --rp --force
```

## Hard Boundaries

- 新导入不再生成旧 `lorebook/rule`；世界规则进入 `lorebook/world/rule/`，系统机制进入 `lorebook/system/`。
- 混合职责条目不自动拆分，进入 `import-report.md` 的 classification review queue。
- 动态 MVU、ST-Prompt-Template、EJS、regex、状态栏/UI 和 Tavern Helper runtime 只归档，不执行。
- `--rp` 只生成 `reference/silly-tavern/{slug}/simulation-migration/`，不创建 `simulation/subjects`、`simulation/entities` 或 `simulation/runs`。
- 导入器不生成 subject-facing `knowledge.md`，避免上帝视角泄露。
