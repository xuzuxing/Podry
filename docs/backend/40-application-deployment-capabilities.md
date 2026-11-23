# 应用部署与生命周期

后续更新：2026-11-23 已在独立数据库/API 和专用 K3s 命名空间完成检查阶段、鉴权镜像拉取、配置/探针/PVC、下线重装及解绑验收，修复生成 ConfigMap 的资源读取遗漏；结果、证据和未覆盖边界见 [真实部署能力验收](41-live-deployment-capabilities.md)。下文保留首次业务实现批次的测试与环境记录。

日期：2026-11-23。基线：数据库 v20，OpenAPI V1.25.0 / 81 个操作。保存配置不执行流水线，各 Worker 默认关闭。本批测试使用隔离 PostgreSQL、模拟 Kubernetes 与 Helm SDK，不代表真实集群验收。

## 1. 部署配置

新增不可变 Chart **1.2.0**；1.0.0/1.1.0 包与摘要保持不变。新字段必须显式选择 1.2.0，历史回滚使用来源包、digest、配置与 Secret 版本。以下为 base 分节提交示例，expectedVersion 取当前配置版本。环境 overrideValues 同样校验，对象递归合并、数组整体替换。

~~~json
{
  "expectedVersion": 3,
  "section": "base",
  "chartConfig": {"workloadKind": "Deployment", "chartVersion": "1.2.0"},
  "deployValues": {
    "containerPort": 8080,
    "command": ["/app"],
    "args": ["serve"],
    "readinessProbe": {"httpGet": {"path": "/ping", "port": 8080}, "periodSeconds": 5},
    "livenessProbe": {"tcpSocket": {"port": 8080}, "initialDelaySeconds": 10},
    "startupProbe": {"httpGet": {"path": "/ping", "port": 8080}, "failureThreshold": 30},
    "configMountPath": "/etc/podry/config",
    "configFiles": {"app.yaml": "mode: demo"},
    "volumes": [
      {"name": "settings", "mountPath": "/settings", "readOnly": true, "configMap": {"name": "shared-settings"}},
      {"name": "tls", "mountPath": "/tls", "readOnly": true, "secret": {"secretName": "app-tls"}},
      {"name": "data", "mountPath": "/data", "readOnly": false, "persistentVolumeClaim": {"claimName": "app-data"}}
    ]
  },
  "secretRefs": []
}
~~~

| 字段 | 实现边界 |
| --- | --- |
| command / args | 各至多 64 项，每项至多 4096 字节；拒绝 NUL；Deployment/Job 均支持 |
| 三类 Probe | Deployment 的 HTTP/TCP 探针，数字端口，非空对象恰好一个 handler；不支持 exec、headers、host 或命名端口；空对象禁用；Job 拒绝探针 |
| configFiles | 普通非敏感文件，至多 50 项、总计 128 KiB、安全文件名；生成每次执行独立的只读 ConfigMap。内容不加密，关键词过滤不能识别所有秘密；敏感内容应使用已有 Secret |
| volumes | 至多 16 项，每项恰好一个已有 ConfigMap/Secret/PVC，来源限同 Namespace；明确 readOnly，ConfigMap/Secret 强制只读 |
| 路径 | 绝对规范路径，不重名/重叠；拒绝根/系统/ServiceAccount 凭据目录、hostPath、subPath、任意 PodSpec |

准入、确认、回滚和 Worker 重验挂载权限。ConfigMap 需要 resource.view；Secret 需要 resource.view + secret.reveal；PVC 需要 resource.view，可写另需 resource.write。引用资源需预先存在，不进入平台所有权，下线不会删除它们。

## 2. 私有镜像拉取

1.2.0 为带凭据产物生成独立 dockerconfigjson Secret，并加入工作负载 imagePullSecrets。外部导入镜像使用 Artifact 的冻结凭据版本；构建镜像读取来源 Attempt 的不可变执行快照，核对执行 hash、应用与镜像仓库身份。不会改用当前 Registry 设置。

预览、数据库快照与审计仅存凭据引用、Registry authority 和脱敏占位。Worker 提交前重验当前作用域，将精确版本解密到临时 Values。轮换不改变旧快照或历史回滚，撤权阻止新提交。无凭据产物匿名拉取；旧 Chart 需显式升级。

集群 Secret 与 Helm release storage 保存实际执行值，需依靠集群访问控制。节点 DNS、Registry CA 信任和网络仍由集群配置保障；imagePullSecrets 不配置 CA，也不跳过 TLS。

## 3. 构建检查

可选 BuildConfig.checkScript：非空且至多 16384 字节，随 Attempt 冻结，重试沿用。Job 顺序为 source init → check init → build 主容器；在校验后的构建 context 中以 sh -eu -c 执行。失败/超时阻止镜像阶段，Job 不自动重试，不能生成成功 Artifact；日志包含 check。

检查容器共享源码，只读挂载执行输入、使用独立临时目录；不挂载 Git/Registry/集群认证或 SA token，不继承进程秘密。使用固定 runner 已有工具，不自动安装 Go/Node，不提供网络隔离或任意脚本沙箱。

**启用前需重新构建部署 runner 镜像，并更新固定 digest。** 旧 runner 不支持 check 模式；语言测试需将工具链加入受控 runner。本批没有发布镜像或修改真实流水线。

## 4. 下线与解绑

均要求 Idempotency-Key，正文示例：

~~~json
{"expectedVersion": 1, "reason": "停止使用测试环境"}
~~~

| 方法与路径 | 返回 | 业务语义 |
| --- | --- | --- |
| POST /api/apps/{appId}/environments/{bindingId}/offline | 202 ReleaseRequest | 持久 offline 任务；冻结当前成功来源的 UID、Helm revision 与快照 hash |
| POST /api/apps/{appId}/environments/{bindingId}/detach | 200 {bindingId,detached,version} | 软解绑，隐藏当前绑定/CD，保留历史和物理目标预约 |

下线需要 app.deploy、成功来源、完整 UID、目标 resource.write/resource.delete 和 Pod 读取权限。queued/active/unknown 或未确定的资源操作阻止准入。同事务关闭 autoDeploy/CD，提升 binding/workflow 版本，使旧预览和自动部署意图失效；之后重新启用 CD 是显式新操作。

Worker 每步重验授权，先删工作负载，再删来源快照拥有的 Service/Ingress/生成配置与 Secret。DELETE 使用冻结 UID 和刚读取的 resourceVersion，Foreground 后再读确认消失。Secret 需完整消费者清单证明无人使用；上游缺少 list 权限保留 unknown。已有 PVC、借用配置/Secret、证书 Secret 保留。

来源 Helm 身份/revision 一致、所列资源和绑定 Pod 均消失后，标记 Helm 历史 uninstalled、确认成功并清空 currentDeploymentId。替换 UID、finalizer、残留 Pod、不完整清单、响应丢失均保留 unknown/目标占用。显式部署 reconcile 保持只读，不重发删除。相同绑定重新启用 CD 后可通过 Helm replace 安装新版本；历史来源不清除。

解绑额外需要 app.configure。未发布过的绑定可直接解绑；有任何发布快照时要求最近一次成功 offline、没有后续发布且 currentDeploymentId 为空。失败/unknown 不能绕过。解绑不访问集群；相同逻辑环境可绑定不同目标，**原物理目标仍被历史预约，不能转给另一应用**。

成功 offline 在应用列表投影 stopped，表示最近一次已核对结果，不证明之后没有集群外部写入；解绑环境不参与健康聚合。整个应用可逐环境处理后归档，没有批量下线或硬删除接口。

v20 仍为 36 张业务表，增加 detached_at、active binding 部分唯一索引和 offline lineage/reason 约束；有 offline/解绑历史拒绝降级。正式迁移以 internal/database/migrations 为准，[schema.sql](../data/schema.sql) 是设计稿。

## 5. 验证与待验收

测试覆盖新 Chart 渲染/旧包兼容、配置拒绝、挂载权限、两类产物凭据冻结/轮换/回滚及脱敏、检查隔离、下线准入/unknown/幂等/解绑/历史保留、UID 条件删除、finalizer/残留 Pod/不完整清单及 Helm 下线后重装。检查脚本另用 Linux 容器验证成功、失败、环境隔离和超时。

真实集群的私有拉取、探针、PVC、runner、下线重部署仍待验收。本批未迁移开发数据库、未重启服务或修改用户集群。历史 Job/旧资源继续适用[自动清理策略](39-resource-cleanup.md)；阻挡 Pod/Secret 消费者核对的历史资源需先处理。未提供强制解锁、Registry GC、数据盘清除或针对集群外部写入的分布式锁。
