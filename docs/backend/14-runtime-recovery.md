# 进程启停与备份恢复

日期：2026-11-21 · 范围：提前实现 T24 可离线验证的进程启停，补充隔离 PostgreSQL 备份恢复演练和操作说明。T23 真实 CI/CD、T24 生产恢复及外部资源清理尚未验收，P1 进入条件保持不变。

本节历史批次迁移为 v7，HTTP 合同为 V1.8.0、61 implemented / 15 planned。本批没有新增 HTTP 操作或迁移，不开启构建和发布 Worker。

## 进程启停

`internal/bootstrap/serve.go` 统一管理 HTTP、构建和发布 Worker、数据库连接池的生命周期。主命令通过原有 SIGINT / SIGTERM 处理进入停机。

1. 先绑定 HTTP 监听端口，再启动 Worker。端口绑定失败不领取任务，释放启动期连接池。
2. 收到停机信号，停止领取新的 BuildAttempt / Deployment，同时关闭 HTTP listener，等待已接收请求完成。已接收请求仍可能持久保存排队任务，重启后继续处理。
3. 已领取的一个执行步骤继续使用独立 work context，可以完成远端核对并落账。停止领取后不再启动日志归档或保留期清理；正在进行的归档通过领取 context 取消，留待重启核对。
4. HTTP、两个 Worker 和连接池关闭共用一个停机 deadline。都退出后才关闭连接池，避免在途事务使用已关闭的数据库。
5. 超时后取消 work context、关闭 HTTP 连接，返回非零退出。不会等待忽略 context 的适配器，也不会再同步等待借用连接归还。此返回值是进程退出边界，不能在同一进程中继续复用 Runtime。

配置：

```dotenv
PODRY_SHUTDOWN_TIMEOUT=30s
PODRY_STOP_GRACE_PERIOD=45s
PODRY_BUILD_ENABLED=false
PODRY_RELEASE_ENABLED=false
```

`PODRY_SHUTDOWN_TIMEOUT` 接受 1s–5m，默认 30s。现有单次执行步骤上限 20s，默认额外留出事务和 HTTP 收尾时间；若配置过短，可能提前中断步骤，但不会因此重放已提交意图。Compose 的 `stop_grace_period` 默认 45s，可通过 `PODRY_STOP_GRACE_PERIOD` 覆盖；它必须大于进程停机时限。其他部署方式也需显式配置更长的终止宽限时间。

停机不是用户取消构建或发布。进程退出不会删除外部 Job、Helm release、Secret 或 ConfigMap，也不会将活动任务批量改成 failed/canceled，更不会释放 unknown 的物理目标占用。

## 重启语义

| 持久状态 | 重启行为 |
| --- | --- |
| 未领取的 queued 任务 | 按原有队列领取；继续校验冻结输入和执行授权 |
| 在途步骤正常收尾 | 保留实际观察状态/产物；后续步骤待重新领取 |
| Build 已保存 creating，Job 创建响应未收到 | 依原有 lease 过期规则按固定 Job 名、UID 和执行摘要核对；不以 lease 过期作为再次创建依据 |
| Deployment 已保存 submitting | Observe only；不再次调用 Submit |
| unknown 发布 | 保留目标 activeDeploymentId/fencingToken，持续核对；不以超时或进程退出解锁 |
| 停机时未保存的在途结果 | 保留原有提交意图与 lease；重启后使用原有 revision/fencing 规则恢复 |

构建和发布 lease 均为 60 秒；本批没有加速回收或清除 lease。恢复使用冻结的集群凭据、Secret 版本、Chart 包、SHA/digest 和执行身份。不能用当前配置替代丢失的历史输入。

## 备份集合

暂停所有 Podry API/Worker 实例的写入并完成停机，之后采集同一批备份。外部 Job 和工作负载可能继续运行，因此数据库中的未知或活动状态仍须保留，恢复后只按既有协议核对。数据库和日志快照期间不启动另一个写入实例。

| 内容 | 必须保留的原因 |
| --- | --- |
| 完整 PostgreSQL 逻辑备份 | 包含 schema_migrations、用户/权限、全部凭据版本、BuildAttempt、不可变快照、目标占用、lease/revision、幂等记录及审计；不能只导出应用表 |
| 原 `PODRY_CREDENTIAL_KEY` | 数据库只存加密 payload，换一个随机密钥无法解密历史凭据；密钥单独保存在受控秘密存储中 |
| 原部署配置、数据库角色/授权与 JWT 配置 | 服务角色不得获得 DDL 权限；JWT 变更会使已有令牌失效；执行器开关初次恢复时关闭 |
| `PODRY_DATA_DIR` 完整目录 | 日志归档只在数据库存 storage key、长度、SHA-256 与过期时间，文件本体不在数据库 |
| 当前 Podry 二进制/镜像与 runner digest | 保留可复现的代码/执行版本；历史 Chart 包已包含在 release snapshot，恢复会重验包与 manifest 摘要 |
| 集群/Registry 的独立灾备 | Kubernetes 对象、Helm 存储和 Registry blob 不属于 PostgreSQL 备份；平台元数据不能重建丢失镜像或集群 |

备份文件可能包含敏感历史与加密数据，需要使用现有部署的受控备份存储。不要将密钥或连接口令写入本仓库。以 PGHOST、PGPORT、PGUSER、PGDATABASE、PGPASSWORD / PGPASSFILE 等现有秘密环境配置连接，以下命令只作为操作示例，本轮未对开发数据库执行：

```sh
# PGDATABASE 为明确的数据库名称，其他连接信息由秘密环境注入。
pg_dump --format=custom --no-owner --no-acl --file=podry.dump
```

日志目录使用部署现有的卷快照或文件备份方式，保留文件相对路径和访问权限；记录采集时间、文件校验值、应用版本、迁移版本和密钥版本标识。`pg_restore --list podry.dump` 只能检查归档目录，不能替代实际恢复演练。

## 恢复步骤

1. 确认旧 Podry 所有实例已退出并隔离，防止旧库与恢复库的 Worker 同时管理同一个物理目标。不要清除目标占用来绕过这一步。
2. 选择新的、空的独立 PostgreSQL 数据库，核对 PGDATABASE，使用同一 PostgreSQL 大版本的工具恢复。禁止覆盖正在服务的开发/生产库。

   ```sh
   pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname="$PGDATABASE" podry.dump
   ```

3. 上述命令不恢复原 owner/ACL。由部署方重新建立原有迁移角色、服务角色和最小表/序列授权，再启动服务；不得将迁移所有者连接直接用作长期服务连接。
4. 恢复原加密密钥、部署版本及 `PODRY_DATA_DIR`。不要在恢复目录上运行清理任务；超过原七天有效期的日志仍按过期处理，恢复不会延长保留期。
5. 保持两个执行器开关关闭，启动 API，核对迁移版本、用户/项目权限、历史请求、快照、目标占用及日志。启动不自动迁移。本批基线要求干净的 v7；后续 [多环境覆盖版本](15-environment-bindings.md) 要求 v8，[晋级与回滚版本](16-release-actions.md) 要求 v9，[构建取消与重试版本](17-build-actions.md) 要求 v10。按所恢复的二进制与备份版本制定显式升级方案，不能以 `migrate down` 代替数据恢复。
6. 确认原集群、Helm 存储、Registry 镜像和准确凭据可用，旧实例已隔离后，再分别决定是否启用构建/发布 Worker。活动/unknown 任务会沿原协议恢复观察，不能人工直接写 succeeded 或置空 activeDeploymentId。
7. 记录恢复后的实际状态、缺失项与外部核对证据。网络或凭据不可用继续保留现场；缺失/损坏归档返回明确不可读取，不回退为虚构日志，也不抹除已有 Artifact。

## 清理边界

已有日志保留任务仍只按服务生成的确切 storage key 清理过期归档，受 DataDir 的安全文件访问约束。只有 build worker 启用并正常运行时才执行该任务。

本段最初批次没有 Job/Secret/ConfigMap 自动 GC；现已在 v19 增加默认关闭的资源清理 Worker，具体范围、日志门槛与恢复规则见 [构建与发布资源自动清理](39-resource-cleanup.md)。没有目标强制解锁、备份 CLI、自动数据库恢复或业务记录保留期。活动/unknown 或归属不明资源不能作为安全清理候选；人工只读核对见本文后续补充。

## 验证记录

新增测试分层：

- Bootstrap 单元测试：真实本地 HTTP 请求与两个模拟 Worker 正常收尾/统一超时；适配器忽略取消、连接池关闭阻塞时仍有界返回；绑定失败不启动 Worker。
- 配置单元测试：默认、合法上下界、非法 duration 和环境变量覆盖。
- 隔离 PostgreSQL + 模拟执行端：正常 drain 保存 Artifact、不领取下一 Build、不启动日志归档；Job 创建响应前强制退出保留 creating/lease；新 Worker 核对同一个 Job，不重复创建。
- 隔离 PostgreSQL + fake Helm Executor：正常 drain 保存成功状态、留下后续任务；强制退出保留 submitting/目标占用/lease；新 Worker 只 Observe，不重复 Submit。
- 隔离 PostgreSQL 真实 `pg_dump` / `pg_restore`：恢复到新的空数据库；重验 v7、unknown 目标/fencing、历史 Secret 版本和错误密钥拒绝、快照/Chart 摘要、缺失/恢复/损坏日志文件；恢复后核对发布，不重复提交。
- Linux 编译后二进制：普通 HTTP/CLI 回归后发送停机信号，验证进程正常退出。

首次全量静态检查发现恢复测试按 Attempt ID 调用了需要 Build ID + AttemptNo 的 sqlc 方法，已修正测试调用；没有修改业务约束或生成代码。随后最终结果：

| 命令 | 结果与边界 |
| --- | --- |
| `./scripts/test-backend.ps1` | 60 个顶层集成用例和 15 个子用例通过；1 个真实集群用例因 PODRY_TEST_KUBE_PAYLOAD 未设置跳过。包含 go vet/build、Linux 编译、真实隔离 PostgreSQL、迁移/服务角色检查、真实 pg_dump/pg_restore 和编译后二进制停机 |
| `go test ./internal/... ./cmd/... -count=1` | 通过；包括本批 Bootstrap/配置测试及已有 Chart/Helm 观察单元测试 |
| `docker compose config --quiet` | 通过；仅解析配置，没有启动或改动开发服务 |
| `node docs/tools/check-docs.mjs` | 39 Markdown、386 本地链接、76 操作、238 schema 引用、31 张设计表；结构检查通过 |
| HTTP 合同 | OpenAPI 文件 SHA-256 仍为 `e475bd8060b97fcd5c848c7dfb24d20d58d3d636898ef1e7906123a8535c81b1`，未改生成源或操作状态 |

测试只创建并回收本轮隔离数据库/容器及临时文件，没有修改开发服务数据库或真实集群。这里的数据库恢复演练不包含真实 Git/BuildKit/Registry/Helm/Kubernetes 灾备或生产恢复。

## v10 构建操作恢复补充

持久取消意图随备份恢复，Worker 恢复后继续确认 Job 和 Pod 的退出；不能因 lease 到期直接置 canceled。重试保留原 Build 与所有历史 Attempt，准确密文版本必须可解密。恢复仍须匹配 v10 二进制/迁移并核对外部执行状态。已有取消/重试历史时禁止降级，详见 [构建取消与重试](17-build-actions.md)。

## v11 镜像来源恢复补充

镜像应用及外部产物依赖 v11。备份必须保留 Registry、导入者、准确凭据版本和既有 Artifact 不可变关系。导入幂等重放无需 Registry 在线；真实发布前仍须核对 digest 可拉取及集群拉取认证。镜像历史存在时禁止降级。详见 [镜像导入](18-image-artifacts.md)。

## v12 资源写入恢复补充

新增资源写入 Worker 复用同一 drain/work 和统一停机 deadline，默认 `PODRY_RESOURCE_WRITES_ENABLED=false`。单步预算 40 秒、lease 60 秒；默认停机 30 秒可能中断步骤，但持久意图继续保留，重启只读核对已发送项，绝不因租约过期再次提交。

完整数据库备份需包含 resource_previews/resource_operations 的密文、owner/预览消费关系、逐项状态、lease/revision/retry_at 和审计，保留原加密密钥及 JWT_SECRET（派生核对标记的签名密钥）。恢复先关闭三个执行器；匹配干净 v12 后再按外部核对结果分别启用。凭据轮换/授权指纹变化会阻止旧预览或待发送项；已在途且缺证据的项保留 unknown。旧实例仍须隔离，不能直接改写 succeeded 或清空意图。存在资源预览/操作历史时 v12 降级拒绝。见 [资源写入](20-resource-writes.md)。

## v13 资源动作恢复补充

恢复仍先关闭三个 Worker，匹配干净 v13 并保留密钥、原始 UID/RV、动作类型及逐项意图。已发送的删除只按原 UID 消失核对；restart/scale 按原 UID、签名及预期内容核对，不能重发。unknown 动作持续占用与平台发布冲突的 namespace；最终状态不明时禁止手工清除意图。动作历史存在时 v13 降级拒绝，Apply-only 历史可回 v12，仍受 v12 历史保护。详见 [资源动作](21-resource-actions.md)。

## v14 应用漂移恢复补充

E08 批次二进制要求匹配干净 v14；当前版本要求 v19。备份包含 application_drift_observations 的身份摘要、状态、数量和观察时间；恢复后的旧观察仍需通过当前身份及 60 秒有效期检查，不能将历史 aligned 当作集群已收敛。没有观察时允许 v14→v13，有历史时拒绝降级。只读刷新不需要开启任何 Worker，也不触发外部修复。详见 [应用漂移](22-application-drift.md)。

## GitHub Webhook 恢复补充

GitHub Push 批次要求干净 v15；当前二进制要求干净 v19。备份 pipeline_push_authorizations、webhook_deliveries、Build/Attempt 和审计；恢复保持全部后台开关关闭。同 Delivery 读取持久结果，有投递历史或 Push 配置拒绝 v15 降级。不得删除去重记录后重投制造新任务。on_ci_success 的后续 v16 恢复合同见 [自动部署](24-ci-auto-deploy.md)，四平台签名/去重见 [Webhook 合同](38-git-webhook-providers.md)。

## v16 自动部署恢复补充

备份保留 pipeline_deploy_authorizations 与 auto_deploy_intents，连同其 Build/Artifact、冻结版本、用户及发布记录。构建准入时捕获策略，恢复不追补开启前的历史构建。本地协调器复用统一 drain/work；三个外部执行 Worker 继续默认关闭，发布执行器不可用只保留 blocked 意图。渲染在事务外，最终预览消费、快照/请求/执行/意图/审计原子提交；并发或崩溃不重复派发。启用前可关闭不需要的 CD；排队但未提交的自动发布还会重验策略，已提交继续观察外部结果。自动配置或意图历史存在时拒绝 v16 降级，禁止删除/重写意图绕过保护。完整合同见 [构建成功自动部署](24-ci-auto-deploy.md)。

## v17 后台健康恢复补充

binding_health_polls 保存调度/租约及安全错误码，可随数据库备份恢复。恢复时保持 PODRY_HEALTH_POLLING_ENABLED=false；核对主密钥、集群与请求者权限后再显式开启。遗留租约 45 秒到期后恢复读取，旧 token 不能写缓存；无需内存回调或重放外部写操作。巡检接入统一 drain/work 和停机 deadline。v17 降级只删除可重建调度行，不删除观察及发布历史；v16 及更早历史保护仍有效。完整合同见 [后台健康巡检](25-background-health.md)。

## 显式发布核对补充

当前可在全部 Worker 关闭时，由有完整权限的操作者调用 `POST /api/deployments/{deploymentId}/reconcile`。先读取部署 revision，等待有效租约结束，再以 expectedRevision 和幂等键提交只读核对；不需要直接修改数据库或启用发布执行器。仅 submitting/observing/unknown 可用，远端证据明确才收敛状态与占用，无法证实的结果仍 unknown。中断不改变原意图；并发 Worker 的新 revision/fencing 或凭据/授权变化会拒绝迟到结果。复用 v17 及原有历史表，无新迁移；恢复必须保留相关幂等记录和审计。完整调用与约束见 [人工发布核对](26-release-reconciliation.md)。

## 显式资源操作核对补充

原资源操作拥有者可在后台开关关闭时调用 `POST /api/resource-operations/{operationId}/reconcile`。从 GET 读取 revision，以 expectedRevision 和幂等键只读核对 running/unknown 中的持久意图；当前完整目标权限与连接凭据前后重验，不重发写入。未发出的 pending 项跳过，证据不足的项保留 unknown；原 UID 仍在的删除不能视为完成。新核对须有原加密计划密钥和签名密钥，已提交结果的重放只重验当前授权，不依赖密钥/网络。保留 v17 历史、lease/revision、密钥与幂等结果，并先隔离旧实例；接口不能撤回旧实例已在途的写入。通用 Apply/Helm 排他和无证据强制解锁仍未开放。详见 [资源人工核对](27-resource-reconciliation.md)。

## 临时终端的停机回收

终端会话不进入备份和任务恢复。未消费票据到期删除；重启后旧会话/票据失效，用户重新创建连接。HTTP Shutdown 不负责已 hijack 的 WebSocket，因此终端单独接入 drain/work：停止准入、取消所有活动连接、等待终端 handler 及上游退出后再关闭数据库。四个后台开关继续默认关闭。见 [Secret 与终端](28-sensitive-resource-access.md)。
