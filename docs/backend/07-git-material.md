# Git 代码选择接口

日期：2026-11-20。本页记录无需 Kubernetes 的 Git 查询批次，在管理配置的 39 个操作上新增两个 Git 查询操作。当时为 41 个可用、1 个连接测试不可用、34 个计划操作；后续 [Kubernetes 读取批次](08-kubernetes-resources.md) 已增至 48 个可用、28 个计划操作。正式数据库迁移仍为版本 3，无新增表；本页验证数值保留为 Git 批次历史证据。

> 后续更新：当前构建已实现，正式迁移版本 4，54 个操作可用。本文 HTTPS-only 规则是历史基线；本地开发 HTTP Git 现支持精确 host:port 显式放行，默认仍为 HTTPS，详见 [本地联调与示例](10-ci-local-demo.md)。

## 接口与权限

| 接口 | 查询参数 | 返回 |
| --- | --- | --- |
| `GET /api/apps/{appId}/git/branches` | keyword、cursor、limit | items{name,headSha,isDefault}、nextCursor、configVersion、observedAt |
| `GET /api/apps/{appId}/git/commits` | ref 必填；shaPrefix、cursor、limit | items{sha,subject,authorName,committedAt}、nextCursor、configVersion、resolvedRef、observedAt |

两者要求 `build.trigger`：超级管理员、团队管理员、项目管理员/开发者可调用，viewer/operator 不因能看应用就能查询代码。无权时在访问 Git 前返回 403/404。响应设置 `Cache-Control: no-store`；不返回 token、作者邮箱、完整提交正文、远端响应体或底层错误详情。

limit 默认 20，范围 1–100。重复和未知参数、非分支 ref、无效 shaPrefix 拒绝为 422。分支名采用 Git ref 校验，配置保存与查询共用该规则。keyword 不区分大小写，分支按名称升序。提交为所选分支 tip 可达的完整历史，包括合并父提交；按 committer 时间降序、同时间 SHA 升序。shaPrefix 是该分支范围内的过滤，不查询其他分支、未广告 SHA 或全局对象库。resolvedRef 是本次 tip 的完整 SHA，空仓库为空字符串。

要构建分支当前 HEAD，应使用同次响应的 `resolvedRef`，不能假定 `items[0].sha` 就是 tip：相同时间或回拨的提交时间可能把父提交排在第一位。用户显式选择某条历史提交时，仍使用该项的完整 SHA。

游标以 HMAC-SHA256 签名，有效 5 分钟。签名使用 JWT 密钥并加入独立用途标记，绑定操作者/tokenVersion、应用、配置版本、凭据版本、接口和筛选。它不是 Git 服务器地址或任意偏移参数。分支查询绑定完整分支快照，提交查询绑定所选分支 tip。配置保存、凭据轮换或远端变化后应从首页重新查询。limit 可以在翻页时调整。

## 读取与一致性

`internal/application/git.go` 在短事务内重验用户、团队/项目 build 权限，读取应用完整配置与凭据当前版本，解密对应不可变 secret_versions。只使用应用已保存的 HTTPS URL；HTTP、SSH、file、URL 内嵌凭据与任意 repositoryUrl 查询参数均拒绝。

`internal/gitremote/reader.go` 使用锁定的 go-git/v5 v5.19.3，直接进行 HTTPS smart Git 广告和 upload-pack 读取。没有 shell、git 子进程、checkout、仓库脚本、文件写入或持久克隆；每次查询独立读取。凭据仅通过 HTTPS Basic Auth 发送，TLS 按宿主信任库校验，禁止重定向。自托管实例需配置可被宿主信任的证书，并使用最终仓库 URL。

Git 网络 I/O 不持有数据库事务/锁；完成后再次重验用户权限、配置版本和凭据版本。读取期间撤销权限不会返回已读取代码，配置或凭据变化返回 revision_conflict。Git 查询本身不创建 Build、Attempt、Artifact 或配置版本，也不改变 setup 的执行就绪状态；构建执行尚未实现。

当前适配 SHA-1 仓库，返回 40 位完整 SHA；合同允许未来的 64 位 SHA，但 SHA-256 仓库尚未适配。支持 smart Git，未实现 dumb HTTP、SSH、凭据 helper、跨站重定向或浏览器临时传 token。provider 可能故意将私仓隐藏为 404，因此无法保证区分“确实不存在”与“无权访问”。

## 预算与错误

每个 Reader 同时最多 4 个查询，排队和远端读取共享 20 秒上下文。广告响应最多 4 MiB；pack 数据最多 32 MiB、50,000 个对象，单个对象/重建 delta 结果最多 8 MiB、累计对象内容预算 64 MiB；所选分支最多 20,000 个可达提交。服务端支持 filter 时请求 tree:0，尽量只取提交；否则完整接收受预算限制的对象。预算用于限制单次读取，不是对 Go 进程总内存的保证。

每页会重新读取分支图，不保留长期仓库缓存。大仓库可能超预算，需要后续专门的缓存/索引适配；不会悄悄只查最近 N 条并把未命中伪装成不存在。

| HTTP / code | 含义 |
| --- | --- |
| 422 git_not_configured | 尚未保存 Git 配置 |
| 422 git_auth_failed | 上游要求认证或拒绝凭据 |
| 422 git_repository_invalid | 上游报告仓库不存在或不可访问 |
| 422 git_ref_not_found | 非空仓库中没有所选分支 |
| 422 validation_failed | 参数、游标或 HTTPS URL 不符合约定 |
| 409 git_ref_changed | 翻页期间远端分支快照变化 |
| 409 revision_conflict | 远端读取期间配置/凭据版本变化 |
| 503 git_unavailable | 网络、TLS、超时、重定向、协议或上游服务失败 |
| 503 git_query_limit | 广告、pack、对象或提交数量超预算 |

成功的空仓库和无匹配过滤返回 items=[]、nextCursor=null；空仓库没有可解析的 tip，resolvedRef=""。不能把这些成功响应与错误混淆。

## 调用示例

沿用 [管理接口的启动与配置流程](06-control-plane.md)，应用先保存 Git 节；私仓引用已创建的团队或全局 git 凭据。以下变量使用该文档中的 `$api`、`$headers`、`$app`：

```powershell
$branches = Invoke-RestMethod -Uri "$api/apps/$($app.id)/git/branches?limit=20" -Headers $headers
$ref = [Uri]::EscapeDataString('main')
$commits = Invoke-RestMethod -Uri "$api/apps/$($app.id)/git/commits?ref=$ref&limit=20" -Headers $headers
$commits.items | Select-Object sha, subject, authorName, committedAt
if ($commits.nextCursor) {
    $cursor = [Uri]::EscapeDataString($commits.nextCursor)
    Invoke-RestMethod -Uri "$api/apps/$($app.id)/git/commits?ref=$ref&cursor=$cursor&limit=20" -Headers $headers
}
```

保留响应中的 configVersion 与完整 sha，供后续构建请求做版本和来源校验。当前没有构建触发接口，不应据此显示构建已启动。

## 验证范围

已运行 `./scripts/test-backend.ps1`：宿主 go vet/go build 通过，Linux/amd64 测试二进制和真实服务主程序在隔离 PostgreSQL 16.15 中执行，**20 个顶层集成测试及 6 个 Token 子测试全部通过**。其中 5 个顶层测试覆盖本批 Git 查询，保留此前 15 个管理配置回归。Git 测试使用进程内 HTTPS smart Git fixture、实际编码的 Git commit/tree/pack 数据和独立测试 CA；不是托管平台或用户生产仓库验收。

Git 集成覆盖分支/提交分页、前缀只匹配分支可达提交、私仓认证和密文解密、错误脱敏、空仓库、无效参数、游标篡改/跨查询、分支变化、凭据轮换、权限拒绝及读取期间撤权/配置修改。另覆盖合并图的双父节点与共同祖先去重、tree:0 filter 协商、启用 delta 压缩的 pack、请求取消/超时、重定向拒绝、TLS 信任校验和 pack 对象数量预算。

文档检查通过：30 个 Markdown、346 个本地链接、76 个 HTTP 操作、238 个 schema 引用。OpenAPI 的 x-implementation 统计为 implemented=41、unavailable=1、planned=34；这是合同覆盖统计，不替代运行时验证。git diff --check 通过，仅有已有 Windows 换行提示。测试容器及本轮临时文件由脚本清理。

尚未执行真实 GitHub/GitLab/自托管生产仓库联调、SHA-256、超大仓库压力测试、Registry、BuildKit、Helm、Kubernetes 或前端验收。
