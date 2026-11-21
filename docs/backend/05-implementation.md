# B1 首批后端实施与验证

此文件保留 B1 首批交付时的范围与证据。后续已经补齐管理、配置与工作流接口，当前边界、迁移 000002/000003 和服务角色授权见 [管理与配置接口](06-control-plane.md)；下文“尚未注册”是首批历史状态。

日期：2026-11-20。基线提交 `fd8d50b4b9c613cfbef6005992373c4406d4f62f`，本次代码尚未提交。本记录只说明本批已实现和实际验证的部分；完整路线仍见 [开发计划](01-development-plan.md)。

## 交付范围

首批按任务依赖实现 T02–T05 和 T06 的基础部分：正式迁移、pgx/sqlc、显式账户 CLI、认证、团队/项目/成员、业务角色、事务审计与幂等工具。HTTP 共实现 **14 个操作**，对应矩阵 01–13、76。B2–B6 的集群、资源、应用、构建、发布接口尚未注册，返回 JSON 404。

| 层 | 当前实现 |
| --- | --- |
| 装配 | `internal/bootstrap` 显式创建依赖；数据库不可达、迁移缺失/dirty/版本不兼容时不启动 API；启动不迁移、不建账户 |
| HTTP | `/api` 与 SPA 隔离；JSON 404/405；X-Request-ID；错误脱敏；普通请求 25 秒上下文；1 MiB JSON 限制；拒绝重复键、未知字段、错误大小写和非 nullable 字段的 null |
| 数据库 | `internal/database/migrations/000001_identity.*.sql` 共 7 张业务表；显式 golang-migrate；`sqlc.yaml` 和查询源可重建生成代码 |
| 身份 | email 规范化；bcrypt；HS256 Access Token，固定 issuer/audience/算法及过期校验；每请求核对账户状态和 tokenVersion；无 Refresh |
| 账户管理 | `admin init`、`users create/disable/reset-password`；密码仅经 stdin；无默认密码；重复初始化及停用最后一个平台管理员被拒绝 |
| 归属 | 团队/项目列表与创建；成员读取、关联、改角色、移除；仅关联已有未停用账户；名称重复返回 409 |
| 授权 | 默认拒绝；平台管理员管理团队；团队管理员管理所属项目；其余成员需显式项目关联；跨团队关联由数据库复合外键约束 |
| 审计 | 成功变更和审计同事务；失败一起回滚；权限拒绝单独记录脱敏事件；查询按团队/项目权限过滤，支持 action、keyword 和分页 |
| 幂等 | `internal/idempotency.Execute` 与业务共用 sqlc 事务；并发插入等待原事务；同键同内容重放，同键不同内容 409；回滚不留占位 |

幂等工具本批通过真实 PostgreSQL 并发测试，还没有接入未来的构建、模板和发布接口；不能将工具通过理解为这些业务已经完成。T06 中的应用与资源目标双重授权也留待对应模块实现。

## 本批合同决定

- **账户**：email 去除首尾空白并转小写；显示名 1–100 字符；新密码 12–72 UTF-8 字节。登录失败统一 `401 invalid_credentials`，不区分不存在/停用/口令错误。
- **Token**：有效期由 `JWT_ACCESS_TOKEN_EXPIRE` 指定，范围 1 分钟至 24 小时；`JWT_SECRET` 至少 32 字节且不能使用示例占位值。退出、改密、停用均增加 tokenVersion。旧 Refresh 配置字段保留兼容，运行时不用。
- **成员继承**：团队 admin 继承该团队所有项目的 admin；其他团队角色只赋予团队可见性，项目权限取其显式项目角色。项目角色不会自动获得其他项目权限。项目成员必须同时为该团队成员；移出团队时外键级联删除项目关联。不能移除/降级最后一位有效团队管理员。
- **写入授权竞态**：事务先锁定操作者、再锁团队和项目，重新读取权限；不会仅信任请求开始时计算的角色。成员接口不能新建账户。
- **审计可见性**：项目事件对有项目访问权的成员可见；纯团队事件只对团队管理员和平台管理员可见；无团队/项目作用域的 CLI 和拒绝事件只对平台管理员可见。B1 非管理员不能读取集群作用域审计，B2 再补 grant 规则。
- **幂等**：作用域为 userId/operationId/key，hash 包含 method/path/规范 JSON；key 为 8–200 个可打印 ASCII 字符。保留期至少 24 小时；本批不自动清理记录。存储为 jsonb，重放保证 JSON 内容相同，空白格式可能不同。
- **数据设计差异**：正式迁移的 project_members 增加 team_id 和复合外键；audit_events 增加 team_id 以限制团队事件可见性。token_version 使用 bigint。`docs/data/schema.sql` 仍为全量设计稿，本批运行和升级以正式迁移为准。
- **代理边界**：未设置可信代理前使用 TCP 对端做限流，不信任任意客户端的 X-Forwarded-For。普通请求上限 100 次/分钟/地址，登录另限 10 次/分钟/地址。流协议将在 B2 单独装配，不经过普通请求边界。

C01 的账户/数据库/示例已对齐；C10 的团队/项目规则已固定。C02–C09 涉及集群、凭据、执行规格和发布快照的部分仍按后续阶段处理，未将 B0 全部标为完成。

## 本地启动

需要已有 PostgreSQL 和 `web/dist/index.html`。根模块的 embed 仍在编译期依赖 `web/dist`；本批没有修改前端或解除该依赖。

先设置实际连接与独立随机 JWT 密钥。`.env.example` 中的数据库主机 `postgres` 用于 Compose 网络，Windows 宿主运行时应使用实际可访问的数据库地址。

```powershell
$env:DATABASE_URL = 'postgres://podry_service:<password>@127.0.0.1:5432/podry?sslmode=require'
$env:DATABASE_MIGRATION_URL = 'postgres://podry_owner:<password>@127.0.0.1:5432/podry?sslmode=require'
# JWT_SECRET 使用独立的随机值，至少 32 字节。
$env:JWT_SECRET = '<independent-random-secret-at-least-32-bytes>'
$env:JWT_ACCESS_TOKEN_EXPIRE = '15m'

$podryBinary = Join-Path $env:TEMP 'podry-backend.exe'
go build -o $podryBinary ./cmd/podry
& $podryBinary migrate up

# Read-Host 不回显口令；不要把真实密码写入参数、脚本或提交记录。
$adminPassword = Read-Host 'Admin password' -AsSecureString
([System.Net.NetworkCredential]::new('', $adminPassword)).Password |
    & $podryBinary admin init --email admin@example.com --name Administrator --password-stdin

$userPassword = Read-Host 'User password' -AsSecureString
([System.Net.NetworkCredential]::new('', $userPassword)).Password |
    & $podryBinary users create --email developer@example.com --name Developer --password-stdin

& $podryBinary serve
```

`migrate down` 仅回退一个版本，会删除该版本的表和数据，只用于明确的测试/回退场景。已有业务数据的升级应使用新增前滚迁移。未设置 DATABASE_MIGRATION_URL 时迁移命令回退到 DATABASE_URL，正式部署应设置独立迁移角色。

由数据库管理员预先建立 owner/service 登录角色及数据库，并用 owner 迁移后，为服务角色授予本批所需权限。例如（角色名按实际环境调整）：

```sql
GRANT CONNECT ON DATABASE podry TO podry_service;
GRANT USAGE ON SCHEMA public TO podry_service;
GRANT SELECT ON users, teams, team_members, projects, project_members,
    audit_events, idempotency_records, schema_migrations TO podry_service;
GRANT INSERT, UPDATE ON users TO podry_service;
GRANT INSERT, UPDATE, DELETE ON teams, team_members, projects,
    project_members, idempotency_records TO podry_service;
GRANT INSERT ON audit_events TO podry_service;
```

服务角色不应是 schema/table owner，不授 CREATE/迁移表写入或审计 UPDATE/DELETE。账户 CLI 需要主机和数据库访问权限；HTTP 不提供用户注册接口。后续新增模块时再按需调整授权。

Compose 示例已改为传入数据库与 JWT 配置，显式等待 PostgreSQL；保留历史注释并禁用不存在的 `--version` 自检。没有构建或发布新容器镜像，现有远程镜像不能被视为已包含本批代码。

## HTTP 调用

使用新建的已有账户登录，再创建归属；成员请求使用 CLI 输出中的实际 UUID。

```powershell
$base = 'http://127.0.0.1:5000/api'
$password = Read-Host 'Admin password' -AsSecureString
$loginBody = @{
    email = 'admin@example.com'
    password = ([System.Net.NetworkCredential]::new('', $password)).Password
} | ConvertTo-Json
$session = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType application/json -Body $loginBody
$headers = @{ Authorization = "Bearer $($session.accessToken)" }

$team = Invoke-RestMethod -Method Post -Uri "$base/teams" -Headers $headers -ContentType application/json -Body (@{name='研发团队'} | ConvertTo-Json)
$project = Invoke-RestMethod -Method Post -Uri "$base/projects" -Headers $headers -ContentType application/json -Body (@{teamId=$team.id;name='示例项目'} | ConvertTo-Json)
Invoke-RestMethod -Uri "$base/projects?teamId=$($team.id)" -Headers $headers
Invoke-RestMethod -Uri "$base/audit-events?projectId=$($project.id)&page=1&pageSize=20" -Headers $headers
Invoke-RestMethod -Method Post -Uri "$base/auth/logout" -Headers $headers
```

## 验证与重现

本批验证使用独立的临时 PostgreSQL 容器和每用例随机新数据库，不迁移、不清空用户现有数据库。测试通过后移除临时容器与构建产物。

```powershell
# 默认：本机 vet/build，交叉编译同一份测试与服务，在临时 Linux 容器执行。
./scripts/test-backend.ps1

# 本机执行，需本机 Go 运行时工作正常。
./scripts/test-backend.ps1 -Native

# sqlc 版本固定；生成文件不手工编辑。
go install github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1
sqlc generate
sqlc vet
node docs/tools/check-docs.mjs
```

| 检查 | 结果及证据范围 |
| --- | --- |
| Go build / vet | 本机 Go 1.27.3，完整模块编译与静态检查；使用已有 web/dist |
| PostgreSQL | 16.15；空库迁移、重复 up、down/up、dirty 拒绝、字段/关联约束、事务回滚 |
| 账户与 HTTP handler | 真实 PostgreSQL；初始化/重复拒绝/普通账户、登录、改密、停用、退出后的失效；错误 JSON、SPA、输入大小和字段校验 |
| Token 与限流 | 过期/缺失过期时间/错误算法/issuer/audience/version 拒绝；伪造转发头不能绕过登录限流 |
| 归属与审计 | 双团队隔离、跨团队关联拒绝、审计可见性、移出团队级联撤销项目、最后管理员保护 |
| 并发与幂等 | 并发撤权后重新授权判断；12 个并发同键请求只执行一次；hash 冲突；业务/幂等/审计回滚 |
| 独立服务角色 | 真实 PostgreSQL 登录角色能执行账户/团队业务，不能创建表、删除审计或回退迁移 |
| 实际二进制 | Linux 编译后二进制执行 help/migrate/admin init/serve，经真实 TCP HTTP 登录、建团队/项目、查询和退出失效 |
| sqlc / 文档 | sqlc generate 可复现、sqlc vet；OpenAPI 仍为 76 操作，增加 projects.teamId 查询说明；文档结构检查通过 |

集成套件共 8 个顶层用例，另有 6 个 Token 子用例。Windows 原生集成运行曾间歇出现 `Access is denied`、`invalid runtime symbol table`/栈异常；未定位根因，不能将本批结果称为 Windows 原生全套稳定通过。默认脚本的 Linux 执行不需要在容器内安装 Go。CGO 当前为 0，未执行 race detector。

实际环境只读检查：Go 1.27.3；Docker Server 29.9.3；kubectl client 1.36.1。当前 `docker-desktop` Kubernetes 上下文请求 `127.0.0.1:6443` 被拒绝；没有可验收的集群连接。BuildKit、Registry 推送/拉取、Helm 和目标 Namespace 权限仍未完成验证。

本批没有真实 Kubernetes、Git/Registry 构建发布、部署/恢复或前端验收证据。下一阶段继续 T07–T10，再实现 T11–T13；构建发布按 B4/B5 推进，不能将本批 14 个接口称为完整 P0。
