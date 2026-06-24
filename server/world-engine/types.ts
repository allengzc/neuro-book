import type {Prisma} from "nbook/server/generated/project-prisma/client";

/** 世界引擎唯一时间真相源：自世界零点起经过的秒数。 */
export type Instant = bigint;

/** JSON 可持久化值。 */
export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};

/** mutation 支持的操作全集。 */
export type WorldMutationOp = "set" | "add" | "unset" | "listAppend" | "collectionAdd" | "collectionRemove";

/** timeline subject 过滤模式：any=任一命中，all=全部命中。 */
export type WorldSliceSubjectFilterMode = "any" | "all";

// ============================================================================
// 旧类型系统（保留向后兼容）
// ============================================================================

/** subject 属性语义类型。@deprecated 使用新类型系统 WorldSchemaNode */
export type WorldAttrKind = "scalar" | "list" | "collection" | "object";

/** schema 中单个属性定义。@deprecated 使用新类型系统 WorldSchemaNode */
export type WorldAttrSchema = {
    kind?: WorldAttrKind;
    type?: string;
    itemType?: string;
    enum?: JsonValue[];
    fields?: Record<string, WorldAttrSchema>;
    default?: JsonValue;
    desc?: string;
};

/** schema 中单个 subject type 定义。@deprecated 使用新类型系统 WorldSubjectTypeSchemaV2 */
export type WorldSubjectTypeSchema = {
    desc?: string;
    attrs: Record<string, WorldAttrSchema>;
};

/** 项目级世界 schema。@deprecated 使用新类型系统 WorldSchemaV2 */
export type WorldSchema = {
    subjectTypes: Record<string, WorldSubjectTypeSchema>;
};

// ============================================================================
// 新类型系统：递归类型定义，支持无限嵌套
// ============================================================================

/** 世界引擎基础数据类型。 */
export type WorldSchemaType =
    | "int"       // 整数
    | "float"     // 浮点数
    | "string"    // 字符串
    | "boolean"   // 布尔值
    | "ref"       // 引用（指向 subject id）
    | "array"     // 数组（有序列表）
    | "object";   // 对象（固定键结构）

/**
 * 世界引擎递归类型节点。
 *
 * 基础类型（int/float/string/boolean/ref）：
 *   - type 指定类型
 *   - values 可选，表示枚举约束
 *
 * array 类型：
 *   - type = "array"
 *   - items 定义数组元素类型（递归）
 *   - unique = true 表示集合语义（无序、不重复，对应旧 collection）
 *
 * object 类型：
 *   - type = "object"
 *   - properties 定义固定键结构（递归）
 *   - dynamic = true 表示动态键映射（key 任意，value 类型统一）
 *
 * 约束说明：
 *   - values: 枚举值约束，适用于基础类型
 *   - unique: 集合语义，仅用于 array（去重、无序）
 *   - dynamic: 动态键，仅用于 object（类似 Record<string, T>）
 */
export type WorldSchemaNode =
    | WorldSchemaNodePrimitive
    | WorldSchemaNodeArray
    | WorldSchemaNodeObject;

/** 基础类型节点：int/float/string/boolean/ref */
export type WorldSchemaNodePrimitive = {
    type: "int" | "float" | "string" | "boolean" | "ref";
    /** ref 类型：引用的 subject type */
    ref?: string;
    /** 枚举约束：限定可选值 */
    values?: JsonValue[];
    /** 默认值 */
    default?: JsonValue;
    /** 描述 */
    desc?: string;
};

/** 数组类型节点 */
export type WorldSchemaNodeArray = {
    type: "array";
    /** 数组元素类型（递归） */
    items: WorldSchemaNode;
    /** 集合语义：true = 无序、不重复（对应旧 collection），false = 有序列表（对应旧 list） */
    unique?: boolean;
    /** 默认值 */
    default?: JsonValue;
    /** 描述 */
    desc?: string;
};

/** 对象类型节点 */
export type WorldSchemaNodeObject = {
    type: "object";
    /** 固定键结构：键名 -> 类型定义（递归） */
    properties?: Record<string, WorldSchemaNode>;
    /** 动态键映射：true = key 任意，value 类型统一（类似 Record<string, T>） */
    dynamic?: boolean;
    /** 动态键的值类型（仅 dynamic=true 时有效） */
    valueType?: string;
    /** 默认值 */
    default?: JsonValue;
    /** 描述 */
    desc?: string;
};

/** 新 subject type 定义 */
export type WorldSubjectTypeSchemaV2 = {
    type: "object";
    properties: Record<string, WorldSchemaNode>;
    desc?: string;
};

/** 新世界 schema */
export type WorldSchemaV2 = {
    types: Record<string, WorldSubjectTypeSchemaV2>;
};

// ============================================================================
// 兼容性转换：新类型 <-> 旧类型
// ============================================================================

/**
 * 新格式类型名 -> 旧格式类型名
 * string -> text, boolean -> bool
 */
function newTypeToOldType(newType: string): string {
    if (newType === "string") return "text";
    if (newType === "boolean") return "bool";
    return newType; // int, float, ref 保持不变
}

/**
 * 旧格式类型名 -> 新格式类型名
 * text -> string, bool -> boolean
 */
function oldTypeToNewType(oldType: string): string {
    if (oldType === "text") return "string";
    if (oldType === "bool") return "boolean";
    return oldType; // int, float, ref 保持不变
}

/**
 * 将新 schema node 转换为旧 WorldAttrKind。
 *
 * 映射规则：
 * - int/float/string/boolean/ref（无 values） -> "scalar"
 * - int/float/string/boolean/ref（有 values） -> "scalar"（枚举约束在 enum 字段体现）
 * - array（unique=false/undefined） -> "list"
 * - array（unique=true） -> "collection"
 * - object（properties） -> "object"
 * - object（dynamic=true） -> "object"（动态键映射，旧系统通过 fields 为空 + itemType 表达）
 */
export function schemaNodeToAttrKind(node: WorldSchemaNode): WorldAttrKind {
    if (node.type === "array") {
        return node.unique ? "collection" : "list";
    }
    if (node.type === "object") {
        return "object";
    }
    return "scalar";
}

/**
 * 将新 schema node 转换为旧 WorldAttrSchema。
 *
 * 用于向后兼容：新系统写入 schema 时，同步生成旧格式供现有代码读取。
 */
export function schemaNodeToAttrSchema(node: WorldSchemaNode): WorldAttrSchema {
    const kind = schemaNodeToAttrKind(node);
    const base: WorldAttrSchema = {
        kind,
        default: node.default,
        desc: node.desc,
    };

    // 基础类型
    if (node.type !== "array" && node.type !== "object") {
        // ref 类型需要编码目标到 type 字段
        if (node.type === "ref" && "ref" in node && node.ref) {
            base.type = `ref(${node.ref})`;
        } else {
            // 转换新格式类型名到旧格式：string -> text, boolean -> bool
            base.type = newTypeToOldType(node.type);
        }
        if ("values" in node && node.values) {
            base.enum = node.values;
        }
        return base;
    }

    // 数组类型
    if (node.type === "array") {
        const itemNode = node.items;
        // 如果元素是基础类型，直接用 itemType
        if (itemNode.type !== "array" && itemNode.type !== "object") {
            base.itemType = newTypeToOldType(itemNode.type);
        } else {
            // 如果元素是复合类型，标记为 object（旧系统可能不支持深度嵌套）
            base.itemType = "object";
        }
        return base;
    }

    // 对象类型
    if (node.type === "object") {
        if (node.dynamic && node.valueType) {
            // 动态键映射：旧系统用 itemType 表达值类型
            base.itemType = newTypeToOldType(node.valueType);
        } else if (node.properties) {
            base.itemType = node.valueType;
        } else if (node.properties) {
            // 固定键结构：递归转换 properties
            base.fields = {};
            for (const [key, childNode] of Object.entries(node.properties)) {
                base.fields[key] = schemaNodeToAttrSchema(childNode);
            }
        }
        return base;
    }

    return base;
}

/**
 * 将旧 WorldAttrSchema 转换为新 WorldSchemaNode。
 *
 * 用于迁移：读取现有 schema 时，转换为新类型供新代码使用。
 */
export function attrSchemaToSchemaNode(attr: WorldAttrSchema): WorldSchemaNode {
    const kind = attr.kind ?? "scalar";

    // scalar -> 基础类型
    if (kind === "scalar") {
        const type = oldTypeToNewType(attr.type ?? "string"); // 转换 text->string, bool->boolean
        if (type === "int" || type === "float" || type === "string" || type === "boolean" || type.startsWith("ref")) {
            const node: WorldSchemaNodePrimitive = {
                type: type.startsWith("ref") ? "ref" : (type as "int" | "float" | "string" | "boolean"),
                default: attr.default,
                desc: attr.desc,
            };
            if (type.startsWith("ref(") && type.endsWith(")")) {
                node.ref = type.slice(4, -1);
            }
            if (attr.enum) {
                node.values = attr.enum;
            }
            return node;
        }
    }

    // list -> array
    if (kind === "list") {
        const itemType = oldTypeToNewType(attr.itemType ?? "string"); // 转换旧类型名
        const items: WorldSchemaNode = itemType === "object"
            ? { type: "object" }
            : { type: itemType as "int" | "float" | "string" | "boolean" | "ref" };

        return {
            type: "array",
            items,
            unique: false,
            default: attr.default,
            desc: attr.desc,
        };
    }

    // collection -> array + unique
    if (kind === "collection") {
        const itemType = oldTypeToNewType(attr.itemType ?? "string"); // 转换旧类型名
        const items: WorldSchemaNode = itemType === "object"
            ? { type: "object" }
            : { type: itemType as "int" | "float" | "string" | "boolean" | "ref" };

        return {
            type: "array",
            items,
            unique: true,
            default: attr.default,
            desc: attr.desc,
        };
    }

    // object
    if (kind === "object") {
        if (attr.fields) {
            // 固定键结构
            const properties: Record<string, WorldSchemaNode> = {};
            for (const [key, childAttr] of Object.entries(attr.fields)) {
                properties[key] = attrSchemaToSchemaNode(childAttr);
            }
            return {
                type: "object",
                properties,
                default: attr.default,
                desc: attr.desc,
            };
        } else if (attr.itemType) {
            // 动态键映射
            return {
                type: "object",
                dynamic: true,
                valueType: attr.itemType,
                default: attr.default,
                desc: attr.desc,
            };
        }
    }

    // 降级处理：未知结构返回 string scalar
    return { type: "string" };
}

/** 一条待写入变更。 */
export type MutationInput = {
    subjectId: string;
    attr: string;
    op: WorldMutationOp;
    value?: JsonValue;
};

/** 一个切面写入输入。 */
export type SliceInput = {
    instant: Instant;
    title?: string;
    summary?: string;
    kind?: string;
    mutations: MutationInput[];
};

/** 校验问题代号。
 *  E（持久，reduce 时现算）：broken-relative（相对 op 缺基）、dangling-ref（ref 目标不存在）。
 *  A（一次性，写操作返回）：base-shifted（插/改绝对 op 改了下游相对 op 的累加基）、masked（改动被下游绝对 set 覆盖）。*/
export type WorldIssueCode = "broken-relative" | "dangling-ref" | "base-shifted" | "masked";

/** 一条数据校验问题。sliceId：E 表示错误显形的切面；A 表示触发本次提醒的下游切面。 */
export type WorldIssue = {
    code: WorldIssueCode;
    sliceId?: string;
    subjectId: string;
    attr: string;
    message: string;
};

/** 写入或编辑切面后的结果：切面 id + 本次产生的问题（E + A）；edit 原样保存不重复返回 A。 */
export type SliceWriteResult = {
    sliceId: string;
    issues: WorldIssue[];
};

/** 删除切面后的结果：删后受影响 subject 重算出的持久问题（E）。 */
export type DeleteSliceResult = {
    issues: WorldIssue[];
};

/** 某 subject 在某个时刻 reduce 出来的状态。 */
export type SubjectState = {
    subjectId: string;
    type: string;
    attrs: Record<string, JsonValue>;
};

/** 某时刻的世界状态。issues：reduce 时现算的持久问题（E）。 */
export type WorldState = {
    instant: Instant;
    subjects: SubjectState[];
    issues: WorldIssue[];
};

/** 收窄查询结果。issues：reduce 时现算的持久问题（E）；传 attrs 时只返回相关属性问题。 */
export type QueryStateResult = {
    subjects: SubjectState[];
    issues: WorldIssue[];
};

/** timeline 切面列表项。issues：读时现算、归属到该切面的持久问题（E），不落库。 */
export type SliceListItem = {
    id: string;
    instant: Instant;
    previousInstant?: Instant;
    title: string;
    summary: string;
    kind: string;
    mutations?: MutationInput[];
    issues?: WorldIssue[];
};

/** subject 列表项。 */
export type WorldSubjectListItem = {
    id: string;
    type: string;
    name: string;
};

/** 创建 subject 的结果。issues：创建（非空 default 写 init slice）时产生的问题。 */
export type CreateWorldSubjectResult = {
    subjectId: string;
    issues: WorldIssue[];
};

/** 创建 subject 的输入；attrs 只初始化 schema 已声明属性，不复制外部文件正文。 */
export type CreateWorldSubjectInput = {
    id: string;
    type: string;
    name?: string;
    at: Instant;
    attrs?: Record<string, JsonValue>;
};

/** Agent 友好的 schema 属性投影。 */
export type WorldSchemaProjectionAttr = {
    name: string;
    kind: WorldAttrKind;
    type?: string;
    itemType?: string;
    enum?: JsonValue[];
    default?: JsonValue;
    desc?: string;
    fields?: Record<string, WorldSchemaProjectionAttr>;
};

/** Agent 友好的 schema 投影。 */
export type WorldSchemaProjection = {
    subjectTypes: Array<{
        type: string;
        desc?: string;
        attrs: WorldSchemaProjectionAttr[];
    }>;
    calendar: {
        format: string;
        examples: string[];
    };
};

/** 世界引擎可用的 Prisma 执行器。 */
export type WorldPrismaExecutor = Prisma.TransactionClient | {
    worldSubject: Prisma.TransactionClient["worldSubject"];
    worldSlice: Prisma.TransactionClient["worldSlice"];
    worldMutation: Prisma.TransactionClient["worldMutation"];
};

/** 读取 mutation 时带上 subject type，避免 reduce 阶段反复查表。 */
export type WorldMutationRow = {
    id: string;
    sliceId: string;
    subjectId: string;
    instant: bigint;
    seq: number;
    attr: string;
    op: string;
    value: string | null;
};
