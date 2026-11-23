# 部署能力与环境生命周期真实验收

日期：2026-11-23。基线：数据库 v20、36 张业务表、OpenAPI V1.25.0 / 81 个操作。[部署与生命周期](40-application-deployment-capabilities.md)中的新增能力已在独立数据库/API 和专用 K3s 命名空间完成本页限定的真实验收；T23 故障矩阵与 B6 仍未整体结项。

公开记录见[脱敏证据](evidence/2026-11-23-deployment-capabilities.json)，可续跑入口为 [test-deployment-capabilities-live.mjs](../../scripts/test-deployment-capabilities-live.mjs)。没有向数据库插入模拟 Artifact 或直接修改业务状态。

## 1. 实际结果

| 路径 | 本次证据 |
| --- | --- |
| 检查失败 | 独立应用的真实 Git 源码检查脚本执行 `exit 23`，runner 将失败统一映射为 exit 1；Job/Build 失败，build 主容器未成功执行，Artifact 数量为 0；日志包含 source/check |
| 检查成功 | 新 runner 按 digest 固定，source → check → build 均成功；检查验证源码存在、无认证挂载和 SA token；真实 BuildKit 推送并生成 Artifact，日志 archived |
| 私有仓库 | 专用 Registry 通过 bcrypt htpasswd 认证，匿名 manifest 返回 401，认证读取返回 200，原始 manifest SHA-256 与 Artifact 相符，config/layers 可读；Registry 日志记录 containerd 成功读取相同 digest |
| 拉取负对照 | 无 imagePullSecrets 的独立 Pod 以 Always 策略拉取同一 imageRef，Kubelet 返回 `authorization failed / no basic auth credentials`；该 Pod 随后使用 UID 条件删除 |
| 部署 | 平台从构建 Attempt 冻结凭据生成 dockerconfigjson Secret；真实 Helm 安装 Chart 1.2.0，Pod Ready、imageID 正确；Service `/ping` 为 200 pong，embed 首页为 200 |
| 配置与挂载 | readiness/startup HTTP 探针、liveness TCP 探针存在；生成 ConfigMap 内容与配置一致；已有 ConfigMap/Secret/PVC 挂载路径及只读设置匹配；local-path PVC Bound |
| 首次下线 | 业务 offline 接口关闭 CD，持久 Worker 执行 UID/RV 条件删除；先经历暂时 unknown，再确认所有托管资源及 Pod 消失；当前发布指针清空，应用健康为 stopped，Helm revision 1 标记 uninstalled |
| 下线后重装 | 通过业务 API 将相同私有镜像导入为 external Artifact，显式重新启用 CD，再预览/确认；同绑定通过 Helm replace 安装 revision 2，Pod Ready，生成新的拉取 Secret 和配置资源 |
| 再次下线及解绑 | revision 2 成功下线，资源消失后软解绑；活动绑定/CD 隐藏，四条 Deployment 历史均可读取；借用的 ConfigMap、Secret、PVC UID 保持不变 |
| 幂等续跑 | 同一 output 重放下线/解绑并核对历史；数据库前后均为 2 Build、2 Attempt、2 Artifact、4 Request、4 Deployment，Helm 仍为 revision 2；未新增执行 |

构建与导入 Artifact 的 imageRef 相同，来源分别为 build / external；这验证两条凭据读取路径，不代表不同版本升级或凭据轮换验收。脚本只保存身份、状态、摘要和必要的配置元信息，不保存认证数据或原始日志。

## 2. 本轮发现并修复的问题

Chart 1.2.0 生成的 ConfigMap 已成功下发，但应用资源读取的固定类型白名单遗漏 ConfigMap，导致 `/api/apps/{appId}/resources` 返回 `503 release_resource_invalid`，实时 Diff 与健康读取也受影响。

[internal/resource/owned.go](../../internal/resource/owned.go) 补齐 v1/ConfigMap 映射，沿用原有 UID 校验、授权过滤与只读投影。回归用例覆盖真实 PostgreSQL 和模拟 Kubernetes 下的资源展示、Diff、同名 UID 替换，以及撤销 ConfigMap 读取权限后不向上游读取内容。修复后在本轮真实实例读取资源和 Diff 成功，继续沿用原 Build/Deployment 验收。

验收器同时适配 Kubernetes 为卷添加 defaultMode、将 readOnly=false 省略、runner 归一化失败退出码及 containerd 的授权失败文字；这些修正没有改变业务执行结果。[基础 CI/CD 验收器](../../scripts/test-cicd-live.mjs)新增不同 CI/CD namespace 和私有 Registry 验证选项，默认匿名路径保持兼容。

## 3. 环境和复现

| 对象 | 本轮配置 |
| --- | --- |
| 本机私有状态 | D:/Temp/podry-capabilities-live-20261123；含环境文件、Token、随机测试密码，仅留本机，不得整体提交 |
| 独立 API / 数据库 | podry-capabilities-api-20261123 / podry-capabilities-db-20261123；宿主 API 仅监听 127.0.0.1:15001 |
| CD Namespace / release | podry-capabilities-live / podry-capabilities |
| CI / BuildKit | 复用 podry-cicd-live 中的 BuildKit；新测试 Build 使用新 runner，不改变既有冻结执行输入 |
| runner | registry.podry.dev/podry-live/runner@sha256:4018401f7eace2740a2721850bd2053d9ebc7ccd0de745779c3254c864dd649d |
| 专用鉴权仓库 | registry.podry.dev/podry-auth-20261123/*；新的窄路径 Ingress 转至专用 Registry，沿用现有测试 CA，Registry 数据独立 PVC；共享 `/v2/` 仍返回 200 |
| 借用资源 | borrowed-settings、borrowed-secret、borrowed-data；下线/解绑后保留 |

本机 DNS 和 Gitea/Registry TLS 已直接可用；当前 Kubeconfig 使用的 API 地址不在证书 SAN 内，集群连接沿用用户授权的 insecureSkipTLSVerify。Registry HTTPS 校验始终启用，runner、BuildKit 与节点继续使用原测试 CA 信任。没有改系统 hosts、共享 Zot 配置、已有应用或历史 unknown 目标。

复现前需准备独立 API/数据库、上述鉴权基础设施及两个专用应用：成功应用使用 Chart 1.2.0、三类探针、configFiles 和三种借用挂载；失败应用检查脚本返回非零；CI 构建输入指向已发布 runner。通过环境变量注入后端 Token 和与指定 Registry authority 匹配的账号密码，然后执行：

~~~powershell
node --use-system-ca scripts/test-deployment-capabilities-live.mjs `
  --api http://127.0.0.1:15001 `
  --app APP_UUID --failure-app FAILURE_APP_UUID --binding BINDING_UUID `
  --registry REGISTRY_UUID --build-namespace podry-cicd-live `
  --kubeconfig docs/k3s.yaml --insecure-kubernetes `
  --output D:/Temp/private-acceptance/evidence.json
~~~

Node 需支持 fetch/parseArgs；环境变量名称和前提可用 `--help` 查询。已有完成记录使用相同 output 续跑；不要以新 output 绕过 unknown 或复用其他应用的输入。脚本会下线并解绑所选测试绑定，并保留其历史和借用资源。新的一轮完整验收需另建专用应用/绑定。

## 4. 验证范围与后续

- `scripts/test-backend.ps1 -Native -TestPattern 'TestApplicationResources|TestDeploymentCapabilities|TestApplicationLifecycle|TestBuildCheckScript'` 通过，含 go vet/build、独立 PostgreSQL 和新增 ConfigMap 读取回归；日志在本机 D:/Temp/podry-capabilities-live-targeted-20261123.log。资源/应用包单元测试及 Linux 服务构建通过。本轮没有重复运行前批完整套件。
- 真实 CI/CD 和生命周期脚本通过，并在解绑后同 output 完整续跑通过；公开证据独立核对数据库计数、容器运行时的 Registry 读取及最终资源清单。
- 验收结束时测试应用已下线并解绑。独立 API/数据库、鉴权 Registry、两块 PVC、借用配置/Secret、Helm 历史和构建记录保留，便于继续核对。开发数据库没有迁移，web/ 及并行前端文档没有处理，未暂存/提交/推送。

本轮仅一个节点、同一 Registry 与测试 CA。检查脚本使用现有 shell 工具，未加入 Go/Node 工具链；探针验证配置和 Ready，未注入故障恢复；PVC 验证 Bound/挂载，未验证应用文件读写、存储故障和数据保留策略。真实凭据轮换/撤权、历史回滚、节点重启 CA 持久性、外部并发写入、多实例强杀恢复、生产备份恢复，以及[自动清理](39-resource-cleanup.md)的真实集群矩阵继续待验收，Registry GC 和业务记录保留策略仍待开发。
