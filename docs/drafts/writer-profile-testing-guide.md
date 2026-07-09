# Writer Profile 优化测试指南

> **时效声明（2026-07-09）**：本文写于 writer 尚无 Plot 工具的阶段，工具契约相关内容已随 Task 87（writer 获得 Plot 只读）与 Task 97（读 `get_story_*` / 写 `save_*` 重排）演进。工具契约以 `reference/plot/system.md` §Agent Tools 与 `server/agent/profiles/writer-profile-contract.test.ts` 为准；本文其余示例（如入参形态）也可能过时，验收前先对照真相源。

## 已完成的测试

### ✅ 1. TypeScript 编译测试
```bash
bun run typecheck
```
**结果**: 通过，无编译错误

### ✅ 2. 单元测试
```bash
bunx vitest run server/agent/profiles/writer-profile-contract.test.ts
```
**测试内容**:
- ✅ Profile manifest 正确 (key: "writer", name: "正文写作")
- ✅ Bash 工具已添加 (`rootToolKeys` 包含 "bash")
- ✅ World Engine 只读工具存在 (`execute_world`)
- ✅ Plot 只读工具存在（Task 87/97 后 writer 持有 8 个 `get_*`，无任何 `save_*` 写工具）
- ✅ 文件工具存在 (read, write, edit)
- ✅ Schemas 已定义 (initialSchema, payloadSchema, outputSchema)

**结果**: 5/5 测试通过

---

## 待测试项（需要实际运行环境）

### 3. llmlint CLI 工具测试

**目的**: 验证 bash 工具能否正常执行 CLI 检查

**测试步骤**:
```bash
# 创建测试文件
echo "这是一个测试文本。不是很好，而是非常好。一丝不苟地完成任务。" > .agent/test-slop.md

# 手动运行 CLI 检查
bun assets/workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts check .agent/test-slop.md
```

**预期输出**:
- 检测到禁用词："不是...而是..."、"一丝"
- 输出类似 eslint 的格式化报告

### 4. Writer Agent 集成测试

**目的**: 验证 writer 在实际写作任务中是否按新流程执行

**测试场景 A: 简单续写任务**
```typescript
// 在 NeuroBook UI 或测试脚本中
const session = await createAgentSession({
    profileKey: "writer",
    workspaceRoot: "/path/to/workspace",
});

await invokeAgent(session.id, {
    message: "续写这一章节，添加 500 字",
    payload: {
        path: "project-slug/manuscript/001-chapter/index.md",
        context: {
            readablePaths: ["project-slug/manuscript/outline.md"],
        },
    },
});
```

**观察点**:
1. Agent thinking 是否提到 6 个关键方面？
   - 任务理解
   - 上下文加载
   - 叙事设计
   - 信息边界（三层隔离）
   - 角色表现
   - 质量控制

2. 执行流程是否包含 8 步？
   - 加载上下文
   - 叙事设计
   - 信息控制三层隔离
   - 角色表现设计
   - 脑内打草稿
   - 质量自查
   - 写入成稿并 CLI 检查
   - 报告落点

3. 是否执行了 llmlint CLI 检查？
   - 查看日志中是否有 bash 工具调用
   - 是否有 CLI 输出

4. 最终输出是否符合质量要求？
   - 无禁用词（一丝、不容置疑等）
   - 无禁用句式（不是...而是...）
   - 无 AI 腔

**测试场景 B: 信息隔离测试**

创建一个包含秘密设定的场景：
```markdown
# lorebook/character/villain/index.md
---
title: 反派
---

这个角色表面是好人，实际是幕后黑手。

knowledge:
- subject: villain
  knows: ["自己的真实身份", "邪恶计划"]
- subject: protagonist
  knows: []
  misunderstands: ["认为反派是好人"]
```

要求 writer 写一段主角与反派对话的场景。

**预期行为**:
- ❌ 不应该让主角知道反派的真实身份
- ✅ 可以给读者留下暗示（反派的微表情、可疑行为）
- ✅ 主角的对话和行为应基于"认为对方是好人"的误解

**观察点**:
- Writer thinking 中是否明确区分了三层视角？
- 正文中是否正确控制了信息披露？

### 5. Chapter Brief 消费测试

**目的**: 验证 writer 正确消费上游编译的 chapter brief，而不是自行调用 Plot tools

**测试场景**: 续写章节，leader 传入完整 brief

```typescript
// Step 1: Leader 编译 brief
const briefResult = await getChapterWriterBrief({
    projectPath: "workspace/my-novel",
    chapterPath: "manuscript/002-chapter/"
});

if (briefResult.details.status !== "ready") {
    // 处理未就绪状态：补 Plot、World Anchor 或 World Context
    console.warn("Brief not ready:", briefResult.details.warnings);
    return;
}

// Step 2: 调用 writer，把 brief 写入 message
const writerResult = await invokeAgent(writerSessionId, {
    message: `续写这一章节：

${briefResult.details.suggestedBriefMarkdown}

写完后 report_result 汇报实际修改路径和剧情摘要。`,
    input: {
        path: "my-novel/manuscript/002-chapter/index.md",
        context: {
            lorebookEntries: ["my-novel/lorebook/character/protagonist/"],
            readablePaths: ["my-novel/manuscript/001-chapter/index.md"],
        },
    },
});
```

**观察点**:

1. ✅ Writer 是否按 brief 中的 Scene / World Context 写作？
2. ✅ Writer 是否用 `execute_world` 自查状态，而非依赖 brief 中的完整状态？
3. ✅ Writer **可以**调用 Plot 只读工具（Task 87 autonomous 模式起 writer 持有 8 个 `get_*`：`get_chapter_writer_brief` / `get_story_chapter` / `get_story_scene_context` / `get_scene_world_context` / `get_story_tree` / `get_story_thread` / `get_story_promise` / `get_story_decision`；清单以 `reference/plot/system.md` §Agent Tools 为准）
4. ❌ Writer 工具调用日志中**不应出现**任何 `save_*` Plot 写工具；出现视为契约违反（剧情设计权在 leader，Task 97 后写面统一为 `save_*` + 显式 action）

**参考**：实际门禁测试见 `server/agent/profiles/writer-profile-contract.test.ts` 和 `server/agent/profiles/leader-owned-plot-reference.test.ts`

### 6. 错误处理测试

**场景 A: CLI 工具执行失败**
```bash
# 模拟 CLI 不存在或执行失败
# 删除或重命名 CLI 文件暂时
```

**预期行为**:
- Writer 应继续手动润色
- 不应阻塞流程
- 日志中应有"CLI 执行失败，继续手动润色"的记录

**场景 B: 缺少必要上下文**
```typescript
await invokeAgent(session.id, {
    message: "续写这一章节",
    payload: {
        path: "project-slug/manuscript/002-chapter/index.md",
        // 故意不提供 context
    },
});
```

**预期行为**:
- Writer 应能根据现有文件内容继续
- 或通过 report_result.result 说明需要补充的上下文

---

## 性能测试

### 提示词长度影响

**测试方法**:
1. 使用相同的写作任务
2. 对比优化前后的 token 消耗

**观察点**:
- 输入 token 增加量（提示词变长）
- 输出 token 是否有变化
- 总成本是否在可接受范围

**预期**:
- 输入 token 增加约 30-40%（提示词从 228 行增到 358 行）
- 输出质量提升应抵消成本增加

---

## 回归测试

**目的**: 确保优化不破坏现有功能

**测试场景**: 运行现有的 writer 相关测试套件
```bash
# 运行所有 writer 相关测试
bun test --filter="writer"
```

**预期**:
- 所有现有测试应继续通过
- 不应有新的失败用例

---

## 测试检查清单

### 基础验证 ✅
- [x] TypeScript 编译通过
- [x] 单元测试通过
- [x] Bash 工具已添加
- [x] execute_world 工具存在（只读 World Engine）
- [x] Schemas 定义正确

### 功能验证 ⏳
- [ ] llmlint CLI 能正常执行
- [ ] Writer 按新 thinking 流程思考
- [ ] Writer 按 8 步 execution 流程执行
- [ ] 信息三层隔离正确工作
- [ ] Writer 正确消费 leader 编译的 Chapter Brief（不主动调用 Plot tools）

### 质量验证 ⏳
- [ ] 输出无禁用词和句式
- [ ] 无 AI 腔和套路化表达
- [ ] 角色视角控制正确
- [ ] 读者视角信息披露合理

### 错误处理 ⏳
- [ ] CLI 执行失败时能回退
- [ ] 缺少上下文时能合理处理
- [ ] 路径错误时能正确报告

### 性能测试 ⏳
- [ ] Token 消耗在预期范围
- [ ] 输出质量有提升
- [ ] 响应时间可接受

### 回归测试 ⏳
- [ ] 现有测试继续通过
- [ ] 不破坏现有功能

---

## 快速验证脚本

你可以使用这个脚本快速验证核心功能：

```bash
#!/bin/bash
# test-writer-optimization.sh

echo "=== Writer Profile 优化验证 ==="

# 1. TypeScript 编译
echo "1. 检查 TypeScript 编译..."
bun run typecheck
if [ $? -eq 0 ]; then
    echo "✅ TypeScript 编译通过"
else
    echo "❌ TypeScript 编译失败"
    exit 1
fi

# 2. 单元测试
echo "2. 运行单元测试..."
bunx vitest run server/agent/profiles/writer-profile-contract.test.ts
if [ $? -eq 0 ]; then
    echo "✅ 单元测试通过"
else
    echo "❌ 单元测试失败"
    exit 1
fi

# 3. CLI 工具测试
echo "3. 测试 llmlint CLI..."
echo "这是一个测试。不是很好，而是非常好。" > .agent/test-slop.md
bun assets/workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts check .agent/test-slop.md
if [ $? -eq 0 ]; then
    echo "✅ CLI 工具可执行"
else
    echo "⚠️  CLI 工具执行有问题（但不阻塞）"
fi

echo ""
echo "=== 基础验证完成 ==="
echo "后续需要实际写作任务测试以验证完整流程"
```

---

## 测试建议

1. **优先级排序**:
   - P0: 基础验证（已完成 ✅）
   - P1: 功能验证（Writer 实际运行测试）
   - P2: 质量验证（输出质量评估）
   - P3: 性能测试（Token 消耗对比）

2. **测试环境**:
   - 使用真实的 NeuroBook 环境
   - 准备测试用的 workspace 和 project
   - 准备包含复杂设定的 lorebook

3. **测试数据**:
   - 简单场景：单一角色，无复杂设定
   - 中等场景：多角色对话，部分秘密设定
   - 复杂场景：多层信息隔离，伏笔与暗示

4. **失败处理**:
   - 如果某个测试失败，记录详细日志
   - 检查是 thinking 问题还是 execution 问题
   - 根据反馈调整提示词
