import type {
    PromptChild,
    PromptProfileReminderNode,
    PromptProfileRootNode,
    PromptProfileSetNode,
    PromptProfileWatchNode,
} from "nbook/server/agent/prompts";
import type {JsonValue} from "nbook/server/agent/types";

/**
 * 规范化 profile prompt children。
 */
function normalizeChildren(children: PromptChild | PromptChild[] | undefined): PromptChild[] {
    if (children === undefined) {
        return [];
    }
    return Array.isArray(children) ? children : [children];
}

/**
 * ProfilePrompt 根节点。
 */
export function ProfilePrompt(props: {
    children?: PromptChild | PromptChild[];
}): PromptProfileRootNode {
    return {
        kind: "profile_prompt",
        children: normalizeChildren(props.children),
    };
}

/**
 * History 消息集合。
 */
export function HistorySet(props: {
    children?: PromptChild | PromptChild[];
}): PromptProfileSetNode {
    return {
        kind: "profile_set",
        set: "history",
        children: normalizeChildren(props.children),
    };
}

/**
 * Dynamic 消息集合。
 */
export function DynamicSet(props: {
    children?: PromptChild | PromptChild[];
}): PromptProfileSetNode {
    return {
        kind: "profile_set",
        set: "dynamic",
        children: normalizeChildren(props.children),
    };
}

/**
 * Appending 消息集合。
 */
export function AppendingSet(props: {
    children?: PromptChild | PromptChild[];
}): PromptProfileSetNode {
    return {
        kind: "profile_set",
        set: "appending",
        children: normalizeChildren(props.children),
    };
}

/**
 * Skill catalog 文本片段。
 */
export function SkillCatalog(props: {
    text: string;
}): string {
    return props.text;
}

/**
 * 最新上下文提醒节点。
 */
export function Reminder(props: {
    id: string;
    when?: boolean;
    watchPath?: string;
    watchValue?: JsonValue;
    repeatEveryTurns?: number;
    children?: PromptChild | PromptChild[];
}): PromptProfileReminderNode {
    return {
        kind: "profile_reminder",
        id: props.id,
        when: props.when ?? true,
        watchPath: props.watchPath,
        watchValue: props.watchValue,
        repeatEveryTurns: props.repeatEveryTurns,
        children: normalizeChildren(props.children),
    };
}

/**
 * 显式激活 skill 文本片段。
 */
export function ActivatedSkills(props: {
    text: string;
}): string {
    return props.text;
}

/**
 * watched variable 变化节点。
 */
export function Watch(props: {
    path: string;
    render?: (change: Parameters<PromptProfileWatchNode["render"]>[0]) => PromptChild;
    children?: PromptChild | PromptChild[];
}): PromptProfileWatchNode {
    return {
        kind: "profile_watch",
        path: props.path,
        render: props.render ?? (() => normalizeChildren(props.children)),
    };
}
