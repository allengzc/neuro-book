/** ghcr 模式：使用 GHCR 预构建 Docker 镜像。 */

import {DEPLOY_DIRNAME, ENV_FILENAME} from './constants.mjs';
import {renderGeneratedCompose} from './config-render.mjs';

export const modeName = 'ghcr';

/** ghcr 模式无需 preBuild。 */
export async function preBuild() {}

/** ghcr 模式无需宿主机构建。 */
export async function build() {}

/** ghcr 模式无需 postBuild。 */
export async function postBuild() {}

/** 返回 image override compose。 */
export function renderCompose(config) {
    return renderGeneratedCompose(config);
}

/** ghcr 模式不生成本地启动脚本。 */
export function renderStartScript() {
    return null;
}

/** 返回更新命令提示。 */
export function updateCommands(config) {
    return [
        `docker compose --env-file ${ENV_FILENAME} -f docker-compose.yml -f ${DEPLOY_DIRNAME}/docker-compose.generated.yml pull app`,
        `docker compose --env-file ${ENV_FILENAME} -f docker-compose.yml -f ${DEPLOY_DIRNAME}/docker-compose.generated.yml up -d`,
    ];
}

/** 模式说明文本。 */
export function notes(config) {
    return `ghcr 模式使用预构建镜像 ${config.image}，容器内包含完整项目源码。更新镜像后运行：
${updateCommands(config).map((line) => `- ${line}`).join('\n')}`;
}
