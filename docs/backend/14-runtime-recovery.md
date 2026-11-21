# 进程启停与备份恢复

日期：2026-11-21 · 范围：提前实现 T24 可离线验证的进程启停，补充隔离 PostgreSQL 备份恢复演练和操作说明。T23 真实 CI/CD、T24 生产恢复及外部资源清理尚未验收，P1 进入条件保持不变。

正式迁移仍为 v7，HTTP 合同仍为 V1.8.0、61 implemented / 15 planned。本批没有新增 HTTP 操作或迁移，不开启构建和发布 Worker。

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
5. 保持两个执行器开关关闭，启动 API，核对迁移版本、用户/项目权限、历史请求、快照、目标占用及日志。启动不自动迁移。当前版本要求干净的 v7；其他版本先按对应版本说明制定显式升级方案，不能以 `migrate down` 代替数据恢复。
6. 确认原集群、Helm 存储、Registry 镜像和准确凭据可用，旧实例已隔离后，再分别决定是否启用构建/发布 Worker。活动/unknown 任务会沿原协议恢复观察，不能人工直接写 succeeded 或置空 activeDeploymentId。
7. 记录恢复后的实际状态、缺失项与外部核对证据。网络或凭据不可用继续保留现场；缺失/损坏归档返回明确不可读取，不回退为虚构日志，也不抹除已有 Artifact。

## 清理边界

已有日志保留任务仍只按服务生成的确切 storage key 清理过期归档，受 DataDir 的安全文件访问约束。只有 build worker 启用并正常运行时才执行该任务。

本批没有 Job/Secret/ConfigMap 自动 GC、目标强制解锁、备份 CLI、自动数据库恢复、业务记录保留期或 unknown 人工处置接口。T24 外部清理仍需确认精确 UID/执行身份、终态结果与日志留存，任何活动/unknown 或归属不明资源都不能当作安全清理候选。

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
