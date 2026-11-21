param(
    [switch]$Native,
    [string]$TestPattern = '.',
    [string]$PostgresImage = 'postgres:16-alpine@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab'
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$testRunId = [guid]::NewGuid().ToString('N')
$testContainer = 'podry-backend-test-' + $testRunId
$testTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testOutput = Join-Path $testTempRoot ('podry-backend-test-' + $testRunId)
$savedEnvironment = @{}
foreach ($key in @('POSTGRES_PASSWORD', 'PODRY_TEST_DATABASE_URL', 'PODRY_TEST_BINARY', 'GOOS', 'GOARCH', 'CGO_ENABLED', 'GOTMPDIR')) {
    $savedEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}

function Assert-NativeSuccess([string]$Operation) {
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed (exit $LASTEXITCODE)." }
}

Push-Location $workspaceRoot
try {
    New-Item -ItemType Directory -Path $testOutput | Out-Null
    $env:POSTGRES_PASSWORD = [guid]::NewGuid().ToString('N')
    docker run --detach --rm --name $testContainer --label podry.purpose=backend-integration -e POSTGRES_PASSWORD -e POSTGRES_DB=podry_test -p 127.0.0.1::5432 $PostgresImage | Out-Null
    Assert-NativeSuccess 'Start isolated PostgreSQL'
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        docker exec $testContainer pg_isready -U postgres -d podry_test *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'Isolated PostgreSQL did not become ready.' }

    go vet ./...
    Assert-NativeSuccess 'go vet'
    go build ./...
    Assert-NativeSuccess 'go build'

    if ($Native) {
        $testInfo = docker inspect $testContainer | ConvertFrom-Json
        $testPort = $testInfo[0].NetworkSettings.Ports.'5432/tcp'[0].HostPort
        $env:PODRY_TEST_DATABASE_URL = "postgres://postgres:$($env:POSTGRES_PASSWORD)@127.0.0.1:$testPort/podry_test?sslmode=disable"
        $env:GOTMPDIR = $testOutput
        go test ./... -count=1 -run $TestPattern
        Assert-NativeSuccess 'Native Go tests'
    } else {
        # Run the same integration sources on Linux using the existing PostgreSQL image.
        # No Go runtime or compiler is installed in the container.
        $env:GOOS = 'linux'
        $env:GOARCH = 'amd64'
        $env:CGO_ENABLED = '0'
        $testBinary = Join-Path $testOutput 'backend-integration.test'
        go test -c ./tests/integration -o $testBinary
        Assert-NativeSuccess 'Compile Linux integration tests'
        docker cp $testBinary "${testContainer}:/tmp/backend-integration.test"
        Assert-NativeSuccess 'Copy integration binary'
        $serverBinary = Join-Path $testOutput 'backend-server'
        go build -o $serverBinary ./cmd/podry
        Assert-NativeSuccess 'Compile Linux server'
        docker cp $serverBinary "${testContainer}:/tmp/backend-server"
        Assert-NativeSuccess 'Copy server binary'
        $env:PODRY_TEST_BINARY = '/tmp/backend-server'
        $env:PODRY_TEST_DATABASE_URL = "postgres://postgres:$($env:POSTGRES_PASSWORD)@127.0.0.1:5432/podry_test?sslmode=disable"
        # Windows PowerShell treats redirected native stderr as ErrorRecord objects.
        # slog writes informational messages there; judge the test process by its exit code.
        $previousErrorAction = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            # Includes shutdown, backup/restore, health, reconciliation races and terminal lifetimes.
            # Only the suite-level budget grows; operation timeouts and worker leases
            # keep their own limits.
            docker exec -e PODRY_TEST_DATABASE_URL -e PODRY_TEST_BINARY -e PODRY_TEST_KUBE_PAYLOAD $testContainer /tmp/backend-integration.test '-test.v=true' '-test.timeout=900s' "-test.run=$TestPattern" 2>&1 | ForEach-Object { $_.ToString() }
            $testExitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorAction
        }
        if ($testExitCode -ne 0) { throw "Linux PostgreSQL integration tests failed (exit $testExitCode)." }
    }
} finally {
    docker rm --force $testContainer *> $null
    foreach ($key in $savedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($key, $savedEnvironment[$key], 'Process')
    }
    Pop-Location
    # Only remove the exact temporary directory allocated by this run.
    $resolvedTestOutput = [IO.Path]::GetFullPath($testOutput)
    if ($resolvedTestOutput.StartsWith($testTempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolvedTestOutput) -eq ('podry-backend-test-' + $testRunId) -and
        (Test-Path -LiteralPath $resolvedTestOutput)) {
        Remove-Item -LiteralPath $resolvedTestOutput -Recurse -Force
    }
}
