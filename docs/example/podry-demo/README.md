# podry-demo

用于 Podry CI/CD 联调的最小 Go + chi + embed 应用，监听 `:8080`。

- `GET /ping`：返回纯文本 `pong`。
- `GET /`：返回编译进二进制的 `web/dist/index.html`。

```powershell
go run ./cmd/podry-demo
curl.exe http://localhost:8080/ping
```

```powershell
docker build -t localhost:5000/podry-demo:local .
docker push localhost:5000/podry-demo:local
docker run --rm -p 18080:8080 localhost:5000/podry-demo:local
curl.exe http://localhost:18080/ping
```

如果构建容器不能访问默认 Go 代理，可追加 `--build-arg GOPROXY=https://goproxy.cn,direct`；应用 Build 配置也可以通过非敏感 buildArgs 设置 GOPROXY。

应用 Build 配置使用仓库根目录作为 context、`Dockerfile` 作为构建文件，imageRepository 为 `podry-demo`。Registry 和 Git 地址应从执行环境可达；构建 Pod 内的 localhost 指向 Pod 自身。前端文件已随源码提供，无需 Node 或前端构建步骤。
