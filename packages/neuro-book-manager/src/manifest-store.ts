import {parseInstallationManifest, parseReleaseManifest} from "#manager/schema";
import type {InstallationManifest, ReleaseChannel, ReleaseManifest} from "#manager/types";
import {readJson, writeJsonAtomic} from "#manager/files";

const RELEASE_API = "https://api.github.com/repos/notnotype/neuro-book/releases";

type GitHubRelease = {
    tag_name: string;
    prerelease: boolean;
    draft: boolean;
    assets: Array<{name: string; browser_download_url: string}>;
};

/** 读取本机 installation manifest。 */
export async function readInstallationManifest(path: string): Promise<InstallationManifest | null> {
    const value = await readJson(path);
    return value === null ? null : parseInstallationManifest(value);
}

/** 原子写入 installation manifest。 */
export async function writeInstallationManifest(path: string, manifest: InstallationManifest): Promise<void> {
    parseInstallationManifest(manifest);
    await writeJsonAtomic(path, manifest);
}

/** 按版本或 channel 查找 Release Manifest。 */
export async function resolveReleaseManifest(channel: ReleaseChannel, version?: string): Promise<ReleaseManifest> {
    const releases = await fetchReleases();
    const normalizedVersion = version ? (version.startsWith("v") ? version : `v${version}`) : null;
    const candidates = normalizedVersion
        ? releases.filter((item) => item.tag_name === normalizedVersion)
        : releases.filter((item) => channel === "stable" ? !item.prerelease : item.prerelease);
    const release = normalizedVersion
        ? candidates[0]
        : candidates.find((item) => item.assets.some((asset) => asset.name === "release-manifest.json"));
    if (!release) {
        throw new Error(normalizedVersion ? `找不到 NeuroBook Release：${normalizedVersion}` : `找不到 ${channel} NeuroBook Release。`);
    }
    const asset = release.assets.find((item) => item.name === "release-manifest.json");
    if (!asset) {
        throw new Error(`Release ${release.tag_name} 尚未完成装配：缺少 release-manifest.json。`);
    }
    const response = await fetch(asset.browser_download_url, {headers: {"User-Agent": "neuro-book-manager"}});
    if (!response.ok) {
        throw new Error(`下载 Release Manifest 失败 ${response.status}：${release.tag_name}`);
    }
    const manifest = parseReleaseManifest(await response.json());
    assertReleaseIdentity(release, manifest, channel);
    assertReleaseAssets(release, manifest);
    return manifest;
}

function assertReleaseIdentity(release: GitHubRelease, manifest: ReleaseManifest, channel: ReleaseChannel): void {
    if (release.tag_name !== `v${manifest.version}`) {
        throw new Error(`GitHub tag ${release.tag_name} 与 Release Manifest version ${manifest.version} 不一致。`);
    }
    const expectedChannel: ReleaseChannel = release.prerelease ? "canary" : "stable";
    if (manifest.channel !== expectedChannel || channel !== expectedChannel) {
        throw new Error(`Release ${release.tag_name} 的 prerelease/channel 标记不一致。`);
    }
    if (!manifest.ghcr.ref.endsWith(`:${release.tag_name}`)) {
        throw new Error(`GHCR ref 必须使用 Release tag：${manifest.ghcr.ref}`);
    }
}

function assertReleaseAssets(release: GitHubRelease, manifest: ReleaseManifest): void {
    const expected = new Map(release.assets.map((asset) => [asset.name, asset.browser_download_url]));
    const assets = [
        ["neuro-book-source.zip", manifest.source.url],
        ["neuro-book-windows-x64.zip", manifest.windowsPortable.url],
        ...manifest.products.map((product) => [
            product.platform === "windows-x64"
                ? "neuro-book-product-windows-x64.zip"
                : "neuro-book-product-linux-x64-glibc.tar.gz",
            product.url,
        ]),
    ];
    for (const [name, url] of assets) {
        if (expected.get(name) !== url) throw new Error(`Release Manifest 资产 URL 与 GitHub Release 不一致：${name}`);
    }
}

async function fetchReleases(): Promise<GitHubRelease[]> {
    const response = await fetch(`${RELEASE_API}?per_page=50`, {
        headers: {"Accept": "application/vnd.github+json", "User-Agent": "neuro-book-manager"},
    });
    if (!response.ok) {
        throw new Error(`读取 NeuroBook Releases 失败：HTTP ${response.status}`);
    }
    const releases = await response.json() as GitHubRelease[];
    return releases.filter((release) => !release.draft);
}
