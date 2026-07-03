import fs from "node:fs/promises";
import path from "node:path";
import type {ChapterRepository} from "nbook/server/plot/contracts/plot-repositories";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {StoryService} from "nbook/server/plot/services/story.service";
import {chapterIdentityFromPath} from "nbook/server/workspace-files/project-workspace";
import {invalidateProjectWorkspaceIndexAfterMutation, readProjectWorkspaceTreeSnapshot} from "nbook/server/workspace-files/project-workspace-index";
import {parseMarkdownDocument, renderMarkdownDocument, resolveWorkspaceRoot} from "nbook/server/workspace-files/workspace-files";
import type {WorkspaceFileNode} from "nbook/server/workspace-files/workspace-files";

/** Bootstrap 执行结果统计。 */
export type CarrierTreeBootstrapResult = {
    actsCreated: number;
    chaptersCreated: number;
    chaptersLinkedToAct: number;
    proseFrontmatterWritten: string[];
    warnings: string[];
};

/**
 * 承载树 Bootstrap:把现有 manuscript 目录结构导入 Act/Chapter 实体,并回写 Prose frontmatter 反指。
 *
 * 用于旧项目一次性迁移(《命定之诗2》等)。幂等:已存在的同 name Act/Chapter 不重建,
 * 已有 chapter 指针的 Prose 不改写;可反复执行。
 * Scene.chapterPath → chapterId 的数据迁移由 initProjectDatabase 的 DB 级迁移负责,本服务不重复处理。
 */
export class ChapterBootstrapService {
    constructor(
        private readonly chapterRepository: ChapterRepository,
        private readonly storyService: StoryService,
        private readonly scopeGuard: PlotScopeGuard,
    ) {}

    /**
     * 扫描 manuscript 目录 → 建 Act(volume)/Chapter(chapter)行 → 回写 Prose frontmatter。
     */
    async bootstrapCarrierTree(projectPath: string): Promise<CarrierTreeBootstrapResult> {
        const story = await this.storyService.ensureStory(projectPath);
        const snapshot = await readProjectWorkspaceTreeSnapshot({root: projectPath});
        const result: CarrierTreeBootstrapResult = {
            actsCreated: 0,
            chaptersCreated: 0,
            chaptersLinkedToAct: 0,
            proseFrontmatterWritten: [],
            warnings: [],
        };

        const volumeNodes = collectManuscriptNodes(snapshot.nodes, "volume");
        const chapterNodes = collectManuscriptNodes(snapshot.nodes, "chapter");

        // 1. 卷:按目录序 ensure StoryAct;name 与 chapter 同一推导契约。
        const actIdByVolumePath = new Map<string, number>();
        for (const [index, node] of volumeNodes.entries()) {
            const identity = chapterIdentityFromPath(node.path);
            let act = await this.chapterRepository.findActByName(story.id, identity.name);
            if (!act) {
                act = await this.chapterRepository.createAct({
                    storyId: story.id,
                    sortOrder: index,
                    name: identity.name,
                    title: node.title || identity.title,
                    summary: "",
                    note: null,
                });
                result.actsCreated += 1;
            } else if (act.sortOrder !== index) {
                act = await this.chapterRepository.updateAct(act.id, {sortOrder: index});
            }
            actIdByVolumePath.set(normalizeNodePath(node.path), act.id);
        }

        // 2. 章:按目录序 ensure StoryChapter,归属父 volume 的 Act。
        for (const [index, node] of chapterNodes.entries()) {
            const identity = chapterIdentityFromPath(node.path);
            const parentVolumePath = findParentVolumePath(node.path, actIdByVolumePath);
            const actId = parentVolumePath === null ? null : actIdByVolumePath.get(parentVolumePath) ?? null;
            let chapter = await this.chapterRepository.findChapterByName(story.id, identity.name);
            if (!chapter) {
                chapter = await this.chapterRepository.createChapter({
                    storyId: story.id,
                    actId,
                    sortOrder: index,
                    name: identity.name,
                    title: node.title || identity.title,
                    note: null,
                });
                result.chaptersCreated += 1;
            } else {
                // DB 迁移建的行 actId 为空;bootstrap 负责补卷归属与目录序,不覆盖用户改过的 title。
                const patch: {actId?: number | null; sortOrder?: number} = {};
                if (chapter.actId === null && actId !== null) {
                    patch.actId = actId;
                    result.chaptersLinkedToAct += 1;
                }
                if (chapter.sortOrder !== index) {
                    patch.sortOrder = index;
                }
                if (Object.keys(patch).length > 0) {
                    chapter = await this.chapterRepository.updateChapter(chapter.id, patch);
                }
            }

            // 3. 回写 Prose frontmatter 反指(已有 chapter 字段的文件不动)。
            const written = await writeChapterPointer(projectPath, node, identity.name, result.warnings);
            if (written) {
                result.proseFrontmatterWritten.push(written);
            }
        }

        if (result.proseFrontmatterWritten.length > 0) {
            // frontmatter 写回绕过了常规写入口,手动失效 workspace 索引让反指立即可查。
            invalidateProjectWorkspaceIndexAfterMutation({root: resolveWorkspaceRoot(projectPath)});
        }
        return result;
    }
}

/**
 * 收集 manuscript 下指定 entryType 的内容节点,按 path 升序(即目录名前缀序)。
 */
function collectManuscriptNodes(nodes: WorkspaceFileNode[], entryType: "volume" | "chapter"): WorkspaceFileNode[] {
    return nodes
        .filter((node) => node.isDirectory && node.contentNode && node.entryType === entryType)
        .filter((node) => normalizeNodePath(node.path).startsWith("manuscript/"))
        .sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * 去掉路径结尾斜杠。
 */
function normalizeNodePath(nodePath: string): string {
    return nodePath.replace(/\/+$/, "");
}

/**
 * 找到 chapter 目录所属的 volume 目录(最长前缀匹配);不在任何 volume 下时返回 null。
 */
function findParentVolumePath(chapterPath: string, actIdByVolumePath: Map<string, number>): string | null {
    const normalized = normalizeNodePath(chapterPath);
    let best: string | null = null;
    for (const volumePath of actIdByVolumePath.keys()) {
        if (normalized.startsWith(`${volumePath}/`) && (best === null || volumePath.length > best.length)) {
            best = volumePath;
        }
    }
    return best;
}

/**
 * 向 Prose index.md 写入 `chapter: <name>` 反指;已有指针或解析失败时跳过。
 * 返回写入的文件相对路径,未写入返回 null。
 */
async function writeChapterPointer(
    projectPath: string,
    node: WorkspaceFileNode,
    chapterName: string,
    warnings: string[],
): Promise<string | null> {
    const indexPath = path.join(node.absolutePath, "index.md");
    let content: string;
    try {
        content = await fs.readFile(indexPath, "utf-8");
    } catch {
        warnings.push(`跳过 ${node.path}:index.md 不可读`);
        return null;
    }
    const parsed = parseMarkdownDocument(content);
    if (parsed.error) {
        warnings.push(`跳过 ${node.path}:frontmatter 解析失败(${parsed.error})`);
        return null;
    }
    if (typeof parsed.frontmatter.chapter === "string" && parsed.frontmatter.chapter.trim()) {
        return null;
    }
    await fs.writeFile(indexPath, renderMarkdownDocument({...parsed.frontmatter, chapter: chapterName}, parsed.body), "utf-8");
    return `${normalizeNodePath(node.path)}/index.md`;
}
