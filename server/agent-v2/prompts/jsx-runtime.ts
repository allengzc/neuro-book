import {Fragment} from "nbook/server/agent/prompts/components";
import type {PromptChild} from "nbook/server/agent/prompts/types";

type PropsWithChildren = {
    children?: PromptChild | PromptChild[];
};

type PromptFactoryComponent<TProps> = (props: TProps & PropsWithChildren) => PromptChild;

/**
 * TSX 运行时入口。
 * 这里只支持函数组件与 Fragment，不支持 HTML intrinsic elements。
 */
function createPromptNode<TProps>(
    type: PromptFactoryComponent<TProps> | typeof Fragment,
    props: (TProps & PropsWithChildren) | null,
): PromptChild {
    const normalizedProps = (props ?? {}) as TProps & PropsWithChildren;
    return type(normalizedProps);
}

/**
 * classic / fallback JSX 工厂兼容入口。
 * 主要用于部分构建链仍探测 createElement 的场景。
 */
export function createElement<TProps>(
    type: PromptFactoryComponent<TProps> | typeof Fragment,
    props: (TProps & PropsWithChildren) | null,
    ...children: PromptChild[]
): PromptChild {
    const normalizedProps = {
        ...(props ?? {}),
        children: children.length <= 1 ? children[0] : children,
    } as TProps & PropsWithChildren;
    return createPromptNode(type, normalizedProps);
}

export function jsx<TProps>(
    type: PromptFactoryComponent<TProps> | typeof Fragment,
    props: (TProps & PropsWithChildren) | null,
): PromptChild {
    return createPromptNode(type, props);
}

export function jsxs<TProps>(
    type: PromptFactoryComponent<TProps> | typeof Fragment,
    props: (TProps & PropsWithChildren) | null,
): PromptChild {
    return createPromptNode(type, props);
}

export function jsxDEV<TProps>(
    type: PromptFactoryComponent<TProps> | typeof Fragment,
    props: (TProps & PropsWithChildren) | null,
): PromptChild {
    return createPromptNode(type, props);
}

export {Fragment};

export namespace JSX {
    export type Element = PromptChild;
    export interface ElementChildrenAttribute {
        children: {};
    }
    export interface IntrinsicElements {}
}
