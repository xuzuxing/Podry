ARG GO_IMAGE=golang:1.27.3-alpine@sha256:fa3d596898d9f126af7c01d14ee7597bab3f39cccf392ef36b69fe77cd681f18
FROM ${GO_IMAGE} AS build
ARG GOPROXY=https://proxy.golang.org,direct
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/podry-demo ./cmd/podry-demo

FROM scratch
COPY --from=build /out/podry-demo /podry-demo
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/podry-demo"]
