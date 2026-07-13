import {basename} from "node:path";

import {inspectInstance} from "#manager/instance-discovery";
import {installSourceAdoption, type AdoptSourceOptions} from "#manager/installer";
import {registerManagerInstance} from "#manager/manager-config";
import type {InstallationManifest, ManagerInstance} from "#manager/types";

/** 检查并事务接管NeuroBook Source checkout，成功后登记用户实例索引。 */
export async function adoptSourceInstallation(options: AdoptSourceOptions & {name?: string; makeDefault?: boolean; configPath?: string}): Promise<{manifest: InstallationManifest; instance: ManagerInstance}> {
    const inspection = await inspectInstance(options.root);
    if (inspection.kind !== "neuro-book-checkout" || !inspection.git) throw new Error("adopt只接受没有Manifest的受支持NeuroBook Git checkout。" );
    if (inspection.blockers.length) throw new Error(inspection.blockers.map((issue) => issue.message).join("\n"));
    const manifest = await installSourceAdoption(options);
    const instance = await registerManagerInstance({root: inspection.root, name: options.name ?? basename(inspection.root), makeDefault: options.makeDefault ?? true, configPath: options.configPath});
    return {manifest, instance};
}
