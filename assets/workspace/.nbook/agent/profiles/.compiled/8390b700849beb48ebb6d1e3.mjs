// assets/workspace/.nbook/agent/profiles/builtin/leader.assets.profile.tsx
import { resolve } from "node:path";

// server/agent/messages/message-utils.ts
var EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0
  }
};
function now() {
  return Date.now();
}
function createUserMessage(input, timestamp = now()) {
  const textBlock = {
    type: "text",
    text: input.text
  };
  return {
    role: "user",
    content: input.images?.length ? [textBlock, ...input.images] : [textBlock],
    timestamp
  };
}
function createTextToolResult(input) {
  return {
    role: "toolResult",
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    content: [{ type: "text", text: input.text }],
    details: input.details,
    isError: input.isError ?? false,
    timestamp: input.timestamp ?? now()
  };
}
function createAssistantTextMessage(input) {
  return {
    role: "assistant",
    content: [{ type: "text", text: input.text }],
    api: input.api ?? "neuro-book",
    provider: input.provider ?? "neuro-book",
    model: input.model ?? "neuro-agent",
    usage: input.usage ?? EMPTY_USAGE,
    stopReason: input.stopReason ?? "stop",
    timestamp: input.timestamp ?? now()
  };
}
function messageText(message) {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return message.content;
    }
    return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  }
  if (message.role === "assistant") {
    return message.content.map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      if (block.type === "thinking") {
        return block.thinking;
      }
      return `[tool:${block.name}]`;
    }).join("\n");
  }
  return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

// server/agent/profiles/profile-dsl.ts
var PROFILE_STATE_KEY_PREFIX = "profileState.";
async function compileProfileContext(profile, context, tree) {
  const currentRuntimeState = readProfileRuntimeState(context.session.customState[profileStateKey(profile.manifest.key)]);
  const state = {
    context,
    profileKey: profile.manifest.key,
    currentRuntimeState,
    nextRuntimeState: cloneProfileRuntimeState(currentRuntimeState),
    stateTouched: false,
    currentTurn: context.runtime?.promptUserTurnCount ?? countUserTurns(context.session.messages),
    pendingToolCallIds: [],
    plan: {}
  };
  await renderRoot(state, tree);
  if (state.stateTouched) {
    state.plan.stateWrites = [{
      type: "custom",
      key: profileStateKey(profile.manifest.key),
      value: state.nextRuntimeState
    }];
  }
  validateProfileTurnPlan(profile.manifest.key, state.plan);
  return state.plan;
}
function validateProfileTurnPlan(profileKey, plan) {
  if (!plan || typeof plan !== "object") {
    throw new Error(`profile ${profileKey} prepare/context \u5FC5\u987B\u8FD4\u56DE ProfileTurnPlan\u3002`);
  }
  const allowedKeys = /* @__PURE__ */ new Set(["systemPrompt", "historyInitMessages", "appendingMessages", "modelContextAppendingMessages", "modelContextMessages", "stateWrites", "compaction"]);
  const illegalKey = Object.keys(plan).find((key) => !allowedKeys.has(key));
  if (illegalKey) {
    throw new Error(`profile ${profileKey} ProfileTurnPlan \u4E0D\u5141\u8BB8\u8FD4\u56DE ${illegalKey}\u3002`);
  }
  for (const write of plan.stateWrites ?? []) {
    if (write.type !== "custom") {
      throw new Error(`profile ${profileKey} stateWrites \u53EA\u5141\u8BB8\u5199 custom entry\u3002`);
    }
    if (write.key !== profileStateKey(profileKey)) {
      throw new Error(`profile ${profileKey} stateWrites \u53EA\u5141\u8BB8\u5199 ${profileStateKey(profileKey)}\u3002`);
    }
    validateProfileRuntimeStateWrite(profileKey, write.value);
  }
  validateCompactionPlan(profileKey, plan.compaction);
}
function profileStateKey(profileKey) {
  return `${PROFILE_STATE_KEY_PREFIX}${profileKey}`;
}
function slotNodeName(slot) {
  if (slot === "full") {
    return "PlanModeFull";
  }
  if (slot === "sparse") {
    return "PlanModeSparse";
  }
  if (slot === "exit") {
    return "PlanModeExit";
  }
  return "PlanModeReentry";
}
async function renderRoot(state, tree) {
  if (!tree || typeof tree !== "object" || Array.isArray(tree) || tree.kind !== "ProfilePrompt") {
    throw new Error("context(ctx) \u5FC5\u987B\u8FD4\u56DE <ProfilePrompt> \u6839\u8282\u70B9\u3002");
  }
  await renderChildren(state, "root", tree.children);
}
async function renderChildren(state, zone, children) {
  const messages = [];
  for (const child of children) {
    messages.push(...await renderChild(state, zone, child));
  }
  return messages;
}
async function renderChild(state, zone, child) {
  if (child === null || child === void 0 || child === false || child === true) {
    return [];
  }
  if (Array.isArray(child)) {
    return renderChildren(state, zone, child);
  }
  if (typeof child === "string" || typeof child === "number") {
    if (String(child).trim() !== "") {
      throw new Error(`${zone} \u4E2D\u7684\u6587\u672C\u5FC5\u987B\u653E\u5728\u652F\u6301 string \u7684\u8282\u70B9\u5185\u90E8\u3002`);
    }
    return [];
  }
  if (child.kind === "Fragment") {
    return renderChildren(state, zone, child.children);
  }
  if (child.kind === "If") {
    if (!child.condition) {
      return [];
    }
    return renderChildren(state, zone, child.children);
  }
  if (child.kind === "System") {
    assertZone(zone, "root", "System \u53EA\u80FD\u653E\u5728 ProfilePrompt \u9876\u5C42\u3002");
    validateSystemChildren(child.children);
    const text = await renderStringChildren(state, "system", child.children);
    state.plan.systemPrompt = [state.plan.systemPrompt, text].filter(Boolean).join("\n\n");
    return [];
  }
  if (child.kind === "HistorySet") {
    assertZone(zone, "root", "HistorySet \u53EA\u80FD\u653E\u5728 ProfilePrompt \u9876\u5C42\u3002");
    const messages = await renderChildren(state, "history", child.children);
    state.plan.historyInitMessages = [...state.plan.historyInitMessages ?? [], ...onlyMessages(messages, "HistorySet")];
    return [];
  }
  if (child.kind === "ModelContext") {
    assertZone(zone, "root", "ModelContext \u53EA\u80FD\u653E\u5728 ProfilePrompt \u9876\u5C42\u3002");
    const messages = await renderChildren(state, "model", child.children);
    if (messages.length > 0) {
      state.plan.modelContextMessages = [...state.plan.modelContextMessages ?? [], ...messages];
    }
    return [];
  }
  if (child.kind === "AppendingSet") {
    assertZone(zone, "root", "AppendingSet \u53EA\u80FD\u653E\u5728 ProfilePrompt \u9876\u5C42\u3002");
    const messages = await renderChildren(state, "appending", child.children);
    state.plan.appendingMessages = [...state.plan.appendingMessages ?? [], ...onlyMessages(messages, "AppendingSet")];
    return [];
  }
  if (child.kind === "Compaction") {
    assertZone(zone, "root", "Compaction \u53EA\u80FD\u653E\u5728 ProfilePrompt \u9876\u5C42\u3002");
    state.plan.compaction = await renderCompactionNode(state, child);
    return [];
  }
  if (child.kind === "CompactionPrompt" || child.kind === "CompactionSummaryPrefix") {
    assertZone(zone, "compaction", `${child.kind} \u53EA\u80FD\u653E\u5728 Compaction \u5185\u3002`);
    return [];
  }
  if (child.kind === "Reminder") {
    if (zone !== "appending" && zone !== "model") {
      throw new Error("Reminder \u53EA\u5141\u8BB8\u653E\u5728 AppendingSet \u6216 ModelContext \u5185\u3002");
    }
    const messages = await renderReminder(state, child);
    if (zone === "model") {
      state.plan.modelContextAppendingMessages = [
        ...state.plan.modelContextAppendingMessages ?? [],
        ...onlyMessages(messages, "ModelContext Reminder")
      ];
      return [];
    }
    return messages;
  }
  if (child.kind === "Watch") {
    if (zone !== "appending" && zone !== "model") {
      throw new Error("Watch \u53EA\u5141\u8BB8\u653E\u5728 AppendingSet \u6216 ModelContext \u5185\u3002");
    }
    return renderWatch(state, zone, child);
  }
  if (child.kind === "Message" || child.kind === "AIMessage" || child.kind === "ToolResult") {
    if (!["history", "model", "appending", "reminder", "watch"].includes(zone)) {
      throw new Error(`${child.kind} \u4E0D\u80FD\u76F4\u63A5\u653E\u5728 ${zone} \u5185\u3002`);
    }
    return onlyNonEmptyMessage(await renderMessageNode(state, child));
  }
  if (child.kind === "ToolCall") {
    throw new Error("ToolCall \u53EA\u80FD\u4F5C\u4E3A AIMessage \u7684\u5B50\u8282\u70B9\u3002");
  }
  if (child.kind === "StringFragment") {
    if (zone !== "message" && zone !== "system" && zone !== "assistant" && zone !== "reminder" && zone !== "watch" && zone !== "compaction") {
      throw new Error("string fragment \u53EA\u80FD\u653E\u5728\u652F\u6301 string \u7684\u8282\u70B9\u5185\u90E8\u3002");
    }
    return [];
  }
  if (child.kind === "PlanModeSlot") {
    throw new Error(`${slotNodeName(child.slot)} \u53EA\u80FD\u4F5C\u4E3A PlanModeReminder \u7684\u76F4\u63A5\u5B50\u8282\u70B9\u3002`);
  }
  throw new Error(`\u672A\u77E5 Profile DSL \u8282\u70B9\uFF1A${JSON.stringify(child)}`);
}
async function renderCompactionNode(state, node) {
  const plan = {
    enabled: node.enabled,
    triggerPercent: node.triggerPercent,
    triggerTokens: node.triggerTokens,
    reserveTokens: node.reserveTokens,
    keepRecentTokens: node.keepRecentTokens,
    keepRecentPercent: node.keepRecentPercent
  };
  for (const child of node.children.flatMap(flattenChildren)) {
    if (child === null || child === void 0 || child === false || child === true) {
      continue;
    }
    if (Array.isArray(child)) {
      continue;
    }
    if (typeof child === "string" || typeof child === "number") {
      if (String(child).trim() !== "") {
        throw new Error("Compaction \u4E2D\u7684\u6587\u672C\u5FC5\u987B\u653E\u5728 CompactionPrompt \u6216 CompactionSummaryPrefix \u5185\u3002");
      }
      continue;
    }
    if (child.kind === "Fragment") {
      const nested = await renderCompactionNode(state, {
        kind: "Compaction",
        children: child.children
      });
      plan.prompt = nested.prompt ?? plan.prompt;
      plan.summaryPrefix = nested.summaryPrefix ?? plan.summaryPrefix;
      continue;
    }
    if (child.kind === "If") {
      if (!child.condition) {
        continue;
      }
      const nested = await renderCompactionNode(state, {
        kind: "Compaction",
        children: child.children
      });
      plan.prompt = nested.prompt ?? plan.prompt;
      plan.summaryPrefix = nested.summaryPrefix ?? plan.summaryPrefix;
      continue;
    }
    if (child.kind === "CompactionPrompt") {
      plan.prompt = await renderStringChildren(state, "compaction", child.children);
      continue;
    }
    if (child.kind === "CompactionSummaryPrefix") {
      plan.summaryPrefix = await renderStringChildren(state, "compaction", child.children);
      continue;
    }
    throw new Error(`Compaction \u53EA\u80FD\u5305\u542B CompactionPrompt / CompactionSummaryPrefix\uFF0C\u4E0D\u80FD\u5305\u542B ${child.kind}\u3002`);
  }
  validateCompactionPlan(state.profileKey, plan);
  return plan;
}
function validateSystemChildren(children) {
  for (const child of children.flatMap(flattenChildren)) {
    if (Array.isArray(child)) {
      validateSystemChildren(child);
      continue;
    }
    if (!child || typeof child !== "object") {
      continue;
    }
    if (child.kind === "StringFragment" || child.kind === "Fragment" || child.kind === "If") {
      if (child.kind === "Fragment" || child.kind === "If") {
        validateSystemChildren(child.children);
      }
      continue;
    }
    throw new Error(`System \u53EA\u80FD\u5305\u542B string-like children\uFF0C\u4E0D\u80FD\u5305\u542B ${child.kind}\u3002`);
  }
}
async function renderMessageNode(state, node) {
  if (node.kind === "Message") {
    if (node.role === "system") {
      throw new Error('<Message role="system"> \u4E0D\u88AB\u652F\u6301\uFF0C\u8BF7\u4F7F\u7528 <System> \u6216 <AppendingSet><Message>\u3002');
    }
    return createUserMessage({
      text: await renderStringChildren(state, "message", node.children)
    });
  }
  if (node.kind === "AIMessage") {
    validateAssistantChildren(node.children);
    const contentText = await renderStringChildren(state, "assistant", node.children);
    const toolCalls = collectToolCalls(node.children).map((toolCall) => ({
      type: "toolCall",
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.args ?? {}
    }));
    const assistant = createAssistantTextMessage({
      text: contentText,
      stopReason: toolCalls.length > 0 ? "toolUse" : "stop"
    });
    state.pendingToolCallIds.push(...toolCalls.map((toolCall) => toolCall.id));
    return {
      ...assistant,
      content: [
        ...contentText ? [{ type: "text", text: contentText }] : [],
        ...toolCalls
      ]
    };
  }
  if (!node.toolCallId || !node.toolName) {
    throw new Error("ToolResult \u5FC5\u987B\u63D0\u4F9B toolCallId \u548C toolName\u3002");
  }
  if (!state.pendingToolCallIds.includes(node.toolCallId)) {
    throw new Error(`ToolResult.toolCallId \u672A\u5339\u914D\u524D\u5E8F ToolCall\uFF1A${node.toolCallId}`);
  }
  state.pendingToolCallIds = state.pendingToolCallIds.filter((toolCallId) => toolCallId !== node.toolCallId);
  return createTextToolResult({
    toolCallId: node.toolCallId,
    toolName: node.toolName,
    text: await renderStringChildren(state, "message", node.children),
    isError: node.isError
  });
}
function validateAssistantChildren(children) {
  validateAssistantChildSequence(children, false);
}
function collectToolCalls(children) {
  const toolCalls = [];
  const visit = (child) => {
    if (child === null || child === void 0 || child === false || child === true) {
      return;
    }
    if (Array.isArray(child)) {
      for (const item of child) {
        visit(item);
      }
      return;
    }
    if (typeof child === "string" || typeof child === "number" || child.kind === "StringFragment") {
      return;
    }
    if (child.kind === "ToolCall") {
      toolCalls.push(child);
      return;
    }
    if (child.kind === "Fragment") {
      for (const item of child.children) {
        visit(item);
      }
      return;
    }
    if (child.kind === "PlanModeSlot") {
      for (const item of child.children) {
        visit(item);
      }
      return;
    }
    if (child.kind === "If" && child.condition) {
      for (const item of child.children) {
        visit(item);
      }
    }
  };
  for (const child of children) {
    visit(child);
  }
  return toolCalls;
}
function validateAssistantChildSequence(children, seenToolCall) {
  let localSeenToolCall = seenToolCall;
  for (const child of children) {
    if (child === null || child === void 0 || child === false || child === true) {
      continue;
    }
    if (Array.isArray(child)) {
      localSeenToolCall = validateAssistantChildSequence(child, localSeenToolCall);
      continue;
    }
    if (typeof child === "string" || typeof child === "number") {
      if (localSeenToolCall && String(child).trim() !== "") {
        throw new Error("AIMessage \u7684 ToolCall \u540E\u4E0D\u80FD\u518D\u8FFD\u52A0\u975E ToolCall \u5B50\u8282\u70B9\u3002");
      }
      continue;
    }
    if (child.kind === "ToolCall") {
      localSeenToolCall = true;
      continue;
    }
    if (child.kind === "StringFragment") {
      if (localSeenToolCall) {
        throw new Error("AIMessage \u7684 ToolCall \u540E\u4E0D\u80FD\u518D\u8FFD\u52A0\u975E ToolCall \u5B50\u8282\u70B9\u3002");
      }
      continue;
    }
    if (child.kind === "Fragment") {
      localSeenToolCall = validateAssistantChildSequence(child.children, localSeenToolCall);
      continue;
    }
    if (child.kind === "PlanModeSlot") {
      localSeenToolCall = validateAssistantChildSequence(child.children, localSeenToolCall);
      continue;
    }
    if (child.kind === "If") {
      if (child.condition) {
        localSeenToolCall = validateAssistantChildSequence(child.children, localSeenToolCall);
      }
      continue;
    }
    if (localSeenToolCall) {
      throw new Error("AIMessage \u7684 ToolCall \u540E\u4E0D\u80FD\u518D\u8FFD\u52A0\u975E ToolCall \u5B50\u8282\u70B9\u3002");
    }
  }
  return localSeenToolCall;
}
async function renderReminder(state, node) {
  if (!node.when) {
    return [];
  }
  const watchSourceCount = [node.watchPath, node.watchValue, node.watch].filter((source) => source !== void 0).length;
  if (watchSourceCount > 1) {
    throw new Error("Reminder.watchPath\u3001Reminder.watchValue \u4E0E Reminder.watch \u53EA\u80FD\u63D0\u4F9B\u4E00\u4E2A\u3002");
  }
  if (node.repeatEveryTurns !== void 0 && (!Number.isInteger(node.repeatEveryTurns) || node.repeatEveryTurns <= 0)) {
    throw new Error("Reminder.repeatEveryTurns \u5FC5\u987B\u662F\u6B63\u6574\u6570\u3002");
  }
  assertAllowedWatchPath(node.watchPath, "Reminder.watchPath");
  const currentValue = node.watch ? await node.watch(state.context) : node.watchPath ? readPath(state.context, node.watchPath) : node.watchValue;
  const hasWatchValue = node.watchPath !== void 0 || node.watchValue !== void 0 || node.watch !== void 0;
  const fingerprint = hasWatchValue ? stableStringifyJsonValue(currentValue) : void 0;
  const previous = state.currentRuntimeState.reminders?.[node.id];
  const didFingerprintChange = hasWatchValue && previous?.fingerprint !== fingerprint;
  const shouldRepeat = typeof node.repeatEveryTurns === "number" && (!previous || state.currentTurn - previous.injectedAtTurn >= node.repeatEveryTurns);
  const shouldInject = hasWatchValue || node.repeatEveryTurns ? didFingerprintChange || shouldRepeat : true;
  if (!shouldInject) {
    return [];
  }
  const messages = await renderChildren(state, "reminder", node.children);
  if (messages.length === 0) {
    return [];
  }
  if (hasWatchValue || node.repeatEveryTurns) {
    state.nextRuntimeState.reminders = {
      ...state.nextRuntimeState.reminders,
      [node.id]: {
        ...fingerprint !== void 0 ? { fingerprint } : {},
        injectedAtTurn: state.currentTurn
      }
    };
    state.stateTouched = true;
  }
  return messages;
}
async function renderWatch(state, zone, node) {
  if (node.path !== void 0 && node.value !== void 0) {
    throw new Error("Watch.path \u4E0E Watch.value \u4E0D\u80FD\u540C\u65F6\u63D0\u4F9B\u3002");
  }
  assertAllowedWatchPath(node.path, "Watch.path");
  if (node.value !== void 0 && !node.id) {
    throw new Error("Watch.value \u6A21\u5F0F\u5FC5\u987B\u63D0\u4F9B id\u3002");
  }
  const key = node.id ?? node.path;
  if (!key) {
    throw new Error("Watch \u5FC5\u987B\u63D0\u4F9B path \u6216 id\u3002");
  }
  const currentValue = node.path ? readPath(state.context, node.path) : node.value;
  const currentBaseline = {
    hasValue: currentValue !== void 0,
    value: currentValue === void 0 ? null : currentValue,
    fingerprint: stableStringifyJsonValue(currentValue)
  };
  const previous = state.nextRuntimeState.watches?.[key] ?? state.currentRuntimeState.watches?.[key];
  state.nextRuntimeState.watches = {
    ...state.nextRuntimeState.watches,
    [key]: currentBaseline
  };
  state.stateTouched = true;
  if (!previous && currentValue === void 0) {
    return [];
  }
  if (previous?.fingerprint === currentBaseline.fingerprint) {
    return [];
  }
  const change = {
    previousValue: previous?.hasValue ? previous.value : void 0,
    currentValue,
    path: key,
    hasPreviousValue: Boolean(previous?.hasValue),
    hasCurrentValue: currentValue !== void 0,
    session: state.context.session
  };
  const rendered = node.render ? await node.render(change) : node.children;
  if (!rendered || rendered === true) {
    return [];
  }
  return renderChildren(state, zone === "model" ? "watch" : "watch", normalizeChildren(rendered));
}
async function renderStringChildren(state, zone, children) {
  const parts = [];
  const visit = async (child) => {
    if (child === null || child === void 0 || child === false || child === true) {
      return;
    }
    if (Array.isArray(child)) {
      for (const item of child) {
        await visit(item);
      }
      return;
    }
    if (typeof child === "string" || typeof child === "number") {
      parts.push(String(child));
      return;
    }
    if (child.kind === "Fragment") {
      for (const item of child.children) {
        await visit(item);
      }
      return;
    }
    if (child.kind === "If") {
      if (!child.condition) {
        return;
      }
      for (const item of child.children) {
        await visit(item);
      }
      return;
    }
    if (child.kind === "StringFragment") {
      parts.push(typeof child.text === "function" ? await child.text(state.context) : child.text);
      return;
    }
    if (child.kind === "PlanModeSlot") {
      throw new Error(`${slotNodeName(child.slot)} \u53EA\u80FD\u4F5C\u4E3A PlanModeReminder \u7684\u76F4\u63A5\u5B50\u8282\u70B9\u3002`);
    }
    if (child.kind === "ToolCall" && zone === "assistant") {
      return;
    }
    throw new Error(`${child.kind} \u4E0D\u80FD\u653E\u5728 string \u5185\u5BB9\u8282\u70B9\u5185\u3002`);
  };
  for (const child of children) {
    await visit(child);
  }
  return parts.join("").trim();
}
function normalizeChildren(children) {
  if (children === void 0) {
    return [];
  }
  return Array.isArray(children) ? children : [children];
}
function flattenChildren(child) {
  if (child === null || child === void 0 || child === false || child === true) {
    return [];
  }
  if (Array.isArray(child)) {
    return child.flatMap(flattenChildren);
  }
  return [child];
}
function onlyMessages(messages, label) {
  return messages.filter((message) => {
    if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
      return true;
    }
    throw new Error(`${label} \u53EA\u80FD\u4EA7\u51FA user/assistant/toolResult message\u3002`);
  });
}
function onlyNonEmptyMessage(message) {
  if (message.role === "toolResult") {
    return [message];
  }
  if (message.role === "assistant") {
    const hasContent = message.content.some((block) => {
      return block.type !== "text" || block.text.trim().length > 0;
    });
    return hasContent ? [message] : [];
  }
  return messageText(message).trim() ? [message] : [];
}
function assertZone(current, expected, message) {
  if (current !== expected) {
    throw new Error(message);
  }
}
function countUserTurns(messages) {
  return messages.filter((message) => {
    return message.role === "user";
  }).length;
}
function assertAllowedWatchPath(path, label) {
  if (!path) {
    return;
  }
  if (!["ctx.session", "ctx.input", "ctx.runtime", "ctx.workspace"].some((prefix) => path === prefix || path.startsWith(`${prefix}.`))) {
    throw new Error(`${label} \u53EA\u80FD\u4ECE ctx.session\u3001ctx.input\u3001ctx.runtime\u3001ctx.workspace \u5F00\u59CB\uFF1A${path}`);
  }
}
function readPath(context, path) {
  const customStatePrefix = "ctx.session.customState.";
  if (path.startsWith(customStatePrefix)) {
    const customPath = path.slice(customStatePrefix.length);
    const matchedKey = Object.keys(context.session.customState).filter((key) => customPath === key || customPath.startsWith(`${key}.`)).sort((left, right) => right.length - left.length)[0];
    if (matchedKey) {
      const value = context.session.customState[matchedKey];
      const rest2 = customPath === matchedKey ? [] : customPath.slice(matchedKey.length + 1).split(".");
      return readObjectPath(value, rest2);
    }
  }
  const roots = {
    "ctx.session": context.session,
    "ctx.input": context.input,
    "ctx.runtime": {
      now: context.runtime?.now ?? new Date(now()).toISOString(),
      promptUserTurnCount: context.runtime?.promptUserTurnCount ?? countUserTurns(context.session.messages),
      pendingUserMessage: context.runtime?.pendingUserMessage
    },
    "ctx.workspace": {
      root: context.session.workspaceRoot,
      currentProject: readCurrentProjectWorkspace(context),
      novelId: context.session.novelId
    }
  };
  const rootKey = Object.keys(roots).find((key) => path === key || path.startsWith(`${key}.`));
  if (!rootKey) {
    return void 0;
  }
  const rest = path === rootKey ? [] : path.slice(rootKey.length + 1).split(".");
  return readObjectPath(roots[rootKey], rest);
}
function readObjectPath(value, rest) {
  let current = value;
  for (const segment of rest) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(segment in current)) {
      return void 0;
    }
    current = current[segment];
  }
  return toJsonValue(current);
}
function toJsonValue(value) {
  if (value === void 0) {
    return void 0;
  }
  return JSON.parse(JSON.stringify(value));
}
function stableStringifyJsonValue(value) {
  if (value === void 0) {
    return "__undefined__";
  }
  return JSON.stringify(sortJson(value));
}
function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortJson(item)]));
  }
  return value;
}
function cloneProfileRuntimeState(state) {
  return {
    reminders: state.reminders ? { ...state.reminders } : void 0,
    watches: state.watches ? { ...state.watches } : void 0
  };
}
function readProfileRuntimeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const state = value;
  return {
    reminders: readReminderStateMap(state.reminders),
    watches: readWatchStateMap(state.watches)
  };
}
function validateProfileRuntimeStateWrite(profileKey, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`profile ${profileKey} stateWrites \u7684 profile runtime state \u5FC5\u987B\u662F object\u3002`);
  }
  const state = value;
  const illegalKey = Object.keys(state).find((key) => key !== "reminders" && key !== "watches");
  if (illegalKey) {
    throw new Error(`profile ${profileKey} stateWrites \u7684 profile runtime state \u4E0D\u5141\u8BB8\u5199 ${illegalKey}\u3002`);
  }
  assertOptionalStateMap(profileKey, state.reminders, "reminders");
  assertOptionalStateMap(profileKey, state.watches, "watches");
  readReminderStateMap(state.reminders);
  readWatchStateMap(state.watches);
}
function validateCompactionPlan(profileKey, plan) {
  if (!plan) {
    return;
  }
  const allowedKeys = /* @__PURE__ */ new Set(["enabled", "triggerPercent", "triggerTokens", "reserveTokens", "keepRecentTokens", "keepRecentPercent", "prompt", "summaryPrefix"]);
  const illegalKey = Object.keys(plan).find((key) => !allowedKeys.has(key));
  if (illegalKey) {
    throw new Error(`profile ${profileKey} compaction \u4E0D\u5141\u8BB8\u8FD4\u56DE ${illegalKey}\u3002`);
  }
  if (typeof plan.enabled !== "undefined" && typeof plan.enabled !== "boolean") {
    throw new Error(`profile ${profileKey} compaction.enabled \u5FC5\u987B\u662F boolean\u3002`);
  }
  if (plan.triggerPercent !== void 0 && plan.triggerTokens !== void 0) {
    throw new Error(`profile ${profileKey} compaction.triggerPercent \u4E0E triggerTokens \u4E0D\u80FD\u540C\u65F6\u63D0\u4F9B\u3002`);
  }
  if (plan.keepRecentPercent !== void 0 && plan.keepRecentTokens !== void 0) {
    throw new Error(`profile ${profileKey} compaction.keepRecentPercent \u4E0E keepRecentTokens \u4E0D\u80FD\u540C\u65F6\u63D0\u4F9B\u3002`);
  }
  assertOptionalPercent(profileKey, plan.triggerPercent, "triggerPercent");
  assertOptionalPercent(profileKey, plan.keepRecentPercent, "keepRecentPercent");
  assertOptionalPositiveInteger(profileKey, plan.triggerTokens, "triggerTokens");
  assertOptionalPositiveInteger(profileKey, plan.reserveTokens, "reserveTokens");
  assertOptionalPositiveInteger(profileKey, plan.keepRecentTokens, "keepRecentTokens");
  assertOptionalString(profileKey, plan.prompt, "prompt");
  assertOptionalString(profileKey, plan.summaryPrefix, "summaryPrefix");
}
function assertOptionalPercent(profileKey, value, name) {
  if (value === void 0) {
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`profile ${profileKey} compaction.${name} \u5FC5\u987B\u5728 (0, 1] \u8303\u56F4\u5185\u3002`);
  }
}
function assertOptionalPositiveInteger(profileKey, value, name) {
  if (value === void 0) {
    return;
  }
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`profile ${profileKey} compaction.${name} \u5FC5\u987B\u662F\u6B63\u6574\u6570\u3002`);
  }
}
function assertOptionalString(profileKey, value, name) {
  if (value === void 0) {
    return;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`profile ${profileKey} compaction.${name} \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32\u3002`);
  }
}
function assertOptionalStateMap(profileKey, value, key) {
  if (value === void 0) {
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`profile ${profileKey} stateWrites \u7684 ${key} \u5FC5\u987B\u662F object map\u3002`);
  }
}
function readReminderStateMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return void 0;
  }
  const reminders = {};
  for (const [key, item] of Object.entries(value)) {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.injectedAtTurn !== "number") {
      throw new Error(`profile runtime reminder state \u975E\u6CD5\uFF1A${key}`);
    }
    reminders[key] = {
      fingerprint: typeof item.fingerprint === "string" ? item.fingerprint : void 0,
      injectedAtTurn: item.injectedAtTurn
    };
  }
  return reminders;
}
function readWatchStateMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return void 0;
  }
  const watches = {};
  for (const [key, item] of Object.entries(value)) {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.hasValue !== "boolean" || typeof item.fingerprint !== "string") {
      throw new Error(`profile runtime watch state \u975E\u6CD5\uFF1A${key}`);
    }
    watches[key] = {
      hasValue: item.hasValue,
      value: item.value ?? null,
      fingerprint: item.fingerprint
    };
  }
  return watches;
}
function readRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function readCurrentProjectWorkspace(ctx) {
  const input = readRecord(ctx.input);
  const studio = readRecord(input.studio);
  return typeof studio.workspace === "string" ? studio.workspace : "";
}

// server/agent/profiles/define-agent-profile.ts
function defineAgentProfile(profile) {
  assertProfileManifest(profile.manifest);
  if (profile.context && profile.prepare) {
    throw new Error(`profile ${profile.manifest.key} \u4E0D\u80FD\u540C\u65F6\u5B9A\u4E49 context \u548C prepare\u3002`);
  }
  if (!profile.context && !profile.prepare) {
    throw new Error(`profile ${profile.manifest.key} \u5FC5\u987B\u5B9A\u4E49 context \u6216 prepare\u3002`);
  }
  const prepare = profile.prepare ? async (...args) => {
    const plan = await profile.prepare(...args);
    validateProfileTurnPlan(profile.manifest.key, plan);
    return plan;
  } : async (...args) => {
    const ctx = args[0];
    const tree = await profile.context(ctx);
    return compileProfileContext(profile, ctx, tree);
  };
  return {
    ...profile,
    prepare
  };
}
function assertProfileManifest(manifest) {
  if (!manifest.key.trim()) {
    throw new Error("profile manifest.key \u4E0D\u80FD\u4E3A\u7A7A");
  }
  if (!manifest.name.trim()) {
    throw new Error(`profile ${manifest.key} manifest.name \u4E0D\u80FD\u4E3A\u7A7A`);
  }
}

// server/agent/profiles/builtin-contracts.ts
import { Type } from "typebox";
var LeaderDefaultInputSchema = Type.Object({
  role: Type.Optional(Type.String({ description: "\u53EF\u9009\u7684\u8FD0\u884C\u89D2\u8272\u63D0\u793A\uFF0C\u7528\u4E8E\u8BA9 leader \u5728\u9ED8\u8BA4\u534F\u4F5C\u6A21\u5F0F\u4E4B\u5916\u4E34\u65F6\u504F\u5411\u67D0\u4E2A\u5DE5\u4F5C\u8EAB\u4EFD\u3002" }))
});
var LeaderDefaultOutputSchema = Type.Object({
  result: Type.Optional(Type.String({ description: "\u53EF\u9009\u603B\u7ED3\u6587\u672C\u3002leader.default \u901A\u5E38\u4E0D\u8981\u6C42 report_result\u3002" }))
});
var WriterInputSchema = Type.Object({
  prompt: Type.String({ description: "\u672C\u6B21\u5199\u4F5C\u4EFB\u52A1\u3002\u5199\u6E05\u8981\u5199\u4EC0\u4E48\u3001\u76EE\u6807\u6587\u4EF6\u8DEF\u5F84\u6216\u65E0\u6587\u4EF6\u843D\u70B9\u3001\u573A\u666F\u8FB9\u754C\u548C\u4EA4\u4ED8\u8981\u6C42\u3002" }),
  plotPoints: Type.Optional(Type.Array(Type.String({ description: "Plot System Scene ID\u3002\u4F20\u5165\u65F6\u5FC5\u987B\u540C\u65F6\u63D0\u4F9B novelId\uFF0Cwriter \u4F1A\u81EA\u52A8\u5C55\u5F00 Scene/Thread/Plots/Chapter Plot\u3002" }), { description: "\u9700\u8981\u843D\u5B9E\u5230\u6B63\u6587\u4E2D\u7684 Scene ID \u5217\u8868\u3002" })),
  lorebookEntries: Type.Optional(Type.Array(Type.Object({
    path: Type.String({ description: "\u5185\u5BB9\u8282\u70B9\u8DEF\u5F84\uFF0C\u6309 writer agent cwd \u89E3\u6790\u3002\u666E\u901A\u5C0F\u8BF4 agent cwd \u662F workspace \u5BB9\u5668\u6839\uFF0C\u56E0\u6B64\u901A\u5E38\u4F20 novel-slug/lorebook/character/foo/ \u6216 novel-slug/manuscript/...\u3002\u76EE\u5F55\u4F1A\u8BFB\u53D6 index.md\uFF0C\u5E76\u8BFB\u53D6\u540C\u7EA7\u53EF\u9009 state.md\u3002" }),
    reason: Type.Optional(Type.String({ description: "\u4E3A\u4EC0\u4E48\u8FD9\u4E2A\u8282\u70B9\u4E0E\u672C\u6B21\u5199\u4F5C\u76F8\u5173\uFF0C\u5E2E\u52A9 writer \u5224\u65AD\u4F7F\u7528\u91CD\u70B9\u3002" })),
    priority: Type.Optional(Type.Number({ description: "\u4F18\u5148\u7EA7\uFF0C\u6570\u5B57\u8D8A\u5C0F\u8D8A\u91CD\u8981\uFF1Bwriter \u4F1A\u6309 priority \u4ECE\u5C0F\u5230\u5927\u8BFB\u53D6\u548C\u6E32\u67D3\u3002" })),
    writingTip: Type.Optional(Type.String({ description: "\u8C03\u7528\u65B9\u4E34\u65F6\u7ED9 writer \u7684\u4F7F\u7528\u63D0\u793A\uFF0C\u4E0D\u4F1A\u5199\u56DE\u5185\u5BB9\u8282\u70B9\u3002" }))
  }), { description: "\u672C\u6B21\u5199\u4F5C\u9700\u8981\u8BFB\u53D6\u7684 Lorebook/Manuscript \u5185\u5BB9\u8282\u70B9\u3002" })),
  constraints: Type.Optional(Type.Array(Type.String({ description: "\u989D\u5916\u5199\u4F5C\u7EA6\u675F\u3001\u683C\u5F0F\u7EA6\u675F\u3001\u7981\u5FCC\u3001\u5B57\u6570\u6216\u7528\u6237\u4E34\u65F6\u504F\u597D\u3002" }), { description: "\u672C\u8F6E\u5199\u4F5C\u7EA6\u675F\u5217\u8868\u3002" })),
  outputPath: Type.Optional(Type.String({ description: "\u53EF\u9009\u8F93\u51FA\u6587\u4EF6\u8DEF\u5F84\uFF0C\u6309 writer agent cwd \u89E3\u6790\u3002\u666E\u901A\u5C0F\u8BF4 agent cwd \u662F workspace \u5BB9\u5668\u6839\uFF0C\u56E0\u6B64\u901A\u5E38\u4F20 novel-slug/manuscript/.../index.md\u3002\u7ED9\u51FA\u65F6 writer \u5E94\u628A\u6B63\u6587\u5199\u5165\u8BE5\u6587\u4EF6\u5E76\u6DA6\u8272\u3002" })),
  novelId: Type.Optional(Type.String({ description: "\u5F53\u524D novel ID\u3002\u4F20\u5165 plotPoints \u65F6\u5FC5\u586B\uFF0C\u56E0\u4E3A plot \u5DE5\u5177\u4E0D\u4F1A\u4ECE session \u81EA\u52A8\u63A8\u65AD novelId\u3002" })),
  writingStylePreset: Type.Optional(Type.String({ description: "\u53EF\u9009 writing style \u9884\u8BBE\u540D\uFF1B\u4E3A\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u6587\u98CE\u3002" })),
  writingReferencePreset: Type.Optional(Type.String({ description: "\u53EF\u9009 writing reference \u9884\u8BBE\u540D\uFF1B\u4E3A\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u53C2\u8003\u6587\u6863\u3002" }))
});
var WriterOutputSchema = Type.Object({
  summary: Type.String({ description: "\u7EA6 100 \u5B57\u5199\u4F5C\u6458\u8981\uFF0C\u8BF4\u660E\u65F6\u95F4\u3001\u5730\u70B9\u3001\u53C2\u4E0E\u89D2\u8272\u3001\u5173\u952E\u52A8\u4F5C\u3001\u5173\u7CFB\u53D8\u5316\u548C\u4F0F\u7B14/\u72B6\u6001\u53D8\u5316\u3002" }),
  outputPath: Type.Optional(Type.String({ description: "\u5B9E\u9645\u5199\u5165\u6216\u4FEE\u6539\u7684\u6587\u4EF6\u8DEF\u5F84\u3002\u6CA1\u6709\u6587\u4EF6\u843D\u70B9\u65F6\u4E0D\u8981\u586B\u3002" }))
});
var RetrievalInputSchema = Type.Object({
  targetProfile: Type.String({ description: "\u53EC\u56DE\u7ED3\u679C\u8981\u670D\u52A1\u7684\u76EE\u6807 profile\uFF0C\u4F8B\u5982 writer\u3002" }),
  task: Type.String({ description: "\u8C03\u7528\u65B9\u7684\u4E0A\u5C42\u4EFB\u52A1\u76EE\u6807\uFF0C\u8BF4\u660E\u4E3A\u4EC0\u4E48\u9700\u8981\u68C0\u7D22\u8FD9\u4E9B\u5185\u5BB9\u8282\u70B9\u3002" }),
  prompt: Type.String({ description: "\u68C0\u7D22\u63D0\u793A\u8BCD\u3002\u53EF\u4EE5\u5305\u542B\u4EBA\u7269\u3001\u5730\u70B9\u3001\u51B2\u7A81\u3001\u7AE0\u8282\u76EE\u6807\u3001\u5173\u952E\u8BCD\u548C\u6392\u9664\u9879\u3002" }),
  chapterOutline: Type.Optional(Type.String({ description: "\u53EF\u9009\u7AE0\u8282\u5927\u7EB2\uFF0C\u7528\u4E8E\u5E2E\u52A9 retrieval \u5224\u65AD\u76F8\u5173\u8282\u70B9\u3002" })),
  recentText: Type.Optional(Type.String({ description: "\u53EF\u9009\u6700\u8FD1\u6B63\u6587\u6216\u8349\u7A3F\u7247\u6BB5\uFF0C\u7528\u4E8E\u53EC\u56DE\u4E0E\u5F53\u524D\u6BB5\u843D\u6700\u76F8\u5173\u7684\u8282\u70B9\u3002" })),
  constraints: Type.Optional(Type.Array(Type.String({ description: "\u68C0\u7D22\u9650\u5236\uFF0C\u4F8B\u5982\u53EA\u67E5 active \u8282\u70B9\u3001\u6392\u9664\u67D0\u7C7B\u8282\u70B9\u3001\u6700\u591A\u67D0\u7C7B\u7ED3\u679C\u3002" }), { description: "\u68C0\u7D22\u7EA6\u675F\u5217\u8868\u3002" })),
  maxEntries: Type.Optional(Type.Number({ description: "\u6700\u591A\u8FD4\u56DE\u591A\u5C11\u4E2A\u5185\u5BB9\u8282\u70B9\u8DEF\u5F84\u3002" }))
});
var RetrievalOutputSchema = Type.Array(Type.String({ description: "\u6309\u4F18\u5148\u7EA7\u6392\u5E8F\u7684\u5185\u5BB9\u8282\u70B9\u8DEF\u5F84\u3002" }), { description: "\u6309\u4F18\u5148\u7EA7\u6392\u5E8F\u7684\u5185\u5BB9\u8282\u70B9\u8DEF\u5F84\u6570\u7EC4\uFF0C\u53EA\u5305\u542B\u8DEF\u5F84\u5B57\u7B26\u4E32\u3002" });

// server/agent/profiles/profile-text.ts
function profileText(strings, ...values) {
  const rawParts = strings.raw.map((part) => decodeUnicodeEscapes(part).replace(/\r\n/g, "\n"));
  const firstPart = rawParts[0] ?? "";
  const lastIndex = rawParts.length - 1;
  rawParts[0] = firstPart.replace(/^\n/, "");
  rawParts[lastIndex] = (rawParts[lastIndex] ?? "").replace(/\n[ \t]*$/, "");
  const indent = minimumIndent(rawParts);
  return rawParts.map((part, index) => {
    const value = index < values.length ? String(values[index] ?? "") : "";
    return stripIndent(part, indent) + value;
  }).join("").trim();
}
function decodeUnicodeEscapes(text) {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    return String.fromCharCode(Number.parseInt(hex, 16));
  });
}
function minimumIndent(parts) {
  const indents = parts.flatMap((part) => part.split("\n")).filter((line) => line.trim().length > 0).map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
  return indents.length > 0 ? Math.min(...indents) : 0;
}
function stripIndent(text, indent) {
  if (indent <= 0) {
    return text;
  }
  return text.split("\n").map((line) => line.startsWith(" ".repeat(indent)) ? line.slice(indent) : line).join("\n");
}

// assets/workspace/.nbook/agent/profiles/builtin/leader.assets.profile.tsx
var profileManifest = {
  key: "leader.assets",
  name: "\u7528\u6237\u8D44\u4EA7\u52A9\u624B",
  description: "\u534F\u52A9\u7F16\u8F91\u5168\u5C40\u7528\u6237 assets\u3001Agent profiles\u3001skills \u548C\u53EF\u8986\u76D6\u7CFB\u7EDF\u8D44\u6E90\u3002"
};
var InputSchema = LeaderDefaultInputSchema;
var OutputSchema = LeaderDefaultOutputSchema;
var allowedToolKeys = [
  "read",
  "write",
  "edit",
  "apply_patch",
  "bash",
  "create_agent",
  "invoke_agent",
  "get_agent",
  "get_agent_profile",
  "get_session",
  "detach_agent",
  "request_user_input",
  "enter_plan_mode",
  "exit_plan_mode"
];
var leader_assets_profile_default = defineAgentProfile({
  manifest: profileManifest,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  allowedToolKeys,
  prepare(ctx) {
    return {
      systemPrompt: renderSystemPrompt(),
      modelContextMessages: [
        createUserMessage({
          text: [
            "<dynamic-context>",
            `Agent cwd: ${ctx.session.workspaceRoot}`,
            `Profile key: ${ctx.session.profileKey}`,
            renderWorkspaceSnapshot(ctx),
            renderAvailableSkills(ctx),
            renderAvailableAgents(ctx),
            renderLinkedAgents(ctx),
            "</dynamic-context>"
          ].filter(Boolean).join("\n")
        })
      ]
    };
  }
});
function renderSystemPrompt() {
  return profileText`
        你是 Neuro Book 的「用户资产助手」，只负责协助用户编辑全局用户 assets、Agent profiles、skills 和系统可覆盖资源。

        重要原则：
        - 用户资产是全局覆盖层，不属于任何单本小说。不要把单本小说的 lorebook、manuscript、剧情规划、章节正文或世界观事实写进这里。
        - 当用户想修改小说正文、角色设定或剧情内容时，提醒用户切回对应小说 workspace。
        - 不要默认把用户当成 TypeScript 或 Agent 系统专家。先用通俗语言解释，再给路径、命令或代码。
        - 普通讨论、需求澄清和下一步建议用自然回复完成。只有需要结构化选择、跨轮阻塞等待或审批式决策时才使用 request_user_input。
        - 文件修改前先确认目标资源、覆盖层位置和验证方式。需求不清楚时先解释歧义并询问。
        - 不要把当前对话中的临时偏好硬编码进长期 profile、skill 或模板，除非用户明确要求。

        # 用户资产目录

        v3 Agent 资源使用新的 .nbook 结构：
        - 系统内置资源：assets/workspace/.nbook/agent/profiles、assets/workspace/.nbook/agent/skills。
        - 用户覆盖资源：workspace/.nbook/agent/profiles、workspace/.nbook/agent/skills。
        - Global Config：workspace/.nbook/config.json。
        - Project Config：workspace/{project}/.nbook/config.json。

        - 当前 user-assets Agent cwd 是 workspace/.nbook。编辑 Agent profile 或 skill 时，优先使用 agent/profiles/...、agent/skills/... 这类相对路径。
        - 读取系统内置参考，可以读取 assets/workspace/.nbook/agent/...。
        - 不要直接修改系统 assets，除非用户明确要求修改仓库内置资源。
        - 旧 assets/agent-v2 和 server/agent-v2 只作为归档参考，不作为新运行时入口。

        # TSX Profile 编辑原则

        - 可以把 profile 解释成“agent 的配方”：它决定这个 agent 是谁、能用哪些工具、每轮运行前准备哪些上下文。
        - 可以把 harness 解释成“运行器”：它负责创建 session、调用 profile、把可见消息写入历史、跑模型和工具、把结果保存回来。
        - 可以把 skill 解释成“可复用说明书”：它教 agent 遇到某类任务时怎么做，但它不是 profile，也不会自己运行。
        - 当用户请求创建、修改、诊断 Agent profile、TSX profile 或 .profile.tsx 文件时，先了解现有 profile contract 和目标 key。
        - 这类任务优先读取 SkillCatalog 中 profile-system-guide 的 SKILL.md，获取 harness/profile/skill 的当前说明、文档索引、模板和验证路径；需要架构细节时再按入口说明读取 reference。
        - 新 profile 使用 defineAgentProfile 契约，显式导出 profileManifest、InputSchema、OutputSchema、Input / Output 类型和 default profile。
        - Profile 文件默认放在用户 assets 的 agent/profiles/...；系统 builtin 放在 assets/workspace/.nbook/agent/profiles/builtin/...。
        - 覆盖 builtin key 时不能修改 key、InputSchema、OutputSchema；可以调整 prompt、helper function 和 allowedToolKeys。
        - 保存 .profile.tsx 只代表文件写入成功，不代表 profile 可运行。修改后应使用 Workbench 手动编译，或运行 profile compile；需要只查看上下文时使用 profile preview。
        - 如果用户要求 Agent 工具用户编辑 TSX，目标是让用户直接审阅 TSX 和 prepare 后的 Message[]，不要强行回到低代码编辑。
        - 操作优先级：先给清楚指导，再用已有 CLI 验证或模板脚手架，最后才考虑新增工具。不要为了新建模板、恢复系统版本或编译检查而先发明专用 Agent 工具。
        - 编译有两层含义：Workbench 里的“编译”按钮会保存源码并生成运行时可加载的 profile 产物；Agent 通过文件工具协助编辑时，优先提醒用户使用 Workbench 编译、profile compile 或 profile preview。不要把项目根 scripts/ 当成 Agent runtime 能稳定调用的入口，也不要让普通用户手工调用 HTTP compile endpoint。
        - 恢复系统版本时，先说明会覆盖用户修改，再从 assets/workspace/.nbook/agent/profiles/... 对应文件复制到 user-assets cwd 下的 agent/profiles/...。

        # Skill 编辑原则

        - 修改已有 skill 前，先读取用户覆盖目录 agent/skills/<skill>/SKILL.md；不存在时再读取系统内置 assets/workspace/.nbook/agent/skills/<skill>/SKILL.md。
        - 自定义或覆盖 skill 时，优先写入 agent/skills/<skill>/SKILL.md。
        - SKILL.md 应保持清晰、可执行、渐进披露；引用脚本、模板或示例时使用相对该 skill 目录的路径。
        - skill 当前通过 catalog 控制可见性，细粒度硬白名单仍是后续事项；不要承诺不存在的权限隔离。
        - 需要使用 skill 时，用 read 读取 catalog 中对应 location 的 SKILL.md；reference 由 Agent 根据 SKILL.md 的说明按需继续读取。

        # 工具使用

        - 读文件用 read，不要用 bash 调 cat/head/tail/sed 代替。大文件按 read 返回的 offset/limit 提示继续读取。
        - 新建文件或完整重写文件用 write；局部修改现有文件时不要用 write 覆盖整文件。
        - 精确修改单文件用 edit。多个分散位置放在同一次 edit 的 edits[] 中；oldText 必须唯一、精确、非重叠。
        - apply_patch 是 Codex 风格 freeform patch 工具，用于当前内容已确认、适合一个 cohesive patch 的改动。不要传 JSON，不要传 { path, patch }。patch 失败后先重新 read 当前文件。
        - bash 只用于 rg、find、ls、git、测试、构建、workspace CLI、脚本验证等真实终端操作。搜索文本优先用 rg。
        - bash 命令必须按 bash 语法编写；工具已绑定当前 workspace root，不要传 workdir。
        - 不提供独立 grep/find/ls 工具；需要时通过 bash 调用 rg/find/ls。

        # 多 Agent 协作

        v3 中 profile 即 agent，不再区分 leader/subagent 类型层级。
        - create_agent 创建新的 agent session，并自动 link 到当前 session。
        - invoke_agent 调用已有 agent。目标 agent 允许 report_result 时，调用方可期待结构化 report；否则按普通 finalMessage 处理。
        - get_agent 无参查看当前 session 拥有的 agent；传 sessionId 查看轻量摘要。
        - get_agent_profile 查询某个 profile 的 schema、report_result schema 和 allowed tools。创建或调用不熟悉的 agent 前先查询它。
        - get_session 默认只查询轻量 session 元数据、title、summary、usage 和 linked agents；默认不返回 tree，也不返回历史消息。需要少量历史时显式传 includeRecentMessages/recentMessageLimit/tokenBudget。
        - detach_agent 只解除 owned link，不删除 session。

        # 输出风格

        保持简洁直接。对资产编辑任务，说明改了哪些文件、为什么这样改、如何验证。对危险或范围不清的修改，先指出风险和需要确认的边界。
    `;
}
function renderWorkspaceSnapshot(ctx) {
  const workspaceKind = typeof ctx.input.role === "string" && ctx.input.role.trim() ? `Role: ${ctx.input.role.trim()}` : "";
  return [
    "User assets workspace:",
    "- agent profiles/skills should use agent/ under current user-assets cwd; repository path: workspace/.nbook/agent",
    workspaceKind
  ].filter(Boolean).join("\n");
}
function renderAvailableSkills(ctx) {
  if (ctx.skills.length === 0) {
    return "Available skills: none";
  }
  return [
    "Available skills:",
    ...ctx.skills.map((skill) => {
      const description = skill.description ? ` - ${skill.description}` : "";
      const whenToUse = skill.whenToUse ? ` (when: ${skill.whenToUse})` : "";
      const location = resolve(skill.skillPath);
      return `- ${skill.key}: ${skill.name}${description}${whenToUse}
  location: ${location}`;
    })
  ].join("\n");
}
function renderAvailableAgents(ctx) {
  const profiles = ctx.catalog.profiles.filter((profile) => profile.loadStatus === "loaded").map((profile) => {
    const description = profile.description ? ` - ${profile.description}` : "";
    return `- ${profile.key}: ${profile.name}${description}`;
  });
  if (profiles.length === 0) {
    return "Available agents: none";
  }
  return ["Available agents:", ...profiles].join("\n");
}
function renderLinkedAgents(ctx) {
  if (ctx.session.linkedAgents.length === 0) {
    return "Linked agents: none";
  }
  return [
    "Linked agents:",
    ...ctx.session.linkedAgents.map((agent) => `- session ${agent.sessionId}: ${agent.profileKey}${agent.detached ? " (detached)" : ""}`)
  ].join("\n");
}
export {
  InputSchema,
  OutputSchema,
  leader_assets_profile_default as default,
  profileManifest
};
