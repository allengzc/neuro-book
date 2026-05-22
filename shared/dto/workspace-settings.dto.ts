import {z} from "zod";

const WorkspaceKindSchema = z.enum(["novel", "user-assets"]);
const AgentProfileKeySchema = z.string().trim().min(1, "profileKey 不能为空");

/**
 * 工作区设置查询。
 */
export const WorkspaceSettingsQueryDtoSchema = z.object({
    novelId: z.string().trim().min(1, "novelId 不能为空").optional(),
    workspaceKind: z.literal("user-assets").optional(),
}).superRefine((value, ctx) => {
    if (value.workspaceKind === "user-assets") {
        return;
    }
    if (!value.novelId) {
        ctx.addIssue({
            code: "custom",
            path: ["novelId"],
            message: "小说工作区必须提供 novelId",
        });
    }
});

/**
 * 工作区可选 Agent Profile。
 */
export const WorkspaceSettingsAgentProfileDtoSchema = z.object({
    profileKey: AgentProfileKeySchema,
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).nullable(),
    loadStatus: z.enum(["loaded", "error"]),
});

/**
 * 工作区设置响应。
 */
export const WorkspaceSettingsDtoSchema = z.object({
    workspaceKind: WorkspaceKindSchema,
    workspaceRoot: z.string().trim().min(1),
    agent: z.object({
        systemDefaultProfileKey: AgentProfileKeySchema,
        /**
         * null 表示当前 workspace 跟随系统默认。
         */
        workspaceDefaultProfileKey: AgentProfileKeySchema.nullable(),
        effectiveProfileKey: AgentProfileKeySchema,
        profiles: z.array(WorkspaceSettingsAgentProfileDtoSchema).default([]),
    }),
});

/**
 * 更新工作区设置请求。
 */
export const UpdateWorkspaceSettingsRequestDtoSchema = z.object({
    agent: z.object({
        /**
         * null 表示清空 workspace 覆盖并回到系统默认。
         */
        defaultProfileKey: AgentProfileKeySchema.nullable().optional(),
    }).optional(),
});

export type WorkspaceSettingsQueryDto = z.infer<typeof WorkspaceSettingsQueryDtoSchema>;
export type WorkspaceSettingsAgentProfileDto = z.infer<typeof WorkspaceSettingsAgentProfileDtoSchema>;
export type WorkspaceSettingsDto = z.infer<typeof WorkspaceSettingsDtoSchema>;
export type UpdateWorkspaceSettingsRequestDto = z.infer<typeof UpdateWorkspaceSettingsRequestDtoSchema>;
