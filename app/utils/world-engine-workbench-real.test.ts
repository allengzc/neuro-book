import {describe, expect, it} from "vitest";
import {
    buildWorldWorkbenchCurrentReviewQueueIndex,
    buildWorldWorkbenchDraftSurfaceState,
    buildWorldWorkbenchEditSliceBody,
    buildWorldWorkbenchEmptySliceState,
    buildWorldWorkbenchIssueTriageSummary,
    buildWorldWorkbenchReviewQueueItems,
    buildWorldWorkbenchSliceComposerSubjectSelection,
    buildWorldWorkbenchSliceReviewSummaries,
    buildWorldWorkbenchSubjectFileProposals,
    buildWorldWorkbenchSubjectStats,
    buildWorldWorkbenchSubjectSystemInitialAttrs,
    buildWorldWorkbenchSubjectSystemSummariesFromRagOverview,
    buildWorldWorkbenchUnsavedDraftLabels,
    buildWorldWorkbenchWorldViewFilterParts,
    collectWorldWorkbenchDraftSliceIds,
    collectWorldWorkbenchSliceTimes,
    findWorldWorkbenchFirstRemainingDraftSliceId,
    findWorldWorkbenchLatestSliceTouchingSubjects,
    formatWorldWorkbenchSubjectFileProposal,
    isWorldWorkbenchSliceVisibleInSubjectFilter,
    mergeWorldWorkbenchKnownSliceTimes,
    mergeWorldWorkbenchTimelineSlice,
    mergeWorldWorkbenchSubjectsWithSubjectSystem,
    normalizeWorldWorkbenchSlices,
    shouldClearWorldWorkbenchReviewIssueFocus,
    worldWorkbenchIssueLevel,
    worldWorkbenchIssueStatusLabel,
} from "nbook/app/utils/world-engine-workbench-real";
import type {WorldSliceDto} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import type {
    WorldWorkbenchPreviewIssueTriageState,
    WorldWorkbenchPreviewSlice,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

describe("World Engine real Workbench util", () => {
    it("保留完整 mutation 并合并 transient issue", () => {
        const apiSlices: WorldSliceDto[] = [
            {
                id: "slice-a",
                time: "复兴纪元 1 年 1 月 1 日 08:00",
                title: "初始化",
                summary: "创建世界",
                kind: "init",
            },
            {
                id: "slice-b",
                time: "复兴纪元 1 年 1 月 1 日 09:00",
                title: "旧剑磨损",
                summary: "艾莉娜进入东塔",
                kind: "event",
                mutations: [
                    {subjectId: "old-sword", attr: "durability", op: "set", value: 80},
                    {subjectId: "erina", attr: "events", op: "listAppend", value: "进入东塔"},
                ],
                issues: [
                    {code: "masked", subjectId: "old-sword", attr: "durability", message: "后续 set 覆盖当前值", sliceId: "slice-b"},
                ],
            },
        ];
        const normalized = normalizeWorldWorkbenchSlices(apiSlices);
        expect(normalized[0]?.mutations).toEqual([]);
        expect(normalized[0]?.issues).toEqual([]);
        expect(collectWorldWorkbenchSliceTimes([
            {time: "  "},
            {time: "复兴纪元 1 年 1 月 1 日 08:00"},
            {time: "  复兴纪元 1 年 1 月 1 日 09:00  "},
        ])).toEqual([
            "复兴纪元 1 年 1 月 1 日 08:00",
            "复兴纪元 1 年 1 月 1 日 09:00",
        ]);
        expect(mergeWorldWorkbenchKnownSliceTimes(["复兴纪元 1 年 1 月 1 日 08:00"], normalized)).toEqual([
            "复兴纪元 1 年 1 月 1 日 09:00",
            "复兴纪元 1 年 1 月 1 日 08:00",
        ]);
        expect(collectWorldWorkbenchDraftSliceIds({
            metadataDraftSliceIds: ["slice-b", "missing-meta"],
            slices: normalized,
            valueDraftSliceIds: ["slice-a", "slice-b", "missing-value"],
        })).toEqual(["slice-a", "slice-b", "missing-meta", "missing-value"]);
        expect(findWorldWorkbenchFirstRemainingDraftSliceId(["slice-b", "missing-meta"], "slice-b")).toBe("missing-meta");
        expect(findWorldWorkbenchFirstRemainingDraftSliceId(["slice-b"], "slice-b")).toBe("");

        const mergedTimeline = mergeWorldWorkbenchTimelineSlice(normalized, {
            id: "slice-middle",
            previousTime: "复兴纪元 1 年 1 月 1 日 08:00",
            time: "复兴纪元 1 年 1 月 1 日 08:30",
            title: "中间补切片",
            summary: "",
            kind: "event",
            mutations: [],
            issues: [],
        });
        expect(mergedTimeline.map((slice) => slice.id)).toEqual(["slice-a", "slice-middle", "slice-b"]);
        expect(findWorldWorkbenchLatestSliceTouchingSubjects(mergedTimeline, [])).toBeNull();
        expect(findWorldWorkbenchLatestSliceTouchingSubjects(mergedTimeline, ["erina"])?.id).toBe("slice-b");
        expect(findWorldWorkbenchLatestSliceTouchingSubjects(mergedTimeline, ["old-sword"])?.id).toBe("slice-b");
        expect(findWorldWorkbenchLatestSliceTouchingSubjects(mergedTimeline, ["missing-subject"])).toBeNull();

        const editBody = buildWorldWorkbenchEditSliceBody(normalized[1] as WorldWorkbenchPreviewSlice, {title: "旧剑重新评估"}, [
            {sliceId: "slice-b", mutationIndex: 0, value: 82},
        ]);
        expect(editBody).toMatchObject({
            time: "复兴纪元 1 年 1 月 1 日 09:00",
            title: "旧剑重新评估",
            summary: "艾莉娜进入东塔",
            kind: "event",
        });
        expect(editBody.mutations).toEqual([
            {subjectId: "old-sword", attr: "durability", op: "set", value: 82},
            {subjectId: "erina", attr: "events", op: "listAppend", value: "进入东塔"},
        ]);

        const triage = new Map<string, WorldWorkbenchPreviewIssueTriageState["status"]>();
        const items = buildWorldWorkbenchReviewQueueItems({
            slices: normalized,
            transientIssues: [
                {
                    attr: "hp",
                    code: "broken-relative",
                    issueIndex: 0,
                    key: "transient:hp",
                    message: "add 没有基准",
                    sliceId: "slice-b",
                    sliceTime: "复兴纪元 1 年 1 月 1 日 09:00",
                    sliceTitle: "旧剑磨损",
                    subjectId: "erina",
                },
            ],
            triageStatus: triage,
        });
        expect(items.map((item) => item.code)).toEqual(["masked", "broken-relative"]);
        expect(items.every((item) => item.status === "open")).toBe(true);

        triage.set(items[0]?.key ?? "", "confirmed");
        expect(items[1]?.identity).toBeTruthy();
        triage.set(items[1]?.identity ?? "", "ignored");
        const reorderedItems = buildWorldWorkbenchReviewQueueItems({
            slices: [{
                ...(normalized[1] as WorldWorkbenchPreviewSlice),
                issues: [
                    {code: "broken-relative", subjectId: "erina", attr: "hp", message: "add 没有基准", sliceId: "slice-b"},
                    {code: "masked", subjectId: "old-sword", attr: "durability", message: "后续 set 覆盖当前值", sliceId: "slice-b"},
                ],
            }],
            transientIssues: [],
            triageStatus: triage,
        });
        expect(reorderedItems.map((item) => `${item.code}:${item.status}`)).toEqual(["broken-relative:ignored", "masked:confirmed"]);
    });

    it("决定空时间线下一步动作", () => {
        const baseInput: Parameters<typeof buildWorldWorkbenchEmptySliceState>[0] = {
            canCreateWorldSubject: false,
            canSeedDemoWorld: true,
            demoWorldSchemaError: "",
            hasSlices: false,
            hasWorldViewFilters: false,
            pendingSubjectSystemCount: 0,
            selectedSubjectIds: [],
            subjectLabel: "",
            worldSubjectCount: 0,
            worldSubjectIds: new Set(),
        };

        expect(buildWorldWorkbenchEmptySliceState(baseInput)).toMatchObject({
            action: "seed-demo",
            title: "当前 Project 还没有 slice",
        });
        expect(buildWorldWorkbenchEmptySliceState({
            ...baseInput,
            pendingSubjectSystemCount: 2,
        })).toMatchObject({
            action: "sync-subject-system",
            title: "当前 Project 还没有 World Engine slice",
        });
        expect(buildWorldWorkbenchEmptySliceState({
            ...baseInput,
            canCreateWorldSubject: true,
            canSeedDemoWorld: false,
            demoWorldSchemaError: "缺少 world subject",
        })).toMatchObject({
            action: "create-world-subject",
            description: "内置示例暂不可用：缺少 world subject 可以先创建 world subject，承载全局世界事件。",
        });
        expect(buildWorldWorkbenchEmptySliceState({
            ...baseInput,
            canSeedDemoWorld: false,
            demoWorldSchemaError: "缺少 character subject",
        })).toMatchObject({
            action: "create-subject",
            description: "内置示例暂不可用：缺少 character subject 请先创建 subject，再写入第一条 slice。",
        });
        expect(buildWorldWorkbenchEmptySliceState({
            ...baseInput,
            canSeedDemoWorld: false,
            demoWorldSchemaError: "示例 subject 已存在",
            worldSubjectCount: 1,
        })).toMatchObject({
            action: "new-slice",
            description: "内置示例暂不可用：示例 subject 已存在 可以直接新建 Slice 推演当前世界。",
        });
        expect(buildWorldWorkbenchEmptySliceState({
            ...baseInput,
            hasSlices: true,
        })).toMatchObject({
            action: "new-slice",
            title: "当前未选择 slice",
        });
        expect(buildWorldWorkbenchEmptySliceState({
            ...baseInput,
            pendingSubjectSystemCount: 1,
            selectedSubjectIds: ["player"],
            subjectLabel: "薇洛丝",
            worldSubjectIds: new Set(["world"]),
        })).toMatchObject({
            action: "sync-subject-system",
            description: "薇洛丝 暂无 World Engine 时间线。请先同步主体系统注册身份；同步不会复制或改写 simulation/subjects 六文件正文。",
            title: "当前 subject 尚未接入 World Engine",
        });
        expect(buildWorldWorkbenchEmptySliceState({
            ...baseInput,
            selectedSubjectIds: ["player"],
            subjectLabel: "薇洛丝",
            worldSubjectIds: new Set(["player"]),
        })).toMatchObject({
            action: "new-slice",
            description: "薇洛丝 在当前视角下暂无 slice。可以新建 Slice 写入第一条变更，或清空 subject 过滤回到整体世界。",
            title: "当前 subject 时间线暂无 slice",
        });
    });

    it("汇总关闭 Workbench 时会丢弃的草稿标签", () => {
        expect(buildWorldWorkbenchUnsavedDraftLabels({
            hasSliceComposerDraft: false,
            metadataDraftCount: 0,
            valueDraftSliceCount: 0,
        })).toEqual([]);
        expect(buildWorldWorkbenchUnsavedDraftLabels({
            hasSliceComposerDraft: true,
            metadataDraftCount: 2,
            valueDraftSliceCount: 1,
        })).toEqual([
            "Slice Composer 草稿",
            "2 个 metadata 草稿",
            "1 个 value 草稿",
        ]);
    });

    it("决定 draft slice 需要自动打开的草稿处理面板", () => {
        expect(buildWorldWorkbenchDraftSurfaceState({
            metadataDraftSliceIds: ["slice-a"],
            sliceHealthFilter: "all",
            sliceId: "slice-a",
            valueDraftSliceIds: ["slice-a"],
        })).toEqual({expandMutationEditor: false, openInspector: false});
        expect(buildWorldWorkbenchDraftSurfaceState({
            metadataDraftSliceIds: ["slice-a"],
            sliceHealthFilter: "draft",
            sliceId: "slice-a",
            valueDraftSliceIds: ["slice-b"],
        })).toEqual({expandMutationEditor: false, openInspector: true});
        expect(buildWorldWorkbenchDraftSurfaceState({
            metadataDraftSliceIds: ["slice-a"],
            sliceHealthFilter: "draft",
            sliceId: "slice-b",
            valueDraftSliceIds: ["slice-b"],
        })).toEqual({expandMutationEditor: true, openInspector: false});
        expect(buildWorldWorkbenchDraftSurfaceState({
            metadataDraftSliceIds: ["slice-a"],
            sliceHealthFilter: "draft",
            sliceId: "slice-a",
            valueDraftSliceIds: ["slice-a"],
        })).toEqual({expandMutationEditor: true, openInspector: true});
    });

    it("构造当前视角过滤标签", () => {
        expect(buildWorldWorkbenchWorldViewFilterParts({
            focusedSubjectHasSystemSummary: true,
            focusedSubjectId: "player",
            labels: {
                search: "搜索",
                status: "状态",
                subjects: "主体",
            },
            selectedSubjectIds: ["mentor", "rival"],
            sliceHealthFilter: "open",
            sliceHealthFilterLabel: "待处理 issue",
            sliceKindFilter: "event",
            sliceSearch: "这是一个很长很长的关键词用于测试截断文本",
            subjectFilterMode: "all",
            subjectNames: new Map([
                ["mentor", "导师"],
                ["player", "薇洛丝"],
            ]),
        })).toEqual([
            "主体语境 薇洛丝",
            "主体(全部 subject) 导师, rival",
            "kind event",
            "状态 待处理 issue",
            "搜索 这是一个很长很长的关键词用于测试截断...",
        ]);

        expect(buildWorldWorkbenchWorldViewFilterParts({
            focusedSubjectHasSystemSummary: true,
            focusedSubjectId: "player",
            labels: {
                search: "搜索",
                status: "状态",
                subjects: "主体",
            },
            selectedSubjectIds: ["player"],
            sliceHealthFilter: "all",
            sliceHealthFilterLabel: "全部",
            sliceKindFilter: "all",
            sliceSearch: "  ",
            subjectFilterMode: "any",
            subjectNames: new Map([["player", "薇洛丝"]]),
        })).toEqual(["主体(任一 subject) 薇洛丝"]);
    });

    it("按 issue key 和当前 slice 计算 review 队列焦点", () => {
        const reviewQueueItems = [
            {attr: "hp", key: "issue-a", sliceId: "slice-a", subjectId: "erina"},
            {attr: "location", key: "issue-b", sliceId: "slice-b", subjectId: "erina"},
            {attr: "durability", key: "issue-c", sliceId: "slice-b", subjectId: "old-sword"},
        ];

        expect(buildWorldWorkbenchCurrentReviewQueueIndex({
            focus: {attr: "durability", issueKey: "issue-c", subjectId: "old-sword"},
            reviewQueueItems,
            selectedSliceId: "slice-a",
        })).toBe(2);
        expect(buildWorldWorkbenchCurrentReviewQueueIndex({
            focus: {attr: "location", issueKey: "missing-issue", subjectId: "erina"},
            reviewQueueItems,
            selectedSliceId: "slice-b",
        })).toBe(1);
        expect(buildWorldWorkbenchCurrentReviewQueueIndex({
            focus: null,
            reviewQueueItems,
            selectedSliceId: "slice-b",
        })).toBe(1);
        expect(buildWorldWorkbenchCurrentReviewQueueIndex({
            focus: {attr: "hp", issueKey: "missing-issue", subjectId: "erina"},
            reviewQueueItems,
            selectedSliceId: "missing-slice",
        })).toBe(-1);
    });

    it("将 issue code 映射成 A/E 等级", () => {
        expect(worldWorkbenchIssueLevel("base-shifted")).toBe("A");
        expect(worldWorkbenchIssueLevel("masked")).toBe("A");
        expect(worldWorkbenchIssueLevel("broken-relative")).toBe("E");
        expect(worldWorkbenchIssueLevel("dangling-ref")).toBe("E");
    });

    it("将 issue triage 状态映射成短文案", () => {
        expect(worldWorkbenchIssueStatusLabel("open")).toBe("待处理");
        expect(worldWorkbenchIssueStatusLabel("confirmed")).toBe("已确认");
        expect(worldWorkbenchIssueStatusLabel("ignored")).toBe("已忽略");
    });

    it("判断消失的 review issue 是否需要清理高亮", () => {
        const reviewQueueItems = [
            {key: "issue-a"},
            {key: "issue-b"},
        ];

        expect(shouldClearWorldWorkbenchReviewIssueFocus({
            focus: null,
            reviewQueueItems,
        })).toBe(false);
        expect(shouldClearWorldWorkbenchReviewIssueFocus({
            focus: {attr: "hp", subjectId: "erina"},
            reviewQueueItems,
        })).toBe(false);
        expect(shouldClearWorldWorkbenchReviewIssueFocus({
            focus: {attr: "hp", issueKey: "issue-b", subjectId: "erina"},
            reviewQueueItems,
        })).toBe(false);
        expect(shouldClearWorldWorkbenchReviewIssueFocus({
            focus: {attr: "hp", issueKey: "missing-issue", subjectId: "erina"},
            reviewQueueItems,
        })).toBe(true);
    });

    it("判断保存后的 slice 是否仍命中 subject 过滤", () => {
        const mutations = [
            {subjectId: "erina"},
            {subjectId: "old-sword"},
        ];

        expect(isWorldWorkbenchSliceVisibleInSubjectFilter({
            mutations,
            selectedSubjectIds: [],
            subjectFilterMode: "all",
        })).toBe(true);
        expect(isWorldWorkbenchSliceVisibleInSubjectFilter({
            mutations,
            selectedSubjectIds: ["erina", "mentor"],
            subjectFilterMode: "any",
        })).toBe(true);
        expect(isWorldWorkbenchSliceVisibleInSubjectFilter({
            mutations,
            selectedSubjectIds: ["erina", "mentor"],
            subjectFilterMode: "all",
        })).toBe(false);
        expect(isWorldWorkbenchSliceVisibleInSubjectFilter({
            mutations,
            selectedSubjectIds: ["erina", "old-sword"],
            subjectFilterMode: "all",
        })).toBe(true);
        expect(isWorldWorkbenchSliceVisibleInSubjectFilter({
            mutations,
            selectedSubjectIds: ["mentor"],
            subjectFilterMode: "any",
        })).toBe(false);
    });

    it("选择 Slice Composer 默认 subject 并保留未注册上下文", () => {
        expect(buildWorldWorkbenchSliceComposerSubjectSelection({
            focusedSubjectId: "erina",
            selectedSubjectIds: ["mentor"],
            worldSubjectIds: ["world", "erina", "mentor"],
        })).toEqual({requestedSubjectId: "erina", subjectId: "erina"});
        expect(buildWorldWorkbenchSliceComposerSubjectSelection({
            focusedSubjectId: "",
            selectedSubjectIds: ["unregistered", "mentor", "erina"],
            worldSubjectIds: ["world", "mentor", "erina"],
        })).toEqual({requestedSubjectId: "erina", subjectId: "erina"});
        expect(buildWorldWorkbenchSliceComposerSubjectSelection({
            focusedSubjectId: "pending-player",
            selectedSubjectIds: ["mentor"],
            worldSubjectIds: ["world", "mentor"],
        })).toEqual({requestedSubjectId: "mentor", subjectId: "mentor"});
        expect(buildWorldWorkbenchSliceComposerSubjectSelection({
            focusedSubjectId: "pending-player",
            selectedSubjectIds: ["pending-player"],
            worldSubjectIds: ["world", "mentor"],
        })).toEqual({requestedSubjectId: "pending-player", subjectId: "world"});
        expect(buildWorldWorkbenchSliceComposerSubjectSelection({
            focusedSubjectId: "",
            selectedSubjectIds: [],
            worldSubjectIds: [],
        })).toEqual({requestedSubjectId: "", subjectId: "world"});
    });

    it("统计 subject 事件和 issue 状态", () => {
        const slices = normalizeWorldWorkbenchSlices([
            {
                id: "slice-maintenance",
                time: "复兴纪元 1 年 1 月 1 日 07:00",
                title: "主体系统初始化",
                summary: "同步主体系统索引",
                kind: "init",
                mutations: [
                    {subjectId: "erina", attr: "events", op: "listAppend", value: "主体系统维护记录"},
                ],
            },
            {
                id: "slice-a",
                time: "复兴纪元 1 年 1 月 1 日 09:00",
                title: "旧剑磨损",
                summary: "艾莉娜进入东塔",
                kind: "event",
                mutations: [
                    {subjectId: "old-sword", attr: "durability", op: "set", value: 80},
                    {subjectId: "erina", attr: "events", op: "listAppend", value: "进入东塔"},
                    {subjectId: "erina", attr: "hp", op: "add", value: -5},
                ],
                issues: [
                    {code: "masked", subjectId: "old-sword", attr: "durability", message: "后续 set 覆盖当前值", sliceId: "slice-a"},
                    {code: "broken-relative", subjectId: "erina", attr: "hp", message: "add 没有基准", sliceId: "slice-a"},
                ],
            },
            {
                id: "slice-b",
                time: "复兴纪元 1 年 1 月 1 日 10:00",
                title: "艾莉娜抵达塔顶",
                summary: "",
                kind: "event",
                mutations: [
                    {subjectId: "erina", attr: "location", op: "set", value: "subject://east-tower-roof"},
                ],
            },
        ]);
        const openItems = buildWorldWorkbenchReviewQueueItems({
            slices,
            transientIssues: [
                {
                    attr: "focus",
                    code: "masked",
                    issueIndex: 0,
                    key: "transient:focus",
                    message: "焦点被后续改写",
                    sliceId: "slice-b",
                    sliceTime: "复兴纪元 1 年 1 月 1 日 10:00",
                    sliceTitle: "艾莉娜抵达塔顶",
                    subjectId: "erina",
                },
            ],
            triageStatus: new Map(),
        });
        const triageStatus = new Map<string, WorldWorkbenchPreviewIssueTriageState["status"]>([
            [openItems.find((item) => item.subjectId === "old-sword")?.key ?? "", "ignored"],
            [openItems.find((item) => item.subjectId === "erina" && item.attr === "hp")?.key ?? "", "confirmed"],
        ]);
        const reviewItems = buildWorldWorkbenchReviewQueueItems({
            slices,
            transientIssues: [
                {
                    attr: "focus",
                    code: "masked",
                    issueIndex: 0,
                    key: "transient:focus",
                    message: "焦点被后续改写",
                    sliceId: "slice-b",
                    sliceTime: "复兴纪元 1 年 1 月 1 日 10:00",
                    sliceTitle: "艾莉娜抵达塔顶",
                    subjectId: "erina",
                },
            ],
            triageStatus,
        });
        expect(buildWorldWorkbenchIssueTriageSummary(reviewItems)).toEqual({
            confirmed: 1,
            done: 2,
            ignored: 1,
            open: 1,
            total: 3,
        });
        expect(buildWorldWorkbenchSliceReviewSummaries({reviewQueueItems: reviewItems, slices})).toEqual([
            {confirmed: 0, done: 0, ignored: 0, open: 0, sliceId: "slice-maintenance", total: 0},
            {confirmed: 1, done: 2, ignored: 1, open: 0, sliceId: "slice-a", total: 2},
            {confirmed: 0, done: 0, ignored: 0, open: 1, sliceId: "slice-b", total: 1},
        ]);
        const stats = buildWorldWorkbenchSubjectStats({
            reviewQueueItems: reviewItems,
            slices,
            subjects: [
                {id: "erina", name: "艾莉娜", type: "character"},
                {id: "old-sword", name: "旧剑", type: "item"},
                {id: "unseen", name: "未登场", type: "character"},
            ],
        });

        expect(stats.find((stat) => stat.subjectId === "erina")).toMatchObject({
            confirmedIssueCount: 1,
            doneIssueCount: 1,
            ignoredIssueCount: 0,
            issueCount: 2,
            latestKind: "event",
            latestTime: "复兴纪元 1 年 1 月 1 日 10:00",
            mutationCount: 3,
            openIssueCount: 1,
            sliceCount: 2,
        });
        expect(stats.find((stat) => stat.subjectId === "old-sword")).toMatchObject({
            doneIssueCount: 1,
            ignoredIssueCount: 1,
            issueCount: 1,
            latestTime: "复兴纪元 1 年 1 月 1 日 09:00",
            mutationCount: 1,
            sliceCount: 1,
        });
        expect(stats.find((stat) => stat.subjectId === "unseen")).toMatchObject({
            issueCount: 0,
            latestTime: "",
            mutationCount: 0,
            sliceCount: 0,
        });
    });

    it("用主体系统 overview 补齐待接入 subject 并生成主体文件建议", () => {
        const overview = {
            projectPath: "workspace/demo",
            subjects: [
                {
                    subjectPath: "simulation/subjects/player",
                    subjectId: "player",
                    metadata: {
                        id: "player",
                        name: "薇洛丝",
                        kind: "player",
                        profile: "simulator.actor",
                        controlledBy: "user",
                        canonicalSource: "reference/card.md",
                        frontmatterError: null,
                    },
                    eventCount: 7,
                    memoryCount: 3,
                    subjectFileExists: true,
                    soulFileExists: true,
                    mindFileExists: true,
                    stateFileExists: true,
                    sourceStatuses: [
                        {source: "events" as const, status: "dirty" as const, recordCount: 6, indexedAt: null, lastError: null},
                        {source: "memory" as const, status: "synced" as const, recordCount: 3, indexedAt: "2026-01-01T00:00:00.000Z", lastError: null},
                    ],
                    errors: [],
                },
                {
                    subjectPath: "simulation/subjects/sample-npc",
                    subjectId: "sample-npc",
                    metadata: {
                        id: "sample-npc",
                        name: "示例 NPC",
                        kind: "npc",
                        profile: "simulator.actor",
                        controlledBy: "simulator",
                        canonicalSource: null,
                        frontmatterError: null,
                    },
                    eventCount: 1,
                    memoryCount: 1,
                    subjectFileExists: true,
                    soulFileExists: true,
                    mindFileExists: true,
                    stateFileExists: true,
                    sourceStatuses: [],
                    errors: [],
                },
            ],
        };
        const worldSubjects = [{id: "world", type: "world", name: "世界"}];

        const merged = mergeWorldWorkbenchSubjectsWithSubjectSystem({overview, worldSubjects});
        expect(merged.map((subject) => subject.id)).toEqual(["world", "player"]);
        expect(merged.find((subject) => subject.id === "player")).toMatchObject({name: "薇洛丝", type: "character"});

        const summaries = buildWorldWorkbenchSubjectSystemSummariesFromRagOverview({overview, worldSubjects});
        expect(summaries).toHaveLength(1);
        expect(summaries[0]).toMatchObject({
            canonicalSource: "reference/card.md",
            controlledBy: "user",
            displayName: "薇洛丝",
            eventCount: 7,
            legacyKind: "player",
            memoryCount: 3,
            sourcePath: "simulation/subjects/player",
            subjectId: "player",
            syncStatus: "pending-world-subject",
        });
        expect(summaries[0]?.sourceStatuses.map((status) => `${status.source}:${status.status}`)).toEqual(["events:dirty", "memory:synced"]);
        expect(buildWorldWorkbenchSubjectSystemInitialAttrs(summaries[0] as NonNullable<typeof summaries[0]>)).toMatchObject({
            actorImportPath: "simulation/subjects/player/soul.md",
            canonicalSource: "reference/card.md",
            controlledBy: "user",
            directStatePath: "simulation/subjects/player/state.md",
            eventCount: 7,
            leaderOnlyPath: "simulation/subjects/player/subject.md",
            legacyKind: "player",
            memoryCount: 3,
            profile: "simulator.actor",
            ragIndexSources: {
                events: "simulation/subjects/player/events.jsonl",
                memory: "simulation/subjects/player/memory.jsonl",
            },
            sourcePath: "simulation/subjects/player",
            subjectFiles: {
                events: "simulation/subjects/player/events.jsonl",
                memory: "simulation/subjects/player/memory.jsonl",
                mind: "simulation/subjects/player/mind.md",
                soul: "simulation/subjects/player/soul.md",
                state: "simulation/subjects/player/state.md",
                subject: "simulation/subjects/player/subject.md",
            },
            subjectSystemVersion: "simulation-subjects-overview",
        });

        const proposals = buildWorldWorkbenchSubjectFileProposals({
            contextSubjectId: "player",
            slice: {
                id: "slice-1",
                time: "复兴纪元488年 1月15日 15:00:00",
                title: "薇洛丝回应眼镜女生",
                summary: "眼镜女生向薇洛丝搭话，薇洛丝保持冷静并观察她的蓝色符文。",
                kind: "event",
                mutations: [
                    {subjectId: "world", attr: "events", op: "listAppend", value: "眼镜女生向薇洛丝搭话。"},
                    {subjectId: "player", attr: "location", op: "set", value: "subject://ritual-hall"},
                    {subjectId: "player", attr: "memory.glasses-girl", op: "set", value: "她很紧张，但愿意主动靠近。"},
                ],
                issues: [],
            },
            subjectNames: new Map([["player", "薇洛丝"]]),
            subjectSystemSummaries: summaries,
        });
        expect(proposals).toHaveLength(1);
        expect(proposals[0]).toMatchObject({
            eventsPath: "simulation/subjects/player/events.jsonl",
            memoryPath: "simulation/subjects/player/memory.jsonl",
            statePath: "simulation/subjects/player/state.md",
            subjectId: "player",
            subjectName: "薇洛丝",
            sliceId: "slice-1",
            sliceKind: "event",
            sliceTime: "复兴纪元488年 1月15日 15:00:00",
            sliceTitle: "薇洛丝回应眼镜女生",
            sourceKind: "direct-mutation",
            sourceLabel: "直接触及该主体",
        });
        expect(proposals[0]?.eventDraft).toContain("我经历了这件事：我回应眼镜女生");
        expect(proposals[0]?.eventDraft).toContain("复兴纪元488年 1月15日 15:00:00｜");
        expect(proposals[0]?.eventJsonLine).toBe("{\"text\":\"我经历了这件事：我回应眼镜女生。眼镜女生向我搭话。\",\"time\":\"复兴纪元488年 1月15日 15:00:00\"}");
        expect(JSON.parse(proposals[0]?.eventJsonLine ?? "{}").text).not.toContain("复兴纪元488年");
        expect(JSON.parse(proposals[0]?.eventJsonLine ?? "{}").text).not.toContain("薇洛丝");
        expect(proposals[0]?.memoryFacts).toEqual([
            "复兴纪元488年 1月15日 15:00:00 player.memory.glasses-girl set = 她很紧张，但愿意主动靠近。",
        ]);
        expect(proposals[0]?.memoryJsonLines).toEqual([
            "{\"topic\":\"glasses-girl\",\"view\":\"她很紧张，但愿意主动靠近。\"}",
        ]);
        expect(proposals[0]?.stateReviewReasons).toContain("检查 state.md「当前位置」：player.location set = subject://ritual-hall");
        const proposalText = formatWorldWorkbenchSubjectFileProposal(proposals[0] as NonNullable<typeof proposals[0]>);
        expect(proposalText).toContain("# Subject file proposal: 薇洛丝 (player)");
        expect(proposalText).toContain("sliceId: slice-1");
        expect(proposalText).toContain("sliceTime: 复兴纪元488年 1月15日 15:00:00");
        expect(proposalText).toContain("sliceTitle: 薇洛丝回应眼镜女生");
        expect(proposalText).toContain("sliceKind: event");
        expect(proposalText).toContain("source: 直接触及该主体");
        expect(proposalText).toContain("## events.jsonl draft");
        expect(proposalText).toContain("jsonl:");
        expect(proposalText).toContain("review: 写入前确认第一人称口吻、角色当时知道什么");
        expect(proposalText).toContain("{\"topic\":\"glasses-girl\",\"view\":\"她很紧张，但愿意主动靠近。\"}");
        expect(proposalText).toContain("review: memory.jsonl 是当前认知快照");
        expect(proposalText).toContain("注意：这是 World Engine 生成的建议，不会自动写入 simulation/subjects。");

        const worldContextProposals = buildWorldWorkbenchSubjectFileProposals({
            contextSubjectId: "player",
            slice: {
                id: "slice-world",
                time: "复兴纪元488年 1月15日 15:01:00",
                title: "薇洛丝听见塔钟",
                summary: "",
                kind: "event",
                mutations: [
                    {subjectId: "world", attr: "events", op: "listAppend", value: "大厅塔钟响起。"},
                ],
                issues: [],
            },
            subjectNames: new Map([["player", "薇洛丝"]]),
            subjectSystemSummaries: summaries,
        });
        expect(worldContextProposals).toHaveLength(1);
        expect(worldContextProposals[0]).toMatchObject({
            sourceKind: "focused-world-context",
            sourceLabel: "当前主体语境下的 world 事件建议",
            subjectId: "player",
        });
        expect(JSON.parse(worldContextProposals[0]?.eventJsonLine ?? "{}").text).toBe("我经历了这件事：我听见塔钟。大厅塔钟响起。");
        expect(JSON.parse(worldContextProposals[0]?.eventJsonLine ?? "{}").text).not.toContain("world.events");

        const acceptanceTagProposals = buildWorldWorkbenchSubjectFileProposals({
            contextSubjectId: "player",
            slice: {
                id: "slice-acceptance",
                time: "复兴纪元488年 1月15日 15:01:30",
                title: "[验收] 薇洛丝观察召唤大厅余波",
                summary: "",
                kind: "event",
                mutations: [
                    {subjectId: "world", attr: "events", op: "listAppend", value: "[验收] 薇洛丝在召唤大厅中保持沉默。"},
                ],
                issues: [],
            },
            subjectNames: new Map([["player", "薇洛丝"]]),
            subjectSystemSummaries: summaries,
        });
        expect(JSON.parse(acceptanceTagProposals[0]?.eventJsonLine ?? "{}").text).toBe("我经历了这件事：我观察召唤大厅余波。我在召唤大厅中保持沉默。");
        expect(JSON.parse(acceptanceTagProposals[0]?.eventJsonLine ?? "{}").text).not.toContain("[验收]");

        const selfPronounProposals = buildWorldWorkbenchSubjectFileProposals({
            contextSubjectId: "player",
            slice: {
                id: "slice-self-pronoun",
                time: "复兴纪元488年 1月15日 15:01:45",
                title: "[验收] 薇洛丝意识到自己未被重点监视",
                summary: "薇洛丝意识到子爵和法师的注意力暂时不在自己身上，这给了她继续观察出口和守卫站位的机会。她决定暂时不暴露任何异常。",
                kind: "event",
                mutations: [
                    {subjectId: "world", attr: "events", op: "listAppend", value: "薇洛丝意识到子爵和法师的注意力暂时不在自己身上，这给了她继续观察出口和守卫站位的机会。她决定暂时不暴露任何异常。"},
                ],
                issues: [],
            },
            subjectNames: new Map([["player", "薇洛丝"]]),
            subjectSystemSummaries: summaries,
        });
        const selfPronounText = JSON.parse(selfPronounProposals[0]?.eventJsonLine ?? "{}").text as string;
        expect(selfPronounText).toBe("我经历了这件事：我意识到自己未被重点监视。我意识到子爵和法师的注意力暂时不在自己身上，这给了我继续观察出口和守卫站位的机会。我决定暂时不暴露任何异常。");
        expect(selfPronounText).not.toContain("给了她");
        expect(selfPronounText).not.toContain("她决定");

        const initProposals = buildWorldWorkbenchSubjectFileProposals({
            contextSubjectId: "player",
            slice: {
                id: "slice-init",
                time: "复兴纪元488年 1月15日 14:00:00",
                title: "创建 命定之诗世界",
                summary: "",
                kind: "init",
                mutations: [
                    {subjectId: "player", attr: "hp", op: "set", value: 100},
                    {subjectId: "player", attr: "events", op: "set", value: []},
                ],
                issues: [],
            },
            subjectNames: new Map([["player", "薇洛丝"]]),
            subjectSystemSummaries: summaries,
        });
        expect(initProposals).toEqual([]);

        const directWorldEventProposals = buildWorldWorkbenchSubjectFileProposals({
            contextSubjectId: "player",
            slice: {
                id: "slice-direct-world",
                time: "复兴纪元488年 1月15日 15:02:00",
                title: "薇洛丝走向大厅",
                summary: "",
                kind: "event",
                mutations: [
                    {subjectId: "world", attr: "events", op: "listAppend", value: " 薇洛丝走向大厅。 "},
                    {subjectId: "player", attr: "location", op: "set", value: "subject://main-hall"},
                    {subjectId: "glasses-girl", attr: "events", op: "listAppend", value: "眼镜女生悄悄离开大厅。"},
                ],
                issues: [],
            },
            subjectNames: new Map([["player", "薇洛丝"]]),
            subjectSystemSummaries: summaries,
        });
        expect(directWorldEventProposals[0]).toMatchObject({
            sourceKind: "direct-mutation",
            subjectId: "player",
        });
        expect(JSON.parse(directWorldEventProposals[0]?.eventJsonLine ?? "{}").text).toBe("我经历了这件事：我走向大厅。");
        expect(JSON.parse(directWorldEventProposals[0]?.eventJsonLine ?? "{}").text).not.toContain("player.location");
        expect(JSON.parse(directWorldEventProposals[0]?.eventJsonLine ?? "{}").text).not.toContain("眼镜女生悄悄离开大厅");

        const linked = mergeWorldWorkbenchSubjectsWithSubjectSystem({
            overview,
            worldSubjects: [
                {id: "player", type: "character", name: "旧名"},
            ],
        });
        expect(linked).toEqual([{id: "player", type: "character", name: "薇洛丝"}]);
    });
});
