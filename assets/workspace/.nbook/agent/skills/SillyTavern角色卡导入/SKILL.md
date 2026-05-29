---
name: SillyTavern角色卡导入
description: 用于把本地 SillyTavern PNG/JSON 角色卡或预设素材导入当前 Neuro Book project，先生成 inspect，再把稳定设定整理到 reference/silly-tavern 与 lorebook，RP 内容作为可选 roleplay 扩展归档。
when_to_use:
  - 用户要求导入、分析、转换 SillyTavern 角色卡、酒馆角色卡、世界书或预设
  - 用户给出 .png、.json、.raw.json 角色卡文件，希望用于当前小说写作或 RP
---

# SillyTavern角色卡导入

用于把本地 SillyTavern 角色卡素材导入当前小说 Project Workspace。默认目标是写作模式可用的基础设定层；RP 模式只是在基础写作层之上追加归档和运行草案。

## 边界

- 默认输出到当前 Project Workspace 的 `reference/silly-tavern/` 和 `lorebook/`。
- 默认只导入稳定文本设定；不执行卡片中的 JavaScript、regex、EJS、MVU、按钮脚本或外部请求。
- 预设 JSON 不当成角色主体导入，只归档和报告。
- 第一版写作导入生成聚合 `lorebook/note` 节点，后续再根据 inspect 结果细拆角色、地点、势力、规则。
- RP 扩展需要显式使用 `--rp`，当前只创建 `roleplay/imports/...` 动态内容归档，不初始化完整 RP 运行目录、不实现 runtime。

## CLI

脚本位置：

```powershell
bun assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/scripts/silly-tavern-card.ts --help
```

常用命令：

```powershell
bun assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/scripts/silly-tavern-card.ts inspect ".agent/workspace/cards/命定之诗/v4.2.1.raw.json" --workspace "current-novel" --force
bun assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/scripts/silly-tavern-card.ts import ".agent/workspace/cards/公立育露学园/2.28_v1--reload.raw.json" --workspace "current-novel" --rp --force
```

默认参数：

- `--out reference/silly-tavern`：workspace 内原始素材、inspect 和导入报告目录。
- `--force`：允许覆盖脚本生成且未被用户手改的 inspect/import 文件；默认目标已存在时报错。
- `--rp`：导入时额外生成 `roleplay/imports/silly-tavern/{card}/`。
- `--json`：在 stdout 输出机器可读摘要，便于后续脚本串联。

## 工作流

1. 确认当前小说 Project Workspace。Agent cwd 是 Workspace Root `workspace/`，执行脚本时 `--workspace` 优先传当前项目目录名，例如 `gong-li-yu-lu-xue-yuan`；手工从仓库根执行时可以传 `workspace/gong-li-yu-lu-xue-yuan`。目标 Project Workspace 根目录必须包含 `project.yaml`，它不在 `.nbook/` 内。
2. 先运行 `inspect`，确认输入是角色卡、预设还是不支持的 JSON。
3. 检查 `inspect.md` 中的 worldbook、MVU、EJS、`@INJECT`、`@@if`、regex 和 tavern_helper 统计。
4. 对角色卡运行 `import`。默认只写 `reference/silly-tavern/{card}/` 和 `lorebook/note/silly-tavern-{card}/`。
5. 如果用户明确要 RP 模式，再加 `--rp`，生成 `roleplay/imports/silly-tavern/{card}/` 的动态机制归档。
6. 导入后优先运行 `workspace node validate project-slug/lorebook/note/silly-tavern-{card}` 检查内容节点。脚本 stdout 和 import-report 中的写入路径已经是 Agent cwd 可直接读取的 `project-slug/...` 形式。

脚本会为每个生成文件写入邻近 `.generated.json` 指纹。重新导入时，`--force` 只覆盖仍匹配指纹的文件；如果用户手改过导入稿，脚本会拒绝覆盖。

## 后续适配

如果 inspect 显示卡片大量依赖 MVU 或 ST-Prompt-Template，先阅读 `docs/research/st-roleplay-tooling.md`。后续优化迁移脚本时，优先增强分类和映射规则，不要把动态运行环境直接搬进 Neuro Book。
