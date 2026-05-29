#!/usr/bin/env node
import {cp, mkdir, rm} from "node:fs/promises";
import {dirname, resolve} from "node:path";

const runtimePackages = [
    "@libsql/isomorphic-ws",
    "ws",
];

for (const packageName of runtimePackages) {
    const source = resolve("node_modules", ...packageName.split("/"));
    const target = resolve(".output", "server", "node_modules", ...packageName.split("/"));
    await rm(target, {recursive: true, force: true});
    await mkdir(dirname(target), {recursive: true});
    await cp(source, target, {recursive: true});
}

console.log(`patched Nitro runtime dependencies: ${runtimePackages.join(", ")}`);
