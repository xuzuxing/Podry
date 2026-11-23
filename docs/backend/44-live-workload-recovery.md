# 运行中检查与 Helm 工作负载提交恢复验收

日期：2026-11-23。范围：T23/B6 的运行中构建检查强杀、Helm Job 创建响应丢失，以及已记录原 UID 的同名替换保护。接续[首次创建强杀验收](43-live-execution-recovery.md)。

新增[集成验收](../../tests/integration/workload_recovery_live_test.go)，扩展[显式入口](../../scripts/test-execution-recovery-live.ps1)和原有故障代理。没有新增接口、迁移、生产执行逻辑或后台开关；步骤预算仍为 20 秒、租约仍为 60 秒。

## 真实执行路径

每个场景创建随机隔离数据库和 Namespace。生产 `ProcessOne` 在独立 OS 子进程执行；代理只允许本次 Namespace 和只读 Discovery。收到真实 K3s 成功响应后暂扣响应，父进程以 `Process.Kill` 强杀 Worker。第二进程不能领取有效租约，原租约自然到期后才启动恢复进程。只加速 `next_poll_at`，不修改状态、lease、owner、revision 或 fencing。

### 构建：检查阶段运行中强杀，再替换原 Job

1. 通过 HTTP 配置及构建准入建立真实 Attempt，冻结固定 digest 的受控 runner。匿名 Git 夹具包含实际 Dockerfile；runner 使用原生 Git 拉取指定 SHA、检查路径并完成 source。
2. check 容器执行有限检查脚本并保持运行；根据真实 Pod 的 initContainerStatuses，确认 source 退出码 0、check 的 state.running 存在。check 是 init container，Pod phase 可以仍为 Pending；不把 ImagePullBackOff 或数据库 running 字段当作脚本运行证据。
3. 在已开始运行的 Job GET 响应返回 Worker 前强杀进程。原 Job/Attempt UID 已持久化；新进程不能抢占有效租约。
4. 将平台集群凭据当前版本轮换为代理拒绝的新 token，撤销请求者的项目成员权限。租约到期后，恢复进程仍以冻结原版本只读观察，同 UID 的 check Pod 继续运行。原 Job、ConfigMap、Secret 和启动 PATCH 不重复。
5. 原 UID 已记录后，故障注入器按当前 UID/RV 条件删除原 Job，等待前台删除确认，再创建同名 Job。复制原 ownership/hash 标记，删除 Kubernetes 自动生成的 controller selector/labels，并保持替代 Job suspended。
6. 连续两次生产观察均为 `unknown / job_identity_conflict`，数据库保存原 UID；不认领、启动或修改替代 Job。始终为 1 Build / 1 Attempt / 0 Artifact。

Git 数据完全由测试生成，check 脚本最终退出 1；即使验收进程异常退出，也不会继续进入镜像阶段。未调用 BuildKit 或执行推送，BuilderEndpoint 仅作为冻结输入存在。

### Helm：Job 已写入、发布未完成时强杀，再替换原 Job

1. 冻结预览并确认两条同目标发布。子进程实际调用 Helm SDK install，先写 pending-install 存储与运行时 Secret，再创建 Job。
2. 在真实 Job POST 返回 201、响应尚未交给 Helm 时强杀。此时工作负载已创建，但 Helm 尚未完成发布状态写回；不声称还有未创建的 Chart 资源。
3. 等待原租约到期，新进程只读恢复，保持 unknown、读到 Helm revision 1，并将原 Job UID 写入 deployment_resources。必须先验证该记录，才允许下一步替换。
4. 故障注入器条件删除并创建同名 suspended Job，复制原 Podry/Helm 标记。连续两次观察都得到 `release_resource_identity_conflict`；原 UID 与 Helm revision 继续作为比较基准。
5. 原 Helm Secret UID/RV、目标 active_deployment_id/fencing 和当前成功指针不变。第二条发布保持 queued；2 Request / 2 Snapshot / 2 Deployment 无新增。

发布 Artifact 是隔离种子，工作负载未验收成功拉取或运行。该场景证明工作负载创建后、Helm 状态完成前的恢复保护，不代表成功发布或业务可用性验收。

## 复现

需要支持 CREATEDB 的专用 PostgreSQL、可用 Kubernetes 内联凭据，以及与当前 runner 协议兼容的固定 digest 镜像。RunnerHost 必须是**测试父进程本机地址，且构建 Pod 可以直接访问该 IP 的随机 TCP 端口**；可将 Linux 测试二进制运行在隔离测试 Pod 内，使用该 Pod IP。不能把宿主机不可达的回环地址作为 RunnerHost。

```powershell
./scripts/test-execution-recovery-live.ps1 `
  -Kubeconfig ./docs/k3s.yaml `
  -InsecureKubernetes `
  -UseExistingTestDatabase `
  -WorkloadRecovery `
  -RunnerHost $env:PODRY_TEST_RUNNER_REACHABLE_IP `
  -RunnerImage $env:PODRY_TEST_PINNED_RUNNER_IMAGE `
  -EvidencePath 'D:/Temp/workload-recovery-new.json'
```

`PODRY_TEST_DATABASE_URL` 只通过环境提供。省略 `-UseExistingTestDatabase` 时复用既有 Docker 测试包装器；本轮采用 K3s 内专用 PostgreSQL 16，没有重启 Docker。EvidencePath 必须是新文件；普通测试不会写真实集群。

直接运行编译后的 Linux 集成二进制时，显式设置 `PODRY_TEST_WORKLOAD_RECOVERY_LIVE=1`、`PODRY_TEST_KUBE_PAYLOAD`、`PODRY_TEST_RECOVERY_RUNNER_HOST`、`PODRY_TEST_RECOVERY_RUNNER_IMAGE` 和可选 `PODRY_TEST_RECOVERY_EVIDENCE`。内部单步子进程不继承这些 live 门禁，只读取父进程指定的随机测试库。

HTTP 只放行本次匿名 Git 及 Registry 夹具的精确 host；集群内 Git 测试客户端不继承环境 HTTP 代理，不改变生产传输或全局代理配置。Kubernetes 跳过 TLS 需要显式选项或 kubeconfig 原有设置，Git/Registry HTTPS 策略不变。

## 证据边界与后续

- 真实：PostgreSQL 事务、独立进程强杀、自然租约到期、受控 runner 的原生 Git/source/check、同 Pod 恢复、Helm SDK 存储与 Job 写入、原 UID 的持久化和真实同名替换。
- 受控：匿名 Git/Registry、发布 Artifact 种子、刻意保持运行的检查脚本、代理凭据轮换与平台项目撤权。未撤销真实 K3s 管理员证书或供应商账号。
- externalWrites/externalCreates 只统计生产 Worker 经代理发送的写请求；每个场景另有 2 次故障注入写入（条件 DELETE 与替代 POST），独立记录为 faultInjectorWrites。Namespace 和测试数据库的准备/清理不在该计数内。
- 成功场景按 Namespace 原 UID、标签与 RV 条件删除，等待消失；失败现场保留后再显式核对回收。原应用、开发数据库及历史 unknown 不参与验收。
- 原有“首次创建响应丢失”与本批“运行中观察/工作负载写入”是不同故障点；独立进程按步骤运行不等于长期多实例服务运行。
- 镜像构建/推送中断、远端凭据失效、长期多实例、共享归档与生产备份恢复、供应商实际 Webhook 投递仍待验收。业务记录保留与 Registry blob GC 仍待开发，T23/B6 未整体结项。

Git 文件夹具补充了原生 Git shallow 拉取测试，同时验证平台的只读提交图查询。修正的是测试协议换行和 shallow 协商，不是生产 Git 客户端。

## 本轮结果

最终源码真实专项通过，143.98 秒：构建检查场景 73.45 秒，Helm 工作负载场景 70.53 秒。两个原 60 秒租约自然到期；恢复分别保留原 Pod/Job UID 和已记录的发布资源 UID，同名新 UID 连续两次被拒绝认领。

| 检查 | 结果与范围 |
| --- | --- |
| 本批真实场景 | Linux 集成二进制在 K3s 内专用 PostgreSQL 16 Pod 执行；真实固定 runner source/check、K3s、Helm SDK 与进程强杀，2 个场景通过 |
| 原强杀场景复跑 | 使用同一最终二进制重新执行文档 43 的两个场景，144.71 秒通过；未覆盖或改写此前公开证据 |
| 定向业务回归 | 隔离 PostgreSQL 下，Git/四供应商 Webhook/构建/发布 Worker/人工核对共 58 个顶层、50 个子用例通过，0 失败、0 跳过；其中远端服务为既有受控夹具，不代表供应商实际投递 |
| 原生 Git 夹具 | Windows 原生 Git shallow fetch 与 checkout、平台只读提交图查询通过；真实 runner 的 source 也通过。初期发现夹具协议错误后修正并复验 |
| 静态与包测试 | `go vet ./...`、`go build ./...`、最终集成包/夹具 vet，以及 `go test ./tests/gitfixture ./internal/build ./internal/release -count=1` 通过；未重跑全量业务套件 |
| 默认行为 | 没有显式 live 配置时新场景与内部子进程入口跳过；PowerShell 参数脚本解析通过。跳过未计作真实验收 |
| 文件与证据 | 本批 9 文件 UTF-8/空白检查、154 个本地文档链接、公开证据摘要/计数/UID 与回收状态校验通过；PowerShell 拒绝无效运行地址并在网络操作前结束 |
| 现场回收 | 最终两个新场景、原场景复跑的两个 Namespace 均自动条件回收；两次失败的空 Namespace 显式核对后条件回收；专用 PostgreSQL Namespace 确认消失 |

[公开证据](evidence/2026-11-23-workload-recovery.json)只包含测试身份、计数、时间与结果；SHA-256：`ca1bd1d04c75e73c1f70afd6570bd63714df7ddda5830b4815e6fbce8246e8ef`。

前两轮新专项仅 Helm 场景通过，构建在 Git 准入阶段失败，未进入运行。原因是测试 HTTP 客户端继承环境代理；显式禁用这条匿名夹具连接的代理后，最终两个场景通过。原生 Git 单独检查还发现夹具前缀重复换行，以及 shallow 初次协商过早发送 pack；这两项也已修正。没有放宽生产超时、重置租约或伪造成功状态。

本地日志：`D:/Temp/podry-workload-recovery-20261123/live-final.log`、`original-repeat.log` 和 `regression-final.log`；失败日志与私有数据库状态保留在同目录，不应整体提交。本批只修改验收、测试夹具、入口和记录；原有应用/历史 unknown、开发库、全局调度及并行前端文件保持原状，未暂存、提交或推送。
