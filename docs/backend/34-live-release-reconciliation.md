# 真实 unknown 发布人工核对

日期：2026-11-22。继续 T23/T24 真实恢复验收，使用 [人工核对接口](26-release-reconciliation.md) 处理两条已有 unknown。公开证据见 [JSON](evidence/2026-11-22-release-reconciliation.json)。没有重提 Helm、改 SQL 状态或清除占用。

## 环境与隔离

沿用独立 PostgreSQL v17、K3s 的 podry-cicd-live 命名空间及历史。原测试 API 的 Worker 持续观察 unknown，会改变 revision 并持有租约；先优雅停止该专用 API，再用相同二进制、数据库与密钥启动临时 API（本机 15001），显式关闭 build、release、resource writes、health polling 四个开关。

核对前通过只读 SQL 确认没有有效租约，未删除 lease 或抢占目标。完成后停止并移除临时 API，恢复原测试 API，确认原 API 能读取历史、公网 HTTPS `/ping` 仍返回 200 pong。数据库和集群资源保留，开发实例、默认配置和前端未改。

## 实际结果

| 目标 / Deployment | 集群读取结果 | 人工核对结果 |
| --- | --- | --- |
| podry-job-live / ab649289-cfbe-4b2d-b9f4-7a30a1f36ae2 | 无该 release 的 Helm Secret，也无所选根 Job/Service | unknown / release_outcome_unknown；revision 785 → 786；fencing=1；成功指针仍为空 |
| podry-demo-auto / 6ab5a26c-80aa-4782-b792-0410abbc8051 | 仅 revision 1 的 deployed Helm Secret；原 Deployment/Service UID、generation/spec 未变 | unknown / release_resource_identity_conflict；revision 208 → 209；fencing=2；成功指针仍为 d93568b2-a110-45b4-827b-163ed03954ca |

两条 activeDeploymentId 均保留。表中 revision 是暂停 Worker 后的验收快照，后台恢复后可继续增加。缺少 Helm Secret 或新 revision 不能证明请求从未写入，不能据此释放 unknown。

两条发布均通过以下真实 HTTP 检查：

- 全部后台开关关闭，POST reconcile 仍返回 200、有效 checkedAt、targetReleased=false，revision 增加一次。
- 同键同请求立即重放及同 output 第二次运行，响应字节摘要相同；每条有效验收只新增一条 deployment.reconcile 审计。
- 同键改理由返回 409 idempotency_conflict；新键使用旧 revision 返回 409 revision_conflict。
- 冻结请求、Artifact、镜像、配置版本、来源和开始时间保持；成功指针不变。
- 成功预发发布向 podry-demo-auto 晋级返回 409 target_busy，没有留下新 Preview、Snapshot、Request 或 Deployment。

隔离数据库全范围计数前后相同：9 Build、11 Attempt、7 Artifact、2 Intent、12 Preview、12 Snapshot、12 Request、12 Deployment。这些包含历史失败/unknown，不代表全部成功。

前后比较 Helm Secret 名称、UID、resourceVersion、version/status，以及实例标签选中的 Deployment/Job/Service UID、generation 和完整 spec 摘要，结果一致。只保存元数据与摘要，不保存 Secret data、Helm Values、Token 或 kubeconfig。该比较支持“未观察到 Helm 记录/根配置变化”，不能替代集群审计或证明没有任何短暂外部写入。

## 可续跑验收器

新增 [test-cicd-reconciliation-live.mjs](../../scripts/test-cicd-reconciliation-live.mjs)。要求已有 unknown 和暂停领取任务的测试环境；Token 从 PODRY_LIVE_TOKEN 注入，API 禁止重定向。调用方需确认本机 kubeconfig 对应绑定 clusterId 的实际集群。

```powershell
node scripts/test-cicd-reconciliation-live.mjs `
  --api http://127.0.0.1:15001 `
  --deployment 6ab5a26c-80aa-4782-b792-0410abbc8051 `
  --kubeconfig docs/k3s.yaml --insecure-kubernetes `
  --output D:/Temp/podry-live-cicd-20261122/acceptance-reconcile-verified-6ab5a26c-80aa-4782-b792-0410abbc8051.json
```

首次 POST 前保存原 revision、幂等键、目标和集群元数据；响应丢失后复用 output。后续重放原操作，不用新 revision 创建另一核对。工具不暂停 Worker、启动服务、改 SQL 或解锁目标；隔离和数据库只读计数由本轮外部编排完成。临时端口已关闭，复现需重新提供独立实例。

首轮脚本误从绑定顶层读目标，实际 DTO 位于 binding.target，导致读取错误命名空间。已修正并增加必需字段校验，废弃首轮集群比较，使用新证据文件重新完整验证。首轮已实际完成的 Job 核对和审计保留，不删历史；因此 Job 审计累计 2、自动目标累计 1，有效验收各增加 1，重放没有新增审计。首轮失败后同样恢复了原测试 API。

## 验证与边界

脚本语法/help、两条真实核对各两次续跑、冲突请求、只读数据库计数/占用/审计、服务恢复和公网 HTTPS 检查通过。文档结构、链接、空白、编码和敏感值检查另行执行。本轮只新增验收器与记录，未修改 Go 业务实现或重跑 Go 全量集成。

尚未证明 unknown 最终收敛成功；在途强杀、响应丢失、多实例、权限撤销/凭据轮换、业务 Secret 历史恢复和持续健康真实验收仍待推进。生产备份恢复、安全 GC 和完整 T23/B6 未结项。
