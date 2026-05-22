import type {BaseChatModel} from "@langchain/core/language_models/chat_models";
import type {AgentThreadRecord, ProfileKey} from "nbook/server/agent/types";
import {useChatModel, useThreadProfileChatModel} from "nbook/server/utils/model";

/**
 * 模型提供器接口。
 */
export interface ModelProvider {
    getChatModel(input?: {
        thread?: AgentThreadRecord;
        profileKey?: ProfileKey;
    }): BaseChatModel;
}

/**
 * 默认模型提供器。
 * 直接复用现有项目的模型加载方式。
 */
export class DefaultModelProvider implements ModelProvider {
    getChatModel(input?: {
        thread?: AgentThreadRecord;
        profileKey?: ProfileKey;
    }): BaseChatModel {
        if (input?.thread && input.profileKey) {
            return useThreadProfileChatModel(
                input.profileKey,
                input.thread.metadata.modelOverride ?? null,
                input.thread.metadata.modelOverrideKey ?? null,
            );
        }

        return useChatModel();
    }
}
