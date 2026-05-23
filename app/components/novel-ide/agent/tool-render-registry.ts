import { defineAsyncComponent, markRaw, type Component } from "vue";
import type {AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import AgentCreateAgentNode from "nbook/app/components/novel-ide/agent/AgentCreateAgentNode.vue";
import AgentEditFileBubble from "nbook/app/components/novel-ide/agent/AgentEditFileBubble.vue";
import AgentRequestUserInputBubble from "nbook/app/components/novel-ide/agent/AgentRequestUserInputBubble.vue";
import AgentExitPlanModeBubble from "nbook/app/components/novel-ide/agent/AgentExitPlanModeBubble.vue";
import AgentWriteFileBubble from "nbook/app/components/novel-ide/agent/AgentWriteFileBubble.vue";
import AgentApplyPatchBubble from "nbook/app/components/novel-ide/agent/AgentApplyPatchBubble.vue";
import AgentTaskBubble from "nbook/app/components/novel-ide/agent/AgentTaskBubble.vue";

/** Tool 节点渲染模式。 */
export type AgentToolRenderMode = "inline" | "block" | "message" | "hidden";

/** 单个 tool 的渲染配置。 */
export type AgentToolRenderConfig = {
    mode: AgentToolRenderMode;
    typeLabel: string;
    collapsedPreview?: string;
    component?: Component;
};

const DEFAULT_TOOL_RENDER_CONFIG: AgentToolRenderConfig = {
    mode: "inline",
    typeLabel: "Tool Call",
};

const TOOL_RENDER_REGISTRY: Record<string, AgentToolRenderConfig> = {
    create_agent: {
        mode: "block",
        typeLabel: "Create",
        collapsedPreview: "Create Agent",
        component: markRaw(AgentCreateAgentNode),
    },
    request_user_input: {
        mode: "block",
        typeLabel: "Question",
        collapsedPreview: "等待用户回答",
        component: markRaw(AgentRequestUserInputBubble),
    },
    enter_plan_mode: {
        mode: "block",
        typeLabel: "Plan Mode",
        collapsedPreview: "等待审批",
        component: markRaw(AgentRequestUserInputBubble),
    },
    exit_plan_mode: {
        mode: "message",
        typeLabel: "Plan Mode",
        collapsedPreview: "计划审批",
        component: markRaw(AgentExitPlanModeBubble),
    },
    write: {
        mode: "block",
        typeLabel: "Write",
        collapsedPreview: "写入文件",
        component: markRaw(AgentWriteFileBubble),
    },
    edit: {
        mode: "block",
        typeLabel: "Edit",
        collapsedPreview: "编辑文件",
        component: markRaw(AgentEditFileBubble),
    },
    apply_patch: {
        mode: "block",
        typeLabel: "Patch",
        collapsedPreview: "应用补丁",
        component: markRaw(AgentApplyPatchBubble),
    },
    task_create: {
        mode: "message",
        typeLabel: "Checklist",
        collapsedPreview: "任务清单",
        component: markRaw(AgentTaskBubble),
    },
    task_set_status: {
        mode: "message",
        typeLabel: "Checklist",
        collapsedPreview: "任务状态更新",
        component: markRaw(AgentTaskBubble),
    },
};

/**
 * 根据 tool 名字返回前端渲染配置。
 */
export const resolveToolRenderConfig = (toolCall: AgentToolCall): AgentToolRenderConfig => {
    return TOOL_RENDER_REGISTRY[toolCall.name] ?? DEFAULT_TOOL_RENDER_CONFIG;
};
