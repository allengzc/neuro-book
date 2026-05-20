import fs from "node:fs/promises";
import {SystemMessage, type BaseMessage} from "@langchain/core/messages";
import {toAgentMessageCreateInputs} from "nbook/server/agent/messages/codec";
import {renderPromptTemplate} from "nbook/server/agent/prompts";
import type {
    PromptChild,
    PromptNode,
    PromptProfileReminderNode,
    PromptProfileSetNode,
    PromptProfileWatchNode,
} from "nbook/server/agent/prompts";
import {AgentProfile, type PreparedProfilePersistedMessages, type PreparedProfileRun} from "nbook/server/agent/profiles/agent-profile";
export {
    ActivatedSkills,
    AppendingSet,
    DynamicSet,
    HistorySet,
    ProfilePrompt,
    Reminder,
    SkillCatalog,
    Watch,
} from "nbook/server/agent/profiles/context-prompt";
import type {ProfileContextRuntime} from "nbook/server/agent/profiles/profile-context";
import type {
    AgentMessageCreateInput,
    AgentReminderState,
    AgentThreadMetadata,
    AgentVariableScope,
    JsonValue,
    ProfileKey,
    ToolKey,
    WatchedVariableBaseline,
} from "nbook/server/agent/types";
import {stableStringifyJsonValue} from "nbook/server/agent/variables/template";
import {parseFrontmatterDocument} from "nbook/server/utils/frontmatter-document";
import {extractSkillMentions} from "nbook/shared/reference-trigger";
import {z} from "zod";

const SkillDocumentFrontmatterSchema = z.object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
});
const SKILL_ROOT_HINT = "workspace/.nbook/assets/agent/skills/ > assets/agent/skills/";

/**
 * SimpleProfile 的模板返回值。
 */
export type SimpleProfileTemplate = PromptChild;
type SimpleProfileTemplateResult = SimpleProfileTemplate | Promise<SimpleProfileTemplate>;

type PlainObject<TValue> =
    TValue extends readonly unknown[]
        ? never
        : TValue extends object
            ? TValue
            : never;

/**
 * 构造有限深度对象路径。
 * 当前只需要覆盖常见的 `scope.studio.xxx` / `scope.agent.thread.xxx` 场景。
 */
type ObjectPathLevel1<TValue, TPrefix extends string> = {
    [K in keyof TValue & string]: `${TPrefix}.${K}`;
}[keyof TValue & string];

type ObjectPathLevel2<TValue, TPrefix extends string> = {
    [K in keyof TValue & string]:
        PlainObject<TValue[K]> extends never
            ? never
            : {
                [TChild in keyof PlainObject<TValue[K]> & string]: `${TPrefix}.${K}.${TChild}`;
            }[keyof PlainObject<TValue[K]> & string];
}[keyof TValue & string];

type ObjectPathLevel3<TValue, TPrefix extends string> = {
    [K in keyof TValue & string]:
        PlainObject<TValue[K]> extends never
            ? never
            : {
                [TChild in keyof PlainObject<TValue[K]> & string]:
                    PlainObject<PlainObject<TValue[K]>[TChild]> extends never
                        ? never
                        : {
                            [TLeaf in keyof PlainObject<PlainObject<TValue[K]>[TChild]> & string]:
                                `${TPrefix}.${K}.${TChild}.${TLeaf}`;
                        }[keyof PlainObject<PlainObject<TValue[K]>[TChild]> & string];
            }[keyof PlainObject<TValue[K]> & string];
}[keyof TValue & string];

/**
 * 监听路径。
 * 约定始终从 `scope.` 开始，避免和 runtime / history 等其他上下文对象混淆。
 */
export type WatchedVariablePath<TKey extends ProfileKey> =
    | ObjectPathLevel1<AgentVariableScope<TKey>, "scope">
    | ObjectPathLevel2<AgentVariableScope<TKey>, "scope">
    | ObjectPathLevel3<AgentVariableScope<TKey>, "scope">;

type StripScopePrefix<TPath extends string> = TPath extends `scope.${infer TRest}` ? TRest : never;

/**
 * 根据点路径读取值类型。
 */
type PathValue<TValue, TPath extends string> =
    TPath extends `${infer THead}.${infer TRest}`
        ? THead extends keyof TValue
            ? PathValue<TValue[THead], TRest>
            : never
        : TPath extends keyof TValue
            ? TValue[TPath]
            : never;

/**
 * watched variable 对应的值类型。
 */
export type WatchedVariableValue<
    TKey extends ProfileKey,
    TPath extends WatchedVariablePath<TKey>,
> = PathValue<AgentVariableScope<TKey>, StripScopePrefix<TPath>>;

/**
 * watched variable 变化上下文。
 */
export type WatchedVariableChange<
    TKey extends ProfileKey,
    TPath extends WatchedVariablePath<TKey> = WatchedVariablePath<TKey>,
> = {
    previousValue: WatchedVariableValue<TKey, TPath> | undefined;
    currentValue: WatchedVariableValue<TKey, TPath> | undefined;
    history: BaseMessage[];
    scope: AgentVariableScope<TKey>;
    runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>;
};

/**
 * 构造 profile prompt 时的上下文。
 */
export type ProfilePromptContext<TKey extends ProfileKey> = {
    runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>;
    input: ProfileContextRuntime<TKey, AgentProfile<TKey>>["input"];
    scope: AgentVariableScope<TKey>;
    history: BaseMessage[];
    skillCatalogText: string;
    activatedSkillsText(): Promise<string>;
    var<TPath extends WatchedVariablePath<TKey>>(path: TPath): WatchedVariableValue<TKey, TPath> | undefined;
    hasTool(toolKey: ToolKey): boolean;
};

type SimpleProfileBuildResult = {
    modelMessages: BaseMessage[];
    persistedMessages: PreparedProfilePersistedMessages;
    immediateMetadata: AgentThreadMetadata;
    completedMetadata: AgentThreadMetadata;
};

type BuiltContextMessageSets = {
    preHistoryMessages: BaseMessage[];
    historyMessages: BaseMessage[];
    postHistoryMessages: BaseMessage[];
    appendingMessages: BaseMessage[];
    currentUserInputMessage: BaseMessage | null;
    persistedMessages: PreparedProfilePersistedMessages;
    immediateMetadata: AgentThreadMetadata;
    completedMetadata: AgentThreadMetadata;
};

type ProfilePromptSections = {
    beforeHistory: PromptProfileSetNode;
    history: PromptProfileSetNode | null;
    afterHistory: PromptProfileSetNode;
    appending: PromptProfileSetNode;
};

type AppendingSetRenderResult = {
    messages: BaseMessage[];
    persistedMessages: AgentMessageCreateInput[];
    immediateMetadata: AgentThreadMetadata;
    completedMetadata: AgentThreadMetadata;
};

type AppendingRenderState = {
    touched: boolean;
};

type ContinueHistorySplit = {
    history: BaseMessage[];
    currentUserInputMessage: BaseMessage | null;
};

/**
 * 可选的高层 profile。
 * 提供常见的 system prompt / dynamic prompt / watched variable 默认编排。
 * 这里消费的是变量快照，不是响应式运行时。
 */
export abstract class SimpleProfile<TKey extends ProfileKey> extends AgentProfile<TKey> {
    /**
     * 构造三段式 profile prompt。
     */
    protected abstract buildPrompt(ctx: ProfilePromptContext<TKey>): SimpleProfileTemplateResult;

    /**
     * 构造本次发送给模型的完整消息。
     */
    override async prepare(runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>): Promise<PreparedProfileRun> {
        return this.buildContext(runtime);
    }

    /**
     * 统一构造 SimpleProfile 本次运行上下文。
     */
    protected async buildContext(
        runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>,
    ): Promise<SimpleProfileBuildResult> {
        const messageSets = await this.buildContextMessageSets(runtime);

        return {
            modelMessages: [
                ...messageSets.preHistoryMessages,
                ...messageSets.historyMessages,
                ...messageSets.postHistoryMessages,
                ...messageSets.appendingMessages,
                ...(messageSets.currentUserInputMessage ? [messageSets.currentUserInputMessage] : []),
            ],
            persistedMessages: messageSets.persistedMessages,
            immediateMetadata: messageSets.immediateMetadata,
            completedMetadata: messageSets.completedMetadata,
        };
    }

    /**
     * 按声明顺序构造 History / Dynamic 上下文，并将 Appending 统一放到末尾。
     */
    private async buildContextMessageSets(
        runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>,
    ): Promise<BuiltContextMessageSets> {
        const loadedHistory = await runtime.loadHistoryMessages();
        const continueHistory = this.splitContinueHistory(runtime, loadedHistory);
        const history = continueHistory.history;
        const ctx = await this.createPromptContext(runtime, history, continueHistory.currentUserInputMessage);
        const profilePrompt = this.requireProfilePrompt(await this.buildPrompt(ctx));
        const sections = this.collectProfileSets(profilePrompt.children);
        const renderedHistorySet = sections.history ? this.renderHistorySet(runtime, sections.history) : [];
        const hasRootSystemMessage = Boolean(history[0] && SystemMessage.isInstance(history[0]));
        const shouldPersistHistorySet = !hasRootSystemMessage && renderedHistorySet.length > 0;
        const preHistoryMessages = await this.renderDynamicSet(runtime, sections.beforeHistory);
        const postHistoryMessages = await this.renderDynamicSet(runtime, sections.afterHistory);
        const appendingResult = await this.renderAppendingSet(runtime, history, sections.appending, continueHistory.currentUserInputMessage);
        const persistedHistory = hasRootSystemMessage
            ? history
            : [...renderedHistorySet, ...history];

        return {
            preHistoryMessages,
            historyMessages: persistedHistory,
            postHistoryMessages,
            appendingMessages: appendingResult.messages,
            currentUserInputMessage: continueHistory.currentUserInputMessage,
            persistedMessages: {
                prepend: shouldPersistHistorySet
                    ? toAgentMessageCreateInputs(renderedHistorySet)
                    : [],
                append: appendingResult.persistedMessages,
                appendBeforeMessageId: runtime.options.turn?.anchorMessageId
                    ?? this.readMessageId(continueHistory.currentUserInputMessage?.additional_kwargs)
                    ?? undefined,
            },
            immediateMetadata: appendingResult.immediateMetadata,
            completedMetadata: appendingResult.completedMetadata,
        };
    }

    /**
     * 从已持久化消息 metadata 中读取消息 id。
     */
    private readMessageId(additionalKwargs: BaseMessage["additional_kwargs"] | undefined): string | null {
        const messageId = additionalKwargs?.messageId;
        return typeof messageId === "string" ? messageId : null;
    }

    /**
     * continue 模式下，前端已经把本轮用户输入写入历史。
     * 这里临时取出尾部用户消息，确保最新 runtime 上下文位于它之前，而用户输入仍是模型最后一条消息。
     */
    private splitContinueHistory(
        runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>,
        history: BaseMessage[],
    ): ContinueHistorySplit {
        if (!this.isContinueInput(runtime.input) || history.length === 0) {
            return {
                history,
                currentUserInputMessage: null,
            };
        }

        const lastMessage = history.at(-1);
        if (!lastMessage || lastMessage._getType() !== "human") {
            return {
                history,
                currentUserInputMessage: null,
            };
        }

        return {
            history: history.slice(0, -1),
            currentUserInputMessage: lastMessage,
        };
    }

    /**
     * 判断本轮是否为 UI 主路径的 continue run。
     */
    private isContinueInput(input: ProfileContextRuntime<TKey, AgentProfile<TKey>>["input"]): boolean {
        return Boolean(
            typeof input === "object"
            && input !== null
            && "mode" in input
            && input.mode === "continue",
        );
    }

    /**
     * 创建 profile prompt 构造上下文。
     */
    private async createPromptContext(
        runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>,
        history: BaseMessage[],
        currentUserInputMessage: BaseMessage | null,
    ): Promise<ProfilePromptContext<TKey>> {
        let activatedSkillsText: string | null = null;
        return {
            runtime,
            input: runtime.input,
            scope: runtime.scope,
            history,
            skillCatalogText: this.buildSkillCatalogText(runtime),
            activatedSkillsText: async () => {
                activatedSkillsText ??= await this.buildActivatedSkillsText(runtime, currentUserInputMessage?.text);
                return activatedSkillsText;
            },
            var: <TPath extends WatchedVariablePath<TKey>>(path: TPath) => (
                readScopeValue(runtime.scope as AgentVariableScope<ProfileKey>, path) as WatchedVariableValue<TKey, TPath> | undefined
            ),
            hasTool: (toolKey) => runtime.scope.agent.tools.includes(toolKey),
        };
    }

    /**
     * 校验 buildPrompt 返回了 ProfilePrompt 根节点。
     */
    private requireProfilePrompt(template: SimpleProfileTemplate): Extract<PromptNode, {kind: "profile_prompt"}> {
        if (!template || typeof template !== "object" || Array.isArray(template) || template.kind !== "profile_prompt") {
            throw new Error("SimpleProfile.buildPrompt 必须返回 <ProfilePrompt> 根节点");
        }
        return template;
    }

    /**
     * 收集 ProfilePrompt 中声明的消息集合。
     * 未被 HistorySet / AppendingSet 包裹的顶层节点按声明位置作为 dynamic 渲染。
     */
    private collectProfileSets(children: PromptChild[]): ProfilePromptSections {
        const sections: ProfilePromptSections = {
            beforeHistory: {
                kind: "profile_set",
                set: "dynamic",
                children: [],
            },
            history: null,
            afterHistory: {
                kind: "profile_set",
                set: "dynamic",
                children: [],
            },
            appending: {
                kind: "profile_set",
                set: "appending",
                children: [],
            },
        };
        let didSeeHistorySet = false;

        const pushDynamicChild = (child: PromptChild): void => {
            const target = didSeeHistorySet ? sections.afterHistory : sections.beforeHistory;
            if (typeof child === "string" || typeof child === "number") {
                if (String(child).trim() !== "") {
                    target.children.push(child);
                }
                return;
            }
            target.children.push(child);
        };

        const visit = (child: PromptChild): void => {
            if (child === null || child === undefined || child === false) {
                return;
            }
            if (Array.isArray(child)) {
                for (const item of child) {
                    visit(item);
                }
                return;
            }
            if (typeof child === "string" || typeof child === "number") {
                pushDynamicChild(child);
                return;
            }
            if (child.kind === "fragment") {
                for (const item of child.children) {
                    visit(item);
                }
                return;
            }
            if (child.kind !== "profile_set") {
                pushDynamicChild(child);
                return;
            }
            if (child.set === "appending") {
                sections.appending.children.push(...child.children);
                return;
            }
            if (child.set === "history") {
                if (didSeeHistorySet) {
                    throw new Error("ProfilePrompt 只能包含一个 HistorySet");
                }
                didSeeHistorySet = true;
                sections.history = child;
                return;
            }
            const target = didSeeHistorySet ? sections.afterHistory : sections.beforeHistory;
            target.children.push(...child.children);
        };

        for (const child of children) {
            visit(child);
        }

        if (!didSeeHistorySet) {
            sections.afterHistory.children.unshift(...sections.beforeHistory.children);
            sections.beforeHistory.children = [];
        }

        return sections;
    }

    /**
     * 渲染普通 prompt 子节点。
     */
    private renderPromptChildren(children: PromptChild[]): BaseMessage[] {
        const messages: BaseMessage[] = [];
        for (const child of children) {
            this.renderPlainChild(child, messages);
        }
        return messages;
    }

    /**
     * 渲染 HistorySet。
     */
    private renderHistorySet(
        runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>,
        section: PromptProfileSetNode,
    ): BaseMessage[] {
        const messages: BaseMessage[] = [];
        for (const child of section.children) {
            this.renderHistoryChild(runtime, child, messages);
        }
        return messages;
    }

    /**
     * 渲染 HistorySet 子节点。
     */
    private renderHistoryChild(
        runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>,
        child: PromptChild,
        messages: BaseMessage[],
    ): void {
        if (child === null || child === undefined || child === false) {
            return;
        }
        if (Array.isArray(child)) {
            for (const item of child) {
                this.renderHistoryChild(runtime, item, messages);
            }
            return;
        }
        if (typeof child === "object" && child.kind === "fragment") {
            for (const item of child.children) {
                this.renderHistoryChild(runtime, item, messages);
            }
            return;
        }
        this.renderPlainChild(child, messages);
    }

    /**
     * 渲染 DynamicSet。
     */
    private async renderDynamicSet(
        runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>,
        section: PromptProfileSetNode,
    ): Promise<BaseMessage[]> {
        const messages: BaseMessage[] = [];
        for (const child of section.children) {
            await this.renderDynamicChild(runtime, child, messages);
        }
        return messages;
    }

    /**
     * 渲染 AppendingSet。
     * AppendingSet 产出的消息会写入当前历史光标；对应状态也随历史写入立即提交。
     */
    private async renderAppendingSet(
        runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>,
        history: BaseMessage[],
        section: PromptProfileSetNode,
        currentUserInputMessage: BaseMessage | null,
    ): Promise<AppendingSetRenderResult> {
        const currentWatched = runtime.thread.metadata.watchedVariables ?? {};
        const nextWatched: Record<string, WatchedVariableBaseline> = {
            ...currentWatched,
        };
        const currentReminders = runtime.thread.metadata.reminders ?? {};
        const nextReminders: Record<string, AgentReminderState> = {
            ...currentReminders,
        };
        const messages: BaseMessage[] = [];
        const persistedMessages: AgentMessageCreateInput[] = [];
        const watchedState: AppendingRenderState = {
            touched: false,
        };
        const reminderState: AppendingRenderState = {
            touched: false,
        };
        const currentTurn = this.countUserTurns(history) + (currentUserInputMessage ? 1 : 0);

        for (const child of section.children) {
            await this.renderAppendingChild(
                runtime,
                history,
                currentWatched,
                nextWatched,
                watchedState,
                currentReminders,
                nextReminders,
                reminderState,
                currentTurn,
                currentUserInputMessage,
                child,
                messages,
                persistedMessages,
            );
        }

        return {
            messages,
            persistedMessages,
            immediateMetadata: {
                ...(watchedState.touched ? {watchedVariables: nextWatched} : {}),
                ...(reminderState.touched ? {reminders: nextReminders} : {}),
            },
            completedMetadata: {},
        };
    }

    /**
     * 渲染普通 prompt 子节点。
     */
    private renderPlainChild(child: PromptChild, messages: BaseMessage[]): void {
        if (child === null || child === undefined || child === false) {
            return;
        }
        if (Array.isArray(child)) {
            for (const item of child) {
                this.renderPlainChild(item, messages);
            }
            return;
        }
        if (typeof child === "string" || typeof child === "number") {
            if (String(child).trim() !== "") {
                throw new Error("prompt 文本必须放在 Message 内部");
            }
            return;
        }
        if (child.kind === "fragment") {
            for (const item of child.children) {
                this.renderPlainChild(item, messages);
            }
            return;
        }
        if (child.kind === "message" || child.kind === "history") {
            messages.push(...renderPromptTemplate(child).messages);
            return;
        }
        throw new Error(`${child.kind} 节点不能出现在普通 prompt 区域`);
    }

    /**
     * 渲染 DynamicSet 子节点。
     */
    private async renderDynamicChild(
        runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>,
        child: PromptChild,
        messages: BaseMessage[],
    ): Promise<void> {
        if (child === null || child === undefined || child === false) {
            return;
        }
        if (Array.isArray(child)) {
            for (const item of child) {
                await this.renderDynamicChild(runtime, item, messages);
            }
            return;
        }
        if (typeof child === "object" && child.kind === "fragment") {
            for (const item of child.children) {
                await this.renderDynamicChild(runtime, item, messages);
            }
            return;
        }
        this.renderPlainChild(child, messages);
    }

    /**
     * 渲染 AppendingSet 子节点。
     */
    private async renderAppendingChild(
        runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>,
        history: BaseMessage[],
        currentWatched: Record<string, WatchedVariableBaseline>,
        nextWatched: Record<string, WatchedVariableBaseline>,
        watchedState: AppendingRenderState,
        currentReminders: Record<string, AgentReminderState>,
        nextReminders: Record<string, AgentReminderState>,
        reminderState: AppendingRenderState,
        currentTurn: number,
        currentUserInputMessage: BaseMessage | null,
        child: PromptChild,
        messages: BaseMessage[],
        persistedMessages: AgentMessageCreateInput[],
    ): Promise<void> {
        if (child === null || child === undefined || child === false) {
            return;
        }
        if (Array.isArray(child)) {
            for (const item of child) {
                await this.renderAppendingChild(
                    runtime,
                    history,
                    currentWatched,
                    nextWatched,
                    watchedState,
                    currentReminders,
                    nextReminders,
                    reminderState,
                    currentTurn,
                    currentUserInputMessage,
                    item,
                    messages,
                    persistedMessages,
                );
            }
            return;
        }
        if (typeof child === "string" || typeof child === "number") {
            if (String(child).trim() !== "") {
                throw new Error("AppendingSet 文本必须放在 Message 内部");
            }
            return;
        }
        if (child.kind === "fragment") {
            for (const item of child.children) {
                await this.renderAppendingChild(
                    runtime,
                    history,
                    currentWatched,
                    nextWatched,
                    watchedState,
                    currentReminders,
                    nextReminders,
                    reminderState,
                    currentTurn,
                    currentUserInputMessage,
                    item,
                    messages,
                    persistedMessages,
                );
            }
            return;
        }
        if (child.kind === "profile_reminder") {
            const reminderMessages = this.renderReminderNode(
                runtime,
                currentReminders,
                nextReminders,
                reminderState,
                currentTurn,
                child,
            );
            messages.push(...reminderMessages);
            persistedMessages.push(...toAgentMessageCreateInputs(reminderMessages));
            return;
        }
        if (child.kind === "profile_watch") {
            watchedState.touched = true;
            const renderedMessages = this.renderWatchNode(runtime, history, currentWatched, nextWatched, child);
            messages.push(...renderedMessages);
            persistedMessages.push(...toAgentMessageCreateInputs(renderedMessages));
            return;
        }
        if (child.kind === "message" && child.source === "input" && this.isContinueInput(runtime.input)) {
            return;
        }

        const rendered = renderPromptTemplate(child);
        const generatedMessages = rendered.messages.filter((message) => message.text.trim() !== "");
        messages.push(...generatedMessages);
        if (this.isContinueInput(runtime.input) && rendered.inputMessages.length > 0) {
            return;
        }
        persistedMessages.push(...toAgentMessageCreateInputs(generatedMessages));
    }

    /**
     * 渲染 watched variable 节点。
     */
    private renderWatchNode(
        runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>,
        history: BaseMessage[],
        currentWatched: Record<string, WatchedVariableBaseline>,
        nextWatched: Record<string, WatchedVariableBaseline>,
        node: PromptProfileWatchNode,
    ): BaseMessage[] {
        const currentValue = readScopeValue(runtime.scope as AgentVariableScope<ProfileKey>, node.path);
        const fingerprint = stableStringifyJsonValue(currentValue);
        const previous = currentWatched[node.path];
        nextWatched[node.path] = {
            fingerprint,
            hasValue: currentValue !== undefined,
            value: currentValue ?? null,
        };

        if (!previous && currentValue === undefined) {
            return [];
        }
        if (previous?.fingerprint === fingerprint) {
            return [];
        }

        const rendered = node.render({
            previousValue: previous ? this.readBaselineValue(previous) as never : undefined as never,
            currentValue: currentValue as never,
            history,
            scope: runtime.scope,
            runtime,
        } satisfies WatchedVariableChange<TKey>);
        if (!rendered) {
            return [];
        }

        return this.renderPromptChildren([rendered]).map((message) => this.toGeneratedHistoryMessage(node.path, message));
    }

    /**
     * 渲染 reminder 节点。
     */
    private renderReminderNode(
        runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>,
        currentReminders: Record<string, AgentReminderState>,
        nextReminders: Record<string, AgentReminderState>,
        reminderState: AppendingRenderState,
        currentTurn: number,
        node: PromptProfileReminderNode,
    ): BaseMessage[] {
        if (!node.when) {
            return [];
        }

        const previous = currentReminders[node.id];
        const fingerprint = node.watchValue !== undefined
            ? stableStringifyJsonValue(node.watchValue)
            : node.watchPath
                ? stableStringifyJsonValue(readScopeValue(runtime.scope as AgentVariableScope<ProfileKey>, node.watchPath))
                : undefined;
        const hasWatchValue = node.watchValue !== undefined || Boolean(node.watchPath);
        const didFingerprintChange = hasWatchValue && previous?.fingerprint !== fingerprint;
        const shouldRepeat = typeof node.repeatEveryTurns === "number"
            && (!previous || currentTurn - previous.injectedAtTurn >= node.repeatEveryTurns);
        const shouldInject = hasWatchValue || node.repeatEveryTurns
            ? didFingerprintChange || shouldRepeat
            : true;

        if (!shouldInject) {
            return [];
        }

        if (hasWatchValue || node.repeatEveryTurns) {
            reminderState.touched = true;
            nextReminders[node.id] = {
                ...(fingerprint ? {fingerprint} : {}),
                injectedAtTurn: currentTurn,
            };
        }

        return this.renderPromptChildren(node.children).filter((message) => message.text.trim() !== "");
    }

    /**
     * 构造 skill catalog 文本。
     */
    private buildSkillCatalogText(runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>): string {
        if (!runtime.scope.agent.tools.includes("skill") || runtime.skillCatalog.length === 0) {
            return "";
        }

        const skillLines = runtime.skillCatalog
            .map((skillItem) => [
                `- name: ${skillItem.name}`,
                `  description: ${skillItem.description}`,
                skillItem.whenToUse ? `  when_to_use: ${skillItem.whenToUse}` : "",
                `  location: ${skillItem.displayLocation ?? skillItem.location}`,
            ].filter(Boolean).join("\n"))
            .join("\n\n");

        return [
            "<system-reminder>",
            "## Skill",
            "",
            "Skills 是可复用工作法，不是长期记忆，也不是每轮都必须执行的流程。",
            "",
            `- skills 根目录：${SKILL_ROOT_HINT}`,
            "- 用户 assets 优先于系统 assets；同名 skill 目录按整个目录覆盖，不按单个文件混合。",
            "- 其他 assets 通常按同路径文件覆盖：`workspace/.nbook/assets/...` 优先于 `assets/...`。",
            "- 当前只存在一个 skill 相关工具：`skill`。",
            "- 需要启用 skill 时，调用 `skill({ skill: \"catalog 中的原始名称\" })`，不要用 read_file 读取 SKILL.md；`skill` 工具是读取完整 SKILL.md 的入口。",
            "- skill 名允许中文。必须使用下方 catalog 中的原始 name，不要把中文名翻译成英文、拼音或 slug。",
            "- 用户显式输入 `$skill-name` 时，表示正在请求对应 skill；如果系统已经预加载该 skill，不要再次读取同一个 SKILL.md，除非需要核对原文。",
            "- 用户显式输入 `$skill-name`，或任务明显匹配当前 skill catalog 描述时，先启用对应 skill，再继续回复或执行；这是前置要求，不是可选装饰。",
            "- 用户没有显式提到 skill 且任务不明显匹配 catalog 时，不要为了形式调用 skill。",
            "- skill 只指导本轮怎么做；稳定设定写入 Lorebook，剧情推进写入 Thread / Scene / Plot，临时计划留在当前对话。",
            "- skill 与用户目标冲突时，优先保证用户目标；如果冲突会实质改变结果，提出一个最小澄清问题。",
            "- 使用 skill 后，最终回复只说明关键产出和必要验证，不复述完整 skill 内容。",
            "",
            "## Available Skills",
            "",
            skillLines,
            "</system-reminder>",
        ].join("\n");
    }

    /**
     * 根据显式 `$skill` 提及自动激活 skills。
     */
    private async buildActivatedSkillsText(
        runtime: ProfileContextRuntime<TKey, AgentProfile<TKey>>,
        currentUserInputText?: string,
    ): Promise<string> {
        const prompt = currentUserInputText ?? this.getPromptText(runtime.input);
        if (!prompt) {
            return "";
        }

        const mentionedSkillNames = extractSkillMentions(prompt);
        if (mentionedSkillNames.length === 0) {
            return "";
        }

        const catalogByName = new Map(runtime.skillCatalog.map((skill) => [skill.name, skill]));
        const activatedBlocks: string[] = [];

        for (const skillName of mentionedSkillNames) {
            const skillItem = catalogByName.get(skillName);
            if (!skillItem) {
                activatedBlocks.push(`用户显式提到了技能 $${skillName}，但当前仓库中未找到同名 skill。`);
                continue;
            }

            const skillContent = await fs.readFile(skillItem.location, "utf-8");
            const parsedSkillDocument = parseFrontmatterDocument(skillContent, SkillDocumentFrontmatterSchema);
            const skillBody = parsedSkillDocument.body.trim();
            activatedBlocks.push([
                `【显式激活 Skill】`,
                `用户在本轮输入中显式提到了 $${skillItem.name}。`,
                `该 skill 已由系统自动预加载；如果需要启用其他 skill，继续使用 skill 工具。`,
                `location: ${skillItem.displayLocation ?? skillItem.location}`,
                "",
                "---",
                skillItem.headerText.trim(),
                "---",
                "",
                skillBody ? `【SKILL.md】\n${skillBody}` : "【SKILL.md】\n（正文为空）",
            ].join("\n"));
        }

        return activatedBlocks.join("\n\n---\n\n");
    }

    /**
     * 从 profile 输入中提取主 prompt 文本。
     */
    private getPromptText(input: ProfileContextRuntime<TKey, AgentProfile<TKey>>["input"]): string {
        if (typeof input !== "object" || input === null) {
            return "";
        }
        if ("prompt" in input && typeof input.prompt === "string") {
            return input.prompt;
        }
        return "";
    }

    /**
     * 将 watched variable 变化消息包装成系统生成历史消息。
     */
    private toGeneratedHistoryMessage(
        watchedVariablePath: string,
        message: BaseMessage,
    ): BaseMessage {
        return new SystemMessage({
            content: message.text,
            additional_kwargs: {
                ...message.additional_kwargs,
                messageCreatedAt: new Date().toISOString(),
                messageStatus: "done",
                messageId: `msg-${crypto.randomUUID()}`,
                systemMessageKind: "variable_change",
                watchedVariableKey: watchedVariablePath,
            },
        });
    }

    /**
     * 从历史 baseline 还原 watched variable 旧值。
     */
    private readBaselineValue(baseline: WatchedVariableBaseline): JsonValue | undefined {
        if (baseline.hasValue === false || (
            baseline.hasValue === undefined
            && baseline.fingerprint === "__undefined__"
        )) {
            return undefined;
        }
        return baseline.value;
    }

    /**
     * 统计当前上下文中的真实用户 turn 数。
     */
    private countUserTurns(history: BaseMessage[]): number {
        return history.filter((message) => message._getType() === "human").length;
    }
}

/**
 * 根据 `scope.xxx.yyy` 路径读取当前值。
 * 这里使用运行时路径解析，类型安全由 `watch()` / `getVariable()` 的 path 字面量保证。
 */
function readScopeValue(
    scope: AgentVariableScope<ProfileKey>,
    path: string,
): JsonValue | undefined {
    const segments = path.split(".");
    if (segments[0] !== "scope") {
        throw new Error(`watched variable path 必须以 scope 开头: ${path}`);
    }

    let current: unknown = scope;
    for (const segment of segments.slice(1)) {
        if (!current || typeof current !== "object" || Array.isArray(current) || !(segment in current)) {
            return undefined;
        }
        current = (current as Record<string, unknown>)[segment];
    }
    return current as JsonValue | undefined;
}
