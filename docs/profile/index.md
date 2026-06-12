# Profile 介绍

Profile 定义一个 Agent 的行为边界。NeuroBook v3 中，profile 就是 agent 类型：创建 `leader.default`、`writer`、`retrieval` 或 `simulator.leader`，本质上都是创建某个 profile 的 session。

普通用户通常只需要选择 profile；profile 作者则需要理解 TSX Profile DSL、工具权限、输入输出 schema、动态上下文、压缩策略、摘要策略和 Runtime Hooks。

## Profile 包含什么

一个 profile 至少包含：

- `manifest.key`：稳定 profile key，例如 `leader.default`。
- `manifest.name`：用户可见名称。
- `inputSchema`：创建 session 时的输入合同。
- `outputSchema`：需要结构化结果时的输出合同。
- `tools`：这个 profile 的根工具绑定对象，决定模型可见工具 schema 和最大工具权限。
- `mainRunToolKeys`：可选，收窄主 run 实际可执行工具；不声明时等于根 `tools` 的全部 key。
- `context(ctx)`：用 TSX DSL 生成 system、history、dynamic context 和 reminder。
- compaction / summary / runtime hooks：控制压缩、摘要、旁路和生命周期行为。

需要结构化结果时，profile 通过 `report_result` 返回。

## 系统 profile 和用户 profile

系统内置 profile 位于：

```text
assets/workspace/.nbook/agent/profiles/builtin/
```

用户覆盖或自定义 profile 位于：

```text
workspace/.nbook/agent/profiles/
```

运行时使用 `.compiled` artifact。保存 TSX 源文件不等于运行时已生效；需要通过 Workbench 或 `profile compile` 编译。

## 常见内置 profile

| Profile | 职责 |
| --- | --- |
| `leader.default` | 普通小说项目的总调度，处理 Skill、writer、retrieval、researcher 和写作流程。 |
| `writer` | 正式章节正文写作，一章节一 agent。 |
| `retrieval` | 内容节点召回和候选判断。 |
| `summarizer` | 后台生成 session title / summary。 |
| `leader.assets` | 协助用户理解和维护 user-assets、profile、skill。 |
| `simulator.leader` | 写作模式和 RP 共用的世界模拟主管。 |
| `simulator.actor` | 单个 subject 的角色扮演 agent。 |
| `rp.writer` | RP 可见正文渲染。 |

## 继续阅读

- [Leader](./leader.md)：默认 leader 如何调度写作、检索、研究和 RP。
- [Writer](./writer.md)：普通 writer 的章节写作边界。
- [其他 Profile](./other-profiles.md)：retrieval、summarizer、assets、RP profiles。
- [Profile Guide](https://github.com/notnotype/neuro-book/blob/master/reference/agent/profile-guide.md)：profile 作者主入口。
