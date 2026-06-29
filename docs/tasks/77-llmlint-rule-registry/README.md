# llmlint Rule Registry

## User Request / Topic

围绕 `llmlint` 的下一阶段规则系统设计：从当前 `static-rules.json` / `llm-rules.json` / `category-suggestions.json` 的分裂结构，升级为可融合多来源规则包的扁平化 Rule Registry。

用户提供了 `.agent/workspace/llmlint_rules/` 作为真实规则样本，包含 Claude / Gemini / deepseek / 通用 / 轻量等多个规则包。样本呈现出“规则包 -> 分类组 -> subRules”的来源形态，但长期设计应转为一条规则一条记录，便于检索、合并、覆盖和用户安装。

## Goal

设计并实现 llmlint 的规则注册表：

1. 规则记录扁平化：一个 lint 规则就是一条独立记录。
2. 支持多个已安装 ruleset，自由组合启用。
3. `id` 全局唯一，用于定位具体规则来自哪个规则包、哪条规则。
4. `namespace` 可重复，用于规则分类、聚合展示和批量覆盖。
5. 不再单独维护 `category` / `subcategory` / `category-suggestions.json`；namespace 承担分类职责。
6. 支持不同规则包向同一个 namespace 追加规则，也支持规则包或用户配置覆盖已有规则。
7. 用户 config 可以自由选择已经安装的 ruleset，并按 namespace 或 rule id 继续覆写。

## Current Decisions

### 2026-06-29 初始设计

**规则身份**
- `id`：全局唯一，定位具体规则。
- `namespace`：非唯一，承担分类、聚合和批量配置职责。
- `ruleset`：可安装、可启用、可组合的规则包来源。
- `category` / `subcategory`：删除，不进入新 schema；如果需要层级分类，用 namespace 字符串表达。

**namespace 语义**
- namespace 不仅能聚合同类规则，也能作为覆盖面。
- 多个规则包可以向同一个 namespace 添加规则，例如 `modifier` 或 `形副词系`。
- 推荐 namespace 使用稳定英文 key；允许中文 namespace 作为导入兼容和本地自用形态。
- 需要 alias / normalization，把常见中文组名映射到稳定英文 key，例如 `形副词系 -> modifier`。
- 同 namespace 不同 id：视为追加规则。
- 同 id：视为覆盖同一条规则，必须提醒用户来源、旧规则与新规则。
- namespace 不负责整组替换；规则融合只按 `id` 判断追加或覆盖。
- namespace 级配置只用于批量启停或调整 level，不改变规则定义本身。

**ruleset 与用户 config**
- 规则包是安装单元；用户 config 只选择已经安装的 ruleset，不直接依赖任意散落 JSON 文件。
- config 可以按 ruleset、namespace、rule id 三层配置。
- 推荐覆盖优先级：rule id override > namespace override > ruleset setting > rule 默认 enabled / level。
- 规则加载需要产出 summary：启用了哪些 ruleset、每个 namespace 聚合了多少规则、发生了哪些覆盖或冲突。

**规则融合**
- 加载顺序由用户 config 中的 `rulesets` 顺序决定。
- 如果后加载 ruleset 定义了新 id，例如已有 `abc.efg.A` / `abc.efg.B`，新包定义 `abc.efg.C`，则 append。
- 如果后加载 ruleset 定义了已有 id，例如再次定义 `abc.efg.A`，则覆盖旧规则，并产生 diagnostics。
- 最终 registry 中同一个 id 只保留最后加载的规则；diagnostics 记录被覆盖规则的来源。

**detector**
- v1 只保留两种：
  - `regex`：确定性定位。
  - `llm`：需要 Agent / LLM 语义判断。
- 规则 registry 的正式格式只接受标准 regex，不支持 `simple` 花括号模板。
- 现有样本里的 `text` 可在导入时 escape 成 regex；`simple` 必须在导入前或导入工具中转换成标准 regex，不能进入 registry。

**action**
- v1 只保留两种：
  - `replace`：提供替换候选。
  - `suggest`：只提示，不提供确定替换。
- 删除类规则用 `replace` 且 `replacements: [""]` 表达；报告层展示为“建议删除”。

**未来扩展**
- 后续可以提供自定义代码段类型，用一个可执行 rule handler 替代 `detector + action`。
- 自定义代码段属于高级扩展，v1 可以先设计 schema，但不急于默认执行；需要清晰的权限、可移植性和安全边界。
- 代码段规则默认不信任第三方 ruleset；用户需要通过 config 显式信任 ruleset 后才能执行。
- handler 沙盒后续优先复用项目内已有沙盒能力；第一版不实现 handler 执行，只保留设计方向。

## Candidate Record Shape

```typescript
type LintRuleRecord = DeclarativeRuleRecord | HandlerRuleRecord;

type BaseLintRuleRecord = {
    id: string;
    namespace: string;
    ruleset: string;
    title: string;
    level: "high" | "medium" | "low";
    enabled?: boolean;
    note?: string;
    examples?: Array<{
        bad: string;
        good?: string;
        reason?: string;
    }>;
    source?: {
        version?: string;
        importedFrom?: string;
    };
};

type DeclarativeRuleRecord = BaseLintRuleRecord & {
    detector:
        | {type: "regex"; targets: string[]; flags?: string}
        | {type: "llm"; prompt: string};
    action:
        | {type: "replace"; replacements: string[]}
        | {type: "suggest"; message: string};
};

type HandlerRuleRecord = BaseLintRuleRecord & {
    handler: {
        type: "module";
        path: string;
        export?: string;
    };
};
```

handler API 第一版保持很小，只允许检查文本并返回 issue，不直接写文件：

```typescript
type LintRuleHandler = {
    meta?: {
        description?: string;
        deterministic?: boolean;
    };
    check(input: LintRuleHandlerInput): Promise<LintRuleIssue[]>;
};

type LintRuleHandlerInput = {
    text: string;
    filePath: string;
    rule: HandlerRuleRecord;
    options: {
        cwd: string;
    };
};

type LintRuleIssue = {
    ruleId: string;
    namespace: string;
    message: string;
    level?: "high" | "medium" | "low";
    range?: {
        start: number;
        end: number;
    };
    suggestions?: Array<{
        title: string;
        replacement?: string;
    }>;
};
```

安全约束：
- `handler.path` 必须是 ruleset 内部相对路径，不能通过 `..` 跳出 ruleset。
- handler 不获得 shell、写文件能力或 Agent 工具，只接收文本和规则元数据。
- 未被用户信任的 ruleset 中如果包含 handler rule，加载时跳过并产生 warning。
- handler rule 返回 suggestion，不直接修改文件。
- 后续真正执行第三方 handler 前，需要补充 sandbox / trust / deterministic policy。

## Candidate Config Shape

```typescript
type LlmlintConfig = {
    rulesets: string[];
    trustedRulesets?: string[];
    rulesetOverrides?: Record<string, "off" | "on">;
    namespaces?: Record<string, "off" | "low" | "medium" | "high">;
    rules?: Record<string, "off" | "low" | "medium" | "high">;
};
```

示例：

```typescript
export default {
    rulesets: [
        "builtin/default",
        "community/claude-daily",
        "user/local-overrides",
    ],
    trustedRulesets: [
        "user/local-overrides",
    ],
    namespaces: {
        modifier: "medium",
        "vocabulary.r18": "off",
    },
    rules: {
        "community.claude.daily.remove-empty-modifier-shell": "off",
    },
};
```

## Compatibility Notes

- 实现前 `llmlint` 的 `presets` / `customRules.static` / `customRules.llm` 是过渡结构；本任务已迁移到 `rulesets` + flat rule records。
- 现有 `static-rules.json` 与 `llm-rules.json` 可迁移为同一 `rules.jsonl` 或 `rules.json`。
- 现有 `.agent/workspace/llmlint_rules` 中的 `text` / `simple` / `regex` 三类来源格式，应先归一化为标准 regex；registry 内不保留 `simple` mode。
- 样本规则中 `simple` 数量较多，导入器必须负责把花括号候选表达式转换为标准 regex；转换失败时不能静默丢弃，必须产生 diagnostics。
- 样本规则中存在 `/.../g` 形式的 JavaScript regex literal，导入器需要解析为 `pattern + flags`；scanner 也需要支持 rule detector 自带 flags，而不是固定追加 `g`。
- 样本规则中存在 `enabled: false` 的组和“可选”组，导入时应保留为规则默认 enabled 状态或 ruleset profile metadata，不能默认全部启用。
- 样本规则中 `replacements: []` 表示删除，迁移为 `action: {type: "replace", replacements: [""]}`；多个 replacements 表示多个候选替换。
- 现有 `category-suggestions.json` 不作为独立文件继续扩展；其中有价值的建议迁移到具体 rule 的 `action` / `note` / `examples`。
- handler rule 是新能力，不从现有 `.agent/workspace/llmlint_rules` 样本直接推导；它服务于未来复杂规则扩展。
- 第一版迁移不实现 handler 执行，避免在 rule registry 迁移时引入沙盒与信任边界风险。

## Code Feasibility Audit

### 2026-06-29 代码调研结论

实现前代码适合迁移到 Rule Registry：

- `src/rules.ts` 已经使用 `Map<string, Rule>` 以 `id` 为键合并规则，和新设计里的 append / override 语义接近。
- 当前 static / llm 分成两个集合，导致同 id 跨类型覆盖需要互相删除；新 registry 应统一为单一 `LintRuleRecord` 集合，再由 detector 类型分流到 scanner 或 LLM 审查输出。
- `src/config.ts` 当时只支持 `presets`、`customRules`、`rules`；现已迁移到 `rulesets`、`trustedRulesets`、`rulesetOverrides`、`namespaces`、`rules`。
- `src/scanner.ts` 当前只扫描 `StaticRule.pattern`，且固定 `new RegExp(rule.pattern, "g")`；新 scanner 需要读取 `detector.type === "regex"` 的 `targets` 和 `flags`。
- `src/reporter.ts` 当前报告结构只面向 static issue 和 LLM rule 列表；新 reporter 需要输出 registry diagnostics，例如 ruleset 覆盖、handler 跳过、导入转换失败、namespace alias 命中。
- `SKILL.md`、`references/cli-usage.md`、`references/workflow.md` 和 `llmlint.config.example.ts` 当时仍是旧 `presets/customRules` 口径；现已同步到新 ruleset registry 口径。
- `bun vitest run server/agent/skills/llmlint.test.ts server/agent/skills/skill-catalog.test.ts` 当前通过，可作为迁移前基线。
- `bun run typecheck` 当前失败集中在 llmlint：`.ts` extension import 与全仓 tsconfig 不匹配，以及 reporter 数组索引 strict undefined。registry 重构应顺手修复这些类型问题，避免把新设计建立在已知 typecheck 债上。

### Assets / Catalog Audit

- `SkillCatalog` 已硬切隐藏 `anti-ai-slop` key，并能列出 `llmlint`。
- 系统 assets 同步会递归同步 `.nbook` 下非黑名单文件，新增 `rulesets/**`、alias 表、ruleset metadata、导入说明文件都可被同步。
- 实现前 deleted managed assets 清单尚未包含 `agent/skills/anti-ai-slop/` 前缀；现已补充 deleted prefix 与对应测试。

## Implementation Acceptance Checklist

- 默认无 config 时加载 builtin ruleset，行为不低于现有 `anti-ai-slop` preset。
- `rulesets` 按配置顺序加载；新 id append，同 id override，并产出 diagnostics。
- 同 namespace 不同 id 可来自不同 ruleset，并在 summary 中聚合统计。
- `namespaces` 覆盖只影响 enabled / level，不修改规则定义。
- `rules` 覆盖优先级高于 namespace 和 ruleset。
- `regex` detector 支持多个 targets、标准 flags、regex literal 导入归一化。
- `llm` detector 能被 `show-llm-rules` 或新等价命令完整展示。
- `replace` action 支持删除、单候选替换、多候选替换；`suggest` action 支持纯提示。
- handler rule 第一版只校验 / 跳过 / warning，不执行第三方代码。
- 迁移后全仓 `bun run typecheck` 不再因 llmlint 失败。
- assets 同步测试覆盖 `rulesets/**` 文件复制，以及受管旧 `agent/skills/anti-ai-slop/` 清理。

## User / Agent Path Acceptance

最后需要按真实使用路径做一轮验收，而不是只跑模块单测：

### 用户路径

1. 用户在 Project Workspace 内创建 `llmlint.config.ts`，只选择已安装 ruleset。
2. 用户运行 `bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <file>`，能看到 static regex issue、规则来源、namespace、level 和替换建议。
3. 用户运行 LLM 规则展示命令，能理解哪些规则需要 Agent 全文审查。
4. 用户关闭某个 namespace、关闭某条 rule、调整某条 rule level 后，CLI 输出符合配置。
5. 用户启用多个 ruleset，遇到同 id 覆盖时能看到明确 warning：哪个 ruleset 覆盖了哪个 ruleset 的哪条 rule。
6. 用户使用中文 namespace alias 或稳定英文 namespace key，配置结果一致且可解释。
7. 维护者重建官方默认 ruleset 时，生成报告能说明转换了多少 `text` / `simple` / `regex`，跳过了哪些失败规则。

### Agent 路径

1. Skill catalog 中只出现 `llmlint`，不出现系统 `anti-ai-slop`。
2. Agent 读取 `SKILL.md` 后，会按新 ruleset 配置说明执行，不再推荐 `presets/customRules`。
3. Agent 的 workflow 文档明确区分 CLI 候选定位、LLM 语义审查、用户审批式修复。
4. Agent 使用 `show-llm-rules` 或后续等价命令时，能把 `llm` detector 规则转化为本轮审查清单。
5. Agent 在修复计划里引用 rule id、namespace、ruleset source，方便用户追踪“这个建议从哪里来”。
6. Agent 遇到 diagnostics 时会向用户解释：覆盖是正常机制，warning 是提醒来源变化，不等同于执行失败。
7. Agent 文档、profile routing、draft testing guide、Task 51 walkthrough 中的命令和配置示例全部同步到新口径。

## Open Questions

- 覆盖提醒第一版落在 CLI stylish 的“规则加载提示”和 JSON report 的 `diagnostics` 字段；暂不新增 `llmlint rules explain`。
- namespace alias/normalization 第一版内置常见中文组名映射，后续可继续从用户 ruleset 中扩展。

## Implementation Log

### 2026-06-29 Rule Registry 实现

已完成：

- `src/types.ts` 改为 flat `LintRuleRecord` / `DeclarativeRuleRecord` / `HandlerRuleRecord` 类型。
- `src/config.ts` 改为 `rulesets`、`trustedRulesets`、`rulesetOverrides`、`namespaces`、`rules` 配置。
- `src/rules.ts` 实现 ruleset loader、namespace alias、同 id override diagnostics、ruleset / namespace / rule 覆盖优先级和 registry summary。
- `src/scanner.ts` 改为扫描 `regex` detector，支持多个 targets 和 detector flags。
- `src/reporter.ts` 在 stylish / JSON 中输出 ruleset、namespace、registry summary 和 diagnostics。
- `.agent/workspace/llmlint_rules` 仅作为内置默认规则集的策展素材，不提供公开单文件导入入口。
- `curated-import` 作为内部模块用于重建官方默认 ruleset，不作为用户 CLI 能力。
- 默认规则迁移到 `rulesets/builtin/default/ruleset.json` 与 `rules.json`，删除旧 `presets/anti-ai-slop/*.json` 分裂规则文件。
- `llmlint.config.example.ts`、`SKILL.md`、`references/cli-usage.md`、`references/workflow.md`、`references/patterns.md` 同步到新口径。
- 系统 assets 同步新增 `agent/skills/anti-ai-slop/` deleted prefix，清理未手改旧副本。
- Task 51 walkthrough 与 `PROJECT-STATUS.md` 更新当前状态。

计划出入：

- 原设计说 handler 第一版“保留 schema，不执行”。实现中对 handler rule 做校验和 warning，但不进入 active registry，也不执行第三方代码。
- 原设计曾讨论过单文件导入；当前硬切为只保留官方默认规则集策展生成，不提供旧格式兼容入口。
- `category-suggestions.json` 未迁移为独立资源；相关建议已收敛进 rule `note` / `action` / `examples`。

验证结果：

- `bun vitest run server/agent/skills/llmlint.test.ts server/agent/skills/skill-catalog.test.ts`：通过。
- `bun run typecheck`：通过。
- `bun vitest run server/workspace-files/workspace-files.test.ts -t "同步系统 assets 会管理 Agent skills、模板和 CLI 辅助文件"`：通过。
- `bun vitest run server/workspace-files/workspace-files.test.ts -t "同步系统 assets 会清理未手改的旧 anti-ai-slop skill 副本"`：通过。
- `bun assets/workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts check docs/tasks/77-llmlint-rule-registry/README.md`：通过，输出 no problems。
- `bun assets/workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts show-llm-rules`：通过，输出 8 条 LLM detector 规则。
- 内部 `importCuratedRulesets()`：通过，生成官方默认 ruleset。
- `bun vitest run server/workspace-files/workspace-files.test.ts -t "同步系统 assets"`：超时；已改跑本轮相关的两个精确同步用例，均通过。

### 2026-06-29 中文规则样本策展合并

已完成：

- 新增 `src/curated-import.ts`，用于读取 `.agent/workspace/llmlint_rules/*.json`，并与人工基础规则一起生成官方默认 ruleset。
- 新增内部 `curated-import` 模块，用于读取 `.agent/workspace/llmlint_rules/*.json` 并重建官方默认 ruleset。
- 新增内置 ruleset：`builtin/default`。
- 默认配置改为只启用 `builtin/default`。
- `builtin/default` 合并原人工 anti-ai-slop 规则与中文策展规则，默认包含并启用 R18 / 成人词汇规则；用户可用 `namespaces: {"vocabulary.r18": "off"}` 关闭。
- 重复规则按 namespace + canonical regex targets + flags 去重；同 target 不同 replacements 合并为候选并集。
- 中文 rule id 改用显式英文语义 slug：`cn.<namespace>.<semantic-slug>`，不再暴露 hash，例如 `cn.vocabulary.body.skull-head`。
- 正式 rule schema 不记录旧格式来源结构；生成报告只保留转换计数、跳过项、合并计数等审计信息。
- rule `source.canonicalKey` 记录内部 canonical detector key，供策展生成器去重与追踪使用。
- namespace alias 扩展到策展样本中的中文组名。
- `src/namespaces.ts` 统一维护中文组名 alias，生成器与运行时 loader 共享同一份映射，避免后续漂移。
- `src/base-rules.ts` 保存人工维护的基础规则；`src/curated-slugs.ts` 保存中文规则 canonical key 到语义 slug 的显式映射，缺失时生成失败。

生成结果：

- 源文件数：11。
- 生成时处理 target 记录：533。
- 去重后最终 rule id：292（27 条人工基础规则 + 265 条中文策展规则）。
- `builtin/default`：292 rules，263 active。

计划出入：

- 策展素材源文件 `.agent/workspace/llmlint_rules` 保留，不删除。
- 旧单文件导入入口已硬切删除；官方默认规则集生成只保留内部模块路径。
- 曾短暂实现 `cn-light` / `cn-standard` / `cn-strong` / `cn-extreme` 四档方案；按用户反馈“取其精华合并成一个规则集”收敛为单一 `builtin/cn`，不再暴露四档内置 ruleset。
- 随后按用户反馈继续把 `builtin/anti-ai-slop` 与 `builtin/cn` 合并为单一 `builtin/default`，不保留两个旧公开入口。
- 高风险组名包含 `[可选]`、`[选开]`、`冲突` 时默认 disabled；`极其杀手.json` 来源默认 disabled；`builtin/default` 的 `vocabulary.r18` 按本轮决策强制启用。

验证结果：

- `bun vitest run server/agent/skills/llmlint.test.ts server/agent/skills/skill-catalog.test.ts`：通过，包含默认 `builtin/default`、语义 slug、缺失 slug 映射失败、LLM rules 输出等断言。
- `bun run typecheck`：通过。
- `bun vitest run server/workspace-files/workspace-files.test.ts -t "同步系统 assets 会管理 Agent skills、模板和 CLI 辅助文件"`：通过，确认 `agent/skills/llmlint/rulesets/builtin/default/ruleset.json` 会同步。
- `bun vitest run server/workspace-files/workspace-files.test.ts -t "同步系统 assets 会清理未手改的旧 anti-ai-slop skill 副本"`：通过。
- `bun vitest run server/workspace-files/workspace-files.test.ts -t "同步系统 assets 会清理未手改的旧 llmlint 内置 ruleset 副本"`：通过。
- `bun assets/workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts check .agent/workspace/test-llmlint-default.md`：通过，默认加载 `builtin/default` 并命中 `cn.vocabulary.body.skull-head` 等中文规则，输出 ruleset、namespace、level 与替换候选。
- `bun assets/workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts show-llm-rules`：通过，输出合并进 `builtin/default` 的 8 条 LLM detector 规则。
- 内部 `importCuratedRulesets()` 临时输出验证：通过，复现单一 `builtin/default` ruleset 统计：533 target、292 unique rules、263 active、9 个 replacement merge；临时验证输出已清理。

### 2026-06-29 去除旧格式兼容字段硬切

已完成：

- 正式 rule schema 删除旧格式来源数组，`rules.json` 不再携带旧文件、旧组名、旧 mode、原始 target、原始 enabled 等结构。
- 删除公开单文件导入模块和 CLI 入口；`.agent/workspace/llmlint_rules` 只作为官方默认规则集的策展素材。
- `curated-import` 内部命名改为 source / curated 语义，生成的 `builtin/default` 规则看起来是 llmlint 原生规则。
- loader 遇到已移除的旧格式来源字段会报错，避免旧结构重新进入规则文件。
- `SKILL.md`、CLI reference、patterns、Task 51 和 `PROJECT-STATUS.md` 已同步到硬切口径。
- 旧入口收尾继续删除 `import-curated` CLI 和 `llmlint <file>` 兼容用法；CLI 只保留 `check <file>` 与 `show-llm-rules`。

验证目标：

- `rulesets/builtin/default/rules.json` 不包含旧格式来源字段。
- 内部 `importCuratedRulesets()` 仍能生成 292 条官方默认规则，并保留转换计数、跳过项和合并计数报告。
- 用户配置仍只面向 `rulesets`、`namespaces`、`rules`。

### 2026-06-29 硬切审查与遗漏修复

已完成：

- 删除公开 `import-legacy` / `legacy-import` 残留入口；CLI 帮助只保留 `check <file>` 与 `show-llm-rules`。
- 系统 assets 删除清单补充 `agent/skills/llmlint/src/legacy-import.ts`，同步时会清理未手改的旧受管副本。
- 复查公开内置 ruleset：系统 assets 中只保留 `rulesets/builtin/default/`，旧 `builtin/anti-ai-slop` 与 `builtin/cn` 只在清理代码、清理测试和历史 walkthrough 中出现。
- 更新当前测试指南和 Task 51 当前状态，避免继续把当前 CLI 称为 Anti-AI-Slop 或把默认 ruleset 写成旧入口。
- 修复 `llmlint.test.ts` 中非法 source schema 测试的类型绕过：正常 ruleset fixture 继续使用 `LintRuleRecord`，非法 JSON fixture 通过 `writeRawRuleset()` 写入。

验证结果：

- `bun vitest run server/agent/skills/llmlint.test.ts server/agent/skills/skill-catalog.test.ts`：通过。
- `bun vitest run server/workspace-files/workspace-files.test.ts -t "同步系统 assets 会清理未手改的旧 llmlint 受管文件"`：通过。
- `bun vitest run server/workspace-files/workspace-files.test.ts -t "同步系统 assets 会管理 Agent skills、模板和 CLI 辅助文件"`：通过。
- `bun run typecheck`：通过。
- `bun assets/workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts --help`：通过，未显示旧导入命令或裸文件参数入口。
- `bun assets/workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts show-llm-rules --format json`：通过，默认 registry 为 `builtin/default`，292 rules / 263 active。
- `bun assets/workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts check docs/tasks/77-llmlint-rule-registry/README.md`：通过执行并命中新默认规则，证明真实 CLI 路径会加载 `builtin/default`。

### 2026-06-29 用户侧 llmlint 半同步状态修复

问题：

- 更广审查发现系统源 `assets/workspace/.nbook/agent/skills/llmlint/` 已硬切，但真实用户侧 `workspace/.nbook/agent/skills/llmlint/` 仍处于半新半旧状态。
- 用户侧 `src/cli.ts` 还引用已删除的 `legacy-import.ts`，导致 `bun workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts --help` 直接失败。
- 用户侧还残留旧 `presets/anti-ai-slop/` 和短暂四档 `cn-light` / `cn-standard` / `cn-strong` / `cn-extreme` ruleset，污染“已安装规则集”心智。

已完成：

- 扩展 user-assets deleted prefix：补充 `agent/skills/llmlint/presets/` 和旧四档 `rulesets/builtin/cn-*`。
- 同步逻辑新增硬切旧官方目录扫描：只清理 llmlint 旧官方前缀；有 sync state 且用户已手改的文件仍保留并 warning；无 sync state 的旧官方残留会被清理。
- 扩展同步测试：覆盖旧 presets、旧 `builtin/cn`、旧四档 `cn-*`、旧 `cli.ts` / `rules.ts` 被系统源覆盖，以及用户侧真实 `llmlint --help` 可运行。
- 执行 `bun scripts/build/prepare-system-assets.ts --sync-user-assets --force-sync-user-assets`：更新 10 个受管 assets，把真实用户侧 llmlint 拉齐到系统源。
- 当前用户侧公开内置 ruleset 只剩 `rulesets/builtin/default/`。

验证结果：

- `bun vitest run server/workspace-files/workspace-files.test.ts -t "旧 llmlint"`：通过。
- `bun vitest run server/workspace-files/workspace-files.test.ts -t "同步系统 assets 会管理 Agent skills、模板和 CLI 辅助文件"`：通过。
- `bun vitest run server/agent/skills/llmlint.test.ts server/agent/skills/skill-catalog.test.ts`：通过。
- `bun workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts --help`：通过，只显示 `check` 和 `show-llm-rules`。
- `bun workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts show-llm-rules --format json`：通过，默认 registry 为 `builtin/default`，292 rules / 263 active。

## References

- 当前 llmlint skill：`assets/workspace/.nbook/agent/skills/llmlint/`
- 当前历史任务：[51 anti-ai-slop / llmlint skill](../51-anti-ai-slop-skill/README.md)
- 用户规则样本：`.agent/workspace/llmlint_rules/`
