param(
    [Parameter(Mandatory = $true)][string]$Kubeconfig,
    [Parameter(Mandatory = $true)][string]$EvidencePath,
    [switch]$InsecureKubernetes,
    [switch]$UseExistingTestDatabase,
    [switch]$WorkloadRecovery,
    [string]$RunnerHost,
    [string]$RunnerImage
)

# Explicit acceptance only: random databases/namespaces and real process kills.
# No scheduler is started; each subprocess executes exactly one worker step.
$ErrorActionPreference = 'Stop'
if ($UseExistingTestDatabase -and -not $env:PODRY_TEST_DATABASE_URL) {
    throw 'UseExistingTestDatabase requires a dedicated PostgreSQL server with CREATEDB.'
}
$testPattern = '^TestExecutionRecoveryLive$'
if ($WorkloadRecovery) {
    $runnerAddress = $null
    if (-not [Net.IPAddress]::TryParse($RunnerHost, [ref]$runnerAddress) -or
        [Net.IPAddress]::IsLoopback($runnerAddress) -or $runnerAddress.ToString() -in @('0.0.0.0', '::') -or
        $RunnerImage -notmatch '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$') {
        throw 'WorkloadRecovery requires the test process IP reachable from runner Pods and a pinned controlled runner image.'
    }
    $testPattern = '^TestWorkloadExecutionRecoveryLive$'
}
$resolvedKubeconfig = (Resolve-Path -LiteralPath $Kubeconfig).Path
$resolvedEvidence = [IO.Path]::GetFullPath($EvidencePath)
if ((Test-Path -LiteralPath $resolvedEvidence) -or (Test-Path -LiteralPath ($resolvedEvidence + '.tmp')) -or
    -not (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($resolvedEvidence)) -PathType Container)) {
    throw 'EvidencePath must be a new file in an existing directory.'
}

# Import only the explicitly selected context's inline credentials. Never run
# auth plugins, read credential files, or emit raw kubeconfig to test output.
$raw = & kubectl --kubeconfig $resolvedKubeconfig config view --raw -o json 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Unable to read the selected kubeconfig.' }
$kube = ($raw -join "`n") | ConvertFrom-Json
$selected = @($kube.contexts | Where-Object { $_.name -eq $kube.'current-context' })
if ($selected.Count -ne 1) { throw 'Select exactly one current kubeconfig context.' }
$clusters = @($kube.clusters | Where-Object { $_.name -eq $selected[0].context.cluster })
$users = @($kube.users | Where-Object { $_.name -eq $selected[0].context.user })
if ($clusters.Count -ne 1 -or $users.Count -ne 1) { throw 'Context must reference one cluster and one user.' }
$cluster = $clusters[0].cluster
$user = $users[0].user
if ($user.exec -or $user.'auth-provider' -or $user.tokenFile -or $user.'client-certificate' -or
    $user.'client-key' -or $cluster.'certificate-authority') {
    throw 'Live recovery accepts inline token or client certificate credentials only.'
}
$payload = @{ apiServer = $cluster.server; insecureSkipTLSVerify = [bool]($InsecureKubernetes -or $cluster.'insecure-skip-tls-verify') }
if ($cluster.'certificate-authority-data') { $payload.certificateAuthorityData = $cluster.'certificate-authority-data' }
if ($user.token) { $payload.token = $user.token }
if ($user.'client-certificate-data') { $payload.clientCertificateData = $user.'client-certificate-data' }
if ($user.'client-key-data') { $payload.clientKeyData = $user.'client-key-data' }
if (-not $payload.token -and (-not $payload.clientCertificateData -or -not $payload.clientKeyData)) {
    throw 'Selected context has no supported inline authentication.'
}
$testEnvironment = @{
    PODRY_TEST_EXECUTION_RECOVERY_LIVE = $(if ($WorkloadRecovery) { '0' } else { '1' })
    PODRY_TEST_WORKLOAD_RECOVERY_LIVE = $(if ($WorkloadRecovery) { '1' } else { '0' })
    PODRY_TEST_RECOVERY_RUNNER_HOST = $RunnerHost
    PODRY_TEST_RECOVERY_RUNNER_IMAGE = $RunnerImage
    PODRY_TEST_KUBE_PAYLOAD = ($payload | ConvertTo-Json -Compress -Depth 10)
    PODRY_TEST_RECOVERY_EVIDENCE = $resolvedEvidence
}
$savedEnvironment = @{}
try {
    foreach ($key in $testEnvironment.Keys) {
        $savedEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, $testEnvironment[$key], 'Process')
    }
    if ($UseExistingTestDatabase) {
        Push-Location (Join-Path $PSScriptRoot '..')
        try {
            go test ./tests/integration -count=1 -run $testPattern -v -timeout 600s
            if ($LASTEXITCODE -ne 0) { throw 'Live execution recovery acceptance failed.' }
        } finally { Pop-Location }
    } else {
        & (Join-Path $PSScriptRoot 'test-backend.ps1') -Native -TestPattern $testPattern
    }
} finally {
    foreach ($key in $savedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($key, $savedEnvironment[$key], 'Process')
    }
}
