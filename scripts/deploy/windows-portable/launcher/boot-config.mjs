import * as yaml from "yaml";

/** 生成 Windows Portable 首次启动使用的 Boot Config。 */
export function renderPortableBootConfig(port) {
    return `# neuro-book Boot Config.
auth:
  enabled: false
server:
  host: '0.0.0.0'
  port: ${port}
database:
  kind: \${DATABASE_KIND:-sqlite}
  url: \${DATABASE_URL:-file:../data/workspace/.nbook/neuro-book.sqlite}
`;
}

/** 严格读取 Portable Boot Config 的鉴权开关；缺省按生产安全值开启。 */
export function readPortableBootAuth(text) {
    return parsePortableBootConfig(text).auth?.enabled ?? true;
}

/** 更新 Portable Boot Config 鉴权开关；值未变化时返回 null。 */
export function updatePortableBootAuth(text, enabled) {
    const parsed = parsePortableBootConfig(text);
    if ((parsed.auth?.enabled ?? true) === enabled) {
        return null;
    }
    parsed.auth = {...parsed.auth, enabled};
    return yaml.stringify(parsed, {indent: 2});
}

function parsePortableBootConfig(text) {
    let parsed;
    try {
        parsed = yaml.parse(text);
    } catch (error) {
        throw new Error(`无法解析 Portable data/config.yaml：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Portable data/config.yaml 顶层必须是对象。");
    }
    if (parsed.auth !== undefined && (!parsed.auth || typeof parsed.auth !== "object" || Array.isArray(parsed.auth))) {
        throw new Error("Portable data/config.yaml auth 必须是对象。");
    }
    if (parsed.auth?.enabled !== undefined && typeof parsed.auth.enabled !== "boolean") {
        throw new Error("Portable data/config.yaml auth.enabled 必须是 boolean。");
    }
    return parsed;
}
