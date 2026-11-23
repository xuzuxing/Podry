# 修复后真实发布与后台健康验收

日期：2026-11-22。接续 [请求取消与脱敏诊断](36-release-cancellation-diagnostics.md)。已将该批代码编译并更新至独立测试 API，真实升级及历史 Secret 回滚成功；另在临时只读巡检实例验证重复刷新、停用过期和重启恢复。公开结果见 [脱敏证据](evidence/2026-11-22-live-release-background-health.json)。原三条 unknown 的根因/处置仍独立保留，T23/B6 未整体完成。

## 独立测试 API 更新

从当前工作树编译 Linux API，备份旧二进制后优雅停止原容器、替换挂载中的二进制，再启动同一容器；数据库、挂载、网络、凭据及原有测试开关保留。以 /healthz 的 JSON status=ok 和鉴权应用读取核对启动成功。

首轮启动等待未通过，已自动恢复旧二进制。检查验收器发现其错误使用可回退到 SPA 的 /readyz 路径，而且等待窗口短于本次容器启动时间；随后改用真实 JSON 健康端点，增加进程启动等待并完成鉴权读取。仅增加测试进程启动等待，没有修改 Worker 步骤、HTTP、Helm action 或 lease 时限。首次回退不计为成功更新。

主测试 API 保留此前显式开启的 Build/Release；资源写入和健康巡检仍默认关闭。没有迁移数据库、修改开发环境或编辑根 web/。

## 修复后真实升级与回滚

复用既有两个真实 Artifact，在此前验收成功的 podry-demo-secret-verified 绑定创建新的升级请求，随后从原成功历史发布回滚。没有重发原 pending 的请求，也没有新建 Build。

| 阶段 | Deployment | Helm revision | 实际结果 |
| --- | --- | --- | --- |
| 新镜像升级 | 756a087b-a0e5-4657-ac9f-7f5dcfcc0a41 | 4 | 新 digest、两 Ready 副本、Secret v2、Pod/Service HTTP 检查通过 |
| 历史回滚 | 49048895-b606-4763-a60a-ca59317096f3 | 5 | 旧 digest、一个副本、历史 Secret v1、/version=404、/ping=200 pong |

升级的脱敏提交摘要显示 action_error=none、phase=observe、context_error=deadline，20.135 秒返回 unknown。后续后台只读观察收敛 succeeded；Helm revision 4 为 deployed。该事实定位本次短暂 unknown 出现在提交后的观察预算，而不是提交错误，也不能解释此前停在 pending-upgrade 的故障。

回滚摘要为 phase=observe、state=succeeded、全部错误分类 none，耗时 18.520 秒。同一 rollback output 第二次通过，保持同一 Request/Deployment，passes=2。回滚工具核对归档 Chart/业务 Values、真实 Secret 数据与 Pod 引用、镜像 digest、普通配置和逐 Pod/Service HTTP。当前应用配置仍 v12/SecretRef v2，凭据当前版本仍 v3，绑定仍 v1，成功指针指向 revision 5；未读取应用进程环境。

原 podry-job-live、podry-demo-auto、podry-demo-secret 三条 unknown 仍占用目标；首个 Secret 目标仍 revision 2 / pending-upgrade。未改 SQL 状态、清 lease/目标占用、删除 Helm 历史或重新提交原未知请求。

## 后台健康的真实观察

新增 [只读验收器](../../scripts/test-health-live.mjs)。要求已经单独开启巡检的运行实例，以及一个已成功发布、只有一个绑定的测试应用。工具不启动 Worker，不调用 /resources；只读取应用详情、healthy 筛选列表，以及测试 PostgreSQL 的调度/观察元数据。SQL 经 docker exec 执行，并通过 PGOPTIONS 强制 default_transaction_read_only=on；不读 Secret 值或资源清单。

本次选择原公网 podry-demo 应用。临时测试 API 使用同一数据库，仅开启 PODRY_HEALTH_POLLING_ENABLED，Build、Release、ResourceWrites 三个开关显式为 false。调度器按现有设计处理该独立测试数据库的全部到期绑定；验收器只对所选单绑定应用断言，不声称所有绑定都能持续满足 TTL。

首次临时实例继承了重复的 Worker 环境条目，无法据此确认写执行器关闭，该轮输出舍弃。替换为预先去除四个开关旧条目的独立环境文件；检查容器每个开关恰有一个值后，以新 output 运行有效验收。临时环境文件含秘密，只保留在仓库外，不进入公开证据。

有效验收两次观察时间为 15:06:30.441875Z 与 15:07:22.394486Z，相隔 51.953 秒，检查时年龄分别约 17.652 与 14.071 秒。两个观察均匹配相同绑定版本、执行 revision、当前成功指针和集群凭据版本，调度 lease 已完成、错误码为空。应用详情与 healthy 筛选均为 healthy。时间为证据中的 UTC，对应北京时间 2026-11-22 23:06:30 与 23:07:22。

这是小范围真实刷新证据，不代表生产容量、所有绑定的持续新鲜度或多实例排他验收。单次测得约 52 秒的刷新间隔已经接近 60 秒 TTL；没有借此延长 TTL、缩短操作安全时限或宣称负载验收完成。

## 停用、过期与恢复

停止并回收临时巡检实例后，不访问资源刷新接口。观察超过 60 秒后，数据库健康投影、应用详情以及 unknown 筛选均回到 unknown；采样时年龄为 62.002314 秒。没有改写观察时间或调度时间。

用同样四个唯一开关重新创建临时巡检实例，沿原 health output 续跑。恢复后的 observedAt=15:11:25.536885Z，严格晚于已过期观察 15:08:55.865490Z，详情和 healthy 筛选恢复。续跑复核当前健康及执行/凭据身份，不能只靠旧成功 samples 判通过；最终 passes=2。

验收完成后再次回收临时实例。主测试 API 的健康开关仍关闭，因此此后的缓存正常过期属于预期行为，不承诺继续自动刷新；公网应用工作负载与 /ping 不受巡检停用影响。

## 复用方式

先由操作者在专用测试环境明确开启健康巡检，再通过环境变量注入 Token；此工具只验证已存在的调度，不提供开启入口。

```powershell
node --use-system-ca scripts/test-health-live.mjs `
  --api http://127.0.0.1:15000 `
  --app d6b36233-d481-4465-b918-c822a7346d54 `
  --binding 17af250b-3e4a-4631-96c3-6f5ce1ab5fab `
  --database-container podry-cicd-live-db-20261122 `
  --output D:/Temp/podry-live-cicd-20261122/acceptance-background-health-verified.json
```

需要 PODRY_LIVE_TOKEN，PostgreSQL 容器中需要已有 POSTGRES_USER/POSTGRES_DB。默认等待 240 秒、至少两次新观察，第一次观察必须晚于该 run 的数据库起始时钟。输出绑定 API、应用、binding、数据库容器、稳定的发布计数与身份；续跑仍读取当前健康。此夹具不支持多绑定聚合、凭据轮换或权限变化期间继续沿同一 output 验收。

## 结果与后续

本轮只新增两条有效发布：全测试库为 9 Build / 11 Attempt / 7 Artifact / 2 Intent / 19 Preview / 19 Snapshot / 19 Request / 19 Deployment。健康刷新、停用过期、重启恢复和幂等回滚没有再增加发布/构建记录。计数包含既有失败和 unknown，不把所有历史计为成功。原公网正常 DNS/TLS 的 /ping 返回 200 pong。

验证包含 Linux API 编译/实际启动、真实 upgrade/rollback/幂等续跑、真实巡检与 API/只读 SQL 检查、新工具语法/help、文档/链接/编码/敏感值与空白检查。本轮未再修改 Go 业务代码，未重跑 Go 全量单元/集成；前批回归与本批真实环境证据分开。未改根 web/、开发数据库、默认开关，未暂存/提交/推送。

剩余：原 pending 的根因与有证据收敛、真实权限撤销/集群凭据及 Vault 密钥轮换、响应丢失/强杀/多实例矩阵、巡检容量与长期新鲜度、跨集群晋级、GitLab/Gitea Webhook、生产恢复及安全 GC。T23/B6 继续保持未整体完成。
