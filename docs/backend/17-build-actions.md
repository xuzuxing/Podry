# 构建取消与重试

最新验证（2026-11-22）：真实 BuildKit 等待步骤执行后请求取消，核对 Job 暂停与 Pod 退出，再以同 Build 新 Attempt 重试成功；SHA、配置、凭据版本、runner 与输入保持一致，成功重试日志 archived，幂等续跑无新增记录。取消的 Pod 已删除，日志 unavailable；尚无所有远端 BuildKit 进程退出或推送中断的完整证据。见 [真实验收](31-live-build-actions-and-job.md)；下文保留 E01 最初交付记录。

日期：2026-11-21 · E01 提前业务实现。真实 CI/CD 仍暂缓，构建与发布 Worker 默认关闭；隔离 PostgreSQL 和模拟 Kubernetes/Registry 结果不代表真实 BuildKit、推送或跨集群执行验收。

## 接口

| 操作 | 请求 | 响应 |
| --- | --- | --- |
| 取消 | `POST /api/builds/{buildId}/cancel` | 202 Build，可能为 canceling、unknown 或已确认的终态 |
| 重试 | `POST /api/builds/{buildId}/retry` | 202 Build，相同 buildId，attemptNo 加一 |

两者要求当前用户具备项目 build 权限及 `Idempotency-Key`，无需请求体；可接受空对象 `{}`，拒绝未知字段和 null。结果、幂等记录和审计在同一事务保存。相同键重放原始 202，仍检查当前权限；重试还检查原尝试的凭据作用域。重放不依赖 Git 在线、最新配置或执行器开关。

## 取消与恢复

1. 尚未记录外部提交意图且无有效 lease 的 planned 尝试直接 canceled，不启动 Job，也无需启用执行器。
2. 其他非终态请求持久保存 cancel_requested_at/by，保留当前 lease/revision。取消意图只可写入一次，重启后继续核对；unknown 保持 unknown，不推断执行结果。
3. Worker 使用原始凭据版本、地址、执行哈希和 Attempt 身份读取 Job。若已知 UID 不匹配或哈希不符，进入 unknown，不操作同名替换对象。
4. 对非终态 Job 请求 suspend=true，使用 UID/resourceVersion 约束。PATCH 成功不代表已经退出；后续必须观察 Suspended=True、active=0，且所有关联 Pod 均处于 Succeeded/Failed 后，才能写 canceled。
5. 在途创建/准备/启动步骤可以完成并保存已发现 UID。落账合并当前取消意图，不能覆盖成 queued/running；首次 POST 前的意图写入也会检查取消标记。
6. 已完成的 Job 优先核验真实结果。Complete 必须验证 runner 结果和 Registry digest，失败或成功均保留真实终态；Registry 不可达继续 unknown。终态通知同样等待关联 Pod 退出。

取消在接受后不再依赖请求者保有权限。创建响应丢失且尚无已知 UID 时，Job 消失不能当作取消成功；已知 UID 的 Job 消失也需读取其 Pod 并确认退出。查询有界，Pod 分页未读完会拒绝确认。取消保留 Job 记录与现有日志证据，但暂停可能导致 Pod 删除，无法保证所有运行日志都来得及归档。

## 重试输入与准入

只接受 failed/canceled，unknown 返回 409 outcome_unknown，活动或成功构建返回 409 build_not_retryable。旧尝试必须 finished、无有效 lease，其他历史尝试也不能活动。入队前在数据库事务外只读核对旧 Job/Pod 的退出状态；证据不足返回 409 build_exit_unconfirmed，不创建任务。

保持原 Build 的 SHA、configVersion、pipelineId、requestedBy、createdAt；复用原 ExecutionSpec 的构建配置、集群连接、BuildKit endpoint、runner 镜像、平台与准确凭据版本。仅生成新 Attempt UUID、Job 名称、镜像 tag，并将新 Attempt 的 requestedBy 设为当前重试用户。保留旧 Attempt、Artifact 和日志历史；成功 Build 不重试。

构建日志默认选择最新 Attempt；显式 attemptNo 则保留该尝试的游标/日志与终态。旧尝试的 follow 日志以自身状态结束，不随新尝试继续等待。

当前应用必须可修改、原 CI 仍启用手动触发，且执行器已启用。准确历史凭据版本必须存在并可解密，不以当前版本替换。读取旧凭据和作用域重新授权；URL 使用当前策略检查。Git 分支和最新配置不重新解析。外部退出检查前后均在短事务中重验状态与 revision；同键并发只新增一个 Attempt，不同键竞争失败不留下占位或多余尝试。

## 迁移与验收边界

显式迁移 `000010_build_actions` 增加取消时间/操作者、不可变取消意图和 Build 输入保护、canceling 队列索引，不新增业务表。当前二进制只接受干净 v10；升级不会改写原 execution_spec/hash 或既有 Job UID。出现取消或重试历史后拒绝降级，避免丢失恢复语义。没有对开发数据库自动迁移。

实现入口：`internal/application/build_actions.go`、`internal/build/actions.go`、`internal/build/service.go`；专项用例：`tests/integration/build_actions_test.go`。测试结果记录在根目录开发进度中。

待真实环境验证：控制器暂停/终止延迟、BuildKit 会话退出、推送中断、重启与响应丢失、保留日志读取。取消无法撤回已推送的镜像或用户代码已经产生的外部副作用；不能把 Pod 退出等同于外部操作已回滚。
