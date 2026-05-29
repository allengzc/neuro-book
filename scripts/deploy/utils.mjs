/** 部署脚本专用工具函数。 */

import * as p from '@clack/prompts';

/** 把用户取消交互转成干净退出。 */
export function unwrapPrompt(value) {
    if (p.isCancel(value)) {
        p.cancel('部署已取消。');
        process.exit(0);
    }

    return value;
}
