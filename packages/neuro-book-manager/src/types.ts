/** NeuroBook Manager 支持的安装 Profile。 */
export type InstallProfile =
    | "source-dev"
    | "source-product"
    | "product-bun"
    | "windows-portable"
    | "source-docker"
    | "ghcr";

/** Release channel。canary 表示全部受支持 prerelease。 */
export type ReleaseChannel = "stable" | "canary";

/** 用户级 Manager 配置中的安装偏好。 */
export type ManagerPreferences = {
    channel: ReleaseChannel;
    installDirectory: string;
    discoveryRoots?: string[];
};

export type CommandInspection = {available: boolean; version?: string};
export type InspectionIssue = {code: string; message: string; remediation?: string};
export type CandidateKind = "managed-installation" | "neuro-book-checkout" | "portable-state" | "invalid-installation" | "unrelated";
export type GitInspection = {repository: string; branch: string; upstream?: string; revision: string; dirty: boolean};
export type ProductInspection = {exists: boolean; trusted: boolean; revision?: string};
export type StateInspection = {root: StateRootPath; configExists: boolean; workspaceExists: boolean; databaseExists: boolean};

/** 目录身份和离线完整性检查；不包含运行状态。 */
export type OfflineInspection = {
    root: string;
    kind: CandidateKind;
    manifest?: InstallationManifest;
    git?: GitInspection;
    product: ProductInspection;
    state: StateInspection;
    blockers: InspectionIssue[];
    warnings: InspectionIssue[];
};

export type EnvironmentInspection = {bun: CommandInspection; git: CommandInspection; docker: CommandInspection; compose: CommandInspection};
export type InstanceDiscovery = {candidates: OfflineInspection[]; warnings: InspectionIssue[]};
export type ImportInspection = OfflineInspection & {importable: boolean};

/** 用户注册的 NeuroBook 实例索引；实例自身状态仍以 installation.json 为准。 */
export type ManagerInstance = {
    id: string;
    name: string;
    root: string;
    registeredAt: string;
    lastUsedAt: string;
};

/** 位于用户主目录的 Manager 配置。 */
export type ManagerConfig = {
    schemaVersion: 1;
    defaultInstanceId: string | null;
    preferences: ManagerPreferences;
    instances: ManagerInstance[];
};

/** 当前支持的 Product 平台。 */
export type ProductPlatform = "windows-x64" | "linux-x64-glibc";

/** update 命令可独立选择的应用组件。 */
export type ComponentId = "source" | "product" | "runtime" | "tools";

/** 安装根允许的 State Root 映射。 */
export type StateRootPath = "." | "data";

/** 托管下载资产必须保存的审计信息。 */
export type ManagedAssetMetadata = {
    archiveSha256: string;
    sourceUrl: string;
    license: string;
    redistribution: string;
};

export type SourceComponent =
    | {
        provider: "git";
        version: string;
        revision: string;
        path: ".";
        repository: string;
        branch: string;
    }
    | ({
        provider: "release";
        version: string;
        revision: string;
        path: ".";
        files: string[];
    } & ManagedAssetMetadata)
    | {
        provider: "container";
        version: string;
        revision: string;
        path: "/app";
    };

export type ProductComponent =
    | {
        provider: "git";
        version: string;
        revision: string;
        path: ".output";
        platform: ProductPlatform;
    }
    | ({
        provider: "release";
        version: string;
        revision: string;
        path: ".output";
        platform: ProductPlatform;
    } & ManagedAssetMetadata)
    | {
        provider: "container";
        version: string;
        revision: string;
        image: string;
        /** GHCR 必填；Source Docker 的本地 revision image 不设置。 */
        digest?: string;
    };

export type ManagerComponent = {
    provider: "managed";
    version: string;
    path: string;
    bundleSha256: string;
};

export type SystemRuntimeComponent = {
    provider: "system";
    version: string;
    executable: string;
};

export type ManagedRuntimeComponent = {
    provider: "managed";
    version: string;
    path: string;
    executableSha256: string;
} & ManagedAssetMetadata;

export type ManagerRuntimeComponent = SystemRuntimeComponent | ManagedRuntimeComponent;

export type ApplicationRuntimeComponent = ManagerRuntimeComponent | {
    provider: "container";
    version: string;
};

export type SystemToolComponent = {
    provider: "system";
    version: string;
    executable: string;
};

export type ManagedToolComponent = {
    provider: "managed";
    version: string;
    path: string;
    executableSha256: string;
} & ManagedAssetMetadata;

export type ManagedGitToolComponent = Omit<ManagedToolComponent, "executableSha256"> & {
    distribution: "PortableGit";
    bashPath: string;
    gitSha256: string;
    bashSha256: string;
};

export type ContainerToolComponent = {
    provider: "container";
    version: string;
};

export type ToolComponents = {
    rg?: SystemToolComponent | ManagedToolComponent | ContainerToolComponent;
    git?: SystemToolComponent | ManagedGitToolComponent | ContainerToolComponent;
    python?: SystemToolComponent | ContainerToolComponent;
};

export type InstallationComponents = {
    source: SourceComponent;
    product?: ProductComponent;
    manager: ManagerComponent;
    managerRuntime: ManagerRuntimeComponent;
    applicationRuntime: ApplicationRuntimeComponent;
    tools: ToolComponents;
};

/** 本机安装状态真相源。 */
export type InstallationManifest = {
    schemaVersion: 3;
    profile: InstallProfile;
    managerVersion: string;
    appVersion: string;
    channel: ReleaseChannel;
    sourceRevision: string;
    stateRoot: StateRootPath;
    components: InstallationComponents;
    installedAt: string;
    updatedAt: string;
};

/** Release 中的可下载资产。 */
export type ReleaseAsset = {
    url: string;
    sha256: string;
    bytes: number;
};

/** 平台 Product 资产。 */
export type ProductReleaseAsset = ReleaseAsset & {
    platform: ProductPlatform;
    sourceRevision: string;
};

/** GHCR 镜像信息。 */
export type ReleaseImage = {
    ref: string;
    digest: string;
    sourceRevision: string;
};

/** GitHub Release 附带的统一组件清单。 */
export type ReleaseManifest = {
    schemaVersion: 2;
    version: string;
    channel: ReleaseChannel;
    sourceRevision: string;
    minManagerVersion: string;
    source: ReleaseAsset;
    products: ProductReleaseAsset[];
    windowsPortable: ReleaseAsset;
    ghcr: ReleaseImage;
};

/** Profile 对组件来源的声明。 */
export type ProfileDefinition = {
    profile: InstallProfile;
    source: SourceComponent["provider"];
    product: "none" | "build" | ProductComponent["provider"];
    applicationRuntime: ApplicationRuntimeComponent["provider"];
    tools: "system" | "managed" | "container";
    docker: boolean;
};

/** Manager 操作计划，dry-run 与执行共用。 */
export type OperationPlan = {
    action: "install" | "update" | "start";
    root: string;
    profile: InstallProfile;
    steps: string[];
};

export type OperationPhase = "planned" | "staged" | "validated" | "switched" | "migrated" | "healthy" | "committed";

export type OperationJournal = {
    schemaVersion: 1;
    id: string;
    action: "install" | "update";
    phase: OperationPhase;
    root: string;
    createdPaths: string[];
    backupRoot: string;
    previousManifest: InstallationManifest | null;
    nextManifest: InstallationManifest | null;
    git?: {
        previousRevision: string;
        targetRevision: string;
        committed: boolean;
    };
    /** Source Dev Git 已提交后，主 checkout 的 frozen install 是否完成。 */
    sourceDependenciesInstalled?: boolean;
    databaseBackup?: string;
    databasePath?: string;
    previousCompose?: string;
    wrapperBackup?: string;
    wrappersChanged?: boolean;
    outcome?: "success" | "rolled-back";
    createdAt: string;
    updatedAt: string;
};
