#!/usr/bin/env bun
/**
 * neuro-book 一键部署脚本
 * 本地构建 -> 打包上传 -> 服务器重建镜像 -> 重启服务
 *
 * 前置条件：本地配置 ~/.ssh/config 中 aly 主机，服务器有 Docker + Compose
 * 使用：bun run deploy                    # 部署到 aly
 *       bun run deploy -- --host myserver # 部署到指定主机
 */

import { $ } from "bun";

const targetIdx = Bun.argv.indexOf("--host");
const host = targetIdx !== -1 ? Bun.argv[targetIdx + 1] : "aly";
const remoteDir = "/root/neuro-book";
const archive = "/tmp/neuro-book-dist.tar.gz";

async function run(cmd, label) {
    const { exitCode, stderr } = await $`${{ raw: cmd }}`.quiet();
    if (exitCode !== 0) {
        console.error(`✗ ${label} 失败:\n${stderr.toString()}`);
        process.exit(1);
    }
    console.log(`   ${label} ✓`);
}

console.log("📦 Step 1: 本地构建");
await run("bun run nuxt:prepare", "nuxt:prepare");
await run("bun run generate", "prisma generate");
await run("bun run nuxt:build", "nuxt:build");

console.log("\n📦 Step 2: 打包");
await run(
    `tar -czf ${archive} --exclude='./.git' --exclude='./node_modules' --exclude='./.nuxt' --exclude='./workspace' --exclude='./.agent' --exclude='./.env' --exclude='./.env.docker' --exclude='./config.yaml' --exclude='./*.tar.gz' --exclude='./.cache' --exclude='./coverage' --exclude='./dist' .`,
    "tar"
);

console.log(`\n📦 Step 3: 上传到 ${host}`);
await run(`scp ${archive} ${host}:/tmp/`, "scp");

console.log("\n📦 Step 4: 服务器重建并启动");
const sshScript = `BUILD_DIR=$(mktemp -d) && tar -xzf /tmp/neuro-book-dist.tar.gz -C $BUILD_DIR && sed -i 's/^.output$/#.output/; s/^server\\/generated\\/prisma$/#server\\/generated\\/prisma/' $BUILD_DIR/.dockerignore && docker build -f $BUILD_DIR/Dockerfile.runner -t neuro-book-app $BUILD_DIR && rm -rf $BUILD_DIR && cd ${remoteDir} && docker compose --env-file .env.docker down && docker compose --env-file .env.docker up -d`;

const result = await $`ssh ${host} ${sshScript}`.quiet();
console.log(result.stdout.toString());
console.log(result.stderr.toString());

// 验证
const check = await $`ssh ${host} "docker compose --env-file ${remoteDir}/.env.docker -f ${remoteDir}/docker-compose.yml ps"`.quiet();
console.log(check.stdout.toString());

console.log(`\n✅ 部署完成！访问 http://${host}:3001`);
