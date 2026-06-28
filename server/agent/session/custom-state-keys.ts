/**
 * Agent task list 在 session custom state 中的固定 key。
 */
export const AGENT_TASKS_STATE_KEY = "agent.tasks";

/**
 * Plot 工具的当前选择状态在 session custom state 中的固定 key。
 */
export const PLOT_SELECTION_STATE_KEY = "plot.selection";

/**
 * World Engine 工具最近查询的 subject 焦点。
 */
export const WORLD_FOCUS_STATE_KEY = "world.focus";

/**
 * Plan Mode reminder 状态在 session custom state 中的固定 key。
 */
export const AGENT_PLAN_MODE_STATE_KEY = "agent.planMode";

/**
 * 等待用户 resolution 的工具表单 metadata，后缀为 toolCallId。
 */
export const AGENT_PENDING_USER_RESOLUTION_STATE_PREFIX = "agent.pendingUserResolution.";

/**
 * Session 展示标题/摘要后台维护状态。
 */
export const SESSION_SUMMARIZER_STATE_KEY = "summarizer.state";

/**
 * Follow-up queue 的持久投影状态，用于刷新或重建 harness 后恢复 UI snapshot。
 */
export const AGENT_FOLLOW_UP_QUEUE_STATE_KEY = "agent.followUpQueue";
