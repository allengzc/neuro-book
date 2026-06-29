import {createClient, type Client} from "@libsql/client";
import {WorldCalendarLoader} from "nbook/server/world-engine/calendar";
import type {WorldCalendar} from "nbook/server/world-engine/calendar";
import {flattenAttrs, WorldSchemaLoader} from "nbook/server/world-engine/schema-loader";
import {WorldEngineRepository} from "nbook/server/world-engine/world-engine.repository";
import {WorldEngineService} from "nbook/server/world-engine/world-engine.service";
import {executeCodeAct} from "nbook/server/world-engine/codeact-sandbox";
import {createWorldApi} from "nbook/server/world-engine/codeact-api";
import {dedupeWorldIssues} from "nbook/server/world-engine/world-issue-builder";
import type {
    CreateWorldSubjectInput,
    DeleteSliceResult,
    QueryStateResult,
    SliceInput,
    SliceListItem,
    SliceWriteResult,
    CreateWorldSubjectResult,
    WorldSchemaProjection,
    WorldSliceSubjectFilterMode,
    WorldSubjectListItem,
    WorldIssue,
} from "nbook/server/world-engine/types";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {initProjectDatabase, normalizeProjectPath, resolveProjectDatabasePath, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";

type WorldEngineModule = {
    service: WorldEngineService;
    repository: WorldEngineRepository;
    calendar: WorldCalendar;
};

type WorldEngineClientEntry = {
    client: Client | null;
};

type TransactionMode = "write" | "read" | "deferred";

export type ExecuteWorldMode = "readonly" | "readwrite";

export type ExecuteWorldResult = {
    data: unknown;
    issues: WorldIssue[];
};

export type ExecuteWorldOptions = {
    timeout?: number;
};

/** 世界引擎后端门面。 */
export class WorldEngineFacade {
    private readonly schemaLoader = new WorldSchemaLoader();
    private readonly calendarLoader = new WorldCalendarLoader();

    /** 关闭指定 Project SQLite 的 PrismaClient。 */
    async closeProject(_projectPath: string): Promise<void> {
        // World Engine 不持久缓存 Project PrismaClient；这里保留为删除流程的释放兜底。
        collectReleasedSqliteHandles({force: true});
    }

    /** 创建 subject + 初始化切面。 */
    async createSubject(projectPath: string, input: CreateWorldSubjectInput): Promise<CreateWorldSubjectResult> {
        return this.runInTransaction(projectPath, (module) => module.service.createSubject(input));
    }

    /** 写入新切面。 */
    async writeSlice(projectPath: string, input: SliceInput): Promise<SliceWriteResult> {
        return this.runInTransaction(projectPath, (module) => module.service.writeSlice(input));
    }

    /** 整块编辑已有切面。 */
    async editSlice(projectPath: string, sliceId: string, input: SliceInput): Promise<SliceWriteResult> {
        return this.runInTransaction(projectPath, (module) => module.service.editSlice(sliceId, input));
    }

    /** 物理删除一个切面。 */
    async deleteSlice(projectPath: string, sliceId: string): Promise<DeleteSliceResult> {
        return this.runInTransaction(projectPath, (module) => module.service.deleteSlice(sliceId));
    }

    /** 读取单个切面及 patch。 */
    async getSlice(projectPath: string, sliceId: string): Promise<SliceListItem> {
        return this.runWithModule(projectPath, (module) => module.service.getSlice(sliceId));
    }

    /** 查询世界状态；公开入口负责决定是否允许全量查询。 */
    async queryState(projectPath: string, query: {subjectIds?: string[]; type?: string; attrs?: string[]; at?: bigint; listLimit?: number}): Promise<QueryStateResult> {
        return this.runWithModule(projectPath, (module) => module.service.queryState(query));
    }

    /** 列出切面。 */
    async listSlices(projectPath: string, query: {from?: bigint; to?: bigint; limit?: number; withPatches?: boolean; subjectIds?: string[]; subjectMode?: WorldSliceSubjectFilterMode} = {}): Promise<SliceListItem[]> {
        return this.runWithModule(projectPath, (module) => module.service.listSlices(query));
    }

    /** 列出 subject 身份。 */
    async listSubjects(projectPath: string, query: {type?: string} = {}): Promise<WorldSubjectListItem[]> {
        return this.runWithModule(projectPath, (module) => module.service.listSubjects(query));
    }

    /** 返回 Agent 友好的 world schema 投影。 */
    async getWorldSchema(projectPath: string): Promise<WorldSchemaProjection> {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const schema = await this.schemaLoader.load(normalizedProjectPath);
        const calendar = await this.calendarLoader.load(normalizedProjectPath);
        return {
            subjectTypes: Object.entries(schema.subjectTypes).map(([type, subjectType]) => ({
                type,
                desc: subjectType.desc,
                attrs: flattenAttrs(subjectType.attrs),
            })),
            calendar: calendar.projection(),
        };
    }

    /** 解析项目日历字符串。 */
    async parseTime(projectPath: string, input: string): Promise<bigint> {
        const calendar = await this.calendarLoader.load(normalizeProjectPath(projectPath));
        return calendar.parse(input);
    }

    /** 格式化项目时间。 */
    async formatTime(projectPath: string, instant: bigint): Promise<string> {
        const calendar = await this.calendarLoader.load(normalizeProjectPath(projectPath));
        return calendar.format(instant);
    }

    /** 执行 CodeAct 查询代码。 */
    async executeCodeActQuery(projectPath: string, code: string): Promise<unknown> {
        return (await this.executeCodeActWorld(projectPath, code, "readonly")).data;
    }

    /** 在同一 deferred 事务内执行 CodeAct 世界读写代码。 */
    async executeCodeActWorld(projectPath: string, code: string, mode: ExecuteWorldMode = "readwrite", options: ExecuteWorldOptions = {}): Promise<ExecuteWorldResult> {
        return this.runInTransaction(projectPath, async (module) => {
            const currentInstant = await module.service.getCurrentInstant();
            const issues: WorldIssue[] = [];

            const worldApi = createWorldApi({
                service: module.service,
                repository: module.repository,
                currentInstant,
                mode,
                issueCollector: issues,
                parseTime: (input) => module.calendar.parse(input),
                formatTime: (instant) => module.calendar.format(instant),
            });

            const data = await executeCodeAct(code, worldApi, {
                timeout: options.timeout ?? (mode === "readwrite" ? 15_000 : 5_000),
            });
            return {
                data: data === undefined ? "执行完成" : data,
                issues: dedupeWorldIssues(issues),
            };
        }, "deferred");
    }

    private async runInTransaction<TResult>(projectPath: string, callback: (module: WorldEngineModule) => Promise<TResult>, mode: TransactionMode = "write"): Promise<TResult> {
        const entry = await this.createClientEntry(projectPath);
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const client = this.requireClient(entry);
        await client.execute(transactionBeginStatement(mode));
        try {
            const result = await callback(await this.createModuleFromExecutor(client, normalizedProjectPath));
            await client.execute("COMMIT");
            return result;
        } catch (error) {
            try {
                await client.execute("ROLLBACK");
            } catch {
                // 保留原始业务错误，rollback 失败只说明连接已不可恢复或事务已结束。
            }
            throw error;
        } finally {
            await this.closeClientEntry(entry);
        }
    }

    private async runWithModule<TResult>(projectPath: string, callback: (module: WorldEngineModule) => Promise<TResult>): Promise<TResult> {
        const entry = await this.createClientEntry(projectPath);
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const client = this.requireClient(entry);
        try {
            return await callback(await this.createModuleFromExecutor(client, normalizedProjectPath));
        } finally {
            await this.closeClientEntry(entry);
        }
    }

    private async createClientEntry(projectPath: string): Promise<WorldEngineClientEntry> {
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        await initProjectDatabase(normalizedProjectPath);
        const databasePath = resolveProjectDatabasePath(normalizedProjectPath);
        return {client: createClient({url: toSqliteFileUrl(databasePath)})};
    }

    private async closeClientEntry(entry: WorldEngineClientEntry): Promise<void> {
        const client = this.requireClient(entry);
        client.close();
        entry.client = null;
        await Promise.resolve();
        collectReleasedSqliteHandles();
    }

    private requireClient(entry: WorldEngineClientEntry): Client {
        if (!entry.client) {
            throw new Error("World Engine SQLite client 已关闭");
        }
        return entry.client;
    }

    private async createModuleFromExecutor(executor: Client, projectPath: string): Promise<WorldEngineModule> {
        const schema = await this.schemaLoader.load(projectPath);
        const calendar = await this.calendarLoader.load(projectPath);
        const repository = new WorldEngineRepository(executor);
        return {
            service: new WorldEngineService(repository, schema, calendar, projectPath),
            repository,
            calendar,
        };
    }
}

function transactionBeginStatement(mode: TransactionMode): string {
    if (mode === "write") {
        return "BEGIN IMMEDIATE";
    }
    if (mode === "read") {
        return "BEGIN TRANSACTION READONLY";
    }
    return "BEGIN DEFERRED";
}
