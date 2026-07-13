import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";
import {valid} from "semver";

import type {InstallationManifest, OperationJournal, ReleaseManifest} from "#manager/types";

const SHA256_PATTERN = "^[a-fA-F0-9]{64}$";
const REVISION_PATTERN = "^[a-f0-9]{40}$";
const ISO_DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$";

const InstallProfileSchema = Type.Union([
    Type.Literal("source-dev"),
    Type.Literal("source-product"),
    Type.Literal("product-bun"),
    Type.Literal("windows-portable"),
    Type.Literal("source-docker"),
    Type.Literal("ghcr"),
]);
const ReleaseChannelSchema = Type.Union([Type.Literal("stable"), Type.Literal("canary")]);
const ProductPlatformSchema = Type.Union([Type.Literal("windows-x64"), Type.Literal("linux-x64-glibc")]);
const StateRootSchema = Type.Union([Type.Literal("."), Type.Literal("data")]);
const RevisionSchema = Type.String({pattern: REVISION_PATTERN});
const ChecksumSchema = Type.String({pattern: SHA256_PATTERN});
const RelativePathSchema = Type.String({minLength: 1});

const GitSourceSchema = Type.Object({
    provider: Type.Literal("git"),
    version: Type.String({minLength: 1}),
    revision: RevisionSchema,
    path: Type.Literal("."),
    repository: Type.String({minLength: 1}),
    branch: Type.String({minLength: 1}),
}, {additionalProperties: false});
const ReleaseSourceSchema = Type.Object({
    provider: Type.Literal("release"),
    version: Type.String({minLength: 1}),
    revision: RevisionSchema,
    path: Type.Literal("."),
    files: Type.Array(RelativePathSchema),
    archiveSha256: ChecksumSchema,
    sourceUrl: Type.String({minLength: 1}),
    license: Type.String({minLength: 1}),
    redistribution: Type.String({minLength: 1}),
}, {additionalProperties: false});
const ContainerSourceSchema = Type.Object({
    provider: Type.Literal("container"),
    version: Type.String({minLength: 1}),
    revision: RevisionSchema,
    path: Type.Literal("/app"),
}, {additionalProperties: false});
const SourceSchema = Type.Union([GitSourceSchema, ReleaseSourceSchema, ContainerSourceSchema]);

const GitProductSchema = Type.Object({
    provider: Type.Literal("git"),
    version: Type.String({minLength: 1}),
    revision: RevisionSchema,
    path: Type.Literal(".output"),
    platform: ProductPlatformSchema,
}, {additionalProperties: false});
const ReleaseProductSchema = Type.Object({
    provider: Type.Literal("release"),
    version: Type.String({minLength: 1}),
    revision: RevisionSchema,
    path: Type.Literal(".output"),
    platform: ProductPlatformSchema,
    archiveSha256: ChecksumSchema,
    sourceUrl: Type.String({minLength: 1}),
    license: Type.String({minLength: 1}),
    redistribution: Type.String({minLength: 1}),
}, {additionalProperties: false});
const ContainerProductSchema = Type.Object({
    provider: Type.Literal("container"),
    version: Type.String({minLength: 1}),
    revision: RevisionSchema,
    image: Type.String({minLength: 1}),
    digest: Type.Optional(Type.String({pattern: "^sha256:[a-fA-F0-9]{64}$"})),
}, {additionalProperties: false});
const ProductSchema = Type.Union([GitProductSchema, ReleaseProductSchema, ContainerProductSchema]);

const ManagerSchema = Type.Object({
    provider: Type.Literal("managed"),
    version: Type.String({minLength: 1}),
    path: RelativePathSchema,
    bundleSha256: ChecksumSchema,
}, {additionalProperties: false});
const SystemRuntimeSchema = Type.Object({
    provider: Type.Literal("system"),
    version: Type.String({minLength: 1}),
    executable: Type.String({minLength: 1}),
}, {additionalProperties: false});
const ManagedRuntimeSchema = Type.Object({
    provider: Type.Literal("managed"),
    version: Type.String({minLength: 1}),
    path: RelativePathSchema,
    archiveSha256: ChecksumSchema,
    executableSha256: ChecksumSchema,
    sourceUrl: Type.String({minLength: 1}),
    license: Type.String({minLength: 1}),
    redistribution: Type.String({minLength: 1}),
}, {additionalProperties: false});
const ManagerRuntimeSchema = Type.Union([SystemRuntimeSchema, ManagedRuntimeSchema]);
const ApplicationRuntimeSchema = Type.Union([
    SystemRuntimeSchema,
    ManagedRuntimeSchema,
    Type.Object({provider: Type.Literal("container"), version: Type.String({minLength: 1})}, {additionalProperties: false}),
]);

const SystemToolSchema = SystemRuntimeSchema;
const ManagedToolSchema = ManagedRuntimeSchema;
const ManagedGitToolSchema = Type.Object({
    provider: Type.Literal("managed"),
    version: Type.String({minLength: 1}),
    path: RelativePathSchema,
    bashPath: RelativePathSchema,
    distribution: Type.Literal("PortableGit"),
    archiveSha256: ChecksumSchema,
    gitSha256: ChecksumSchema,
    bashSha256: ChecksumSchema,
    sourceUrl: Type.String({minLength: 1}),
    license: Type.String({minLength: 1}),
    redistribution: Type.String({minLength: 1}),
}, {additionalProperties: false});
const ContainerToolSchema = Type.Object({provider: Type.Literal("container"), version: Type.String({minLength: 1})}, {additionalProperties: false});
const ToolComponentsSchema = Type.Object({
    rg: Type.Optional(Type.Union([SystemToolSchema, ManagedToolSchema, ContainerToolSchema])),
    git: Type.Optional(Type.Union([SystemToolSchema, ManagedGitToolSchema, ContainerToolSchema])),
    python: Type.Optional(Type.Union([SystemToolSchema, ContainerToolSchema])),
}, {additionalProperties: false});

export const InstallationManifestSchema = Type.Object({
    schemaVersion: Type.Literal(3),
    profile: InstallProfileSchema,
    managerVersion: Type.String({minLength: 1}),
    appVersion: Type.String({minLength: 1}),
    channel: ReleaseChannelSchema,
    sourceRevision: RevisionSchema,
    stateRoot: StateRootSchema,
    components: Type.Object({
        source: SourceSchema,
        product: Type.Optional(ProductSchema),
        manager: ManagerSchema,
        managerRuntime: ManagerRuntimeSchema,
        applicationRuntime: ApplicationRuntimeSchema,
        tools: ToolComponentsSchema,
    }, {additionalProperties: false}),
    installedAt: Type.String({pattern: ISO_DATE_PATTERN}),
    updatedAt: Type.String({pattern: ISO_DATE_PATTERN}),
}, {additionalProperties: false});

const OperationPhaseSchema = Type.Union([
    Type.Literal("planned"),
    Type.Literal("staged"),
    Type.Literal("validated"),
    Type.Literal("switched"),
    Type.Literal("migrated"),
    Type.Literal("healthy"),
    Type.Literal("committed"),
]);

export const OperationJournalSchema = Type.Object({
    schemaVersion: Type.Literal(1),
    id: Type.String({minLength: 1}),
    action: Type.Union([Type.Literal("install"), Type.Literal("update")]),
    phase: OperationPhaseSchema,
    root: Type.String({minLength: 1}),
    createdPaths: Type.Array(RelativePathSchema),
    backupRoot: Type.String({minLength: 1}),
    previousManifest: Type.Union([InstallationManifestSchema, Type.Null()]),
    nextManifest: Type.Union([InstallationManifestSchema, Type.Null()]),
    git: Type.Optional(Type.Object({
        previousRevision: RevisionSchema,
        targetRevision: RevisionSchema,
        committed: Type.Boolean(),
    }, {additionalProperties: false})),
    sourceDependenciesInstalled: Type.Optional(Type.Boolean()),
    databaseBackup: Type.Optional(Type.String({minLength: 1})),
    databasePath: Type.Optional(Type.String({minLength: 1})),
    previousCompose: Type.Optional(Type.String({minLength: 1})),
    composeChanged: Type.Optional(Type.Boolean()),
    composeCreated: Type.Optional(Type.Boolean()),
    dockerImageCreated: Type.Optional(Type.String({minLength: 1})),
    dockerImageCleanupError: Type.Optional(Type.String({minLength: 1})),
    wrapperBackup: Type.Optional(Type.String({minLength: 1})),
    wrappersChanged: Type.Optional(Type.Boolean()),
    outcome: Type.Optional(Type.Union([Type.Literal("success"), Type.Literal("rolled-back")])),
    createdAt: Type.String({pattern: ISO_DATE_PATTERN}),
    updatedAt: Type.String({pattern: ISO_DATE_PATTERN}),
}, {additionalProperties: false});

const ReleaseAssetSchema = Type.Object({
    url: Type.String({minLength: 1}),
    sha256: ChecksumSchema,
    bytes: Type.Integer({minimum: 0}),
}, {additionalProperties: false});
const ProductReleaseAssetSchema = Type.Object({
    url: Type.String({minLength: 1}),
    sha256: ChecksumSchema,
    bytes: Type.Integer({minimum: 0}),
    platform: ProductPlatformSchema,
    sourceRevision: RevisionSchema,
}, {additionalProperties: false});
const ReleaseImageSchema = Type.Object({
    ref: Type.String({minLength: 1}),
    digest: Type.String({pattern: "^sha256:[a-fA-F0-9]{64}$"}),
    sourceRevision: RevisionSchema,
}, {additionalProperties: false});

export const ReleaseManifestSchema = Type.Object({
    schemaVersion: Type.Literal(2),
    version: Type.String({minLength: 1}),
    channel: ReleaseChannelSchema,
    sourceRevision: RevisionSchema,
    minManagerVersion: Type.String({minLength: 1}),
    source: ReleaseAssetSchema,
    products: Type.Array(ProductReleaseAssetSchema, {minItems: 1}),
    windowsPortable: ReleaseAssetSchema,
    ghcr: ReleaseImageSchema,
}, {additionalProperties: false});

export type InstallationManifestValue = Static<typeof InstallationManifestSchema>;
export type OperationJournalValue = Static<typeof OperationJournalSchema>;
export type ReleaseManifestValue = Static<typeof ReleaseManifestSchema>;

/** 严格解析并执行 Profile/组件语义校验。 */
export function parseInstallationManifest(value: unknown): InstallationManifest {
    assertSchema(
        InstallationManifestSchema,
        value,
        "installation.json 不符合 NeuroBook Manager schema v3；旧版安装必须重新安装，Windows Portable 只复用完整 data/。",
    );
    const manifest = value as InstallationManifest;
    assertSemVer(manifest.managerVersion, "managerVersion");
    assertSemVer(manifest.appVersion, "appVersion");
    assertInstallationSemantics(manifest);
    assertComponentPaths(manifest);
    return manifest;
}

/** 严格解析崩溃恢复账本，禁止未经校验的路径和 Manifest 进入回滚流程。 */
export function parseOperationJournal(value: unknown, path: string): OperationJournal {
    assertSchema(OperationJournalSchema, value, `Operation journal 不符合 schema：${path}`);
    const journal = value as OperationJournal;
    for (const createdPath of journal.createdPaths) assertSafeRelativePath(createdPath);
    if (journal.previousManifest) parseInstallationManifest(journal.previousManifest);
    if (journal.nextManifest) parseInstallationManifest(journal.nextManifest);
    if (journal.git?.committed && !journal.nextManifest) {
        throw new Error(`Git 已提交的 Operation journal 缺少 nextManifest：${path}`);
    }
    return journal;
}

/** 严格解析并执行 Release revision/platform 语义校验。 */
export function parseReleaseManifest(value: unknown): ReleaseManifest {
    assertSchema(ReleaseManifestSchema, value, "release-manifest.json 不符合 NeuroBook Release schema v2。");
    const manifest = value as ReleaseManifest;
    assertSemVer(manifest.version, "version");
    assertSemVer(manifest.minManagerVersion, "minManagerVersion");
    const platforms = new Set<string>();
    for (const product of manifest.products) {
        if (product.sourceRevision !== manifest.sourceRevision) {
            throw new Error(`Product ${product.platform} sourceRevision 与 Release Source 不一致。`);
        }
        if (platforms.has(product.platform)) {
            throw new Error(`Release Manifest 包含重复 Product 平台：${product.platform}`);
        }
        platforms.add(product.platform);
    }
    if (manifest.ghcr.sourceRevision !== manifest.sourceRevision) {
        throw new Error("GHCR sourceRevision 与 Release Source 不一致。");
    }
    return manifest;
}

function assertInstallationSemantics(manifest: InstallationManifest): void {
    const {source, product, applicationRuntime, tools} = manifest.components;
    if (source.revision !== manifest.sourceRevision || product && product.revision !== manifest.sourceRevision) {
        throw new Error("Installation Source/Product revision 与 sourceRevision 不一致。");
    }
    if (manifest.profile === "windows-portable" && manifest.stateRoot !== "data" || manifest.profile !== "windows-portable" && manifest.stateRoot !== ".") {
        throw new Error(`Profile ${manifest.profile} 的 State Root 非法：${manifest.stateRoot}`);
    }
    const expected = profileContract(manifest.profile);
    if (source.provider !== expected.source || (product?.provider ?? "none") !== expected.product || !expected.runtimes.includes(applicationRuntime.provider)) {
        throw new Error(`Profile ${manifest.profile} 的 Source/Product/Application Runtime 组件组合非法。`);
    }
    if (manifest.profile === "windows-portable") {
        if (tools.rg?.provider !== "managed" || tools.git?.provider !== "managed" || !("bashPath" in tools.git)) {
            throw new Error("Windows Portable 必须包含 managed rg 和提供 bash 的 PortableGit。" );
        }
    }
    if (manifest.profile === "ghcr" || manifest.profile === "source-docker") {
        if (tools.rg?.provider !== "container" || tools.git?.provider !== "container" || tools.python?.provider !== "container") {
            throw new Error(`${manifest.profile} 的应用工具必须由 container provider 提供。`);
        }
    }
    if (manifest.profile === "ghcr" && (!product || product.provider !== "container" || !product.digest)) {
        throw new Error("GHCR Product 必须记录不可变 image digest。");
    }
    if (manifest.profile === "source-docker" && product?.provider === "container" && product.digest) {
        throw new Error("Source Docker 使用本地 revision image，不记录 GHCR digest。");
    }
}

function profileContract(profile: InstallationManifest["profile"]): {source: string; product: string; runtimes: string[]} {
    switch (profile) {
        case "source-dev": return {source: "git", product: "none", runtimes: ["system", "managed"]};
        case "source-product": return {source: "git", product: "git", runtimes: ["system", "managed"]};
        case "product-bun": return {source: "release", product: "release", runtimes: ["system", "managed"]};
        case "windows-portable": return {source: "release", product: "release", runtimes: ["managed"]};
        case "source-docker": return {source: "git", product: "container", runtimes: ["container"]};
        case "ghcr": return {source: "container", product: "container", runtimes: ["container"]};
    }
}

function assertComponentPaths(manifest: InstallationManifest): void {
    const paths = [
        manifest.components.manager.path,
        manifest.components.managerRuntime.provider === "managed" ? manifest.components.managerRuntime.path : null,
        manifest.components.applicationRuntime.provider === "managed" ? manifest.components.applicationRuntime.path : null,
        manifest.components.tools.rg?.provider === "managed" ? manifest.components.tools.rg.path : null,
        manifest.components.tools.git?.provider === "managed" ? manifest.components.tools.git.path : null,
        manifest.components.tools.git?.provider === "managed" ? manifest.components.tools.git.bashPath : null,
        ...manifest.components.source.provider === "release" ? manifest.components.source.files : [],
    ].filter((path): path is string => Boolean(path));
    for (const path of paths) assertSafeRelativePath(path);
}

export function assertSafeRelativePath(path: string): void {
    const normalized = path.replaceAll("\\", "/");
    if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized) || normalized.split("/").includes("..")) {
        throw new Error(`组件路径必须位于 Installation Root 内：${path}`);
    }
}

function assertSemVer(version: string, field: string): void {
    if (!valid(version)) throw new Error(`${field} 不是合法 SemVer：${version}`);
}

function assertSchema(schema: TSchema, value: unknown, message: string): void {
    if (!Value.Check(schema, value)) throw new Error(message);
}
