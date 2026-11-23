# 资源清理 Worker 真实集群专项验收

日期：2026-11-23。按照 [清理合同](39-resource-cleanup.md)，在独立 PostgreSQL 数据库和随机 K3s namespace 中执行生产代码的 `ProcessBuild` / `ProcessRelease`，验证日志门槛、删除确认、引用保护和历史保留。公开结果见 [脱敏证据](evidence/2026-11-23-resource-cleanup.json)。

这是**真实 Kubernetes 清理步骤 + 受控业务记录夹具**：Job、Pod、日志、UID/RV 条件删除、Foreground GC 和引用列举均来自真实集群；执行成功记录、当前指针及保留期时间来自隔离测试种子。没有运行新一轮 Git/BuildKit 或 Helm，也没有实际等待七天。已有真实 CI/CD 及日志归档执行证据仍以 [部署能力验收](41-live-deployment-capabilities.md) 为准。

## 实际结果

| 验收项 | 结果 |
| --- | --- |
| 独立测试范围 | `podry-cleanup-live-bc60a1e0`，namespace UID `e977e7ff-5042-4669-a7cd-f3a1ce2e8844`；验收结束后已确认 namespace 消失 |
| 构建日志门槛 | 未归档时 `cleanup_logs_unarchived`，Job 无删除时间；清理次数与五分钟后重试调度已持久化 |
| 未确认删除 | Job 注入专用测试 finalizer，Worker 发起删除后仍记录 `cleanup_deletion_unconfirmed`，不写成功时间 |
| 解除测试阻塞 | 验收器只移除自己加入的 finalizer，保留 Kubernetes finalizer；随后 Job、所属 Pod、`-auth` Secret、`-spec` ConfigMap 均消失 |
| 构建日志保留 | 实际完成 Pod 的日志转换为 NDJSON 测试归档并冻结长度/摘要；清理后仍由生产 `ReadLogs` 成功读取，内容一致 |
| 当前发布保护 | 超过七天但仍是当前发布时没有候选，不发生回收 |
| 旧 Secret 引用保护 | 新成功发布替代后，旧 Job 被回收；零副本 ReplicaSet 的 `envFrom.secretRef` 仍阻止旧 Secret 删除，记录 `cleanup_resource_referenced` |
| 解除引用后继续回收 | 按原 UID/RV 删除测试 ReplicaSet，再执行同一旧发布清理；旧 Secret 消失，当前 Job/Secret UID 不变 |
| 非候选资源保留 | 借用 ConfigMap 与带 `owner=helm`、`helm.sh/release.v1` 类型的存储哨兵 UID 不变；后者是测试哨兵，并非真实 Helm revision |
| 历史保留 | 清理前后均保留 2 Build / 2 Attempt / 2 Artifact / 2 Request / 2 Snapshot / 2 Deployment / 4 deployment_resources；当前发布指针不变 |
| 审计 | `build.resources.cleanup` / `deployment.resources.cleanup` 共 2 次 succeeded、3 次 unknown；unknown 表示暂缓证据，不改变业务执行状态 |

执行镜像固定为已构建的一次性 Job 镜像：`registry.podry.dev/podry-live/podry-job@sha256:b9cd7434b07ce6e4a004c0c40f99711411c09ec2cf59dec8e6c86a462e33e0b3`。发布快照通过现有 HTTP preview/confirm 冻结，使用 Chart 1.2.0；测试种子只记录真实创建对象的 UID，未修改不可变快照、Artifact 或历史构建身份。

## 复跑入口

新增 [专项用例](../../tests/integration/cleanup_live_test.go) 和 [PowerShell 入口](../../scripts/test-resource-cleanup-live.ps1)。默认 `go test` 跳过集群写入，必须显式执行入口或设置 `PODRY_TEST_CLEANUP_LIVE=1`。入口只读取 kubeconfig 当前 context 的内联 token/证书，不执行认证插件，不输出凭据。

```powershell
./scripts/test-resource-cleanup-live.ps1 `
  -Kubeconfig ./docs/k3s.yaml `
  -InsecureKubernetes `
  -ImageRef 'registry.podry.dev/podry-live/podry-job@sha256:b9cd7434b07ce6e4a004c0c40f99711411c09ec2cf59dec8e6c86a462e33e0b3' `
  -EvidencePath 'D:/Temp/cleanup-new-run.json'
```

镜像必须是匿名可拉取、无需参数即可成功退出的有限 Linux/amd64 程序；不能替换为长驻 Web 进程。`EvidencePath` 必须是已有目录下的新文件，每次运行建立新的数据库和 namespace，不复用旧执行身份。`-InsecureKubernetes` 仅影响本次 K8s 连接。

默认入口复用后端测试脚本：Docker 启动临时 PostgreSQL，执行 `go vet/build` 和该专项。也支持 `-UseExistingTestDatabase`，从进程环境读取 `PODRY_TEST_DATABASE_URL`，要求指向专用、允许 CREATEDB 的测试 PostgreSQL；用例仍创建随机数据库，不迁移或清空该 URL 指定的数据库。此模式只执行专项测试，vet/build 单独运行。

本次 Docker 引擎无响应，临时测试数据库准入超时，最终改用 `podry-cleanup-db-2c710196` 内的 PostgreSQL 16，经本机端口转发完成验收。该 PostgreSQL namespace 和之前两次夹具准入失败遗留的测试 namespace 均已按原身份回收。没有重启 Docker 或修改原测试 API。

成功后先确认测试 namespace 消失，再写入公开证据。失败时保留本次 namespace 供检查，不强制清除 finalizer；隔离数据库与本地归档由测试框架回收。原始运行日志在本机 `D:/Temp/podry-cleanup-live-20261123/run-k3s.log`，私有连接配置不随公开证据提交。

## 验证与边界

- 最终 `TestResourceCleanupLive` 通过，268.46 秒；覆盖真实 K3s 清理步骤和独立 PostgreSQL 持久调度/审计。成功证据中 `namespaceRemoved=true`。
- `go vet ./...`、`go build ./...`、`go test ./internal/cleanup ./internal/kubernetes -count=1` 通过；Linux 集成测试二进制编译通过，PowerShell 入口语法检查通过。未将此次专项描述为全量业务回归。
- 本轮没有修改生产清理策略、数据库版本、HTTP 合同或默认执行开关，未启用开发服务清理。既有应用与历史 unknown 未参与回收；`web/` 和并行前端文档未修改，未暂存、提交或推送。
- 本轮使用受控记录加速 24h/168h 门槛，并手动调用有界清理步骤；不证明七天真实时间流逝、30 秒调度节拍、多实例共享归档、生产恢复或真实 Helm 升级后的所有历史组合。归档由实际 Pod 日志准备，未重跑生产归档 Worker。
- 响应丢失、同名新 UID、权限失败、不完整引用列表等仍以既有隔离 PostgreSQL/模拟 API 回归为证据，真实故障注入继续待办；CRD/外部并发写入引用、业务记录保留策略和 Registry blob GC 仍未覆盖。T23/B6 没有整体结项。
