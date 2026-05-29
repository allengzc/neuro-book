/** 部署脚本交互提示封装。 */

import * as p from '@clack/prompts';
import {unwrapPrompt} from './utils.mjs';

/** 在交互模式下确认；非交互模式直接返回 false。 */
export async function askConfirm({interactive, message, initialValue = true}) {
    if (!interactive) {
        return false;
    }

    return Boolean(unwrapPrompt(await p.confirm({
        message,
        initialValue,
    })));
}

/** 在交互模式下询问文本；非交互模式直接使用默认值。 */
export async function askText({interactive, value, message, placeholder, initialValue, validate}) {
    if (value !== undefined && value !== null && value !== '') {
        return String(value);
    }

    if (!interactive) {
        return String(initialValue ?? '');
    }

    return String(unwrapPrompt(await p.text({
        message,
        placeholder,
        initialValue,
        validate,
    })));
}

/** 在交互模式下选择选项；非交互模式直接使用默认值。 */
export async function askSelect({interactive, value, message, options, initialValue}) {
    if (value !== undefined && value !== null && value !== '') {
        return String(value).toLowerCase();
    }

    if (!interactive) {
        return String(initialValue);
    }

    return String(unwrapPrompt(await p.select({
        message,
        options,
        initialValue,
    })));
}
