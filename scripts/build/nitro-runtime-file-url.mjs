const absoluteNodeModulesFileUrlPattern = /file:\/\/(?:\/?[A-Za-z]:\/|\/)[^'"\s]*?\/node_modules\//gu;
const absoluteNodeModulesFileUrlCheckPattern = /file:\/\/(?:\/?[A-Za-z]:\/|\/)[^'"\s]*?\/node_modules\//u;

/** 把构建机绝对node_modules file URL改为Product vendor相对路径。 */
export function patchAbsoluteNodeModuleFileUrls(text, replacementBase) {
    return text.replace(absoluteNodeModulesFileUrlPattern, `${replacementBase}/`);
}

/** 判断Nitro产物是否仍引用任意平台的绝对node_modules file URL。 */
export function containsAbsoluteNodeModuleFileUrl(text) {
    return absoluteNodeModulesFileUrlCheckPattern.test(text);
}
