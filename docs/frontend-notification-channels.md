# 前端通知途径分析报告

## 概述

项目当前前端有**两类通知途径**：
1. **全局通知系统**（`useNotification` + `NotificationViewport`）- 标准途径
2. **组件内局部 error state**（`const error = ref("")`）- 特定场景途径

## 1. 标准全局通知系统

### 实现位置
- **Composable**: `app/composables/useNotification.ts`
- **展示组件**: `app/components/common/NotificationViewport.vue`
- **错误解析工具**: `app/utils/api-error.ts`

### 使用方式
```typescript
const notification = useNotification();

// 四种 tone
notification.success("操作成功");
notification.error("操作失败");
notification.warning("警告信息");
notification.info("提示信息");

// 带标题
notification.error("详细错误信息", { title: "操作失败" });

// 自定义配置
notification.notify({
    title: "标题",
    message: "消息",
    tone: "error",
    autoClose: true,
    duration: 5600,
    position: "top-right"
});
```

### API 错误处理标准化
```typescript
import { resolveApiErrorMessage } from "nbook/app/utils/api-error";

try {
    await $fetch("/api/...");
} catch (error) {
    notification.error(
        resolveApiErrorMessage(error, "默认错误文案"),
        { title: "操作失败" }
    );
}
```

### 视觉设计
- **位置**: `top-right` (默认), 可配置 6 个位置
- **样式**: 
  - 半透明背景 + backdrop-blur
  - 4 种 tone 对应不同颜色（success: 翠绿, warning: 琥珀, error: 玫瑰, info: 天蓝）
  - 圆角卡片 + 阴影
  - 自动关闭（默认 3.2s-5.6s 根据 tone）
- **动画**: 淡入淡出 + 轻微位移

### 适用场景（按 CLAUDE.md 规范）
1. **跨入口操作**：不属于单一 Dialog/Panel 的操作
2. **后台动作**：Agent 运行、自动保存、文件同步等
3. **即时反馈**：复制、粘贴、剪贴板、文件操作等
4. **成功提示**：创建成功、保存成功、编译通过等

### 当前使用情况
已在 **18 个组件**中使用，包括：
- `app/pages/index.vue` - IDE 主界面（文件同步、自动保存、Inline AI 等）
- `app/components/novel-ide/agent/AgentChatSurface.vue` - Agent 对话
- `app/components/novel-ide/workspace/WorkspaceFilePanel.vue` - 文件面板
- `app/components/novel-ide/workspace/WorkspaceCharacterPanel.vue` - 角色面板
- `app/components/profile-template-editor/ProfileTemplateVisualEditor.vue` - Profile 编辑器
- `app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewInspector.vue` - Workbench Preview Inspector

## 2. 组件内局部 error state

### 实现模式
```typescript
const error = ref("");

function setError(message: string) {
    error.value = message;
}

// 在模板中展示
<div v-if="error" class="error-banner">
    {{ error }}
</div>
```

### 当前使用位置
1. **WorldEngineWorkbenchDialog.vue**:177
   - `const error = ref("")`
   - `const notice = ref("")` (成功/提示)
   - 专用函数：`setWorkbenchError()`, `setWorkbenchNotice()`
   
2. **FormAnnotationDialog.vue**:25
   - `const error = ref("")`
   
3. **NovelRagInspectorDialog.vue**:39
   - `const error = ref("")`
   
4. **NovelRagPanel.vue**:36
   - `const error = ref("")`

5. **Settings 面板** (3 个)：
   - `NovelIdeAgentProfileModelSettingsPanel.vue`:69 - `const errorText = ref("")`
   - `NovelIdeEmbeddingSettingsPanel.vue`:52 - `const errorText = ref("")`
   - `NovelIdeWebSettingsPanel.vue`:61 - `const errorText = ref("")`

### 适用场景（按 CLAUDE.md 规范）
1. **Dialog/Panel 内可恢复的表单错误**
2. **加载错误**（仅在当前入口可见）
3. **表单验证错误**（用户需边看边改）

### 视觉设计
Settings 面板的标准样式：
```vue
<div v-if="errorText" class="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 shadow-sm">
    <span class="i-lucide-circle-alert h-4 w-4 text-rose-700"></span>
    <div class="text-sm text-rose-700">{{ errorText }}</div>
</div>
```

## 3. 不规范案例：WorldEngineWorkbenchDialog.vue

### 问题定位
**文件**: `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue:1919:12`

### 当前实现
该组件使用了**混合模式**：
1. 局部 `error.value` + `notice.value`（约 15+ 处赋值）
2. **没有**使用全局 `useNotification()`

### 问题分析
根据 CLAUDE.md 规范：
> 前端错误展示按入口归属：当前 Dialog/Panel 内可恢复的表单或加载错误写入该入口自己的局部 error state；**跨入口、后台动作、复制/剪贴板/文件操作等即时反馈使用 `useNotification()`**；不要把 A 入口触发的错误写进只有 B 入口能看到的 error state。

**WorldEngineWorkbenchDialog** 是一个**大型 Dialog**（2100+ 行），包含：
- Slice Composer（编辑器）
- Preview Inspector（预览侧边栏）
- Subject Creator（主体创建）
- Timeline（时间线）

其中许多操作（例如保存 Slice、删除 Subject、加载预览）应该属于"跨入口"或"后台动作"，但当前全部使用局部 error state，可能导致：
1. **错误不可见**：用户在 A 面板触发操作，错误显示在 B 面板的 error banner
2. **错误滞留**：切换上下文后旧错误依然显示
3. **通知不一致**：其它组件用 notification，唯独这里用局部 state

### 建议改进方向
需要**逐操作审查**，按规则分类：
- **保留局部 error state**：
  - 表单验证错误（Slice Composer 输入不完整）
  - 当前 Panel 内的加载错误（Schema 加载失败）
  
- **迁移到 useNotification()**：
  - 保存 Slice 成功/失败
  - 删除 Subject 成功/失败
  - 复制操作反馈
  - 后台预览计算错误
  - 跨 Panel 的操作反馈

## 4. 其它辅助通知途径

### 4.1 confirm / dialog.confirm
**用途**: 用户确认对话框（删除、重置等破坏性操作）

```typescript
const confirmed = await confirm("确认删除吗？", "删除确认");
if (!confirmed) return;
```

**当前使用**：
- `AgentChatSurface.vue` - Rollback 确认
- `NovelBookshelfDialog.vue` - 删除项目
- `WorkspaceCharacterPanel.vue` - 删除角色
- `WorkspaceFilePanel.vue` - 删除文件/目录

### 4.2 useDialog (Dialog 组件)
**用途**: 模态对话框容器，不是通知途径本身

## 5. 规范总结

### 选择通知途径的决策树

```
是否需要用户立即响应（确认/取消）？
├─ 是 → confirm / dialog.confirm
└─ 否 → 是否是错误/成功/警告反馈？
    ├─ 是 → 错误是否只在当前 Dialog/Panel 内有效？
    │   ├─ 是 → 局部 error state (const error = ref(""))
    │   └─ 否 → useNotification()
    └─ 否 → 不需要通知，直接更新 UI state
```

### 具体判断标准

#### 使用 `useNotification()` 的场景
- ✅ 跨入口操作（从 A 入口触发，影响 B 入口）
- ✅ 后台动作（自动保存、Agent 运行、文件同步）
- ✅ 即时反馈（复制、粘贴、文件操作）
- ✅ 成功提示（创建、保存、编译成功）
- ✅ 操作完成后 Dialog 会关闭的场景

#### 使用局部 `error state` 的场景
- ✅ 表单验证错误（用户需边看边改）
- ✅ 当前 Panel 的加载错误（只在此入口可见）
- ✅ 需要持续展示直到用户修正的错误
- ✅ 错误信息需要和表单字段关联展示

#### 使用 `confirm` 的场景
- ✅ 删除、重置等破坏性操作
- ✅ 需要用户明确同意才能继续的操作

## 6. API 错误处理标准流程

### 标准模式
```typescript
import { resolveApiErrorMessage } from "nbook/app/utils/api-error";
import { useNotification } from "nbook/app/composables/useNotification";

const notification = useNotification();

async function saveData() {
    try {
        await $fetch("/api/save", { method: "POST", body: data });
        notification.success("保存成功");
    } catch (error) {
        notification.error(
            resolveApiErrorMessage(error, "保存失败"),
            { title: "保存失败" }
        );
    }
}
```

### 关键要点
1. **统一使用 `resolveApiErrorMessage`**，不要在业务组件里重复解析 `$fetch` 错误结构
2. **提供 fallback 文案**（第二个参数）
3. **添加 title**，提高通知的可识别性
4. **成功和错误通知成对出现**（如果操作有明确成功状态）

## 7. 待改进项

### 高优先级
1. **WorldEngineWorkbenchDialog.vue**
   - 审查所有 `error.value` / `notice.value` 赋值
   - 按规范分类，跨入口操作迁移到 `useNotification()`
   
### 中优先级
2. **FormAnnotationDialog.vue**
3. **NovelRagInspectorDialog.vue**
4. **NovelRagPanel.vue**
   - 评估是否有跨入口操作
   - 确认局部 error state 是否合理

### 低优先级（已基本规范）
- Settings 面板（已有统一的 errorText + 标准样式）
- Agent Chat Surface（已使用 notification）
- Workspace 面板（已使用 notification）

## 8. 代码规范建议

### 命名规范
- 局部错误状态：`const error = ref("")` 或 `const errorText = ref("")` （Settings 面板）
- 成功提示状态：`const notice = ref("")` （WorldEngineWorkbenchDialog 模式）

### 模板规范
局部错误展示标准样式（参考 Settings 面板）：
```vue
<div 
    v-if="error" 
    class="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 shadow-sm"
>
    <span class="i-lucide-circle-alert h-4 w-4 text-rose-700"></span>
    <div class="text-sm text-rose-700">{{ error }}</div>
</div>
```

### 清理规范
显示新通知时清理旧通知（WorldEngineWorkbenchDialog 的 `setWorkbenchError` 模式）：
```typescript
function setError(message: string) {
    error.value = message;
    if (message) {
        notice.value = ""; // 清掉成功提示
    }
}

function setNotice(message: string) {
    notice.value = message;
    if (message) {
        error.value = ""; // 清掉错误提示
    }
}
```

## 9. 参考资料

- **CLAUDE.md 前端规范**: 第 38-42 行（错误展示规范）
- **标准实现**: `app/composables/useNotification.ts`
- **错误解析**: `app/utils/api-error.ts`
- **展示组件**: `app/components/common/NotificationViewport.vue`
- **最佳实践案例**: `app/pages/index.vue`, `app/components/novel-ide/agent/AgentChatSurface.vue`
