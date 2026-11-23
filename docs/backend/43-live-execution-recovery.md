# 构建与发布进程强杀恢复验收

日期：2026-11-23。范围：T23/B6 的首次提交响应丢失、独立进程强杀、原租约恢复、凭据轮换、撤权和物理目标占用。

新增 [集成验收](../../tests/integration/execution_recovery_live_test.go) 与 [PowerShell 入口](../../scripts/test-execution-recovery-live.ps1)。没有新增 HTTP 接口、迁移或生产开关，也不修改执行器的 20 秒步骤预算和 60 秒租约。

## 验收方式

每个场景使用随机隔离数据库和 Namespace。父进程只负责准入、代理故障注入与断言；实际执行步骤在独立的测试子进程中调用生产 Build/Release `ProcessOne`。子进程使用数据库内冻结的密文凭据和执行快照，不读取本地 kubeconfig，不运行全局 Worker 调度器。

父进程建立仅供本次验收使用的回环 HTTPS 代理。代理将请求转发给真实 K3s，在上游成功创建对象、返回 201 后阻断响应。父进程收到已提交证据后调用操作系统 `Process.Kill` 终止 Worker；这里不以取消 Go context 代替进程崩溃。随后启动第二个独立进程，确认有效租约不能被领取；等待原 60 秒租约自然到期，再启动恢复进程。

代理仅允许本次 Namespace 的资源请求及必要的只读 API Discovery。真实 kubeconfig 只留在父进程内存，子进程通过数据库读取回环代理凭据；原始 SDK 输出不进入公开证据。成功后核对 Namespace 的原 UID、标签和 resourceVersion，再条件删除并等待消失；失败保留现场。数据库仍由既有随机测试数据库夹具回收。

## 场景与完成标准

| 场景 | 预期结果 |
| --- | --- |
| suspended Job 已创建，创建响应未返回即强杀 | 数据库保留 creating/owner/原租约；Job 尚未关联 UID，但真实对象已存在 |
| 有效构建租约期间启动第二进程 | 不领取任务、不增加写请求 |
| 轮换集群凭据后恢复原构建 | 继续使用冻结 v1；以原 Job UID 和 hash 收敛到 preparing，只发生一次 Job POST |
| 恢复后撤销构建请求者的项目权限 | 返回 execution_authorization_revoked；原 Job 保持 suspended，零 Artifact，无 Secret/ConfigMap 创建或解除暂停 |
| Helm 已写 pending-install 存储、响应未返回即强杀 | 数据库保持 submitting，物理目标仍由原 Deployment/fencing 占用 |
| 有效发布租约期间启动第二进程 | 不领取该目标或其后续排队发布 |
| 凭据轮换、资源授权撤销后恢复已提交发布 | 只 Observe，使用原凭据版本；保持 unknown，不伪造成功/失败、不新增 Helm revision |
| pending 发布后续任务与历史 | 第二条发布仍 queued；原 Helm Secret UID/RV 不变，目标占用/fencing 不变，当前成功指针不移动，2 Request/2 Snapshot/2 Deployment 不增加 |

## 复现

准备支持 CREATEDB 的专用 PostgreSQL；测试自行创建随机数据库，不迁移传入连接指向的数据库。默认入口通过既有 Docker 测试包装器启动一次性 PostgreSQL，并执行 vet/build。已有专用测试 PostgreSQL 时可使用 `-UseExistingTestDatabase`，连接通过 `PODRY_TEST_DATABASE_URL` 注入。

```powershell
./scripts/test-execution-recovery-live.ps1 `
  -Kubeconfig ./docs/k3s.yaml `
  -InsecureKubernetes `
  -EvidencePath 'D:/Temp/execution-recovery-new.json'
```

EvidencePath 必须不存在；每轮使用全新业务身份。仅导入当前 context 的内联 token 或客户端证书，不执行 kubeconfig 插件。Kubernetes 跳过 TLS 校验需要显式选项或 kubeconfig 原有配置，不改变 Git/Registry HTTPS 验证。

直接运行普通 Go 测试不会写入真实集群；须显式设置 `PODRY_TEST_EXECUTION_RECOVERY_LIVE=1`。内部子进程入口只打开父进程指定的 `podry_test_*` 数据库，不执行迁移。

## 证据边界

- 真实：PostgreSQL 事务、独立 OS 进程强杀、自然租约到期、K3s suspended Job、Helm SDK pending 存储写入及只读恢复、条件回收 Namespace。
- 受控：应用/用户/权限由隔离 HTTP 夹具建立；Git/Registry 是 fixture，发布 Artifact 是隔离种子。发布的故障点在 Helm 存储首次写入之后、业务对象创建之前；不代表工作负载半写入或成功部署后的崩溃恢复。
- 构建在 suspended 阶段停止，不执行 Git 拉取、检查脚本、BuildKit 或镜像推送；不证明运行中构建/推送中断及远端 BuildKit 取消。
- 凭据轮换将当前版本改为代理明确拒绝的新 token，用来验证原版本冻结。没有撤销真实集群管理员证书或轮换 Gitea/Registry 的外部凭据。
- 多进程逐步执行用于验证有效租约和目标排他，不是长期多实例部署。原有 unknown 及开发数据库完全不参与本轮。
- 只加速一个构建核对后的 next_poll_at；不修改租约、owner/revision、执行状态或目标占用。隔离目标/授权在准入前调整到本轮 Namespace。

## 本轮结果

最终真实专项通过，耗时 138.82 秒：构建场景 69.43 秒，Helm 场景 69.38 秒。两条原租约均自然到期，恢复期间没有修改 lease、owner、revision、执行状态或目标占用。

- 构建只产生一次 Job POST；恢复关联原 UID 后，撤权阻止准备/启动，原 Job 保持 suspended，零 Artifact。
- 发布只产生一次 Helm Secret POST；强杀点确认为 pending-install。轮换凭据并撤销平台资源授权后，新进程仍读到原 Helm revision 1，只读核对保留 unknown；原 Secret UID/RV、fencingToken=1 和当前指针不变。
- 同目标第二条发布保持 queued，2 Request / 2 Snapshot / 2 Deployment 无新增。有效租约期间，第二进程不能领取任务。
- 两个最终 Namespace、前两次失败的专用 Namespace，以及临时 PostgreSQL Namespace 均已确认消失。没有操作既有应用、开发数据库或历史 unknown。

[公开证据](evidence/2026-11-23-execution-recovery.json)仅包含身份、计数、结果和时间，SHA-256：`c2878899ca7aa09f3c9e6cccb9ff0f200052b295e160085d5a1370b91c0f15bb`。

| 检查 | 结果与边界 |
| --- | --- |
| 最终真实集群专项 | Linux 编译后二进制在一次性 PostgreSQL 16 Pod 内执行；真实 K3s、2 个场景通过；子进程执行真实生产 Worker/Helm SDK |
| 构建/发布/人工核对定向回归 | 同一独立 PostgreSQL 内 38 个顶层、30 个子用例通过，0 失败；Git/Kubernetes/Registry/Executor 使用原有受控 fixture，不替代真实执行证据 |
| 静态/内部检查 | `go vet ./...`、`go build ./...`、最终 `go vet ./tests/integration`、`go test ./internal/build ./internal/release -count=1` 通过 |
| 默认入口 | 无显式 live 配置时，两条新增测试均跳过；PowerShell 解析通过。未将跳过视为真实验收，也未宣称默认 Docker 包装器本轮通过 |
| 文档与公开证据 | 本批 6 文件 UTF-8/空白、150 个本地链接及公开证据身份/revision/回收断言通过；证据不含凭据 payload、密钥或数据库连接信息 |
| 编译快照 | 定向回归二进制早于最后追加的 pending-install / 原 Helm revision 两项 live 断言；生产代码一致，最终真实专项已重新编译并覆盖这两项断言。没有重跑全量业务套件 |

首轮 Windows 经远端 PostgreSQL 转发执行，构建场景通过，Helm 场景未达到预定强杀点；改用集群内数据库后的旧快照复跑也未通过 Helm 场景。原因在新验收代理：按 JSON 解析 typed Secret 响应，未显式处理 client-go 的内容协商。代理强制请求 JSON 后真实专项通过，随后追加原 revision 读取断言并以最终源码重新通过；没有扩大生产步骤预算或租约。两次失败不计入通过结果。

本地原始日志与私有状态位于 `D:/Temp/podry-execution-recovery-20261123`，不能整体提交。公开证据对应 `live-final.log`；定向回归为 `regression-linux.log`。本批只新增验收代码、入口和记录，没有修改生产执行器。

T23/B6 仍需工作负载部分写入、运行中强杀、替换 UID、远端凭据失效、多实例长跑及生产恢复等剩余矩阵，不能据此整体结项。
