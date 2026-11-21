# 多环境绑定与覆盖

日期：2026-11-21。提前实现 E03 的离线业务路径；真实 CI/CD、B6 与跨环境执行验收仍待基础设施恢复。正式数据库迁移升级为 v8，OpenAPI V1.9.0，76 个操作中 63 个已实现、13 个未注册。构建和发布 Worker 仍默认关闭。

## 业务入口

| 入口 | 行为 |
| --- | --- |
| `POST /api/apps/{appId}/environments` | 创建独立绑定及物理目标，返回 Binding；不创建 CD、不修改 workflowVersion、不执行发布 |
| `PUT /api/apps/{appId}/environments/{bindingId}` | 校验 expectedVersion，整体替换 overrideValues，绑定 version 加一；保留当前成功发布指针 |
| `POST /api/apps/{appId}/workflow-templates`，`template=add_deploy` | 复用本应用已有 CI，原子新增 Binding/CD，workflowVersion 加一；复用原有幂等事务 |
| `PUT /api/apps/{appId}/pipelines` | 给独立绑定显式增加 CD；仍限制每应用一个 CI、每绑定一个 CD |

新增绑定要求已保存基础部署配置，允许基础配置之外的 Git/Build 仍未完成。add_deploy 要求已有 CI 和 Git/Build/Base，不能同时传 ci；deployment.definition.upstreamPipelineId 可为 null，由服务端解析为已有 CI。生产与开发环境当前均只允许 manual / autoDeploy=false；external_image、image/clone、push/on_ci_success 尚未开放。

环境、clusterId、namespace、releaseName 在创建绑定时固定。PUT 不接受 target/environmentId，严格 JSON 解码返回 422。本批不提供解绑/删除或迁移现有发布目标；跨环境添加应创建新绑定。独立绑定不是完整管线，页面应在显式创建 CD 后展示完整发布流程。

已有 CI 时，新增生产环境 CD 的请求示例（UUID、版本和目标需替换为实际值，携带 Bearer 与 Idempotency-Key）：

```json
{
  "template": "add_deploy",
  "expectedConfigVersion": 3,
  "expectedWorkflowVersion": 1,
  "deployment": {
    "binding": {
      "environmentId": "e1000000-0000-4000-8000-000000000002",
      "target": {
        "clusterId": "c1000000-0000-4000-8000-000000000001",
        "namespace": "production",
        "releaseName": "podry-demo-prod"
      },
      "overrideValues": { "replicaCount": 2 },
      "autoDeploy": false
    },
    "definition": {
      "triggerMode": "manual",
      "upstreamPipelineId": null,
      "deployTimeoutSeconds": 600
    }
  }
}
```

修改绑定的 PUT 请求（expectedVersion 来自绑定列表，与配置/工作流版本分别管理）：

```json
{
  "expectedVersion": 1,
  "overrideValues": {
    "replicaCount": 3,
    "env": { "APP_MODE": "production" },
    "resources": { "requests": { "cpu": "100m", "memory": "128Mi" } }
  },
  "autoDeploy": false
}
```

## 覆盖规则

合并次序为 Chart 默认值 → 基础 Values → 当前绑定 overrideValues → 平台固定镜像 digest/身份。overrideValues 使用内置 Chart 的受控字段：Deployment 可设副本、端口、资源、普通 env、Service/Ingress；Job 仍禁止 Deployment/Service/Ingress 字段，保留单任务限制。

- PUT 替换整个覆盖对象；传 `{}` 恢复基础配置继承。未出现的覆盖字段继承基础值。
- 对象逐层合并，标量替换；嵌套 `{}` 不清除基础对象，null 不代表删除，直接拒绝。
- 禁止镜像、标签/所有权、任意 Pod 模板、Secret 明文与未识别字段；普通 env 不得碰撞基础 SecretRef.targetKey。
- 对覆盖本身和合并结果均校验；Ingress 依赖启用的 Service 与有效 host。基础配置保存时也检查所有绑定，防止破坏现有环境的合并结果。
- 每次合并复制对象，不修改基础配置或其他环境。绑定读取返回实际保存的覆盖，而不是空对象占位。

## 权限、并发与发布

写接口要求 app.configure，沿用 actor/team/project/application 锁与审计事务。创建检查合并后资源的 resource.write，更新检查新旧两套配置所涉及的资源。启用 Service/Ingress 时不能只凭 Deployment 的 grant；取消这些覆盖也需要原资源权限。配置保存不额外要求 Helm 存储 Secret 权限，真实发布预览/确认仍要求它。

数据库同时约束应用/环境唯一、物理 cluster/namespace/release 唯一、一个目标只归一个绑定。冲突返回 409 target_conflict，整个事务回滚，不能留下无主目标。更新绑定的 expectedVersion 必须与当前版本一致；并发相同版本只有一个成功，另一个返回 revision_conflict。

排队、submitting、observing、unknown 或仍有 active_deployment_id 的目标拒绝覆盖更新，返回 target_busy；不释放占用或 fencing token。保存覆盖不改变 currentDeploymentId，也不宣称线上配置已经改变。绑定 version 自动使旧健康观察失效。

发布预览在同一短事务中取得配置版本、绑定版本和合并结果，事务外渲染，落预览时再次重验版本和授权。合并结果冻结在 Chart.Values/Manifest 中；未改变 release.Plan 字段顺序、快照 schemaVersion 或历史校验规则。确认校验绑定版本，绑定更新后的旧预览返回 revision_conflict；重放已确认请求仍检查冻结资源的当前权限。setup 发布候选、工作流保存同样使用每个绑定的合并结果，Worker 继续从不可变快照执行。

## 迁移与验证边界

显式执行 `podry migrate up` 应用 000008；API 启动不自动运行迁移。v8 只将 override_values 的空对象约束扩为对象约束，保留 auto_deploy=false、目标、现有绑定、发布记录和快照。降级不会清空覆盖，存在非空覆盖时直接失败；失败迁移会被 migrate 标记为 dirty，需按迁移错误调查处理，不能直接 force 掩盖。

验证使用随机隔离 PostgreSQL 与本地 Helm 渲染，测试产物为隔离 fixture，不连接用户 Git、Registry 或 Kubernetes。覆盖独立绑定/多 CD、目标冲突回滚、并发版本、权限撤销、Secret 碰撞、跨环境隔离、旧预览失效、快照完整性、忙碌/unknown 保护、健康缓存失效/保留当前发布指针及 v7→v8 升级/阻止丢数据降级。

| 检查 | 2026-11-21 实际结果 |
| --- | --- |
| `./scripts/test-backend.ps1 -TestPattern '^TestEnvironment'` | 首轮 7 个新增用例通过；随后补充的健康观察用例在全量中通过 |
| `./scripts/test-backend.ps1` | 68 个顶层集成用例、15 个子用例通过，1 个真实集群用例因 PODRY_TEST_KUBE_PAYLOAD 未设置跳过；含 8 个多环境用例、go vet/build、Linux 编译、隔离 PG、真实备份恢复与二进制停机 |
| `go test ./internal/... ./cmd/... -count=1` | 通过 |
| `sqlc vet` 与重复 `sqlc generate` | 通过；生成前后文件摘要一致 |
| `node docs/tools/check-docs.mjs` | 通过；40 个 Markdown、394 个本地链接、76 个 HTTP 操作、238 个 Schema 引用、31 张设计表；仅文档结构检查 |
| OpenAPI V1.9.0 SHA-256 | `fb102fe0ddad874ea8a4fe328b70f8f18cf5a930e1c507c7ac00792e5efe7a0d` |

本轮没有修改根目录 web/ 或根 README，没有提交代码、迁移开发数据库、连接真实集群或触发真实构建/发布。真实 B6、跨环境发布/故障与权限验收仍待基础设施恢复。
