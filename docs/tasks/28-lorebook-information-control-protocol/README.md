# Lorebook Information Control Protocol Task

## User Request

- 新建 `Lorebook Information Control Protocol` 任务。
- 第一步先设计内容类型层：基于当前 novel lorebook 模板、SillyTavern 导入分类，以及 `命定之诗与黄昏之歌` 的大型 worldbook 条目，找到一套通用、常用、不过度碎片化的 lorebook 类型划分。
- 协议目标是支持“信息分离控制”的 lorebook 条目，而不是像普通 lorebook 一样只写上帝视角全文。
- 协议正文应写给 AI 和作者使用，不长期留在 task walkthrough 里。

## Outcome

Lorebook 协议正文已迁出 task walkthrough，进入稳定内容规范：

- [../../../spec/content/lorebook-information-control.md](../../../spec/content/lorebook-information-control.md)

本 task 只保留需求、决策摘要、变更记录和后续 TODO。

## Decisions

- lorebook 定位为“给 AI 的作品说明书”。
- 第一版只收敛内容类型层和目录层；信息控制 frontmatter、正文分区和 GraphRAG 边后续再设计。
- 默认顶层目录为 `world / character / location / faction / item / event / system`，外加 `lorebook/index.md`。
- 支持扩展类型 `species / creature / organization / instruction`，但不默认生成顶层目录。
- 不再把 `relationship`、`rule`、`note`、`formatting`、`dynamic-mvu`、`dynamic-prompt` 作为稳定 lorebook 协议类型。
- 当前兼容 `spec/content/state.md` 的 lorebook 同级 `state.md`；但 RP actor 主观状态、心智和个人 knowledge 不进入 lorebook，后续逐步减少并迁出 lorebook 下的动态状态。
- `instruction` 作为作品级 AI 使用说明继续保留，并细分为 `style / narration / boundary / disclosure / retrieval / formatting / continuity` 等推荐 subtype。
- 信息控制模型暂不展开 schema，只保留后续设计入口。

## Follow-ups

- 设计 lorebook information control frontmatter schema。
- 设计正文分区规范，例如 `Public Canon`、`Actor Safe Summary`、`GM Secrets`、`Writer Notes`。
- 更新 workspace-files lorebook type 校验，支持默认类型和受支持扩展类型，移除 `rule` / `note` 作为正式协议类型的长期目标。
- 更新 novel directory template，新增 `lorebook/index.md`，并把 `story-concept`、`synopsis`、`project-positioning`、`initial-plot-seed` 从默认 lorebook 节点迁出或降级为 planning 材料。
- 更新 SillyTavern 导入映射：`event -> lorebook/event`，`system -> lorebook/system`，世界规则进入 `world/rule`，种族/组织/生物按项目目录策略进入默认子目录或提升目录。
- 后续逐步迁出 lorebook 同级 `state.md`，并复核 writer 读取同级 `state.md` 的合同。
- 为 actor context-load sidecar 设计基于 knowledge declaration 的过滤策略。
- 为 GraphRAG 设计 `who knows what` 的边类型和知识层级。

## Files Changed

- `docs/tasks/28-lorebook-information-control-protocol/README.md`
- `spec/content/lorebook-information-control.md`
- `spec/README.md`
- `PROJECT-STATUS.md`

## Verification

- 已阅读当前 novel lorebook template、workspace-files lorebook type 校验、SillyTavern 导入分类，以及 `命定之诗与黄昏之歌` worldbook 条目样本。
- 本次只更新设计文档，未运行代码测试。
