import {Type} from "typebox";

/**
 * leader.default 的实例初始化参数。它只用于 create_agent，不承载每轮 prompt。
 */
export const LeaderDefaultInputSchema = Type.Object({
    role: Type.Optional(Type.String()),
});

/**
 * leader.default 的结构化输出合同。
 */
export const LeaderDefaultOutputSchema = Type.Object({
    result: Type.Optional(Type.String()),
});
