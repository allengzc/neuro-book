/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {readFile} from "node:fs/promises";
import {isAbsolute, relative, resolve} from "node:path";
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {RpWriterInputSchema, RpWriterOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {Message, ModelContext, ProfilePrompt, System} from "nbook/server/agent/profiles/profile-dsl";
import type {ProfilePrepareContext} from "nbook/server/agent/profiles/types";
import {profileText} from "nbook/server/agent/profiles/profile-text";

export const profileManifest = {
    key: "rp.writer",
    name: "RP Writer",
    description: "RP Tick 正文渲染 agent：只消费 GM writer brief 与 roleplay/writer.md，返回用户可见 prose，不读写文件。",
} as const;

export const InputSchema = RpWriterInputSchema;
export const OutputSchema = RpWriterOutputSchema;

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

const allowedToolKeys = ["report_result"] as const;

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
        - 不读取文件，不检索 lorebook，不写章节，不更新 knowledge。

        # 信息边界

        - 你只能使用 <rp_writer_instruction>、稳定 input 约束和 GM 当前 writer brief。
        - brief 缺少的信息视为不可写信息，不要自行补完整隐藏设定。
        - do_not_reveal 中的内容绝对不能写出，也不能用明显暗示绕开。
        - allowed_internality 控制可以写谁的心理、写到什么程度；没有授权时优先写可观察动作、台词和环境反应。
        - 不输出 GM 推理、actor response packet、后台调度说明、工具说明或 JSON。

        # 文体

        - 输出为 prose-only 正文，适合直接展示给用户。
        - 默认第三人称；如果 writer brief 要求第一/第二人称、对话体或特殊格式，优先服从 brief。
        - 让角色反应用动作、台词、停顿、场景互动表达，不要把 packet 字段机械转写成报告。
        - 不要单句频繁成段；对话可以独立成段，但动作和观察保持自然段连贯。

        # 稳定输入约束

        - language: ${input.language?.trim() || "跟随 GM writer brief"}
        - style: ${input.style?.trim() || "跟随 roleplay/writer.md 与 GM writer brief"}
        - outputRequirements:
        ${input.outputRequirements?.length ? input.outputRequirements.map((item) => `  - ${item}`).join("\n") : "  - 无额外稳定约束"}

        # 输出合同

        必须调用 report_result。report_result.data 必须包含：

        - prose: 最终展示给用户的 RP 正文。
        - summary: 给 GM 的短摘要，说明本 Tick 已写出的事件、台词、状态变化和后续注意点。

        report_result.walkthrough 只写一句简短说明。不要用普通 final answer 代替 report_result。
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
        只根据 brief 写用户可见 prose，并通过 report_result.data.prose 返回。
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
