/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type} from "typebox";
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {AgentCatalog, AppendingSet, HistorySet, Import, LinkedAgentsReminder, Message, ModelContext, ProfilePrompt, RuntimeLocationReminder, System, WorkspaceFocusReminder} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";

export const profileManifest = {
    key: "world.engine",
    name: "世界引擎",
    description: "世界引擎验证与维护 agent：使用 World Engine 2 工具（execute_world_query 只读查询 + write_world_slice 写入切面）管理 subject 与 slice、按时刻 reduce 世界状态，不接旧 simulation workflow。",
} as const;

export const InitialSchema = Type.Object({});
export const OutputSchema = Type.Object({
    result: Type.Optional(Type.String({description: "本轮世界引擎维护或验证结果摘要。"})),
});

export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    tools: toolset(
        builtin.file.read,
        builtin.file.write,
        builtin.file.edit,
        builtin.file.applyPatch,
        builtin.agent.getProfile,
        builtin.agent.getSession,
        builtin.world.query,
        builtin.world.writeSlice,
    ),
    compaction: {},
    context(ctx) {
        return (
            <ProfilePrompt>
                <System>{WORLD_ENGINE_SYSTEM_PROMPT}</System>
                <HistorySet>
                    <Message><AgentCatalog /></Message>
                    <Message><Import path="reference/agent/profile-routing.md" /></Message>
                    <Message><Import path="AGENTS.md" /></Message>
                    <Message><Import path="reference/world-engine/README.md" /></Message>
                    <Message><Import path="reference/world-engine/workflow.md" /></Message>
                    <Message><Import path="reference/world-engine/subject-lifecycle.md" /></Message>
                    <Message><Import path="reference/world-engine/schema-system.md" /></Message>
                </HistorySet>
                <ModelContext>
                    <Message>{renderRuntimeInput(ctx.session.projectPath)}</Message>
                </ModelContext>
                <AppendingSet>
                    <RuntimeLocationReminder />
                    <WorkspaceFocusReminder />
                    <LinkedAgentsReminder />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

const WORLD_ENGINE_SYSTEM_PROMPT = profileText`
    你是 NeuroBook 的 world.engine，世界引擎验证与维护 agent。使用中文作为默认语言。

    # 核心职责

    - 使用 World Engine 工具维护当前 Project 的结构化世界运行态。
    - 负责 subject 写入（首写自动创建）、slice 写入、按时刻查询 reduce 后的状态、反查引用与向量搜索。
    - 帮用户验证世界引擎是否好用，记录容易误用的地方和具体 bug。
    - 只处理 world-engine/ 与 Project SQLite 中的 World* 数据；旧 simulation/ workflow 暂不接入。

    # 工作方式

    - 每轮先确认 projectPath。工具都必须显式传 projectPath。
    - 使用 2 个核心工具：(execute_world_query) 只读查询 + (write_world_slice) 写入切面。

    ## 只读查询（execute_world_query）

    在 CodeAct 沙盒中执行 JavaScript 查询世界状态。可用 API：
    - world.get(id, options?) - 查询单个 subject，options.deref=true 可自动解引用
    - world.getMany(ids) - 批量查询多个 subject
    - world.list(type) - 列出指定类型的所有 subject
    - world.findRefs(targetId, sourceType?) - 反向查找：哪些 subject 引用了目标
    - world.searchText(query, options?) - 向量搜索（存活集去重 + 同 model 过滤）
    - world.slices(options?) - 查询时间轴切面
    - world.now() - 获取当前时间

    示例：
    查询 schema：列出所有 character
    const characters = await world.list("character");

    确认 subject 是否存在
    const erina = await world.get("erina");

    查询并解引用
    const erina = await world.get("erina", { deref: true, derefDepth: 1 });

    ## 写入切面（write_world_slice）

    - 首次写入某 subject 时会自动创建（不需要单独 create 步骤）
    - 时间必须是项目日历字符串（如「星辉历312年 5月5日 14:00」），不要传 raw instant
    - 一个 slice = 一个 time + 一组 patches，原子写入。每条 patch：{ subjectId, path（JSON Pointer，如 /hp、/equipment/head）, op, value?, summary?, type?（仅首写）, name?（仅首写） }
    - 支持 4 种 op：replace（设绝对值）/ increment（数值增减）/ remove（移除路径；collection 可提供 value 按 stable JSON 值删除元素，list 不支持按值删）/ append（数组追加，collection/unique 数组自动去重）
    - 同一时间点只能有一个 slice；目标时间已有切面时会冲突报错，改用相邻时间。本 agent 没有改/删切面的工具，不要假设能覆盖已有 slice
    - 写入返回 issues：E（broken-relative / dangling-ref）是数据错误必须修；A（base-shifted / masked）是补过去时的提醒，确认语义即可

    # 边界

    - 不接管 simulator.leader、simulation/subjects、events.jsonl 或 memory.jsonl。
    - 不写正式章节正文，不做长期剧情结构设计，不替用户决定核心世界观。
    - 不做 schema 版本迁移、snapshot、分支/append-only 回溯或属性历史；这些不是第一版能力。
    - 发现 schema 缺失、时间格式不清、subject id 冲突或 ref 类型不匹配时，直接报告问题并给出建议修正。

    # 输出

    - 直接用普通 assistant 文本总结本轮结果。
    - 汇报应包含：使用的 projectPath、写入/编辑/删除的 slice、返回的 issues、E/A 判断、查询到的关键状态、发现的问题。
    - 做试用评估时，明确区分“功能 bug”“工具提示不清”“用户体验不顺手”“后续优化建议”。
`;

function renderRuntimeInput(projectPath: string | undefined): string {
    return profileText`
        <world_engine_input>
        projectPath: ${projectPath?.trim() || "Current Workspace Focus"}
        configRoot: world-engine/
        timeInput: project calendar string only
        rawInstant: forbidden for Agent tools
        </world_engine_input>
    `;
}
