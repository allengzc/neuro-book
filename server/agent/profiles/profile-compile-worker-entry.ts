import {parentPort} from "node:worker_threads";
import {runProfileCompile} from "./profile-compile-worker-runtime";
import type {AgentProfileCompileRequestDto} from "nbook/shared/dto/agent-profile.dto";

type WorkerRequest = {
    id: number;
    input: AgentProfileCompileRequestDto;
};

if (!parentPort) {
    throw new Error("profile compile worker 必须运行在 worker_threads 中。");
}

parentPort.on("message", async (message: WorkerRequest) => {
    const result = await runProfileCompile(message.input);
    parentPort!.postMessage({
        id: message.id,
        result,
    });
});
