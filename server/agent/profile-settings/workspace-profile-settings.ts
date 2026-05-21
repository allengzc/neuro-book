import fs from "node:fs/promises";
import path from "node:path";
import {createError} from "h3";
import {z} from "zod";
import type {AgentSystem} from "nbook/server/agent/agent-system";
import type {WorkspaceRootKind} from "nbook/server/workspace-files/novel-workspace";
import {USER_ASSETS_WORKSPACE_KIND} from "nbook/server/workspace-files/novel-workspace";
import type {
    WorkspaceAgentProfileSettingsDto,
    WorkspaceAgentProfileSettingsQueryDto,
    UpdateWorkspaceAgentProfileSettingsRequestDto,
} from "nbook/shared/dto/app-settings.dto";
import type {PrismaClient, Prisma} from "nbook/server/generated/prisma/client";
import {resolveWorkspaceRootInput} from "nbook/server/workspace-files/novel-workspace";

const SETTINGS_FILE_NAME = "agent-profile-settings.json";
const WorkspaceProfileSettingsFileSchema = z.object({
    leader: z.object({
        defaultProfileKey: z.string().trim().min(1).nullable().optional(),
    }).optional(),
});

type WorkspaceProfileSettingsFile = z.infer<typeof WorkspaceProfileSettingsFileSchema>;
type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

/**
 * 根据 settings API 查询参数解析 workspace root 与类型。
 */
export async function resolveWorkspaceProfileSettingsTarget(
    prismaClient: PrismaExecutor,
    query: WorkspaceAgentProfileSettingsQueryDto,
): Promise<{workspaceRoot: string; workspaceKind: WorkspaceRootKind}> {
    const workspaceKind = query.workspaceKind === "user-assets" ? "user-assets" : "novel";
    const workspaceRoot = await resolveWorkspaceRootInput(prismaClient, {
        novelId: query.novelId,
        workspaceKind: query.workspaceKind,
    });
    if (!workspaceRoot) {
        throw createError({statusCode: 400, message: "workspaceRoot 不能为空"});
    }
    return {
        workspaceRoot,
        workspaceKind,
    };
}

/**
 * 解析指定 workspace 当前有效的默认 leader profile。
 */
export async function resolveWorkspaceDefaultLeaderProfileKey(input: {
    agentSystem: AgentSystem;
    workspaceRoot: string | null | undefined;
    workspaceKind: WorkspaceRootKind | null | undefined;
    explicitProfileKey?: string | null;
}): Promise<string> {
    if (input.explicitProfileKey?.trim()) {
        return input.explicitProfileKey.trim();
    }

    const settings = input.workspaceRoot
        ? await readWorkspaceProfileSettings(input.workspaceRoot)
        : {};
    const workspaceDefault = settings.leader?.defaultProfileKey?.trim();
    if (workspaceDefault) {
        await assertLeaderProfile(input.agentSystem, workspaceDefault);
        return workspaceDefault;
    }

    return systemDefaultLeaderProfileKey(input.workspaceKind);
}

/**
 * 读取 workspace profile 设置 DTO。
 */
export async function readWorkspaceAgentProfileSettings(input: {
    agentSystem: AgentSystem;
    workspaceRoot: string;
    workspaceKind: WorkspaceRootKind;
}): Promise<WorkspaceAgentProfileSettingsDto> {
    const settings = await readWorkspaceProfileSettings(input.workspaceRoot);
    const workspaceDefault = settings.leader?.defaultProfileKey?.trim() || null;
    const systemDefault = systemDefaultLeaderProfileKey(input.workspaceKind);
    const effective = workspaceDefault ?? systemDefault;
    const profiles = await input.agentSystem.profileRegistry.list();

    return {
        workspaceKind: input.workspaceKind,
        workspaceRoot: input.workspaceRoot,
        systemDefaultLeaderProfileKey: systemDefault,
        workspaceDefaultLeaderProfileKey: workspaceDefault,
        effectiveLeaderProfileKey: effective,
        leaderProfiles: profiles
            .filter((profile) => profile.kind === "leader")
            .map((profile) => ({
                profileKey: profile.key,
                name: profile.name,
                description: null,
                loadStatus: "loaded" as const,
            }))
            .sort((left, right) => left.profileKey.localeCompare(right.profileKey)),
    };
}

/**
 * 更新 workspace profile 设置。
 */
export async function updateWorkspaceAgentProfileSettings(input: {
    agentSystem: AgentSystem;
    workspaceRoot: string;
    workspaceKind: WorkspaceRootKind;
    body: UpdateWorkspaceAgentProfileSettingsRequestDto;
}): Promise<WorkspaceAgentProfileSettingsDto> {
    const nextDefault = input.body.leader.defaultProfileKey?.trim() || null;
    if (nextDefault) {
        await assertLeaderProfile(input.agentSystem, nextDefault);
    }

    await writeWorkspaceProfileSettings(input.workspaceRoot, {
        leader: {
            defaultProfileKey: nextDefault,
        },
    });

    return readWorkspaceAgentProfileSettings({
        agentSystem: input.agentSystem,
        workspaceRoot: input.workspaceRoot,
        workspaceKind: input.workspaceKind,
    });
}

/**
 * 返回系统级默认 leader profile。
 */
export function systemDefaultLeaderProfileKey(workspaceKind: WorkspaceRootKind | null | undefined): string {
    return workspaceKind === USER_ASSETS_WORKSPACE_KIND ? "leader.assets" : "leader.default";
}

/**
 * 校验 profile 是当前可用 leader profile。
 */
async function assertLeaderProfile(agentSystem: AgentSystem, profileKey: string): Promise<void> {
    const profile = await agentSystem.profileRegistry.get(profileKey);
    if (profile.kind !== "leader") {
        throw createError({
            statusCode: 400,
            message: `profile ${profileKey} 不是 leader profile`,
        });
    }
}

/**
 * 读取 workspace profile 设置文件。
 */
async function readWorkspaceProfileSettings(workspaceRoot: string): Promise<WorkspaceProfileSettingsFile> {
    try {
        const raw = await fs.readFile(resolveSettingsPath(workspaceRoot), "utf-8");
        return WorkspaceProfileSettingsFileSchema.parse(JSON.parse(raw));
    } catch (error) {
        if (isMissingPathError(error)) {
            return {};
        }
        throw error;
    }
}

/**
 * 写入 workspace profile 设置文件。
 */
async function writeWorkspaceProfileSettings(workspaceRoot: string, settings: WorkspaceProfileSettingsFile): Promise<void> {
    const filePath = resolveSettingsPath(workspaceRoot);
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, `${JSON.stringify(settings, null, 4)}\n`, "utf-8");
}

/**
 * 解析设置文件绝对路径。
 */
function resolveSettingsPath(workspaceRoot: string): string {
    return path.resolve(process.cwd(), workspaceRoot, ".nbook", SETTINGS_FILE_NAME);
}

/**
 * 判断是否为文件缺失。
 */
function isMissingPathError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "ENOENT";
}
