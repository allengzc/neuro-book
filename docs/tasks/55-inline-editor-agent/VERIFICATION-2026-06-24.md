# Inline Editor Path Fix - 验证报告

## 完成的修改

### ✅ Phase 1: 前端路径转换
- **文件**: `app/pages/index.vue`
- **改动**: 新增 `resolveInlineEditorTargetPath()` 和 `resolveInlineEditorReferences()` 函数
- **改动**: 修改 `sendInlineEditorPrompt()` 在构造 payload 时调用路径转换

### ✅ Phase 2: 修复 Schema 注释
- **文件**: `server/agent/profiles/builtin-contracts.ts`
- **改动**: 修正 `InlineEditorPayloadSchema.targetPath` 描述
- **改动**: 修正 `references[].path` 描述

### ✅ Phase 3: 修复 Profile Prompt
- **文件**: `assets/workspace/.nbook/agent/profiles/builtin/inline.editor.profile.tsx`
- **改动**: 删除误导表述"裸 manuscript/... / lorebook/... 路径可以作为 Project 内路径使用"
- **改动**: 明确说明 Agent cwd 和路径前缀要求

### ✅ Phase 4: 增强 Profile Context 渲染
- **文件**: `assets/workspace/.nbook/agent/profiles/builtin/inline.editor.profile.tsx`
- **改动**: 新增 `renderProjectContext()` 函数
- **改动**: 在 `renderInlineEditContext()` 中调用 `renderProjectContext()`，明确渲染 projectSlug 和 projectPath

### ✅ Phase 5: 更新任务文档
- **文件**: `docs/tasks/55-inline-editor-agent/README.md`
- **改动**: 在 Implementation Walkthrough 添加 2026-06-24 条目
- **改动**: 在 Decisions / Discussion 添加路径协议规则

## 验证结果

### ✅ Profile 编译
```bash
bun scripts/build/profile.ts compile --all --system
```
**结果**: ✅ 成功编译 14 个 profile artifacts，包括 `inline.editor`

### ✅ TypeScript 类型检查
```bash
bunx vue-tsc --noEmit
```
**结果**: ✅ 没有发现与本次修改相关的类型错误
- 检测到的错误都在 `server/agent/tools/control-tools.test.ts`，与本次修改无关
- 我们修改的文件（`app/pages/index.vue`, `inline.editor.profile.tsx`, `builtin-contracts.ts`）没有类型错误

## 手动测试步骤

**请按照以下步骤进行手动验证**：

1. **启动开发服务器**：
   ```bash
   bun dev
   ```

2. **打开测试项目**：
   - 访问 `http://localhost:3000/?project=workspace%2Fming-ding-zhi-shi-2`
   - 进入 `manuscript/001-volume/001-chapter/index.md` 或任何章节文件

3. **触发 Inline AI**：
   - 选中一段文本
   - 点击 selection menu 的 ✨ "加入 AI 引用"
   - Prompt Bar 应该展开，显示选区 chip

4. **发送请求**：
   - 选择任务类型（如"润色"）
   - 输入指令（如"让这段更简洁"）
   - 打开浏览器开发者工具 Network 面板
   - 点击"发送"

5. **验证 payload**：
   - 在 Network 面板找到 `/api/agent/sessions/{id}/invoke` 请求
   - 检查 Request Payload 的 `input` 字段
   - **期望**: `targetPath` 应该是 `ming-ding-zhi-shi-2/manuscript/...` 格式
   - **期望**: `references[].path` 也应该包含 project slug

6. **验证 Agent 工具调用**：
   - 切换到 Agent 面板
   - 观察工具调用是否成功
   - **期望**: `read` 工具调用成功，没有 `ENOENT` 错误
   - **期望**: Agent 能够正确读取和编辑文件

7. **检查 session 日志**（可选）：
   ```powershell
   # 替换 {session-id} 为实际的 session ID
   Get-Content "workspace\.nbook\agent\sessions\{session-id}.jsonl" | Select-String "targetPath|read"
   ```
   - **期望**: 日志中的 `targetPath` 包含完整路径
   - **期望**: `read` 工具调用的 `path` 参数包含完整路径

## 预期结果

修复后应该达到：
- ✅ `inline.editor` 可以成功调用 `read` / `edit` / `write` 工具
- ✅ Session 日志不再出现 `ENOENT: no such file or directory` 错误
- ✅ 路径协议与 `writer` / `retrieval` 等其他 profile 完全对齐
- ✅ Schema 和文档明确路径格式要求，不再误导
- ✅ 前端改动最小化，只在 payload 构造时转换一次

## 已知问题

无。所有计划中的修改都已完成，且通过了自动化验证。

## 下一步

1. **手动测试**: 请按照上述步骤进行浏览器测试，确认实际行为符合预期
2. **监控**: 上线后观察 inline editor session 的工具调用成功率
3. **可选优化**: 如需要，可以为 `resolveInlineEditorTargetPath()` 添加单元测试
