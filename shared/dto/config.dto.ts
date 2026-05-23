import {z} from "zod";
import {
    AgentProfileModelConfigDtoSchema,
    ConfiguredModelDtoSchema,
    EnabledModelOptionDtoSchema,
    ModelProviderAdapterSchema,
} from "nbook/shared/dto/app-settings.dto";
import {
    DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
    DEFAULT_MONACO_EDITOR_PREFERENCES,
} from "nbook/shared/editor-workbench";

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
]));

const ConfigPathTextSchema = z.string().trim().min(1);
const NullableModelKeySchema = z.string().trim().min(1).nullable().default(null);
const ProviderIdSchema = z.string().trim().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
const ProviderOptionTextSchema = z.string().trim().default("");
const ProviderTimeoutMsSchema = z.number().int().positive().nullable().default(null);
const ProviderRequestOptionsSchema = z.record(z.string(), JsonValueSchema).default({});
const ProfileKeySchema = z.string().trim().min(1);

/**
 * Secret 字段的编辑态。GET 不返回 value；PUT 中 value 缺失表示保留。
 */
export const SecretConfigValueDtoSchema = z.object({
    configured: z.boolean(),
    maskedValue: z.string().nullable(),
    value: z.string().optional(),
});

export const ConfigScopeDtoSchema = z.enum(["boot", "global", "global-workspace"]);
export const ConfigEffectDtoSchema = z.enum(["hot", "next-run", "next-session", "restart-required"]);
export const ConfigMergeDtoSchema = z.enum(["replace", "deep-merge"]);

export const ConfigItemMetaDtoSchema = z.object({
    key: z.string().trim().min(1),
    scope: ConfigScopeDtoSchema,
    effect: ConfigEffectDtoSchema,
    merge: ConfigMergeDtoSchema,
    secret: z.boolean(),
    description: z.string().trim().min(1),
});

export const ConfigWorkspaceQueryDtoSchema = z.object({
    workspaceKind: z.enum(["novel", "user-assets"]).default("novel"),
    novelId: z.string().trim().min(1).optional(),
}).superRefine((value, ctx) => {
    if (value.workspaceKind === "novel" && !value.novelId) {
        ctx.addIssue({
            code: "custom",
            path: ["novelId"],
            message: "Project Workspace 配置必须提供 novelId",
        });
    }
});

export const ConfigModelProviderOptionsDtoSchema = z.object({
    apiKey: SecretConfigValueDtoSchema,
    baseURL: ProviderOptionTextSchema,
    proxy: ProviderOptionTextSchema,
    timeoutMs: ProviderTimeoutMsSchema,
    requestOptions: ProviderRequestOptionsSchema,
});

export const ConfiguredProviderConfigDtoSchema = z.object({
    id: ProviderIdSchema,
    name: z.string().trim().min(1),
    adapter: ModelProviderAdapterSchema,
    options: ConfigModelProviderOptionsDtoSchema,
    models: z.array(ConfiguredModelDtoSchema).default([]),
});

export const ConfigModelSettingsDtoSchema = z.object({
    defaultModelKey: NullableModelKeySchema,
    defaultModelLabel: z.string().trim().nullable().default(null),
    enabledModels: z.array(EnabledModelOptionDtoSchema).default([]),
    providers: z.array(ConfiguredProviderConfigDtoSchema).default([]),
});

export const ConfigAgentProfileSettingsDtoSchema = z.object({
    enabledModels: z.array(EnabledModelOptionDtoSchema).default([]),
    agentProfiles: z.array(z.object({
        profileKey: ProfileKeySchema,
        name: z.string().trim().min(1),
        model: AgentProfileModelConfigDtoSchema,
    })).default([]),
});

export const ConfigDefaultProfileSettingsDtoSchema = z.object({
    workspaceKind: z.enum(["novel", "user-assets"]),
    projectConfigAvailable: z.boolean(),
    systemDefaultProfileKey: ProfileKeySchema,
    globalDefaultProfileKey: ProfileKeySchema.nullable(),
    projectDefaultProfileKey: ProfileKeySchema.nullable(),
    effectiveProfileKey: ProfileKeySchema,
    profiles: z.array(z.object({
        profileKey: ProfileKeySchema,
        name: z.string().trim().min(1),
        description: z.string().trim().nullable(),
        loadStatus: z.enum(["loaded", "error"]),
    })).default([]),
});

export const MarkdownEditorConfigDtoSchema = z.object({
    fontFamily: z.string().default(DEFAULT_MARKDOWN_EDITOR_PREFERENCES.fontFamily),
    fontSize: z.number().positive().default(DEFAULT_MARKDOWN_EDITOR_PREFERENCES.fontSize),
    lineHeight: z.number().positive().default(DEFAULT_MARKDOWN_EDITOR_PREFERENCES.lineHeight),
    contentWidth: z.number().positive().default(DEFAULT_MARKDOWN_EDITOR_PREFERENCES.contentWidth),
    paragraphIndentEnabled: z.boolean().default(DEFAULT_MARKDOWN_EDITOR_PREFERENCES.paragraphIndentEnabled),
    paragraphIndentEm: z.number().nonnegative().default(DEFAULT_MARKDOWN_EDITOR_PREFERENCES.paragraphIndentEm),
});

export const MonacoEditorConfigDtoSchema = z.object({
    fontFamily: z.string().default(DEFAULT_MONACO_EDITOR_PREFERENCES.fontFamily),
    fontSize: z.number().positive().default(DEFAULT_MONACO_EDITOR_PREFERENCES.fontSize),
    lineHeight: z.number().positive().default(DEFAULT_MONACO_EDITOR_PREFERENCES.lineHeight),
    tabSize: z.number().int().positive().default(DEFAULT_MONACO_EDITOR_PREFERENCES.tabSize),
    wordWrap: z.boolean().default(DEFAULT_MONACO_EDITOR_PREFERENCES.wordWrap),
    minimapEnabled: z.boolean().default(DEFAULT_MONACO_EDITOR_PREFERENCES.minimapEnabled),
    lineNumbers: z.boolean().default(DEFAULT_MONACO_EDITOR_PREFERENCES.lineNumbers),
    renderWhitespace: z.boolean().default(DEFAULT_MONACO_EDITOR_PREFERENCES.renderWhitespace),
});

export const UiConfigDtoSchema = z.object({
    theme: z.enum(["sepia", "light", "dark"]).default("sepia"),
});

export const EditorConfigDtoSchema = z.object({
    markdown: MarkdownEditorConfigDtoSchema.default(DEFAULT_MARKDOWN_EDITOR_PREFERENCES),
    monaco: MonacoEditorConfigDtoSchema.default(DEFAULT_MONACO_EDITOR_PREFERENCES),
});

export const ConfigAgentProfileMapDtoSchema = z.record(z.string(), z.object({
    model: AgentProfileModelConfigDtoSchema,
})).default({});

export const GlobalConfigDtoSchema = z.object({
    auth: z.object({
        enabled: z.boolean().default(true),
    }).default({enabled: true}),
    models: z.object({
        default: NullableModelKeySchema,
        providers: z.array(ConfiguredProviderConfigDtoSchema).default([]),
    }).default({default: null, providers: []}),
    agent: z.object({
        defaultProfileKey: z.object({
            novel: ProfileKeySchema.nullable().default(null),
            userAssets: ProfileKeySchema.nullable().default(null),
        }).default({novel: null, userAssets: null}),
        profiles: ConfigAgentProfileMapDtoSchema,
    }).default({defaultProfileKey: {novel: null, userAssets: null}, profiles: {}}),
    ui: UiConfigDtoSchema.default({theme: "sepia"}),
    editor: EditorConfigDtoSchema.default({
        markdown: DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
        monaco: DEFAULT_MONACO_EDITOR_PREFERENCES,
    }),
}).partial().passthrough();

export const ProjectConfigDtoSchema = z.object({
    models: z.object({
        default: NullableModelKeySchema,
    }).partial().optional(),
    agent: z.object({
        defaultProfileKey: ProfileKeySchema.nullable().optional(),
        profiles: ConfigAgentProfileMapDtoSchema.optional(),
    }).partial().optional(),
    editor: EditorConfigDtoSchema.partial().optional(),
}).partial().passthrough();

export const ConfigSnapshotDtoSchema = z.object({
    version: z.string().trim().min(1),
    effective: z.record(z.string(), JsonValueSchema),
    meta: z.array(ConfigItemMetaDtoSchema),
});

export const ConfigEditorSnapshotDtoSchema = z.object({
    version: z.string().trim().min(1),
    workspaceKind: z.enum(["novel", "user-assets"]),
    global: GlobalConfigDtoSchema,
    project: ProjectConfigDtoSchema.nullable(),
    effective: z.record(z.string(), JsonValueSchema),
    meta: z.array(ConfigItemMetaDtoSchema),
    modelSettings: ConfigModelSettingsDtoSchema,
    agentProfileSettings: ConfigAgentProfileSettingsDtoSchema,
    defaultProfileSettings: ConfigDefaultProfileSettingsDtoSchema,
});

export type SecretConfigValueDto = z.infer<typeof SecretConfigValueDtoSchema>;
export type ConfigItemMetaDto = z.infer<typeof ConfigItemMetaDtoSchema>;
export type ConfigWorkspaceQueryDto = z.infer<typeof ConfigWorkspaceQueryDtoSchema>;
export type ConfigModelSettingsDto = z.infer<typeof ConfigModelSettingsDtoSchema>;
export type ConfigAgentProfileSettingsDto = z.infer<typeof ConfigAgentProfileSettingsDtoSchema>;
export type ConfigDefaultProfileSettingsDto = z.infer<typeof ConfigDefaultProfileSettingsDtoSchema>;
export type GlobalConfigDto = z.infer<typeof GlobalConfigDtoSchema>;
export type ProjectConfigDto = z.infer<typeof ProjectConfigDtoSchema>;
export type ConfigSnapshotDto = z.infer<typeof ConfigSnapshotDtoSchema>;
export type ConfigEditorSnapshotDto = z.infer<typeof ConfigEditorSnapshotDtoSchema>;
