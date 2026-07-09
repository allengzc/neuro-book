# Writer Profile 优化完成总结

## 完成时间
2026-06-16

## 优化目标
将 writer.profile.tsx 从简单的"读→写→润色"升级为完整的"读→设计→草稿→自查→写→CLI检查→润色"流程，强化信息控制和质量保障。

## 实施的修改

### 1. 添加 bash 工具支持 ✅
- **文件**: `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
- **位置**: 第 43-52 行
- **改动**: 在 `toolset()` 中添加 `builtin.file.bash`
- **目的**: 使 writer 能够执行 llmlint CLI 检查

### 2. 重构 `<thinking_mode>` 章节 ✅
- **位置**: 第 104-119 行
- **改动**: 从"10步执行清单"简化为"思考原则 + 6个关键方面"
- **关键方面**:
  - 任务理解
  - 上下文加载
  - 叙事设计
  - 信息边界（三层隔离）
  - 角色表现
  - 质量控制
- **原因**: 思维链应该是通用原则，不是执行步骤的复述

### 3. 扩展 `<execution_workflow>` 章节 ✅
- **位置**: 第 121-172 行
- **改动**: 从 5 步扩展到 8 步
- **新增步骤**:
  1. 加载必要上下文（细化工具使用规则）
  2. 叙事设计（新增）
  3. 信息控制三层隔离（新增，核心步骤）
  4. 角色表现设计（新增）
  5. 脑内打草稿（新增）
  6. 质量自查（新增）
  7. 写入成稿并 CLI 检查（集成 llmlint CLI）
  8. 报告落点

### 4. 新增 `<tool_usage_guide>` 章节 ✅
- **位置**: 第 174-230 行（在 `</execution_workflow>` 之后）
- **内容**:
  - `<plot_tools>`: 说明 4 个 plot 工具的使用时机和返回内容
  - `<llmlint_tool>`: 说明 CLI 工具的执行方式和处理原则
  - `<file_tools>`: 说明 read/write/edit/apply_patch 的使用场景
- **目的**: 明确工具使用时机，避免机械读取全部上下文

### 5. 新增 `<information_control>` 章节 ✅
- **位置**: 第 247-276 行（在 `<viewpoint_boundary>` 之前）
- **内容**: 详细说明信息控制三层隔离的操作方法
  - 第一层 - 角色视角：角色知道什么、不知道什么、误解什么
  - 第二层 - 读者视角：哪些信息可以让读者知道但角色不知道
  - 第三层 - 作者视角：writer 知道但不能写进正文的信息
- **目的**: 强化 writer 的核心能力（相比 rp.writer 更需要，因为直接面对复杂的 lorebook 和 plot context）

## 架构改进

### 章节重组后的结构
```xml
<System>
  <writing_reference>...</writing_reference>
  <assistant_definition>...</assistant_definition>
  <neurobook_writer_contract>...</neurobook_writer_contract>

  <thinking_mode>                     <!-- 简化为思考原则 -->
    思考视角、聚焦点、6个关键方面
  </thinking_mode>

  <execution_workflow>                <!-- 8步完整流程 -->
    1. 加载上下文
    2. 叙事设计
    3. 信息控制三层隔离
    4. 角色表现设计
    5. 脑内打草稿
    6. 质量自查
    7. 写入成稿并CLI检查
    8. 报告落点
  </execution_workflow>

  <tool_usage_guide>                  <!-- 新增 -->
    <plot_tools>何时用哪个工具</plot_tools>
    <llmlint_tool>CLI使用方法</llmlint_tool>
    <file_tools>文件工具使用场景</file_tools>
  </tool_usage_guide>

  <content_node_rules>...</content_node_rules>

  <information_control>               <!-- 新增 -->
    三层视角隔离的操作原则
  </information_control>

  <viewpoint_boundary>...</viewpoint_boundary>
  <char_performance>...</char_performance>
  <important>...</important>
  <!-- 其他章节保持不变 -->
</System>
```

### 职责分离
- **thinking_mode**: 思考原则（通用、稳定）
- **execution_workflow**: 执行流程（具体、可操作）
- **information_control**: 信息隔离原则（核心能力）
- **tool_usage_guide**: 工具使用指南（避免误用）

## 与 rp.writer 的对比

| 维度 | rp.writer | 优化前 writer | 优化后 writer |
|------|-----------|--------------|--------------|
| **思维链设计** | 14步执行清单 | 10步执行清单 | 思考原则+6个关键方面 |
| **执行流程** | 9步 | 5步 | 8步 |
| **信息控制** | Brief已过滤 | 笼统的"视角边界" | 三层隔离独立章节 |
| **质量控制** | 内置stop-slop | 只有文风检查 | stop-slop + CLI检查 |
| **工具指南** | 无（无plot工具） | 无 | 完整的plot+CLI指南 |
| **bash工具** | ✅ | ❌ | ✅ |

**核心差异原因**：
- rp.writer 消费已过滤的 brief（单一输入源），writer 直接处理 lorebook + plot context（多源复杂输入）
- rp.writer 的 brief 已做信息隔离，writer 需要自己从原始设定过滤
- writer 需要更强的工具使用指导（4个plot工具 + CLI工具）

## 提示词长度控制
- 优化前：约 228 行
- 删除 thinking_mode 步骤编号：-10 行
- execution_workflow 扩展：+50 行
- 新增 tool_usage_guide：+60 行
- 新增 information_control：+30 行
- **优化后**：约 358 行
- 仍在合理范围内（rp.writer 为 271 行）

## 验证结果

### ✅ TypeScript 编译通过
```bash
bun run typecheck
# 无错误输出
```

### 待验证项
根据计划文档，以下验证项待后续测试：

1. **Profile 加载测试**
   - 创建测试用例验证 profile 能否正常加载
   - 验证 bash 工具已添加

2. **实际写作任务测试**
   - 使用实际写作任务验证新流程
   - 观察 agent 是否按新的 thinking 和 execution 流程执行
   - 验证是否执行了 llmlint CLI 检查

3. **CLI 工具测试**
   - 验证 llmlint CLI 是否可正常执行
   - 测试错误处理（CLI 执行失败时的回退机制）

## 向后兼容性
- ✅ 不影响 `InitialSchema`、`PayloadSchema`、`OutputSchema`
- ✅ 不影响工具接口
- ✅ 只添加工具，不删除现有工具
- ✅ 提示词增强是纯增量，不破坏现有行为

## 未实施项（P2 优先级）
代码重构优化：
- 提取 `validateProjectPath` 公共函数
- 简化 `resolvePayloadTarget` 和 `normalizeProjectPathRef`
- **状态**: 未实施（不影响核心功能）

## 关键文件
- ✅ `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` - 已修改
- 📖 `assets/workspace/.nbook/agent/profiles/builtin/rp.writer.profile.tsx` - 参考文件
- 📖 `reference/agent/rp-tick/writer-brief.md` - Writer Brief 格式参考
- 📖 `assets/workspace/.nbook/agent/skills/llmlint/SKILL.md` - llmlint 工具文档

## 后续建议

1. **测试新流程**
   - 使用简单的续写任务测试新的 8 步流程
   - 验证信息三层隔离是否生效
   - 检查 llmlint CLI 是否正常工作

2. **收集反馈**
   - 观察实际写作任务中的表现
   - 根据反馈调整 thinking_mode 的关键方面
   - 优化 tool_usage_guide 的说明

3. **可选优化**
   - 如果路径验证逻辑频繁出错，可以实施 P2 的代码重构
   - 如果提示词过长影响性能，可以考虑精简部分章节

## 设计亮点

1. **思维链与执行流程分离**
   - thinking_mode 回归通用思考原则
   - execution_workflow 承载具体执行步骤
   - 避免了重复和混淆

2. **信息控制独立章节**
   - 明确三层视角隔离
   - 强化 writer 的核心能力
   - 便于后续引用和强调

3. **工具使用指南**
   - 明确何时使用哪个工具
   - 避免机械读取全部上下文
   - 提升工具使用效率

4. **质量保障完整化**
   - 脑内打草稿 → 质量自查 → CLI 检查
   - 三层质量控制保障输出质量
