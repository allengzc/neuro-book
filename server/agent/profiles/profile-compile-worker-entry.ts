import {parentPort} from "node:worker_threads";
import {runProfileCompile, runProfileCompileAll} from "./profile-compile-worker-runtime";
import type {
    AgentProfileCompileAllRequestDto,
    AgentProfileCompileRequestDto,
} from "nbook/shared/dto/agent-profile.dto";

type WorkerRequest = {
    id: number;
    mode?: "single" | "all";
    input: AgentProfileCompileRequestDto | AgentProfileCompileAllRequestDto;
};

if (!parentPort) {
    throw new Error("profile compile worker 必须运行在 worker_threads 中。");
}

parentPort.on("message", async (message: WorkerRequest) => {
    const result = message.mode === "all"
        ? await runProfileCompileAll(message.input)
        : await runProfileCompile(message.input as AgentProfileCompileRequestDto);
    parentPort!.postMessage({
        id: message.id,
        result,
    });
});
