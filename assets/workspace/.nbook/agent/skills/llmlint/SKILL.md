---
name: llmlint
description: Lint and polish LLM-generated Chinese text by detecting template-like wording, AI writing tells, hollow summaries, rhythm issues, and rule-driven style problems. Use when the user asks to polish text, check whether writing feels AI-like, lint LLM output, review prose naturalness, or configure llmlint rules.
when_to_use:
  - 用户请求润色文本、检查 AI 味、优化自然度或审查套路化表达
  - 用户显式提到 llmlint、文本 lint、LLM 输出规范或规则配置
  - 用户提供 Markdown / 纯文本文件并要求生成修复计划或改写建议
metadata:
  author: NeuroBook Team
  version: 2.0.0
---

# llmlint

llmlint 是面向 LLM 输出的文本 lint skill。CLI 负责稳定、可复现的候选定位；Agent 负责结合语境做语义审查、评分、修复计划和用户审批式改写。

## Quick Start

检查文件中的 regex detector 候选：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <文件路径>
```

显示需要 Agent 主动全文审查的 LLM rules：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts show-llm-rules
```

指定配置文件：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts --config llmlint.config.ts check <文件路径>
```

输出 JSON：

```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts --format json check <文件路径>
```

## Workflow

1. 获取输入文本：用户给路径时直接使用；用户粘贴文本时写入 `.agent/polish-input.md`。
2. 运行 `check`：读取 regex detector 命中项。命中只代表候选，不代表必须修复。
3. 运行 `show-llm-rules`：逐条阅读全文审查 llm detector 规则，并记录“未发现候选 / 建议修复 / 建议保留 / 需要确认”。
4. 完成快速审查评分：Directness、Rhythm、Trust、Authenticity、Density 各 1-10 分，总分 50。
5. 生成 `.agent/polish-plan.md`：统计、评分、修复详情、不确定项和建议。
6. 用户审批后执行修复：默认写入 `.agent/polish-output.md`；只有用户明确要求时才改原文件。
7. 输出报告：总候选数、已修复、保留原因、评分变化和输出位置。

## Config

默认启用 `builtin/default` ruleset。它合并了人工维护的 anti-ai-slop 规则与中文规则样本的策展结果，已包含 R18/成人词汇规则；普通项目可用 `namespaces: {"vocabulary.r18": "off"}` 关闭。

项目可放置 `llmlint.config.ts`：

```typescript
export default {
    rulesets: [
        "builtin/default",
    ],
    trustedRulesets: [],
    rulesetOverrides: {},
    namespaces: {
        modifier: "medium",
        "vocabulary.r18": "off",
        "商务黑话": "off",
    },
    rules: {
        "filler-word-actually": "warn",
        "firstly-secondly": "error",
        "filler-lets": "off",
    },
    output: "stylish",
};
```

`rulesets` 是安装和启用单元；配置只能选择已经安装在 `rulesets/` 下的规则包。同 namespace 不同 id 会追加；同 id 会由后加载的 ruleset 覆盖前者，并产生 diagnostics。官方推荐入口是 `builtin/default`。

覆盖优先级：rule id > namespace > ruleset > rule 默认 enabled / level。namespace 负责分类和批量开关，rule id 负责精确定位和覆盖。namespace 推荐使用稳定英文 key，也支持内置中文 alias，例如 `商务黑话` 会归一到 `jargon.business`。

规则覆盖值：
- `off`：禁用该规则
- `warn`：作为 medium 级别
- `error`：作为 high 级别
- `low` / `medium` / `high`：直接指定级别

## Judgment Rules

- High：强烈建议修复，但仍需确认语境；技术步骤或报告提纲可能合理。
- Medium：读取前后文后判断；对话口癖、人物声音、引用和讽刺可能应保留。
- Low：默认保留，除非明显降低密度、自然度或可信度。
- 不熟悉专有名词、同人梗、科幻设定、历史事实或领域知识时，先调研再判断。
- 不要为了消除“AI 味”把作者风格、角色声音或有效文体特征磨平。

## References

- [CLI 详细使用说明](references/cli-usage.md)
- [中文文本润色模式库](references/patterns.md)
- [完整流程详解](references/workflow.md)
