# 真实构建取消、重试与 Helm Job 发布

日期：2026-11-22。继续 [真实 CI/CD](29-live-cicd-acceptance.md) 和 [Helm Ingress 发布](30-ingress-helm-release.md)，使用独立 Job 应用验证运行中取消、冻结输入重试、一次性工作负载完成及历史快照重新执行。原 Web 应用仍为 Helm revision 3，正常 HTTPS 访问 `/ping` 返回 `200 pong`。

## 实际结果

| 对象 / 步骤 | 结果 |
| --- | --- |
| Gitea 测试分支 | podry-live-actions-20261122；仅加入 Dockerfile.job 和 cmd/podry-job/main.go；main 未改动 |
| 固定源码 | f0b3fb6a995d20f10af99a690d65c78ecb360077 |
| Job 应用 | 3b75c673-09ed-45e6-ad43-3e5f4ea917e8；最终配置 v4；manual CI/CD |
| 最终验证 Build | 4a99c4d8-5711-4a80-a589-5017701edf97；同一 Build 两次 Attempt |
| 运行中取消 | 看到实际执行的等待输出后发起；Job suspend=true、Suspended=True、active=0、关联 Pod 已退出/删除，最终 canceled，无 Artifact |
| 重试 | attemptNo=2；新 Attempt、Job UID、镜像 tag；原 SHA、configVersion、创建时间和规范化执行输入保持一致 |
| 构建结果 | source/build 容器 exit 0；真实 Registry manifest 原始字节的 digest、blob 存在性与 Artifact 一致；成功重试日志 archived |
| 新测试目标 | podry-cicd-live / podry-job-verified；绑定 798ca0fa-d7a6-45ad-adba-594ed2058100 |
| Helm 首次发布 | d737fd10-2ae2-404e-871c-8d9944de62d0；revision 1；Job Complete，Pod exit 0，日志 podry-job: pong |
| 历史快照重新执行 | 22375cc3-bf6a-4aca-8d5a-05ad72114bb1；rollback 来源指向首次发布；revision 2；新的 Job 名称和 UID，再次 exit 0 |
| 快照与指针 | 两轮使用同一 Artifact/digest 和相同 Chart 归档；真实 Helm 存储已核对，当前发布指针指向成功的 revision 2 |

[公开证据](evidence/2026-11-22-cicd-actions-job.json) 包含 Job/Pod UID、实际 imageID、日志摘要、取消与重试输入核对、Helm revision、失败记录和保留的 unknown。原始文件位于 D:/Temp/podry-live-cicd-20261122，含秘密的文件不能整体上传。

回滚执行中曾短暂观察为 unknown，后续只读观察确认同一 Deployment/Helm revision 成功；没有再次提交。此处证明的是**同一镜像与归档配置的 Job 重新执行**，不能据此声称不同版本升级/回退、跨环境晋级或外部副作用回滚已验收。

## 两处实测修正

### 分支 HEAD 选择

最初的验收脚本使用 `items[0].sha`。Gitea 创建的两条提交 committer 时间相同，既有接口按时间降序、同时间 SHA 升序，第一项恰好是只有一次性程序、还没有 Dockerfile.job 的父提交。两次真实构建在 source 阶段失败，没有 Artifact；它们完整保留在历史中，不计为成功验收。

两个真实验收脚本现均使用提交查询响应的 `resolvedRef` 冻结分支 tip。构建接口仍允许用户显式选择分支历史内的其他完整 SHA，不改变 [提交排序合同](07-git-material.md)。修正后的真实构建使用包含两个文件的分支 HEAD 成功。

### Helm 客户端 OpenAPI 下载

较早的 Job 发布 ab649289-cfbe-4b2d-b9f4-7a30a1f36ae2 在提交后进入 unknown。用该归档 Chart/Values、相同步骤 context 和 HTTP 时限执行只读 Helm server dry-run，复现 OpenAPI v3/v2 响应体下载超时；相同清单通过 Kubernetes server dry-run。产品没有保留原始 Helm 错误，因此诊断复现和原任务状态分开记录。

适配器在 install/upgrade 上设置 `DisableOpenAPIValidation=true`，避免重复下载远端 schema。仅允许经过版本/摘要核验的内置 Chart 和业务校验后的 Values；实际 Kubernetes create/update 的服务端校验继续生效。未增加租约/步骤时限，也未关闭 Git、Registry 或应用 HTTPS 校验。

原任务仍为 unknown，原目标 podry-job-live 继续由它占用；未重新提交、直接改数据库或强制解锁。修复后的链路在新环境绑定及物理目标 podry-job-verified 上验证。该旧任务仍需后续有充分证据的恢复处置，不能因为当前查不到 Helm/Job 就推断从未写入。

## 复现

1. 按 [基础环境记录](29-live-cicd-acceptance.md) 配置 runner、BuildKit、Git/Registry 信任和显式启用的独立测试 API。
2. 在专用测试分支放入 [Job 程序](../example/podry-demo/cmd/podry-job/main.go) 和 [Dockerfile.job](../example/podry-demo/Dockerfile.job)，创建独立 Git 应用。Build 使用 Dockerfile.job、context=`.`、独立 imageRepository、linux/amd64；Base 使用 [Job Values](../../tools/cicd-live/job-release-values.json)，另附当前 expectedVersion。创建同集群、同 namespace 的手动绑定。
3. 在非敏感 buildArgs 设置 `BUILD_HOLD_SECONDS=91`；等待步骤接受 0–300 秒，正常使用默认 0。验收器要求 30–300 秒，并匹配执行输出，忽略 Dockerfile RUN 命令文字。若该步骤已经缓存，需要新源码或不同等待秒数，确保首次尝试确实执行；取消后重试不得更改冻结输入。
4. Token 通过本机环境变量 `PODRY_LIVE_TOKEN` 提供，按下面命令运行。不要把 Token 写进命令参数、仓库或公开证据。

```powershell
node --use-system-ca scripts/test-cicd-actions-live.mjs `
  --api http://127.0.0.1:15000 `
  --app 3b75c673-09ed-45e6-ad43-3e5f4ea917e8 `
  --binding 798ca0fa-d7a6-45ad-adba-594ed2058100 `
  --kubeconfig docs/k3s.yaml --insecure-kubernetes `
  --output D:/Temp/podry-live-cicd-20261122/acceptance-actions-final.json
```

[验收器](../../scripts/test-cicd-actions-live.mjs) 在写入前保存幂等键和固定 SHA，依次验证取消、重试、Registry、归档日志、Helm Job 和历史快照重新执行。相同 output 续跑复用已有身份；不会自动重试 unknown 或删除资源。第一次 Job 的已核对证据在历史快照执行前保存，因为 Helm upgrade 可以删除旧 Job。

最终用相同 output 续跑成功，应用范围内保持 4 Build / 6 Attempt / 2 Artifact / 3 Request / 3 Deployment：其中两条 source 失败 Build、一次成功构建后发布 unknown 的较早验收、一次最终通过的取消/重试链路均保留。计数包含历史失败和 unknown，不能只按最终成功链路理解。

## 验证与边界

- `go test ./internal/release -count=1` 通过；实际 SDK install/upgrade 的 Deployment 和 Job 均在模拟 OpenAPI 不可用时继续使用归档 Chart/解析后的 Values。模拟 Kubernetes writer 不代表真实服务端写入。
- `scripts/test-backend.ps1` 的 5 个定向集成用例通过，包含 go vet/build、Linux 编译和隔离 PostgreSQL；覆盖运行中取消恢复、冻结 Secret 发布、目标串行/unknown 恢复、Job 预览身份、历史 Job 回滚。未重跑全量集成回归。
- 示例 `go run ./cmd/podry-job` 输出正确；真实 CI/CD 及两次 Job Pod 的退出码、镜像 digest、OwnerReference、日志、Helm 存储、资源/Diff 查询和当前发布指针另行通过。
- 暂停导致取消的 Pod 删除，本次取消日志为 unavailable；仅成功重试的日志确认 archived。没有直接取得所有远端 BuildKit 进程退出的完整证据，也未注入推送中断。
- 自动部署、不同版本晋级/回滚、跨环境执行、强杀/提交响应丢失、凭据轮换/撤权、节点重启 CA 持久性、生产恢复和安全 GC 仍待后续。T23/B6 整体没有结项。

仅更新独立测试 API 的二进制。主开发数据库、默认执行开关与根 web/ 未改动；未暂存、提交或推送主仓库。临时诊断 Pod 和原测试资源保留供核对。
