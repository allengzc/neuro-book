import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {Command} from "commander";
import {loadConfig} from "./config";
import {loadRules} from "./rules";
import {scanText} from "./scanner";
import {createCheckJsonReport, createLLMRulesJsonReport, formatCheckReport, formatJsonReport, formatLLMRules, hasHighLevelIssue} from "./reporter";
import type {LlmlintOutput} from "./types";

type GlobalOptions = {
    config?: string;
    format?: string;
};

const OUTPUTS = new Set<LlmlintOutput>(["stylish", "json"]);

/**
 * llmlint 命令行入口。CLI 只做参数解析和错误出口，规则行为由模块提供。
 */
export async function runCli(argv: string[]): Promise<void> {
    const program = new Command();

    program
        .name("llmlint")
        .description("检查 LLM 输出中的套路化表达、AI 写作痕迹和中文文本节奏问题")
        .version("0.2.0")
        .addHelpCommand(false)
        .option("-c, --config <path>", "指定 llmlint.config.ts 路径")
        .option("-f, --format <format>", "输出格式：stylish 或 json");

    program
        .command("check")
        .description("检查文件中的 regex rule 候选问题")
        .argument("<file>", "要检查的 UTF-8 文本文件")
        .option("-f, --format <format>", "输出格式：stylish 或 json")
        .action(async (file: string, commandOptions: GlobalOptions | Command) => {
            try {
                const options = mergeOptions(program, commandOptions);
                await checkFile(file, options);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    program
        .command("show-llm-rules")
        .description("显示需要 Agent 主动全文审查的 LLM 规则")
        .option("-f, --format <format>", "输出格式：stylish 或 json")
        .action(async (commandOptions: GlobalOptions | Command) => {
            try {
                const options = mergeOptions(program, commandOptions);
                await showLLMRules(options);
            } catch (error) {
                console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
                process.exitCode = 1;
            }
        });

    await program.parseAsync(argv);
}

async function checkFile(file: string, options: GlobalOptions): Promise<void> {
    const {config, configPath} = await loadConfig({cwd: process.cwd(), configPath: options.config});
    const loadedRules = await loadRules(config);
    const output = resolveOutput(config.output, options.format);
    const filePath = resolve(process.cwd(), file);
    const issues = scanText(readFileSync(filePath, "utf-8"), loadedRules.regexRules);
    console.log(output === "json"
        ? formatJsonReport(createCheckJsonReport(filePath, configPath, issues, loadedRules))
        : formatCheckReport(filePath, issues, loadedRules));
    if (hasHighLevelIssue(issues)) {
        process.exitCode = 1;
    }
}

async function showLLMRules(options: GlobalOptions): Promise<void> {
    const {config, configPath} = await loadConfig({cwd: process.cwd(), configPath: options.config});
    const loadedRules = await loadRules(config);
    const output = resolveOutput(config.output, options.format);
    console.log(output === "json"
        ? formatJsonReport(createLLMRulesJsonReport(configPath, loadedRules))
        : formatLLMRules(loadedRules.llmRules, loadedRules.diagnostics));
}

function mergeOptions(program: Command, commandOptions: GlobalOptions | Command): GlobalOptions {
    const localOptions = typeof (commandOptions as Command).opts === "function"
        ? (commandOptions as Command).opts<GlobalOptions>()
        : commandOptions as GlobalOptions;
    return {
        ...program.opts<GlobalOptions>(),
        ...localOptions,
    };
}

function resolveOutput(configOutput: LlmlintOutput, optionOutput: string | undefined): LlmlintOutput {
    if (!optionOutput) {
        return configOutput;
    }
    if (!OUTPUTS.has(optionOutput as LlmlintOutput)) {
        throw new Error(`输出格式无效: ${optionOutput}`);
    }
    return optionOutput as LlmlintOutput;
}
