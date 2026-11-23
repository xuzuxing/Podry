# 真实业务 Secret 历史版本恢复

日期：2026-11-22。补充 [历史回滚](16-release-actions.md) 的真实 Secret 证据，复用此前两份 Build Artifact，没有创建新 Build。公开记录见 [JSON](evidence/2026-11-22-secret-history-rollback.json)。本批不代表完整 T23/B6 通过。

## 验证目标与结果

在独立测试应用 ab5637b3-a81a-483f-906e-37c304178c63 下新增手动非生产目标 podry-demo-secret-verified，binding=59b6d2bf-534a-4071-94ca-7b3d3b45ec05，namespace=podry-cicd-live。旧/新镜像来自 [此前版本验收](33-live-version-upgrade-and-rollback.md)，原公网应用未重新发布。

团队级 secret 凭据 e6c4bbd2-bf47-419b-be17-a7fa92da3180 的键为 PODRY_LIVE_SECRET，三个版本使用独立随机测试值。明文只放在仓库外私有测试状态并注入验证进程，不打印或保存到公开证据。

| 步骤 | Deployment | Helm / Chart | 配置 / SecretRef | 真实结果 |
| --- | --- | --- | --- | --- |
| 旧 Artifact 晋级 | 51ace9d4-c719-485a-a192-c8f43707db84 | 1 / 1.0.0 | v11 / Secret v1 | 一个副本、旧 digest；Secret 匹配 v1；/version=404、/ping=200 pong |
| 新 Artifact 升级 | a4fac62a-b470-4cdd-a749-e05536e47bd2 | 2 / 1.1.0 | v12 / Secret v2 | 两个副本、新 digest；Secret 匹配 v2；两 Pod 的 /version=live-v2 |
| 凭据轮换到 v3 后回滚 | 0381ba05-e06a-448a-8269-9bd6bcd64633 | 3 / 1.0.0 | 历史 v11 / Secret v1 | 一个副本、旧 digest；新执行 Secret 匹配 v1，与 v2/v3 不同；/ping=200 pong |

回滚来源是第一条成功发布，kind/sourceDeploymentId 正确，归档 Chart 包与第一条一致；平台快照 SecretRef 为 1 → 2 → 1，secret_versions 的 1/2/3 均保留。回滚后凭据当前版本仍为 3，应用当前配置仍为 v12、引用 Secret v2，workflow 为 v6、binding 为 v1，成功指针指向回滚。回滚只恢复历史执行快照。

## Secret 与脱敏证据

在内存中比较归档 Helm Values 的 Secret data 和当前业务 Secret，检查 Deployment/每个当前 Pod 的 secretKeyRef、实际 imageID、Ready、副本、普通环境变量及 Pod/Service HTTP。回滚创建新的 Secret 名称和 UID。公开证据只含匹配布尔值、版本、身份和变量名，不保存明文、Base64 或单值摘要。

镜像为 scratch，没有注入调试程序或增加 Secret 查询端点；没有读取应用进程环境。因此这里只证明 Secret 数据、Pod 引用与运行状态，不能宣称应用业务逻辑已消费该值。

通过只读 SQL 核对冻结版本，并扫描当前配置/凭据元数据、应用范围历史快照、项目审计和本轮五份验收输出，三个随机值的原文/Base64 均未出现。Chart/普通业务 Values 摘要不包含运行时 Secret data。Helm release 存储本来包含运行时 Values/Secret 清单，此次在内存解码验证；其读取仍需受限权限，本轮不宣称集群已启用 Secret 静态加密。

## 首个目标的未决结果

本轮最初使用 podry-demo-secret：Secret v1 首次发布成功，随后升级 Deployment=1cffcba3-4523-4c94-8eb2-ce9b4943b78e 停在 Helm revision 2 / pending-upgrade，平台为 unknown / release_resource_identity_conflict。原 Deployment generation=1，仍指向 v1 发布 23f884aa-7e33-4ede-a025-45f04acd54a9。停止本地等待，没有重提、删除 Helm 记录或清占用。

相同测试 API 容器网络中，以准确 Chart/Values、相同 20 秒预算及 8 秒 HTTP 时限诊断。Helm 存储放在内存：拦截全部非 GET/HEAD 时，7.36 秒到达被拦截的 Secret POST；另一诊断对 Secret POST 和 Service/Deployment PATCH 强制 dryRun=All，所有 DELETE 拦截，10.749 秒完成，未持久改变工作负载。该结果没有确定原提交中断根因，不能声称已修复超时。

新独立目标完成了上表三步，原目标仍保留。加上此前 podry-job-live、podry-demo-auto，共三条 unknown 均仍占用各自目标；本轮成功没有覆盖失败历史。该 pending 升级的根因与有证据收敛仍待处理。

## 可续跑工具

扩展 [回滚验收器](../../scripts/test-cicd-rollback-live.mjs) 的可选 Secret 模式，原无 Secret 模式保留。本夹具限定一个键、历史版本 1/2、当前版本大于 2；需要两份通用验收器的成功输出。首次运行前升级必须仍为当前成功发布。通过环境变量 PODRY_LIVE_TOKEN、PODRY_LIVE_SECRET_V1、PODRY_LIVE_SECRET_V2 注入 Token 和随机测试值，不将值写入命令参数。

```powershell
node --use-system-ca scripts/test-cicd-rollback-live.mjs `
  --api http://127.0.0.1:15000 `
  --baseline D:/Temp/podry-live-cicd-20261122/acceptance-secret-verified-baseline.json `
  --upgrade D:/Temp/podry-live-cicd-20261122/acceptance-secret-verified-upgrade.json `
  --secret-credential e6c4bbd2-bf47-419b-be17-a7fa92da3180 `
  --secret-key PODRY_LIVE_SECRET --secret-current-version 3 `
  --kubeconfig docs/k3s.yaml --insecure-kubernetes `
  --output D:/Temp/podry-live-cicd-20261122/acceptance-secret-verified-rollback.json
```

POST 前保存准入证据和幂等键；同 output 第二次通过，passes=2、Request/Deployment 不变。续跑前后独立数据库全范围均为 9 Build / 11 Attempt / 7 Artifact / 2 Intent / 17 Preview / 17 Snapshot / 17 Request / 17 Deployment，没有重复任务。这包含此前成功、失败和 unknown；当前验证目标只有三条成功发布，首个目标的两条历史另行保留。

## 验证与下一步

脚本语法/help、真实阶段和续跑、SQL 历史/计数/占用、脱敏扫描和原公网 HTTPS `/ping` 通过；文档结构、链接、编码与空白另行核对。未新增 Go 业务代码、迁移、构建、服务重启或默认开关变更，未改根 web/，未暂存/提交/推送。未重跑 Go 全量集成或旧无 Secret 夹具，不将此前证据作为修改后全套回归。

只覆盖业务 Secret 当前版本变化后的历史取值；集群连接凭据/Vault 密钥轮换、撤权、强杀、响应丢失、多实例和持续健康仍待真实验收。下一步继续 pending 提交诊断与 T23 故障矩阵；生产恢复、安全 GC 和 B6 未整体完成。

后续 [请求取消与脱敏诊断](36-release-cancellation-diagnostics.md) 修复了独立可复现的请求取消丢失，并补上真实 Helm 存储读取的隔离 dry-run；仍未确定本节原 pending 的根因，目标占用与历史继续保留。
