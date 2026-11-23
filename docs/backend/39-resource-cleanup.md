# 构建与发布资源自动清理

日期：2026-11-23。正式迁移 v19，仍为 36 张业务表、79 个 HTTP 操作。实现入口：[Worker](../../internal/cleanup/service.go)、[构建清理](../../internal/build/cleanup.go)、[发布清理](../../internal/release/cleanup.go)。

## 配置与保留策略

| 配置 | 默认 | 生效条件 |
| --- | --- | --- |
| `PODRY_RESOURCE_CLEANUP_ENABLED` | `false` | 显式开启才访问集群，与构建/发布提交开关独立 |
| `PODRY_BUILD_RESOURCE_RETENTION` | `24h` | 自 Attempt finished_at 起算，允许 1h–2160h；另行检查日志门槛 |
| `PODRY_RELEASE_RESOURCE_RETENTION` | `168h` | 自 Deployment finished_at 起算，允许 168h–2160h；必须已被后续成功发布替代 |

开启时必须配置原 `PODRY_CREDENTIAL_KEY` 和持久 `PODRY_DATA_DIR`。先显式执行 `podry migrate up`，再启用清理；启动不自动迁移。恢复备份时先关闭全部后台开关，隔离旧实例，并同时恢复原密钥、数据库和归档目录，之后按外部证据决定是否开启。

历史集群凭据还需具备对应 namespace 的 Kubernetes get/list/delete 权限：构建涉及 Job、Pod、Secret、ConfigMap；发布涉及 Job/Secret 的 get/delete，以及下文引用检查中列出的所有资源的 list。任一权限不足均保留资源，并记录安全错误分类，不将 403/不完整读取当作不存在。

Worker 每 30 秒最多处理一个 BuildAttempt 和一个 Deployment；每类步骤最多 20 秒。证据不足或上游失败时保留资源，保存错误分类和五分钟后重试时间；超时/崩溃使当前事务回滚，下一轮重新读取外部身份。没有按标签批量删除、DeleteCollection、TTLAfterFinished、强制清除 finalizer 或目标占用。

## 构建资源

- 仅 `stage=finished` 且 `succeeded/failed/canceled`、有冻结 Job UID、超过保留期、无有效执行租约的 Attempt 可进入清理。旧 Attempt 与重试的新 Attempt 使用独立 Job 身份。
- 重验冻结 ExecutionSpec 哈希及 Build/Attempt/集群/namespace/Job/commit 身份。Job 匹配原 UID 和执行注解，控制器证明完成、失败或已暂停；所有原 Job Pod 必须确认终态。
- 七天内没有归档则暂缓。未过期归档必须通过文件、长度、SHA-256 和 NDJSON 解码验证；缺失、损坏或超限均保留资源。多个 Podry 实例必须共享同一持久归档目录。
- 归档超过原 expires_at，或完成超过七天且从未归档，允许日志到期处理；先记录 `log_availability=expired`，再移除运行时来源。GC 不延长归档保留期。
- 先条件删除 Job，确认消失且原 Job Pod 均已消失，再处理同一执行的 `-auth` Secret 和 `-spec` ConfigMap。依赖对象同时匹配执行注解和原 Job OwnerReference。
- 保留 Build、Attempt、Artifact、Registry tag/blob、凭据版本和审计。失败/取消 Attempt 清理后的重试仍依据原 UID 消失及 Pod 退出证据。

归档文件到期回收仍由 Build Worker 的 `PurgeExpiredArchives` 负责；资源清理遇到已过期归档时也先安全删除该 Attempt 的确切文件，再记录 expired，避免绕过原回收游标。未过期文件不会因外部资源回收提前删除。

## 发布资源

- 仅终态、超过保留期且同一 binding/物理 target 已有创建时间更晚的成功发布可进入候选。当前发布、该 target 的 queued/submitting/observing/unknown 和有效租约均受保护。
- 事务按应用、集群、目标、Deployment 锁定并重验候选。集群锁阻止新的平台资源写入准入；该集群存在 queued/running/unknown 资源操作时暂缓。租约到期不能作为操作完成证据。原 activeDeploymentId、fencing 和执行租约不会被修改。
- 从原快照提取资源，校验快照/Chart/manifest 摘要和 Deployment/Request/应用/绑定/目标关系。只回收原 `deployment_resources` 已记录准确 UID 的 Job 和版本 Secret。
- Job 匹配原标签、镜像与 UID，控制器及所有原 Job Pod 已结束。Foreground 删除后等待依赖回收。旧 Job 运行时日志在至少七天后随资源到期，当前发布 Job 保留；本批没有新增发布日志归档，长期应用日志由外部日志系统保留。
- Secret 删除前完整列举本 namespace 的 Pod、ReplicationController、ServiceAccount、Deployment、ReplicaSet、StatefulSet、DaemonSet、Job、CronJob、Ingress，检查 Secret/CSI 卷、投影、env/envFrom、imagePullSecrets、ServiceAccount secrets 和 Ingress TLS。零副本 ReplicaSet 与 CronJob 模板同样受保护。任一列表失败、缺失 items、超过 200 项或仍有分页均暂缓。
- 保留 Deployment、Service、Ingress、Helm release 存储 Secret 和 Helm 历史。历史回滚从原快照、Chart 和准确凭据版本生成新工作负载/Secret；保留的旧 ReplicaSet 继续受引用检查保护。

检查覆盖平台支持的内置工作负载，不能为 CRD 自定义控制器或绕过 Podry 的并发写入提供跨对象事务。这些专属资源应由既定平台流程管理；外部引用需独立确认。归属不明的同名替代对象始终保留。

## 删除、并发与恢复

每次 DELETE 携带当前 GET 的 UID 与 resourceVersion 作为 preconditions。成功或 202 不是清理完成；再次 GET 404 才确认对象消失。冲突、新 UID、未知响应和 finalizer 阻塞均待重试；重试先 GET 并检查冻结身份，不创建资源、不重放构建或 Helm。

有界事务行锁提供互斥，`SKIP LOCKED` 跳过其他实例持有的任务。响应丢失或外部删除后数据库回滚时，下次从原身份重新观察；已不存在的对象视为已回收，仍在的原对象可再次带条件删除。

v19 为 `build_attempts` 与 `deployments` 各增加：

| 字段 | 含义 |
| --- | --- |
| `next_cleanup_at` | 下一轮清理调度时间 |
| `cleanup_attempts` | 已持久记录的尝试次数 |
| `cleanup_error_code` | 安全错误分类，不含 Secret/Manifest/上游正文 |
| `resources_cleaned_at` | 确认候选范围内所有应清理对象消失的时间 |

每轮已持久化尝试追加 `build.resources.cleanup` 或 `deployment.resources.cleanup` 审计，result 为 succeeded/unknown，仅含 executionId 和错误分类。失败不改变业务状态、当前指针、Artifact 或执行 error_code。存在清理尝试历史时拒绝 v19 降级，以保留外部删除证据；无清理历史允许 v19→v18。

## 验证范围

隔离 PostgreSQL 与模拟 TLS Kubernetes API 覆盖日志门槛、到期、UID 替换、活动 Pod、条件删除、响应丢失后重启、并发领取、当前发布/目标占用、旧控制器引用和迁移保护。配置测试验证默认关闭、独立启用、密钥与保留期上下界。真实 K3s 清理、生产恢复与共享存储多实例验收仍待开展；本轮未清理用户现有集群。

全量编译快照 200 个顶层、176 个子用例通过，1 个真实集群用例跳过；其后几项清理边界补强以最终源码专项验证，9 个顶层、8 个子用例通过。最终内部单元回归通过；没有将分层结果当作最终源码的一次完整全量运行。日志和复跑中断记录见根目录 [开发进度](../../DEVELOPMENT_PROGRESS.md) 本轮记录。
