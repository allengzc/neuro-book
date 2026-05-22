import fs from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {createError} from "h3";
import type {Prisma, PrismaClient} from "nbook/server/generated/prisma/client";
import {useAgentHarness} from "nbook/server/agent/http";
import type {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {USER_ASSETS_WORKSPACE_KIND, resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";
import type {WorkspaceRootKind} from "nbook/server/workspace-files/novel-workspace";
import type {
    UpdateWorkspaceSettingsRequestDto,
    WorkspaceSettingsDto,
    WorkspaceSettingsQueryDto,
} from "nbook/shared/dto/workspace-settings.dto";

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

const SETTINGS_FILE_PATH = path.join(".nbook", "settings.json");

const WorkspaceSettingsFileSchema = z.object({
    agent: z.object({
        defaultProfileKey: z.string().trim().min(1).nullable().optional(),
    }).optional(),
}).passthrough();

type WorkspaceSettingsFile = z.infer<typeof WorkspaceSettingsFileSchema> & {
    [key: string]: JsonValue | undefined;
};

/**
 * 读取工作区设置。第一版只暴露 Agent 默认 Profile，但文件结构允许保留其他字段。
 */
export async function readWorkspaceSettings(input: {
    prisma: PrismaExecutor;
    query: WorkspaceSettingsQueryDto;
    profiles?: AgentProfileCatalog;
}): Promise<WorkspaceSettingsDto> {
    const workspace = await resolveWorkspaceSettingsTarget(input.prisma, input.query);
    const settings = await readSettingsFile(workspace.workspaceRoot);
    return buildWorkspaceSettingsDto({
        workspaceKind: workspace.workspaceKind,
        workspaceRoot: workspace.workspaceRoot,
        settings,
        profiles: input.profiles ?? useAgentHarness().profiles,
    });
}

/**
 * 更新工作区设置。只修改 agent.defaultProfileKey，其他字段保持原样。
 */
export async function updateWorkspaceSettings(input: {
    prisma: PrismaExecutor;
    query: WorkspaceSettingsQueryDto;
    body: UpdateWorkspaceSettingsRequestDto;
    profiles?: AgentProfileCatalog;
}): Promise<WorkspaceSettingsDto> {
    const workspace = await resolveWorkspaceSettingsTarget(input.prisma, input.query);
    const profiles = input.profiles ?? useAgentHarness().profiles;
    const settings = await readSettingsFile(workspace.workspaceRoot);

    if (input.body.agent && Object.hasOwn(input.body.agent, "defaultProfileKey")) {
        const nextProfileKey = input.body.agent.defaultProfileKey?.trim() || null;
        if (nextProfileKey) {
            await assertProfileCanRun(profiles, nextProfileKey);
        }
        settings.agent = {
            ...(settings.agent ?? {}),
            defaultProfileKey: nextProfileKey,
        };
    }

    await writeSettingsFile(workspace.workspaceRoot, settings);
    return buildWorkspaceSettingsDto({
        workspaceKind: workspace.workspaceKind,
        workspaceRoot: workspace.workspaceRoot,
        settings,
        profiles,
    });
}

/**
 * 解析工作区设置目标。
 */
async function resolveWorkspaceSettingsTarget(
    prisma: PrismaExecutor,
    query: WorkspaceSettingsQueryDto,
): Promise<{workspaceRoot: string; workspaceKind: WorkspaceRootKind}> {
    const workspaceKind = query.workspaceKind === USER_ASSETS_WORKSPACE_KIND ? USER_ASSETS_WORKSPACE_KIND : "novel";
    const workspaceRoot = await resolveWorkspaceRootInput(prisma, {
        novelId: query.novelId,
        workspaceKind: query.workspaceKind,
    });
    if (!workspaceRoot) {
        throw createError({
            statusCode: 400,
            message: "workspaceRoot 不能为空",
        });
    }
    return {
        workspaceRoot,
        workspaceKind,
    };
}

/**
 * 组装工作区设置 DTO。
 */
async function buildWorkspaceSettingsDto(input: {
    workspaceKind: WorkspaceRootKind;
    workspaceRoot: string;
    settings: WorkspaceSettingsFile;
    profiles: AgentProfileCatalog;
}): Promise<WorkspaceSettingsDto> {
    const systemDefaultProfileKey = systemDefaultProfileKeyFor(input.workspaceKind);
    const workspaceDefaultProfileKey = input.settings.agent?.defaultProfileKey?.trim() || null;
    const catalog = await input.profiles.snapshot();

    return {
        workspaceKind: input.workspaceKind,
        workspaceRoot: input.workspaceRoot,
        agent: {
            systemDefaultProfileKey,
            workspaceDefaultProfileKey,
            effectiveProfileKey: workspaceDefaultProfileKey || systemDefaultProfileKey,
            profiles: catalog.profiles.map((profile) => ({
                profileKey: profile.key,
                name: profile.name,
                description: profile.description ?? null,
                loadStatus: profile.loadStatus,
            })),
        },
    };
}

/**
 * 校验 profile 是否存在且可运行。
 */
async function assertProfileCanRun(profiles: AgentProfileCatalog, profileKey: string): Promise<void> {
    const catalog = await profiles.snapshot();
    const profile = catalog.profiles.find((item) => item.key === profileKey);
    if (!profile || profile.loadStatus !== "loaded") {
        throw createError({
            statusCode: 400,
            message: `不可用的 profileKey: ${profileKey}`,
        });
    }
}

/**
 * 系统默认 profile。
 */
function systemDefaultProfileKeyFor(workspaceKind: WorkspaceRootKind): string {
    return workspaceKind === USER_ASSETS_WORKSPACE_KIND ? "leader.assets" : "leader.default";
}

/**
 * 读取 settings 文件。缺失时返回空对象，格式异常时抛错。
 */
async function readSettingsFile(workspaceRoot: string): Promise<WorkspaceSettingsFile> {
    try {
        const raw = await fs.readFile(resolveSettingsPath(workspaceRoot), "utf-8");
        const parsed = WorkspaceSettingsFileSchema.parse(JSON.parse(raw));
        return parsed as WorkspaceSettingsFile;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return {};
        }
        throw error;
    }
}

/**
 * 写入 settings 文件。
 */
async function writeSettingsFile(workspaceRoot: string, settings: WorkspaceSettingsFile): Promise<void> {
    const filePath = resolveSettingsPath(workspaceRoot);
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, `${JSON.stringify(settings, null, 4)}\n`, "utf-8");
}

/**
 * settings 文件绝对路径。
 */
function resolveSettingsPath(workspaceRoot: string): string {
    return path.resolve(process.cwd(), workspaceRoot, SETTINGS_FILE_PATH);
}
