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
  if (child.kind === "Variable") {
    assertZone(zone, "model", "Variable \u7B2C\u4E00\u7248\u53EA\u5141\u8BB8\u653E\u5728 ModelContext \u5185\u3002");
    const text = await renderVariableNode(state, child);
    return text.trim() ? [createUserMessage({ text })] : [];
  }
  if (child.kind === "VariableSchema") {
    assertZone(zone, "model", "VariableSchema \u7B2C\u4E00\u7248\u53EA\u5141\u8BB8\u653E\u5728 ModelContext \u5185\u3002");
    const text = renderVariableSchemaNode(state, child);
    return text.trim() ? [createUserMessage({ text })] : [];
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
    if (child.kind === "Variable" || child.kind === "VariableSchema") {
      throw new Error(`${child.kind} \u7B2C\u4E00\u7248\u53EA\u5141\u8BB8\u653E\u5728 ModelContext\u3002`);
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
  const currentValue = node.watch ? await node.watch(state.context) : node.watchPath ? await readPath(state.context, node.watchPath) : node.watchValue;
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
  const currentValue = node.path ? await readPath(state.context, node.path) : node.value;
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
async function renderVariableNode(state, node) {
  const result = await state.context.vars.read(node.path, {
    maxBytes: node.maxBytes
  });
  if (result.issue) {
    return [
      "<variable>",
      `path: ${node.path}`,
      `issue: ${result.issue.message}`,
      "</variable>"
    ].join("\n");
  }
  return [
    "<variable>",
    `path: ${node.path}`,
    node.label ? `label: ${node.label}` : "",
    result.truncated ? "truncated: true" : "",
    "value:",
    JSON.stringify(result.value ?? null, null, 2),
    "</variable>"
  ].filter(Boolean).join("\n");
}
function renderVariableSchemaNode(state, node) {
  const result = state.context.vars.catalog({
    namespace: node.namespace,
    prefix: node.prefix,
    paths: node.paths,
    writableOnly: node.writableOnly,
    detail: node.detail
  });
  const payload = { catalog: result.catalog, schemas: result.schemas, issues: result.issues };
  return [
    "<variable-schema>",
    JSON.stringify(payload, null, 2),
    node.includeToolGuide === false ? "" : [
      "Tool workflow:",
      "- variable_schema: inspect focused variable schemas. Use namespace/prefix/paths; do not request everything.",
      "- variable_read: read a registered variable value before editing.",
      "- variable_patch: update one writable registered variable path with RFC 6902 JSON Patch, then read again to verify important changes."
    ].join("\n"),
    "</variable-schema>"
  ].filter(Boolean).join("\n");
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
    if (child.kind === "Variable" || child.kind === "VariableSchema") {
      throw new Error(`${child.kind} \u7B2C\u4E00\u7248\u53EA\u80FD\u4F5C\u4E3A ModelContext \u7684\u76F4\u63A5\u5B50\u8282\u70B9\u3002`);
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
  if (!["client", "global", "project", "session"].some((prefix) => path === prefix || path.startsWith(`${prefix}.`))) {
    throw new Error(`${label} \u5B57\u7B26\u4E32\u5F62\u5F0F\u53EA\u80FD\u4ECE client\u3001global\u3001project\u3001session \u53D8\u91CF\u8DEF\u5F84\u5F00\u59CB\uFF1B\u975E\u53D8\u91CF\u4E0A\u4E0B\u6587\u8BF7\u4F7F\u7528\u51FD\u6570 watch\uFF1A${path}`);
  }
}
async function readPath(context, path) {
  return context.vars.get(path);
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

// server/agent/profiles/define-agent-profile.ts
function defineAgentProfile(profile) {
  assertProfileManifest(profile.manifest);
  assertProfileSummarizer(profile.manifest.key, profile.summarizer);
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
function assertProfileSummarizer(profileKey, summarizer) {
  if (!summarizer) {
    return;
  }
  if (summarizer.enabled === false) {
    return;
  }
  if (!summarizer.profileKey || !summarizer.profileKey.trim()) {
    throw new Error(`profile ${profileKey} summarizer.profileKey \u4E0D\u80FD\u4E3A\u7A7A`);
  }
  if (summarizer.input !== void 0 && (typeof summarizer.input !== "object" || summarizer.input === null || Array.isArray(summarizer.input))) {
    throw new Error(`profile ${profileKey} summarizer.input \u5FC5\u987B\u662F\u5BF9\u8C61`);
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
var SessionSummarizerInputSchema = Type.Object({
  sourceSessionId: Type.Number({ description: "\u7531 harness \u6CE8\u5165\u7684\u6E90 leader session id\u3002" }),
  trigger: Type.Optional(Type.Union([
    Type.Literal("after_invocation")
  ], { description: "\u9996\u6B21\u89E6\u53D1\u65F6\u673A\u3002\u7B2C\u4E00\u7248\u4EC5\u652F\u6301 after_invocation\u3002" })),
  interval: Type.Optional(Type.Object({
    kind: Type.Union([
      Type.Literal("turn"),
      Type.Literal("loop"),
      Type.Literal("dialogueContentTokens")
    ]),
    value: Type.Number({ description: "\u89E6\u53D1\u95F4\u9694\u3002turn/loop \u8868\u793A\u6B21\u6570\uFF0CdialogueContentTokens \u8868\u793A\u65B0\u589E\u6B63\u6587 token\u3002" })
  }, { description: "\u540E\u53F0\u6458\u8981\u5468\u671F\u89E6\u53D1\u914D\u7F6E\u3002" })),
  maxDialogueContentTokens: Type.Optional(Type.Number({ description: "Agent Dialogue Content \u8D85\u8FC7\u8BE5 token \u4F30\u7B97\u503C\u65F6\u8DF3\u8FC7\u672C\u6B21\u6458\u8981\u3002" }))
});
var SessionSummarizerOutputSchema = Type.Object({
  title: Type.String({ description: "\u7B80\u77ED session \u6807\u9898\uFF0C\u5EFA\u8BAE\u4E0D\u8D85\u8FC7 32 \u5B57\u3002" }),
  summary: Type.String({ description: "\u5F53\u524D session \u7684\u53EF\u8BFB\u6458\u8981\uFF0C\u5EFA\u8BAE\u4E0D\u8D85\u8FC7 240 \u5B57\u3002" })
});
var WriterInputSchema = Type.Object({
  prompt: Type.String({ description: "\u672C\u6B21\u5199\u4F5C\u4EFB\u52A1\u3002\u5199\u6E05\u8981\u5199\u4EC0\u4E48\u3001\u662F\u91CD\u5199\u8FD8\u662F\u5C40\u90E8\u4FEE\u6539\u3001\u7AE0\u8282\u8FB9\u754C\u548C\u4EA4\u4ED8\u8981\u6C42\u3002" }),
  chapterPaths: Type.Array(Type.String({ description: "\u7AE0\u8282\u5185\u5BB9\u8282\u70B9\u76EE\u5F55\u8DEF\u5F84\u3002\u5F53\u524D Project Workspace \u4F7F\u7528 manuscript/.../\uFF1B\u8DE8 Project Workspace \u4F7F\u7528 novel-slug/manuscript/.../\u3002" }), {
    minItems: 1,
    maxItems: 1,
    description: "\u672C writer session \u7ED1\u5B9A\u7684\u552F\u4E00\u7AE0\u8282\u3002\u8C03\u7528\u65B9\u5FC5\u987B\u5148\u521B\u5EFA\u7AE0\u8282\u5185\u5BB9\u8282\u70B9\uFF0C\u5E76\u5728 Plot System \u4E2D\u628A Scene \u6302\u5230\u8BE5\u7AE0\u8282\u3002"
  }),
  lorebookEntries: Type.Optional(Type.Array(Type.String({ description: "\u5185\u5BB9\u8282\u70B9\u8DEF\u5F84\uFF0C\u6309 writer agent cwd \u89E3\u6790\u3002writer \u4F1A\u6309\u6570\u7EC4\u987A\u5E8F\u8BFB\u53D6 index.md \u4E0E\u540C\u7EA7\u53EF\u9009 state.md\u3002" }), { description: "\u672C\u6B21\u5199\u4F5C\u9700\u8981\u8BFB\u53D6\u7684 Lorebook/Manuscript \u5185\u5BB9\u8282\u70B9\u8DEF\u5F84\u6570\u7EC4\u3002" })),
  constraints: Type.Optional(Type.Array(Type.String({ description: "\u989D\u5916\u5199\u4F5C\u7EA6\u675F\u3001\u683C\u5F0F\u7EA6\u675F\u3001\u7981\u5FCC\u3001\u5B57\u6570\u6216\u7528\u6237\u4E34\u65F6\u504F\u597D\u3002" }), { description: "\u672C\u8F6E\u5199\u4F5C\u7EA6\u675F\u5217\u8868\u3002" })),
  writingStylePreset: Type.Optional(Type.String({ description: "\u53EF\u9009 writing style \u9884\u8BBE key\uFF0C\u4E0D\u662F\u6587\u4EF6\u8DEF\u5F84\u3002\u7CFB\u7EDF\u9884\u8BBE\u76EE\u5F55\uFF1Aassets/workspace/.nbook/agent/writing-presets/styles\uFF1B\u7528\u6237\u8986\u76D6\u76EE\u5F55\uFF1Aworkspace/.nbook/agent/writing-presets/styles\u3002\u4E3A\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u6587\u98CE\u3002" })),
  writingReferencePreset: Type.Optional(Type.String({ description: "\u53EF\u9009 writing reference \u9884\u8BBE key\uFF0C\u4E0D\u662F\u6587\u4EF6\u8DEF\u5F84\u3002\u7CFB\u7EDF\u9884\u8BBE\u76EE\u5F55\uFF1Aassets/workspace/.nbook/agent/writing-presets/references\uFF1B\u7528\u6237\u8986\u76D6\u76EE\u5F55\uFF1Aworkspace/.nbook/agent/writing-presets/references\u3002\u4E3A\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u53C2\u8003\u6587\u6863\u3002" }))
});
var WriterOutputSchema = Type.Object({
  summary: Type.String({ description: "\u5199\u4F5C\u6458\u8981\uFF0C\u8BF4\u660E\u65F6\u95F4\u3001\u5730\u70B9\u3001\u53C2\u4E0E\u89D2\u8272\u3001\u5173\u952E\u52A8\u4F5C\u3001\u5173\u7CFB\u53D8\u5316\u548C\u4F0F\u7B14/\u72B6\u6001\u53D8\u5316\u3002" }),
  outputPath: Type.Optional(Type.String({ description: "\u5B9E\u9645\u5199\u5165\u6216\u4FEE\u6539\u7684\u6587\u4EF6\u8DEF\u5F84\u3002\u6CA1\u6709\u6587\u4EF6\u843D\u70B9\u65F6\u4E0D\u8981\u586B\u3002" }))
});
var RetrievalInputSchema = Type.Object({
  prompt: Type.String({ description: "\u68C0\u7D22\u8BF7\u6C42\u3002\u5199\u6E05\u4EFB\u52A1\u76EE\u6807\u3001\u8981\u627E\u4EC0\u4E48\u3001\u7ED9\u8C01\u7528\u3001\u7AE0\u8282/\u6B63\u6587\u4E0A\u4E0B\u6587\u3001\u6392\u9664\u9879\u548C\u6570\u91CF\u504F\u597D\u3002" })
});
var RetrievalOutputSchema = Type.Object({
  entries: Type.Array(Type.Object({
    path: Type.String({ description: "\u5185\u5BB9\u8282\u70B9\u8DEF\u5F84\u3002Leader \u8C03 writer \u65F6\u53EA\u63D0\u53D6\u8FD9\u4E2A path\u3002" }),
    reason: Type.String({ description: "\u4E3A\u4EC0\u4E48\u8FD9\u4E2A\u8282\u70B9\u5E94\u8BE5\u4F20\u7ED9 writer\u3002\u6309\u5F53\u524D\u5199\u4F5C\u4EFB\u52A1\u6982\u62EC\uFF0C\u4E0D\u8981\u5B8C\u6574\u590D\u8FF0\u8282\u70B9 summary\u3002" }),
    use: Type.Optional(Type.String({ description: "\u5EFA\u8BAE writer \u91CD\u70B9\u4F7F\u7528\u8FD9\u4E2A\u8282\u70B9\u7684\u54EA\u4E00\u90E8\u5206\u4FE1\u606F\uFF1B\u7ED9 Leader \u5224\u65AD\u7528\uFF0C\u4E0D\u76F4\u63A5\u4F20\u7ED9 writer\u3002" })),
    risk: Type.Optional(Type.String({ description: "\u53EF\u9009\u98CE\u9669\u8BF4\u660E\uFF0C\u4F8B\u5982\u53EA\u662F\u5F31\u76F8\u5173\u3001\u72B6\u6001\u53EF\u80FD\u8FC7\u65F6\u3001\u9700\u8981\u7528\u6237\u786E\u8BA4\u3001\u53EF\u80FD\u4E0E\u4EFB\u52A1\u51B2\u7A81\u3002" }))
  }), { description: "\u6309\u63A8\u8350\u4F18\u5148\u7EA7\u6392\u5E8F\u7684\u5019\u9009\u5185\u5BB9\u8282\u70B9\u3002" }),
  note: Type.Optional(Type.String({ description: "\u6574\u4F53\u68C0\u7D22\u8BF4\u660E\uFF0C\u4F8B\u5982\u6CA1\u6709\u5F3A\u76F8\u5173\u6761\u76EE\u3001\u7ED3\u679C\u504F\u5C11\u3001\u5EFA\u8BAE\u8865\u5145\u641C\u7D22\u6761\u4EF6\u3002" }))
});

// assets/workspace/.nbook/agent/profiles/builtin/session.summarizer.profile.tsx
var profileManifest = {
  key: "session.summarizer",
  name: "Session Summarizer",
  description: "Background profile that maintains display title and summary for an Agent session."
};
var InputSchema = SessionSummarizerInputSchema;
var OutputSchema = SessionSummarizerOutputSchema;
var session_summarizer_profile_default = defineAgentProfile({
  manifest: profileManifest,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  allowedToolKeys: ["report_result"],
  prepare() {
    return {
      systemPrompt: [
        "\u4F60\u662F NeuroBook \u7684\u540E\u53F0 session \u5C55\u793A\u5143\u6570\u636E\u6458\u8981\u5668\u3002",
        "\u4F60\u4F1A\u6536\u5230\u4E00\u6BB5 Agent Dialogue Content\uFF0C\u5B83\u662F\u6E90 session \u5F53\u524D active path \u7684\u53EF\u89C1\u6B63\u6587\u3002",
        "\u53EA\u6839\u636E\u8FD9\u6BB5\u6B63\u6587\u751F\u6210\u5C55\u793A\u7528 title \u548C summary\uFF0C\u4E0D\u8981\u7F16\u9020\u6587\u4EF6\u3001\u5DE5\u5177\u7ED3\u679C\u6216\u672A\u51FA\u73B0\u7684\u7ED3\u8BBA\u3002",
        "title \u5FC5\u987B\u7B80\u77ED\u5177\u4F53\uFF0C\u4E0D\u8D85\u8FC7 32 \u4E2A\u4E2D\u6587\u5B57\u7B26\u3002",
        "summary \u7528\u4E00\u53E5\u8BDD\u6982\u62EC\u5F53\u524D\u4F1A\u8BDD\u76EE\u6807\u3001\u5DF2\u5B8C\u6210\u8FDB\u5C55\u6216\u6700\u65B0\u72B6\u6001\uFF0C\u4E0D\u8D85\u8FC7 240 \u4E2A\u4E2D\u6587\u5B57\u7B26\u3002",
        "\u5FC5\u987B\u8C03\u7528 report_result\uFF0Creport_result.data \u5FC5\u987B\u662F { title, summary }\u3002"
      ].join("\n")
    };
  }
});
export {
  InputSchema,
  OutputSchema,
  session_summarizer_profile_default as default,
  profileManifest
};
