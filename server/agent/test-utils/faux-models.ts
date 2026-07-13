import {createModels, fauxProvider} from "@earendil-works/pi-ai";
import type {FauxProviderHandle, Models, RegisterFauxProviderOptions} from "@earendil-works/pi-ai";

export type FauxModelsFixture = FauxProviderHandle & {
    runtime: Models;
};

/**
 * 创建 suite 私有的 Faux Provider 与 Models，response queue 不与其他测试共享。
 */
export function createFauxModels(options?: RegisterFauxProviderOptions): FauxModelsFixture {
    const faux = fauxProvider(options);
    const runtime = createModels();
    runtime.setProvider(faux.provider);
    return {...faux, runtime};
}
