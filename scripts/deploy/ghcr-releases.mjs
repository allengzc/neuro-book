import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {DEFAULT_IMAGE} from './constants.mjs';

export const DEFAULT_RELEASE_API = 'https://api.github.com/repos/notnotype/neuro-book/releases?per_page=30';

/** 读取当前安装器包版本。 */
export async function readInstallerPackageVersion() {
    const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    return String(packageJson.version);
}

/** package version 对应的 GHCR release tag。 */
export function defaultReleaseTag(packageVersion) {
    const version = String(packageVersion).trim();
    return version.startsWith('v') ? version : `v${version}`;
}

/** 用 release tag 生成完整 GHCR app image。 */
export function imageForReleaseTag(tag, imageBase = DEFAULT_IMAGE) {
    return `${imageBase}:${normalizeReleaseTag(tag)}`;
}

/** 允许用户输入带 v 或不带 v 的 release tag。 */
export function normalizeReleaseTag(tag) {
    const value = String(tag ?? '').trim();
    if (!value) {
        throw new Error('GHCR release tag 不能为空。');
    }
    return value.startsWith('v') ? value : `v${value}`;
}

/** 返回 release 类型标签。 */
export function releaseKind(release) {
    if (!release.prerelease) {
        return 'stable';
    }
    const match = /-(canary|alpha|beta|rc)(?:[.+-]|$)/u.exec(String(release.tag_name));
    return match?.[1] ?? 'prerelease';
}

/** 过滤可用于 GHCR 镜像选择的 release。 */
export function selectableGhcrReleases(releases) {
    const source = Array.isArray(releases) ? releases : [releases];
    return source.filter((release) => {
        if (!release?.tag_name || release.draft) {
            return false;
        }
        return ['stable', 'canary', 'alpha', 'beta', 'rc'].includes(releaseKind(release));
    });
}

/** 生成 Clack select 使用的选项。 */
export function ghcrReleaseOptions(releases) {
    return selectableGhcrReleases(releases).map((release) => ({
        label: `${release.tag_name} (${releaseKind(release)})`,
        value: release.tag_name,
        hint: release.published_at ? new Date(release.published_at).toLocaleString() : undefined,
    }));
}

/** 查询 GitHub Releases，默认同时列出 stable 和 prerelease。 */
export async function fetchGhcrReleases(api = process.env.NEURO_BOOK_RELEASE_API ?? DEFAULT_RELEASE_API) {
    const response = await fetch(api, {
        headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'NeuroBook-Deploy',
        },
    });
    if (!response.ok) {
        throw new Error(`查询 GHCR release 列表失败：${api} ${response.status}`);
    }
    const payload = await response.json();
    const releases = selectableGhcrReleases(payload);
    if (releases.length === 0) {
        throw new Error('没有找到可用于 GHCR 部署的 stable / canary / alpha / beta / rc release。');
    }
    return releases;
}
