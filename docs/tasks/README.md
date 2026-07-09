# Task Walkthroughs

`docs/tasks/` 用来记录重大任务的持续过程。它不是一次性流水账，而是功能级、任务级的长期上下文。

## 何时创建或更新

- 会改变代码行为、架构决策、模块状态或长期 TODO 的任务，需要更新任务 walkthrough。
- 同一功能后续调节继续更新同一个任务目录，例如拆书功能继续写入 `docs/tasks/07-book-splitting/README.md`。
- 用户创建一个重要的讨论，或者架构设计

## 命名

- Active task 使用 `{order}-{name}` 目录名，例如 `01-config-system`、`02-book-splitting`。
- `order` 使用两位数字，从 `01` 开始；active task 按 README 首次加入 git 的时间正序编号，缺少 git 记录时使用目录 LastWriteTime。
- `name` 使用英文 kebab-case。
- 每个任务目录至少包含 `README.md`。
- 并不一定强制都把任务塞到 README.md 里，还可以在任务目录类放其他和任务有关的文档等资料，例如 notes.md, references.md

## 归档

- `docs/tasks/archived/` 存放已归档 task，目录保留原 slug，不加 active 编号。
- 用户可以手动归档任务。
- 执行任务治理时，目录 LastWriteTime 早于当前时间三天的 task 会移入 `archived/`。
- archived task 不参与 active 编号，也不要求继续维护 `PROJECT-STATUS.md` 同步状态。
- 每一轮的实现报告都需要记录在这个 58 号任务目录下的 walkthourghs/ 子文件夹中

## goal 模式工作流程

如果你正在持续推进某个任务，则按照这个流程循环进行：

调研/计划 -> 编码/实现 -> 测试 -> 浏览器测试 -> 代码审查 <-> 修复（回到代码审查） -> 调研/计划 或者 结束任务

最后应该从用户的角度，新建一个 project 跑一个实际的例子，评估这个系统的好用程度，bug。然后继续优化

注意：实现的过程中如果堵塞，可以尝试稍微绕道，但是每次绕道到必须要在 walkthourgh 文件中记录好。重大出入则记录到 README.md 中

## 同步要求

重大任务结束时同时更新：

- 根目录 `PROJECT-STATUS.md`
- 对应 active `docs/tasks/<order>-<task-slug>/README.md` 或 archived `docs/tasks/archived/<task-slug>/README.md`
