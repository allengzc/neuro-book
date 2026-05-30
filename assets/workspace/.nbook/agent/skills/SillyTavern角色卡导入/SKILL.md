---
name: SillyTavern角色卡导入
description: 用于把本地 SillyTavern PNG/JSON 角色卡或预设素材解包并导入当前 Neuro Book project，流程是 inspect 临时 overview、unpack 稳定 reference/silly-tavern 目录、import 从解包目录写入 lorebook。
when_to_use:
  - 用户要求导入、分析、转换 SillyTavern 角色卡、酒馆角色卡、世界书或预设
  - 用户给出 .png、.json、.raw.json 角色卡文件，希望用于当前小说写作或 RP
---

# SillyTavern角色卡导入

用于把本地 SillyTavern 角色卡素材导入当前小说 Project Workspace。默认目标是写作模式可用的基础设定层；RP 模式只是在基础写作层之上追加归档和运行草案。

## 边界

- `inspect` 只输出临时 overview 给 AI/用户查看，不生成文件。
- `unpack` 生成当前 Project Workspace 的 `reference/silly-tavern/{slug}/` 稳定解包目录。
- `import` 从解包目录读取数据，把世界书条目写成当前 Project Workspace 的普通 `lorebook/` 文件。
- 默认只导入稳定文本设定；不执行卡片中的 JavaScript、regex、EJS、MVU、按钮脚本或外部请求。
- 预设 JSON 不当成角色主体导入，只归档和报告。
- 第一版写作导入把 worldbook entry 写入 `lorebook/note` 节点，后续再根据解包报告细拆角色、地点、势力、规则。
- RP 扩展需要显式使用 `--rp`，当前只创建 `roleplay/imports/...` 动态内容归档，不初始化完整 RP 运行目录、不实现 runtime。

## CLI

脚本位置：

```powershell
bun assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/scripts/silly-tavern-card.ts --help
```

常用命令：

```powershell
bun assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/scripts/silly-tavern-card.ts inspect ".agent/workspace/cards/命定之诗/v4.2.1.raw.json"
bun assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/scripts/silly-tavern-card.ts unpack ".agent/workspace/cards/公立育露学园/2.28_v1--reload.raw.json" --project "current-novel" --force
bun assets/workspace/.nbook/agent/skills/SillyTavern角色卡导入/scripts/silly-tavern-card.ts import "reference/silly-tavern/2.28-尝鲜版v1-全裸登校-育露学园的第一天-reload" --project "current-novel" --rp --force
```

默认参数：

- `--project`：当前小说 Project Workspace 根目录，必须包含 `project.yaml`。
- `--out reference/silly-tavern`：`unpack` 的 Project Workspace 内解包输出目录。
- `--force`：允许覆盖脚本生成且未被用户手改的解包/import 文件；默认目标已存在时报错。
- `--rp`：导入时额外生成 `roleplay/imports/silly-tavern/{card}/`。
- `--json`：在 stdout 输出机器可读摘要，便于后续脚本串联。

## 工作流

1. 确认当前小说 Project Workspace。执行脚本时用 `--project` 传 Project Workspace 根目录，例如在 Agent cwd 为 Workspace Root 时传当前项目目录名 `gong-li-yu-lu-xue-yuan`；手工从仓库根执行时传 `workspace/gong-li-yu-lu-xue-yuan`。目标 Project Workspace 根目录必须包含 `project.yaml`，它不在 `.nbook/` 内。
2. 先运行 `inspect`，只看 stdout overview，确认输入是角色卡、预设还是不支持的 JSON；这个阶段不写文件。
3. 运行 `unpack`，生成 `reference/silly-tavern/{card}/`。目录内包含 `raw/card.json`、`overview.md`、`inspect.json`、`worldbook/entries.json`、逐条 frontmatter + 正文格式的 `worldbook/entries/*.md`、`extensions/regex_scripts.json`、逐条 `extensions/regex_scripts/*.json`、`extensions/tavern_helper*.json`、逐条 `extensions/tavern_helper/scripts/*.json`、逐项 `extensions/tavern_helper/variables/*.json` 和 `unpack-report.md`。worldbook 条目会按 `insertion_order` 排序，文件名前缀使用 6 位补零的 `insertion_order`。worldbook 的 frontmatter 会在 `st` 下保留除 `content` 外的原始字段，包括 `keys`、`secondary_keys`、`insertion_order`、`position`、`selective`、`use_regex`、`extensions` 等。
4. 对解包目录运行 `import`。导入命令从解包目录读取 `raw/card.json` 和 `inspect.json`，不再重新从图片或原始 JSON 获取数据。导入后的 lorebook frontmatter 会在 `ext.sillyTavernWorldbook` 下保留同一份 worldbook 元数据。
5. 如果用户明确要 RP 模式，再加 `--rp`，生成 `roleplay/imports/silly-tavern/{card}/` 的动态机制归档。
6. 导入后优先运行 `workspace node validate lorebook/note/...` 检查内容节点。

脚本会在解包目录根部维护一个集中 `generated.json` 指纹清单。重新解包或导入时，`--force` 只覆盖仍匹配指纹的文件；如果用户手改过导入稿，脚本会拒绝覆盖。

## 后续适配

如果 inspect 显示卡片大量依赖 MVU 或 ST-Prompt-Template，先阅读 `docs/research/st-roleplay-tooling.md`。后续优化迁移脚本时，优先增强分类和映射规则，不要把动态运行环境直接搬进 Neuro Book。
