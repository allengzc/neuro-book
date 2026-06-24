import fs from "node:fs/promises";
import path from "node:path";
import {createError} from "h3";
import * as yaml from "yaml";
import {resolveProjectAbsolutePath} from "nbook/server/workspace-files/project-workspace";
import {
    attrSchemaToSchemaNode,
    schemaNodeToAttrSchema,
    type JsonValue,
    type WorldAttrKind,
    type WorldAttrSchema,
    type WorldSchema,
    type WorldSchemaNode,
    type WorldSchemaProjectionAttr,
    type WorldSchemaV2,
    type WorldSubjectTypeSchemaV2,
} from "nbook/server/world-engine/types";

const SCHEMA_RELATIVE_PATH = "world-engine/schema.yaml";
const ATTR_KINDS = new Set<WorldAttrKind>(["scalar", "list", "collection", "object"]);
// 同时支持新旧格式的类型名称：text/string, bool/boolean
const VALUE_TYPES = new Set(["int", "float", "text", "string", "bool", "boolean", "enum"]);
const ITEM_VALUE_TYPES = new Set([...VALUE_TYPES, "object"]);

/** 加载 Project Workspace 内的 world-engine/schema.yaml。 */
export class WorldSchemaLoader {
    async load(projectPath: string): Promise<WorldSchema> {
        const schemaPath = path.join(resolveProjectAbsolutePath(projectPath), SCHEMA_RELATIVE_PATH);
        try {
            const parsed = yaml.parse(await fs.readFile(schemaPath, "utf-8")) as unknown;
            return normalizeSchema(parsed);
        } catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
                return {subjectTypes: {}};
            }
            throw createError({statusCode: 400, message: `世界 schema 解析失败：${error instanceof Error ? error.message : String(error)}`});
        }
    }
}

/** 查询某个属性路径在 schema 中的定义；未声明属性返回 null。 */
export function findAttrSchema(schema: WorldSchema, subjectType: string, attrPath: string): WorldAttrSchema | null {
    const subjectSchema = schema.subjectTypes[subjectType];
    if (!subjectSchema) {
        return null;
    }
    const parts = attrPath.split(".").filter(Boolean);
    if (parts.length === 0) {
        return null;
    }

    const firstPart = parts[0];
    if (!firstPart) {
        return null;
    }

    let current: WorldAttrSchema | undefined = subjectSchema.attrs[firstPart];
    for (const part of parts.slice(1)) {
        if (!current) {
            return null;
        }
        const kind = normalizeAttrKind(current);
        if (kind !== "object") {
            return null;
        }
        if (current.fields?.[part]) {
            current = current.fields[part];
            continue;
        }
        if (current.itemType) {
            current = current.itemType === "object" ? {kind: "object"} : {kind: "scalar", type: current.itemType};
            continue;
        }
        return null;
    }
    return current ? normalizeAttr(current) : null;
}

/** 返回属性的 kind，子字段省略 kind 时按 scalar 处理。 */
export function normalizeAttrKind(attr: WorldAttrSchema | null): WorldAttrKind {
    return attr?.kind ?? "scalar";
}

/** 从 schema 中收集创建 subject 时要写入 init slice 的默认值。 */
export function collectDefaultAttrs(schema: WorldSchema, subjectType: string): Array<{attr: string; value: JsonValue}> {
    const subjectSchema = schema.subjectTypes[subjectType];
    if (!subjectSchema) {
        return [];
    }
    const defaults: Array<{attr: string; value: JsonValue}> = [];
    collectDefaultsFromAttrs(subjectSchema.attrs, "", defaults);
    return defaults;
}

/** 生成 Agent 友好的 schema 属性列表。 */
export function flattenAttrs(attrs: Record<string, WorldAttrSchema>, prefix = ""): WorldSchemaProjectionAttr[] {
    const result: WorldSchemaProjectionAttr[] = [];
    for (const [name, attr] of Object.entries(attrs)) {
        const fullName = prefix ? `${prefix}.${name}` : name;
        const normalized = normalizeAttr(attr);
        const projected = projectAttrSchema(fullName, normalized);
        result.push({
            ...projected,
            name: fullName,
        });
        if (normalized.kind === "object" && normalized.fields) {
            result.push(...flattenAttrs(normalized.fields, fullName));
        }
    }
    return result;
}

function projectAttrSchema(name: string, attr: WorldAttrSchema): WorldSchemaProjectionAttr {
    const normalized = normalizeAttr(attr);
    const fields = normalized.fields
        ? Object.fromEntries(Object.entries(normalized.fields).map(([fieldName, fieldSchema]) => [fieldName, projectAttrSchema(fieldName, fieldSchema)]))
        : undefined;
    const projected: WorldSchemaProjectionAttr = {
        name,
        kind: normalizeAttrKind(normalized),
        type: normalized.type ?? normalized.itemType,
        enum: normalized.enum,
        default: normalized.default,
        desc: normalized.desc,
    };
    if (normalized.itemType) {
        projected.itemType = normalized.itemType;
    }
    if (fields) {
        projected.fields = fields;
    }
    return projected;
}

function normalizeSchema(input: unknown): WorldSchema {
    if (input === null || input === undefined) {
        return {subjectTypes: {}};
    }
    if (typeof input !== "object" || Array.isArray(input)) {
        throw createError({statusCode: 400, message: "schema 配置必须是 object"});
    }

    // 新格式检测：有 types 字段
    if ("types" in input && input.types) {
        return normalizeNewSchemaToOld(input as {types: unknown});
    }

    // 旧格式：有 subjectTypes 字段
    const rawSubjectTypes = (input as {subjectTypes?: unknown}).subjectTypes;
    const subjectTypes = rawSubjectTypes === undefined ? {} : readRecord(rawSubjectTypes, "subjectTypes");
    const normalized: WorldSchema["subjectTypes"] = {};
    for (const [type, rawSubjectType] of Object.entries(subjectTypes)) {
        assertSubjectTypeName(type);
        const subjectType = readRecord(rawSubjectType, `subjectTypes.${type}`);
        const attrs = subjectType.attrs === undefined ? {} : readRecord(subjectType.attrs, `subjectTypes.${type}.attrs`);
        normalized[type] = {
            desc: readDesc(subjectType.desc, `subjectTypes.${type}.desc`),
            attrs: normalizeAttrs(attrs as Record<string, WorldAttrSchema>),
        };
    }
    const schema = {subjectTypes: normalized};
    assertRefTargets(schema);
    return schema;
}

/**
 * 解析新格式 schema 并转换为旧格式（向后兼容）。
 *
 * 新格式示例：
 * types:
 *   character:
 *     type: object
 *     properties:
 *       name: { type: string, default: "无名者" }
 *       skills: { type: array, items: { type: string }, unique: true }
 */
function normalizeNewSchemaToOld(input: {types: unknown}): WorldSchema {
    const rawTypes = readRecord(input.types, "types");
    const subjectTypes: WorldSchema["subjectTypes"] = {};

    for (const [typeName, rawTypeSchema] of Object.entries(rawTypes)) {
        assertSubjectTypeName(typeName);
        const typeSchema = readRecord(rawTypeSchema, `types.${typeName}`);

        // 新格式要求 subject type 必须是 object
        const nodeType = typeSchema.type;
        if (nodeType !== "object") {
            throw createError({
                statusCode: 400,
                message: `types.${typeName}: subject type 必须是 object，实际为 ${String(nodeType)}`,
            });
        }

        const properties = typeSchema.properties
            ? readRecord(typeSchema.properties, `types.${typeName}.properties`)
            : {};

        // 递归解析 properties，转换为旧格式 attrs
        const attrs: Record<string, WorldAttrSchema> = {};
        for (const [attrName, rawNode] of Object.entries(properties)) {
            const node = normalizeSchemaNode(rawNode as unknown, `types.${typeName}.properties.${attrName}`);
            attrs[attrName] = schemaNodeToAttrSchema(node);
        }

        subjectTypes[typeName] = {
            desc: readDesc(typeSchema.desc, `types.${typeName}.desc`),
            attrs,
        };
    }

    const schema: WorldSchema = {subjectTypes};

    // 校验 ref 引用
    assertRefTargetsForNewSchema(schema, rawTypes);

    return schema;
}

/**
 * 递归规范化 WorldSchemaNode。
 *
 * 校验：
 * - type 字段必须存在且合法
 * - unique 约束只能用于 array
 * - dynamic 约束只能用于 object
 * - array 必须有 items
 * - object 必须有 properties 或 dynamic
 */
function normalizeSchemaNode(input: unknown, pathLabel: string): WorldSchemaNode {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        throw createError({statusCode: 400, message: `${pathLabel}: schema node 必须是 object`});
    }

    const node = input as Record<string, unknown>;
    const type = node.type;

    if (typeof type !== "string") {
        throw createError({statusCode: 400, message: `${pathLabel}: 缺少 type 字段或类型错误`});
    }

    const validTypes = new Set(["int", "float", "string", "boolean", "ref", "array", "object"]);
    if (!validTypes.has(type)) {
        throw createError({statusCode: 400, message: `${pathLabel}: 不合法的 type: ${type}`});
    }

    // 基础类型
    if (type === "int" || type === "float" || type === "string" || type === "boolean" || type === "ref") {
        const baseNode: WorldSchemaNode = {
            type: type as "int" | "float" | "string" | "boolean" | "ref",
            default: isJsonValue(node.default) ? node.default : undefined,
            desc: typeof node.desc === "string" ? node.desc : undefined,
        };

        if (type === "ref" && typeof node.ref === "string") {
            (baseNode as {ref?: string}).ref = node.ref;
        }

        if (node.values !== undefined) {
            if (!Array.isArray(node.values)) {
                throw createError({statusCode: 400, message: `${pathLabel}: values 必须是数组`});
            }
            if (!node.values.every(isJsonValue)) {
                throw createError({statusCode: 400, message: `${pathLabel}: values 必须是 JSON 值数组`});
            }
            (baseNode as {values?: JsonValue[]}).values = node.values;
        }

        return baseNode;
    }

    // array 类型
    if (type === "array") {
        if (!node.items) {
            throw createError({statusCode: 400, message: `${pathLabel}: array 必须有 items 字段`});
        }

        const items = normalizeSchemaNode(node.items, `${pathLabel}.items`);
        const unique = typeof node.unique === "boolean" ? node.unique : undefined;

        return {
            type: "array",
            items,
            unique,
            default: isJsonValue(node.default) ? node.default : undefined,
            desc: typeof node.desc === "string" ? node.desc : undefined,
        };
    }

    // object 类型
    if (type === "object") {
        const dynamic = typeof node.dynamic === "boolean" ? node.dynamic : undefined;
        const valueType = typeof node.valueType === "string" ? node.valueType : undefined;

        if (dynamic && !valueType) {
            throw createError({statusCode: 400, message: `${pathLabel}: dynamic object 必须指定 valueType`});
        }

        if (node.properties && dynamic) {
            throw createError({statusCode: 400, message: `${pathLabel}: 不能同时指定 properties 和 dynamic`});
        }

        if (!node.properties && !dynamic) {
            throw createError({statusCode: 400, message: `${pathLabel}: object 必须有 properties 或 dynamic=true`});
        }

        if (node.properties) {
            const rawProperties = readRecord(node.properties, `${pathLabel}.properties`);
            const properties: Record<string, WorldSchemaNode> = {};

            for (const [key, rawChild] of Object.entries(rawProperties)) {
                properties[key] = normalizeSchemaNode(rawChild, `${pathLabel}.properties.${key}`);
            }

            return {
                type: "object",
                properties,
                default: isJsonValue(node.default) ? node.default : undefined,
                desc: typeof node.desc === "string" ? node.desc : undefined,
            };
        }

        // dynamic object
        return {
            type: "object",
            dynamic: true,
            valueType,
            default: isJsonValue(node.default) ? node.default : undefined,
            desc: typeof node.desc === "string" ? node.desc : undefined,
        };
    }

    throw createError({statusCode: 400, message: `${pathLabel}: 不支持的 type: ${type}`});
}

/** 校验新格式 schema 的 ref 引用 */
function assertRefTargetsForNewSchema(schema: WorldSchema, rawTypes: Record<string, unknown>): void {
    for (const [typeName, rawTypeSchema] of Object.entries(rawTypes)) {
        const typeSchema = rawTypeSchema as Record<string, unknown>;
        const properties = typeSchema.properties as Record<string, unknown> | undefined;

        if (properties) {
            assertRefTargetsInNode(schema, properties, `types.${typeName}.properties`);
        }
    }
}

/** 递归校验 node 中的 ref */
function assertRefTargetsInNode(schema: WorldSchema, nodeOrNodes: unknown, pathLabel: string): void {
    if (typeof nodeOrNodes !== "object" || nodeOrNodes === null) {
        return;
    }

    if (Array.isArray(nodeOrNodes)) {
        return;
    }

    const nodes = nodeOrNodes as Record<string, unknown>;

    for (const [key, rawNode] of Object.entries(nodes)) {
        if (typeof rawNode !== "object" || rawNode === null) {
            continue;
        }

        const node = rawNode as Record<string, unknown>;
        const nodePathLabel = `${pathLabel}.${key}`;

        // 检查 ref
        if (node.type === "ref" && typeof node.ref === "string") {
            const refType = node.ref;
            if (!schema.subjectTypes[refType]) {
                throw createError({
                    statusCode: 400,
                    message: `${nodePathLabel}: ref 指向未声明的 subject type: ${refType}`,
                });
            }
        }

        // 递归检查 array items
        if (node.type === "array" && node.items) {
            assertRefTargetsInNode(schema, {_: node.items}, `${nodePathLabel}.items`);
        }

        // 递归检查 object properties
        if (node.type === "object" && node.properties) {
            assertRefTargetsInNode(schema, node.properties, `${nodePathLabel}.properties`);
        }
    }
}

/** 判断是否为合法 JSON 值 */
function isJsonValue(input: unknown): input is JsonValue {
    if (input === null || typeof input === "string" || typeof input === "boolean") {
        return true;
    }
    if (typeof input === "number") {
        return Number.isFinite(input);
    }
    if (Array.isArray(input)) {
        return input.every(isJsonValue);
    }
    if (isPlainRecord(input)) {
        return Object.values(input).every(isJsonValue);
    }
    return false;
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return false;
    }
    const proto = Object.getPrototypeOf(input) as unknown;
    return proto === Object.prototype || proto === null;
}

function assertSubjectTypeName(type: string): void {
    if (type.trim() === "") {
        throw createError({statusCode: 400, message: "subject type 不能为空"});
    }
    if (/\s/.test(type)) {
        throw createError({statusCode: 400, message: `subject type 不能包含空白：${type}`});
    }
    if (type.includes("(") || type.includes(")")) {
        throw createError({statusCode: 400, message: `subject type 不能包含括号：${type}`});
    }
}

function assertRefTargets(schema: WorldSchema): void {
    for (const [subjectType, subjectSchema] of Object.entries(schema.subjectTypes)) {
        assertAttrRefTargets(schema, subjectSchema.attrs, `subjectTypes.${subjectType}.attrs`);
    }
}

function assertAttrRefTargets(schema: WorldSchema, attrs: Record<string, WorldAttrSchema>, prefix: string): void {
    for (const [name, attr] of Object.entries(attrs)) {
        const pathLabel = `${prefix}.${name}`;
        const refType = readRefType(attr.type) ?? readRefType(attr.itemType);
        if (refType && !schema.subjectTypes[refType]) {
            throw createError({statusCode: 400, message: `schema ref 指向未声明 subject type：${pathLabel} -> ${refType}`});
        }
        if (attr.fields) {
            assertAttrRefTargets(schema, attr.fields, pathLabel);
        }
    }
}

function readRefType(type: string | undefined): string | undefined {
    if (type === undefined) {
        return undefined;
    }
    return /^ref\((.+)\)$/.exec(type)?.[1];
}

function readRecord(input: unknown, pathLabel: string): Record<string, unknown> {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        throw createError({statusCode: 400, message: `schema 字段必须是 object：${pathLabel}`});
    }
    return input as Record<string, unknown>;
}

function readDesc(input: unknown, pathLabel: string): string | undefined {
    if (input === undefined) {
        return undefined;
    }
    if (typeof input !== "string") {
        throw createError({statusCode: 400, message: `desc 必须是字符串：${pathLabel}`});
    }
    return input;
}

function normalizeAttrs(attrs: Record<string, WorldAttrSchema>, prefix = ""): Record<string, WorldAttrSchema> {
    const normalized: Record<string, WorldAttrSchema> = {};
    for (const [name, attr] of Object.entries(attrs)) {
        const fullName = prefix ? `${prefix}.${name}` : name;
        assertAttrName(name, fullName);
        normalized[name] = normalizeAttr(attr, fullName);
    }
    return normalized;
}

function assertAttrName(name: string, pathLabel: string): void {
    if (name.trim() === "") {
        throw createError({statusCode: 400, message: `attr 名不能为空：${pathLabel}`});
    }
    if (name !== name.trim()) {
        throw createError({statusCode: 400, message: `attr 名不能包含前后空白：${pathLabel}`});
    }
    if (name.includes(".")) {
        throw createError({statusCode: 400, message: `attr 名不能包含 .：${pathLabel}`});
    }
}

function normalizeAttr(attr: WorldAttrSchema, pathLabel = "attr"): WorldAttrSchema {
    if (typeof attr !== "object" || attr === null || Array.isArray(attr)) {
        throw createError({statusCode: 400, message: `属性 schema 必须是 object：${pathLabel}`});
    }
    const kind = readAttrKind(attr, pathLabel);
    const type = readValueType(attr, "type", pathLabel);
    const itemType = readValueType(attr, "itemType", pathLabel);
    const fields = readFields(attr, pathLabel);
    const enumValues = readEnum(attr, pathLabel);
    const defaultValue = readDefault(attr, pathLabel);
    const desc = readDesc((attr as {desc?: unknown}).desc, `${pathLabel}.desc`);
    assertAttrShape({kind, type, itemType, fields, enumValues, pathLabel});
    const normalizedFields = fields ? normalizeAttrs(fields, pathLabel) : undefined;
    const normalized: WorldAttrSchema = {
        ...attr,
        kind,
        type,
        itemType,
        enum: enumValues,
        default: defaultValue,
        desc,
        fields: normalizedFields,
    };
    if (defaultValue !== undefined) {
        assertDefaultValue(pathLabel, defaultValue, normalized);
    }
    return normalized;
}

function readAttrKind(attr: WorldAttrSchema, pathLabel: string): WorldAttrKind {
    const rawKind = (attr as {kind?: unknown}).kind;
    if (rawKind === undefined) {
        return "scalar";
    }
    if (typeof rawKind === "string" && ATTR_KINDS.has(rawKind as WorldAttrKind)) {
        return rawKind as WorldAttrKind;
    }
    throw createError({statusCode: 400, message: `属性 kind 不合法：${pathLabel}=${String(rawKind)}`});
}

function readFields(attr: WorldAttrSchema, pathLabel: string): Record<string, WorldAttrSchema> | undefined {
    const fields = (attr as {fields?: unknown}).fields;
    if (fields === undefined) {
        return undefined;
    }
    if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
        throw createError({statusCode: 400, message: `属性 fields 必须是 object：${pathLabel}`});
    }
    return fields as Record<string, WorldAttrSchema>;
}

function readValueType(attr: WorldAttrSchema, field: "type" | "itemType", pathLabel: string): string | undefined {
    const valueType = (attr as {type?: unknown; itemType?: unknown})[field];
    if (valueType === undefined) {
        return undefined;
    }
    if (typeof valueType !== "string" || !isKnownValueType(valueType, field)) {
        throw createError({statusCode: 400, message: `属性 ${field} 不合法：${pathLabel}=${String(valueType)}`});
    }
    return valueType;
}

function isKnownValueType(type: string, field: "type" | "itemType"): boolean {
    const valueTypes = field === "itemType" ? ITEM_VALUE_TYPES : VALUE_TYPES;
    if (valueTypes.has(type)) {
        return true;
    }
    const refType = /^ref\((.+)\)$/.exec(type)?.[1];
    if (refType === undefined) {
        return false;
    }
    assertSubjectTypeName(refType);
    return true;
}

function assertAttrShape(input: {
    kind: WorldAttrKind;
    type?: string;
    itemType?: string;
    fields?: Record<string, WorldAttrSchema>;
    enumValues?: JsonValue[];
    pathLabel: string;
}): void {
    if (input.kind !== "object" && input.fields) {
        throw createError({statusCode: 400, message: `${input.pathLabel}(${input.kind}) 不能声明 fields`});
    }
    if (input.kind === "scalar" && input.itemType) {
        throw createError({statusCode: 400, message: `${input.pathLabel}(scalar) 不能声明 itemType`});
    }
    if ((input.kind === "list" || input.kind === "collection") && input.type) {
        throw createError({statusCode: 400, message: `${input.pathLabel}(${input.kind}) 不能声明 type，请使用 itemType`});
    }
    if ((input.kind === "list" || input.kind === "collection") && !input.itemType) {
        throw createError({statusCode: 400, message: `${input.pathLabel}(${input.kind}) 必须声明 itemType`});
    }
    if (input.kind === "object" && input.type) {
        throw createError({statusCode: 400, message: `${input.pathLabel}(object) 不能声明 type`});
    }
    if (input.kind === "object" && input.fields && input.itemType) {
        throw createError({statusCode: 400, message: `${input.pathLabel}(object) 不能同时声明 fields 和 itemType`});
    }
    const valueType = input.type ?? input.itemType;
    if (valueType === "enum" && !input.enumValues?.length) {
        throw createError({statusCode: 400, message: `${input.pathLabel}(enum) 必须声明非空 enum`});
    }
    if (input.enumValues && valueType !== "enum") {
        throw createError({statusCode: 400, message: `${input.pathLabel} 只有 type/itemType=enum 时才能声明 enum`});
    }
}

function readEnum(attr: WorldAttrSchema, pathLabel: string): JsonValue[] | undefined {
    const enumValues = (attr as {enum?: unknown}).enum;
    if (enumValues === undefined) {
        return undefined;
    }
    if (!Array.isArray(enumValues)) {
        throw createError({statusCode: 400, message: `属性 enum 必须是 array：${pathLabel}`});
    }
    for (const [index, item] of enumValues.entries()) {
        if (!isJsonValue(item)) {
            throw createError({statusCode: 400, message: `属性 enum 必须是 JSON 值：${pathLabel}[${index}]`});
        }
    }
    assertUniqueEnumValues(enumValues, pathLabel);
    return enumValues;
}

function assertUniqueEnumValues(enumValues: JsonValue[], pathLabel: string): void {
    const seen = new Map<string, number>();
    for (const [index, item] of enumValues.entries()) {
        const key = stableJson(item);
        const previousIndex = seen.get(key);
        if (previousIndex !== undefined) {
            throw createError({statusCode: 400, message: `属性 enum 不能包含重复值：${pathLabel}[${previousIndex}] / ${pathLabel}[${index}]`});
        }
        seen.set(key, index);
    }
}

function readDefault(attr: WorldAttrSchema, pathLabel: string): JsonValue | undefined {
    const defaultValue = (attr as {default?: unknown}).default;
    if (defaultValue === undefined) {
        return undefined;
    }
    if (!isJsonValue(defaultValue)) {
        throw createError({statusCode: 400, message: `属性 default 必须是 JSON 值：${pathLabel}`});
    }
    return defaultValue;
}

function assertDefaultValue(pathLabel: string, value: JsonValue, attr: WorldAttrSchema): void {
    const kind = normalizeAttrKind(attr);
    if (kind === "list" || kind === "collection") {
        if (!Array.isArray(value)) {
            throw createError({statusCode: 400, message: `${pathLabel} default 必须是 array`});
        }
        const itemType = attr.itemType ?? attr.type;
        if (itemType) {
            for (const [index, item] of value.entries()) {
                assertTypedDefault(`${pathLabel}[${index}]`, item, itemType, attr);
            }
        }
        return;
    }
    if (kind === "object") {
        assertObjectDefault(pathLabel, value, attr);
        return;
    }
    const type = attr.type ?? attr.itemType;
    if (type) {
        assertTypedDefault(pathLabel, value, type, attr);
    }
}

function assertObjectDefault(pathLabel: string, value: JsonValue, attr: WorldAttrSchema): void {
    if (!isPlainRecord(value)) {
        throw createError({statusCode: 400, message: `${pathLabel} default 必须是 object`});
    }
    if (attr.fields) {
        for (const [key, item] of Object.entries(value)) {
            const fieldSchema = attr.fields[key];
            if (!fieldSchema) {
                throw createError({statusCode: 400, message: `${pathLabel}.${key} 未在 object.fields 声明`});
            }
            assertDefaultValueBySchema(`${pathLabel}.${key}`, item, fieldSchema);
        }
        return;
    }
    if (attr.itemType) {
        for (const [key, item] of Object.entries(value)) {
            assertTypedDefault(`${pathLabel}.${key}`, item, attr.itemType, attr);
        }
    }
}

function assertDefaultValueBySchema(pathLabel: string, value: JsonValue, attr: WorldAttrSchema): void {
    if (normalizeAttrKind(attr) === "object") {
        assertObjectDefault(pathLabel, value, attr);
        return;
    }
    const type = attr.type ?? attr.itemType;
    if (type) {
        assertTypedDefault(pathLabel, value, type, attr);
    }
}

function assertTypedDefault(pathLabel: string, value: JsonValue, type: string, attr: WorldAttrSchema): void {
    if (type === "int" && (typeof value !== "number" || !Number.isInteger(value))) {
        throw createError({statusCode: 400, message: `${pathLabel} default 必须是 int`});
    }
    if (type === "int" && !Number.isSafeInteger(value)) {
        throw createError({statusCode: 400, message: `${pathLabel} default 必须是安全整数`});
    }
    if (type === "float" && (typeof value !== "number" || !Number.isFinite(value))) {
        throw createError({statusCode: 400, message: `${pathLabel} default 必须是 float`});
    }
    if (type === "text" && typeof value !== "string") {
        throw createError({statusCode: 400, message: `${pathLabel} default 必须是 text`});
    }
    if (type === "bool" && typeof value !== "boolean") {
        throw createError({statusCode: 400, message: `${pathLabel} default 必须是 bool`});
    }
    if (type === "enum" && attr.enum && !attr.enum.some((item) => stableJson(item) === stableJson(value))) {
        throw createError({statusCode: 400, message: `${pathLabel} default 不在 enum 取值内`});
    }
    if (type === "object" && !isPlainRecord(value)) {
        throw createError({statusCode: 400, message: `${pathLabel} default 必须是 object`});
    }
    const refType = readRefType(type);
    if (refType) {
        assertRefDefault(pathLabel, value);
    }
}

function assertRefDefault(pathLabel: string, value: JsonValue): void {
    if (typeof value !== "string" || !value.startsWith("subject://")) {
        throw createError({statusCode: 400, message: `${pathLabel} default 必须是 subject://<id> 引用`});
    }
    const targetId = value.slice("subject://".length);
    if (targetId.trim() === "") {
        throw createError({statusCode: 400, message: `${pathLabel} default 引用 id 不能为空`});
    }
    if (targetId !== targetId.trim()) {
        throw createError({statusCode: 400, message: `${pathLabel} default 引用 id 不能包含前后空白：${targetId}`});
    }
}

function stableJson(input: JsonValue): string {
    if (Array.isArray(input)) {
        return `[${input.map((item) => stableJson(item)).join(",")}]`;
    }
    if (isPlainRecord(input)) {
        return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${stableJson((input[key] as JsonValue | undefined) ?? null)}`).join(",")}}`;
    }
    return JSON.stringify(input);
}

function collectDefaultsFromAttrs(attrs: Record<string, WorldAttrSchema>, prefix: string, output: Array<{attr: string; value: JsonValue}>): void {
    for (const [name, attr] of Object.entries(attrs)) {
        const fullName = prefix ? `${prefix}.${name}` : name;
        const defaultValue = attr.default;
        if (defaultValue !== undefined) {
            output.push({attr: fullName, value: defaultValue});
            continue;
        }
        const kind = normalizeAttrKind(attr);
        // list / collection 默认空数组：为相对 op（listAppend / collection*）建立基准，
        // 这样首次追加不会被当成「缺基」E1，缺基只发生在 init 被删等真错误时。
        if (kind === "list" || kind === "collection") {
            output.push({attr: fullName, value: []});
            continue;
        }
        if (kind === "object" && attr.fields) {
            collectDefaultsFromAttrs(attr.fields, fullName, output);
        }
    }
}
