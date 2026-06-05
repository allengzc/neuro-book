/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import type {Static} from "typebox";
import {SubjectSimulatorInputSchema, SubjectSimulatorOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {createSubjectSimulatorProfile} from "nbook/assets/workspace/.nbook/agent/profiles/builtin/subject-simulator-profile";

export const profileManifest = {
    key: "simulator.actor",
    name: "Subject Simulator",
    description: "通用 subject simulator：基于 subject 指令、knowledge/mind/state 和 simulator leader 的戏内消息回应，通过 report_result 返回结构化 subject packet。",
} as const;

export const InputSchema = SubjectSimulatorInputSchema;
export const OutputSchema = SubjectSimulatorOutputSchema;

export type Input = Static<typeof InputSchema>;
export type Output = Static<typeof OutputSchema>;

export default createSubjectSimulatorProfile(profileManifest);
