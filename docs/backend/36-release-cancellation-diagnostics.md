# 发布请求取消与脱敏诊断

后续状态：该修复已部署到独立测试 API，并通过新升级、历史 Secret 回滚与幂等续跑；后台健康的真实刷新/过期/恢复也已完成小范围验收，见 [后续记录](37-live-release-and-background-health.md)。原 pending 根因仍未确定。下文保留代码修复批次尚未部署时的边界。

日期：2026-11-22。延续 [Secret 历史恢复](35-live-secret-history-rollback.md)，本批修复可复现的 HTTP 请求取消丢失，并补充发布提交诊断。首个 Secret 升级的 pending 根因仍未确定；不把本次修复写成该历史故障的修复证明。

## 请求取消修复

此前 boundTransport 将请求 context 替换为 Worker 步骤 context。真实 httptest HTTP 服务先返回响应头、再等待取消：取消原请求后，响应体读取继续阻塞，修复前测试在 2 秒保护时限失败。

现在以原请求 context 派生子 context，通过 context.AfterFunc 绑定步骤取消。已取消的请求/步骤在进入底层 transport 前拒绝；响应体读完、读取失败或关闭后释放绑定。保留原请求的值、deadline 与取消信号，也继续阻止步骤结束后迟到的 Helm 请求。不能在 RoundTrip 返回响应头时提前解除绑定，否则响应体不再受步骤取消约束。

回归覆盖请求取消、步骤取消、http.Client 超时在响应体阶段的传播，以及普通响应体可读、完成清理、已取消请求不访问底层 transport。修复前仅请求取消子用例失败；本次没有证据证明原来的 8 秒 http.Client 时限失效，不据此延长任何时限。

Worker 步骤仍为 20 秒，Kubernetes HTTP 时限仍为 8 秒，Helm action 时限仍为 15 秒，lease、fencing、目标占用和身份校验不变。

## 提交与 HTTP 诊断

Submit 输出一条结构化摘要：deployment_id、最后到达的 phase、install/upgrade/none、结果状态/代码、action_error、returned_error、context_error 及总耗时。错误仅分为 none/deadline/canceled/timeout/error，不调用错误的文本格式化。返回错误可能来自配置、历史读取或观察，因此字段命名为 returned_error。

HTTP transport 记录固定枚举的 method/resource、响应头状态和耗时。开始/成功使用 Debug，错误和非预期 HTTP 失败使用 Warn；预检 404 使用 Debug。资源分类仅限 discovery、helm_storage、secrets、services、deployments、jobs、ingresses、pods、other。不输出 URL、对象名、查询参数、Header、请求体、响应体和原始错误。响应头耗时不代表整个响应体耗时；步骤结束摘要提供整体时限证据。当前服务未增加日志级别配置开关。

日志测试将同一标记放入 hostname、namespace、Secret 名称、query、Authorization、body 和错误消息，确认输出不包含该标记。SDK 故障测试运行真实 install/upgrade action，使用内存 Helm driver 与 fake Kubernetes 写端：升级 Update 返回含模拟 Secret 的错误，结果仍 unknown，摘要只含安全分类；重放同一执行不再次 Update，历史仍两条。此测试不代表真实 Kubernetes 故障注入。

## 真实存储读取诊断

在同一测试 API 容器网络运行独立诊断进程，以首个 Secret 目标归档的准确 Chart/Values、20 秒步骤及 8 秒 HTTP 时限执行升级检查。较上批补上真实 Helm Secret 存储读取与 Submit 前 Last 查询；存储变更仍只进入内存，读取结果与内存中的历史版本隔离，避免把现存 pending 当作新提交依据。

所有 Kubernetes POST/PATCH 强制 dryRun=All；DELETE 全部拦截。Secret POST=201、Service PATCH=200、Deployment PATCH=200，16.047 秒返回，无 context deadline。SDK 忽略被拦截的删除错误，所以进程成功不代表完成真实删除或完整升级。真实 Helm 存储写入、完整 Submit 后 Observe 以及数据库回写未参与本次计时。

该诊断没有复现原中断，不能还原已发生请求的网络/调度时序，也不是修复后端到端发布证明。它使用仓库外临时诊断程序；没有向原 unknown 重新提交。

诊断前后，podry-demo-secret 的 Helm revision 2 仍 pending-upgrade；原 Deployment UID=364b7134-b91a-4b12-b963-2ae3196fc645、generation=1、执行身份=23f884aa-7e33-4ede-a025-45f04acd54a9、一个 Ready 副本。升级执行没有业务 Secret 落地。现有三条 unknown 仍占用各自目标。只读 SQL 全局计数仍为 9 Build / 11 Attempt / 7 Artifact / 2 Intent / 17 Preview / 17 Snapshot / 17 Request / 17 Deployment；包含既有失败与 unknown。原公网正常 DNS/TLS 的 /ping 返回 200 pong。

## 验证与边界

- go test ./internal/... ./cmd/... -count=1 通过；新增 SDK 故障测试另行定向通过。
- go vet ./internal/release、go build ./internal/release 通过。
- Linux 编译集成测试，在新建、自动回收的隔离 PostgreSQL 容器执行 6 个顶层用例及关闭恢复的两个子用例，全部通过：冻结 Secret、同目标串行/unknown 恢复、过期 lease、撤权/已确定超时、人工核对 fencing、Worker drain/deadline 恢复。执行器为 fixture，不作为真实集群故障证据。
- 首次 scripts/test-backend.ps1 在 go vet 阶段遇到 web/dist 文件在枚举后消失，Go embed 报文件缺失，未进入该脚本的集成执行。保持前端不动，改为独立编译/执行上述后端用例；不把该脚本标为通过，也未重跑全量集成。

公开记录见 [脱敏证据](evidence/2026-11-22-release-cancellation-diagnostics.json)。未更新正在运行的测试 API 二进制、重启服务、重新发布或修改默认后台开关；本次代码尚未进行修复后的真实提交验收。未改根 web/、迁移或开发数据库，未暂存/提交/推送。

后续需要在带脱敏日志的运行实例中取得未来故障的阶段证据，继续真实响应丢失/强杀/权限与凭据轮换矩阵；原 pending 的根因和有证据收敛、持续健康、生产恢复及安全 GC 仍待处理，T23/B6 未整体完成。
