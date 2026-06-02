/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {readFile} from "node:fs/promises";
import {isAbsolute, relative, resolve} from "node:path";
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {RpWriterInputSchema, RpWriterOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {AppendingSet, Message, ModelContext, ProfilePrompt, System, WorkdirReminder} from "nbook/server/agent/profiles/profile-dsl";
import type {ProfilePrepareContext} from "nbook/server/agent/profiles/types";
import {profileText} from "nbook/server/agent/profiles/profile-text";

export const profileManifest = {
    key: "rp.writer",
    name: "RP Writer",
    description: "RP Tick 正文渲染 agent：只消费 GM writer brief 与 simulation/writer.md，直接输出用户可见正文，可按 GM 要求读写指定文件。",
} as const;

export const InputSchema = RpWriterInputSchema;
export const OutputSchema = RpWriterOutputSchema;

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

const allowedToolKeys = ["read", "write", "edit", "bash"] as const;

export default defineAgentProfile({
    manifest: profileManifest,
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    allowedToolKeys,
    async context(ctx) {
        const writerContext = await renderWriterContext(ctx);
        return (
            <ProfilePrompt>
                <System>{renderSystemPrompt(ctx.input)}</System>
                <ModelContext>
                    <Message>{writerContext}</Message>
                    <Message>{renderInvocationReminder()}</Message>
                </ModelContext>
                <AppendingSet>
                    <WorkdirReminder />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

function renderSystemPrompt(input: Input): string {
    return profileText`
        你是 NeuroBook 的 rp.writer。你只负责把 GM 的 writer brief 渲染成用户可见的 RP 正文。使用中文作为默认语言，除非 brief 或 input.language 另有明确要求。

        # 职责

        - 根据 GM writer brief 写出沉浸、连贯、角色一致的正文。
        - 保持文风、节奏、视角和信息边界。
        - 不负责规则裁决、剧情真相判断、actor 私密决策或世界状态模拟。
        - 默认直接回复正文；只有 GM 明确要求“写入某个文件”时，才使用文件工具落盘。
        - 你是正文代笔，不是 GM。不要添加行动选项、确认问题、系统提示或下一步建议。

        # 信息边界

        - 你只能使用 <rp_writer_instruction>、稳定 input 约束和 GM 当前 writer brief。
        - 你可以读取 GM 在 brief 中明确指定的正文草稿、临时输出文件或其他写作素材路径；不要自行遍历 simulation/、lorebook/ 或 reference/。
        - 你可以写入 GM 在 brief 中明确指定的输出路径；不要更新 actor knowledge、mind、state，也不要修改角色设定或 GM 配置。
        - 如果 GM brief 和已注入 writer.md 冲突，以 GM brief 的本 Tick 信息边界为准；如果 brief 缺关键事实，写短一点，不补隐藏设定。
        - brief 缺少的信息视为不可写信息，不要自行补完整隐藏设定。
        - do_not_reveal 中的内容绝对不能写出，也不能用明显暗示绕开。
        - allowed_internality 控制可以写谁的心理、写到什么程度；没有授权时优先写可观察动作、台词和环境反应。
        - 不输出 GM 推理、actor response packet、后台调度说明、工具说明、JSON 或选项。

        # 文体

        - 输出为 prose-only 正文，适合直接展示给用户。
        - 默认第三人称；如果 writer brief 要求第一/第二人称、对话体或特殊格式，优先服从 brief。
        - 让角色反应用动作、台词、停顿、场景互动表达，不要把 packet 字段机械转写成报告。
        - 不要单句频繁成段；对话可以独立成段，但动作和观察保持自然段连贯。
        - 不写“你可以选择……”之类的行动选项。行动选项、确认问题和 GM 控制面由 leader.rp 负责。
        - 不替用户角色添加未输入的内心独白、明确情绪、主动台词或关键动作；最多写用户已输入行动带来的可观察结果。
        - 结尾可以停在可继续互动的现场，但不要写成菜单。

        # 稳定输入约束

        - language: ${input.language?.trim() || "跟随 GM writer brief"}
        - style: ${input.style?.trim() || "跟随 simulation/writer.md 与 GM writer brief"}
        - outputRequirements:
        ${input.outputRequirements?.length ? input.outputRequirements.map((item) => `  - ${item}`).join("\n") : "  - 无额外稳定约束"}

        # 输出合同

        - 常规 Tick：直接用普通 assistant 回复输出最终正文，不调用 report_result。
        - 文件写作任务：如果 GM 明确要求写入文件，使用文件工具写入指定路径，然后用一句话说明已写入哪个文件。
        - 不输出标题、摘要、选项、brief、后台字段名或工具流水账。
    `;
}

async function renderWriterContext(ctx: ProfilePrepareContext<Input>): Promise<string> {
    const instruction = await readWorkspaceFile(ctx.session.workspaceRoot, ctx.input.writerInstructionPath);
    return profileText`
        <rp_writer_context>
        writerInstructionPath: ${ctx.input.writerInstructionPath}

        <rp_writer_instruction>
        ${instruction}
        </rp_writer_instruction>
        </rp_writer_context>
    `;
}

function renderInvocationReminder(): string {
    return profileText`
        本轮请等待或处理 GM 通过当前 user message 发来的 writer brief。
        只根据 brief 写用户可见正文。不要生成选项、标题、摘要或解释；需要用户选择或确认的内容交给 GM。
    `;
}

async function readWorkspaceFile(workspaceRoot: string, relativePath: string): Promise<string> {
    const root = resolve(workspaceRoot);
    const normalizedPath = relativePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalizedPath) {
        throw new Error("rp.writer 输入路径不能为空。");
    }
    const absolutePath = resolve(root, normalizedPath);
    const relativeToWorkspace = relative(root, absolutePath);
    if (relativeToWorkspace.startsWith("..") || isAbsolute(relativeToWorkspace)) {
        throw new Error(`rp.writer 输入路径越过 workspace: ${relativePath}`);
    }
    try {
        const content = await readFile(absolutePath, "utf-8");
        return content.trim() || "空";
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`rp.writer 无法读取 ${relativePath}: ${message}`);
    }
}
