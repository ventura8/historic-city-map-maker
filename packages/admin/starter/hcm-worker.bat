@echo off
rem Historic City Map Maker: use this computer for the imagery pipeline's jobs (docs/research/M7-local-worker.md section 1.5).
rem The admin's "Use this computer" fills the three values below; the file holds no secret (the admin pairs this computer
rem by itself once the worker runs). Double-click it once: it checks Docker, writes its PowerShell part to a folder of
rem yours and registers a task of your user at logon (no administrator rights), which runs the worker in the background:
rem it asks the server for the installed pipeline image, pulls it by digest, runs the worker and starts it again whenever
rem it ends. "Stop using this computer" in the admin gives this file with uninstall chosen: it removes all of it.
rem Without Docker Desktop (W5, household computers): it turns WSL on (one Windows permission prompt and a restart, then it goes on
rem by itself after you sign in), installs its own Ubuntu with Docker Engine from Docker's signed apt repository (a pinned version),
rem and keeps that Linux awake while the helper runs. Settings > Apps lists the helper, with Uninstall.
setlocal
set "HCM_PROJECT=__HCM_PROJECT__"
set "HCM_CITY=__HCM_CITY__"
set "HCM_ACTION=__HCM_ACTION__"
if not "%~1"=="" set "HCM_ACTION=%~1"
set "HCM_SELF=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
 "$t = Get-Content -LiteralPath $env:HCM_SELF -Raw; $m = '#PS' + '-BEGIN'; & ([scriptblock]::Create(($t -split $m, 2)[1]))"
if not "%HCM_ACTION%"=="run" pause
exit /b
#PS-BEGIN
# The PowerShell part (the lines above are cmd's). Its values come from the environment the lines above set, or from
# the header the installed copy carries (hcm-worker.ps1 under %LOCALAPPDATA%\hcm-worker).
$Project = $env:HCM_PROJECT
# This file's version: the first 12 hex digits of the SHA-256 of both starter templates with this line emptied
# (scripts/site/src/admin/starter.ts; a test fails when the files change and it does not). The worker gets it as HCM_STARTER.
$StarterVersion = 'e0afe8c32568'
$City = $env:HCM_CITY
$Action = $env:HCM_ACTION
$Name = 'hcm-worker'
$Port = 8765
$Outdated = 75
# The worker's usage error (argparse): an image older than this starter's supervisor (finding 74 of 2026-11-03).
$Usage = 2
$Refusals = 3
$GetDocker = 'https://docs.docker.com/get-started/get-docker/'
$ImageApi = "https://us-central1-$Project.cloudfunctions.net/worker-image"
$ImagePattern = '^us-central1-docker\.pkg\.dev/' + [regex]::Escape($Project) + '/hcm/pipeline@sha256:[0-9a-f]{64}$'
$Folder = Join-Path $env:LOCALAPPDATA $Name
$Installed = Join-Path $Folder "$Name.ps1"
$Startup = Join-Path ([Environment]::GetFolderPath('Startup')) "$Name.cmd"
$Run = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Installed`""
# The starter the installed release publishes (docs/research/M7-local-worker.md, *The starter updates itself*): the list on the map's
# Hosting (the version and each template's SHA-256) and the file from the server's worker.starter.
$StarterList = "https://$Project.web.app/admin/starter.json"
$StarterApi = "https://us-central1-$Project.cloudfunctions.net/worker-starter"
$UpdateSeconds = 86400
$script:UpdateSaid = 'unchecked'
# The local AI (docs/research/M10-local-ai.md): a sidecar with no network, started here because the worker has no Docker socket.
$Matcher = 'hcm-matcher'
$AiFiles = 'hcm-ai-files'
$AiBox = 'hcm-ai-box'
$AiMinFreeKb = 31457280
$AiSeconds = 20
$AiImagePattern = '^pytorch/pytorch(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$'
$AiImageNote = Join-Path $Folder 'ai-image'
$SidecarFlags = @('--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-u', '10001:10001', '-e', 'HOME=/tmp', '--tmpfs', '/tmp')
$SidecarFlags += @('-e', 'HCM_AI_ROOT=/ai', '-v', "${AiFiles}:/ai/files:ro", '-v', "${AiBox}:/ai/box", '--entrypoint', 'python')
# The sidecar's folder of unpacked packages: lib for PyTorch's image, lib-cpu for the worker's own (Start-Matcher).
$script:AiLib = 'lib'
$script:SidecarImage = ''
# The governor (docs/research/M26-governor.md): what only Windows can say, every few seconds, and the worker's CPU quota.
$GovernSeconds = 5
$Hints = '/work/host-hints.json'
# W5, household computers (docs/research/M7-local-worker.md, Household computers): without Docker Desktop, Docker Engine in the helper's
# own WSL distribution; the notes of what this helper installed (so a removal takes only that); the removal's exit codes (76, +1 with
# Docker, +2 keeping the scanned maps); the uninstall entry of Settings > Apps; the resume after the restart WSL needs.
$Distro = 'hcm-worker'
$DistroImage = 'Ubuntu-24.04'
$DockerVersion = '27.5.1'
$DockerKey = '9DC858229FC7DD38854AE2D88D81803C0EBFCD88'
$MinFreeGb = 20
$WslNote = Join-Path $Folder 'installed-wsl'
$DistroNote = Join-Path $Folder 'installed-distro'
$RemoveExit = 76
$UninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$Name"
$ResumeKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
$WslHelp = 'https://learn.microsoft.com/windows/wsl/install'
$VirtualizationHelp = 'https://aka.ms/enablevirtualization'
$Origin = "https://$Project.web.app"
$script:ViaWsl = $false
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# Docker Desktop installed and running.
function Test-Docker {
    if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) { return $false }
    & docker.exe info *> $null
    return $LASTEXITCODE -eq 0
}

# W5: every docker command of this file, in the helper's own WSL distribution when there is no Docker Desktop; what is piped in (the
# host hints) goes on to it.
function docker {
    $command = if ($script:ViaWsl) { @('wsl.exe', '-d', $Distro, '-u', 'root', '--', 'docker') } else { @('docker.exe') }
    $program = $command[0]
    $rest = @($command | Select-Object -Skip 1) + $args
    if ($MyInvocation.ExpectingInput) { $input | & $program @rest } else { & $program @rest }
}

# The helper's own WSL distribution is registered (wsl.exe lists names in UTF-16: its NULs are dropped).
function Test-HelperDistro {
    $names = ((& wsl.exe -l -q 2> $null) -join "`n") -replace "`0", ''
    return @($names -split "`n" | Where-Object { $_.Trim() -eq $Distro }).Count -gt 0
}

function Test-Wsl {
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { return $false }
    & wsl.exe --status *> $null
    return $LASTEXITCODE -eq 0
}

# Virtualization on in the firmware (or Windows already runs on a hypervisor): WSL 2 needs it.
function Test-Virtualization {
    $cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
    $system = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
    return ($system.HypervisorPresent -eq $true) -or ($cpu.VirtualizationFirmwareEnabled -eq $true)
}

function Test-Room {
    $drive = Get-PSDrive -Name $env:SystemDrive.TrimEnd(':') -ErrorAction SilentlyContinue
    if ($drive -and $drive.Free -ge $MinFreeGb * 1GB) { return $true }
    Write-Host "Docker and the map's pipeline need $MinFreeGb GB free on drive $env:SystemDrive; it has $([int]($drive.Free / 1GB)) GB."
    Write-Host 'Free some space (empty the Recycle Bin; Settings, System, Storage), then open this file again.'
    return $false
}

function Write-Blocked($What) {
    Write-Host "$What was refused, or this computer does not allow it (a work computer's administrator may block it)."
    Write-Host "Ask them to turn on WSL, or see $WslHelp, then open this file again."
}

# WSL turned on with one Windows permission prompt; the setup resumes by itself after the restart (RunOnce of this user).
function Install-Wsl {
    if (-not (Test-Virtualization)) {
        Write-Host 'Virtualization is off on this computer, and the helper needs it for WSL (a small Linux inside Windows).'
        Write-Host "Turn it on in the computer's BIOS or UEFI settings (Intel VT-x, AMD-V or SVM): $VirtualizationHelp"
        return $false
    }
    Write-Host 'Step 1 of 3: turning on WSL, a small Linux inside Windows where Docker runs (about 5 minutes, 1 GB).'
    Write-Host 'Windows asks once for your permission (a Yes or No window): choose Yes. Then the computer restarts.'
    try {
        $turnedOn = Start-Process -FilePath 'wsl.exe' -ArgumentList '--install', '--no-distribution' -Verb RunAs -Wait -PassThru -ErrorAction Stop
    } catch { $turnedOn = $null }
    if ($null -eq $turnedOn -or $turnedOn.ExitCode -ne 0) { Write-Blocked 'Turning on WSL'; return $false }
    Set-Content -LiteralPath $WslNote -Value 'wsl' -Encoding Ascii
    Set-ItemProperty -Path $ResumeKey -Name $Name -Value "powershell.exe $Run install"
    Write-Host 'Restart the computer now: after you sign in again, the setup goes on by itself.'
    if ((Read-Host 'Restart now? [Y/n]') -notmatch '^[nN]') { Restart-Computer -Force }
    return $false
}

# The helper's own Ubuntu, used by nothing else, with systemd (Docker's service starts with it).
function Install-Distro {
    Write-Host "Step 2 of 3: installing the helper's own Linux ($DistroImage, about 3 minutes, 1.5 GB); nothing else uses it."
    & wsl.exe --install $DistroImage --name $Distro --no-launch
    if ($LASTEXITCODE -ne 0) {
        & wsl.exe --update
        & wsl.exe --install $DistroImage --name $Distro --no-launch
    }
    if ($LASTEXITCODE -ne 0 -or -not (Test-HelperDistro)) {
        Write-Host "Windows could not install the helper's Linux. Update WSL (type wsl --update in a terminal), then open this file again."
        Write-Host "Help: $WslHelp"
        return $false
    }
    Set-Content -LiteralPath $DistroNote -Value $Distro -Encoding Ascii
    "printf '[boot]\nsystemd=true\n' > /etc/wsl.conf" | & wsl.exe -d $Distro -u root -- sh -s
    & wsl.exe --terminate $Distro *> $null
    return $true
}

# Docker Engine in that Linux from Docker's own apt repository: its key checked by fingerprint, the version pinned and held.
function Install-Engine {
    Write-Host "Step 3 of 3: installing Docker Engine $DockerVersion in it from Docker's signed repository (about 3 minutes, 600 MB)."
    $lines = @(
        'set -e',
        'if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then',
        '. /etc/os-release',
        'export DEBIAN_FRONTEND=noninteractive',
        'apt-get update -q && apt-get install -y -q ca-certificates curl gnupg',
        'install -d -m 0755 /etc/apt/keyrings',
        'curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /tmp/docker.asc',
        "gpg --show-keys --with-colons /tmp/docker.asc | grep -q '^fpr:*$($DockerKey):'",
        'install -m 0644 /tmp/docker.asc /etc/apt/keyrings/docker.asc',
        'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" >/etc/apt/sources.list.d/docker.list',
        'apt-get update -q',
        "v=5:$DockerVersion-1~ubuntu.`$VERSION_ID~`$VERSION_CODENAME",
        'apt-get install -y -q "docker-ce=$v" "docker-ce-cli=$v" containerd.io',
        'apt-mark hold docker-ce docker-ce-cli >/dev/null',
        'systemctl enable --now docker',
        'fi'
    )
    # The local AI reaches the NVIDIA card only through NVIDIA's container toolkit and its CDI file (the owner's 5090, 2026-11-13).
    if ((& nvidia-smi -L 2> $null) -match '^GPU') {
        $lines += @(
            'command -v nvidia-ctk >/dev/null 2>&1 && exit 0',
            'curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit.gpg',
            "curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit.gpg] https://#' >/etc/apt/sources.list.d/nvidia-container-toolkit.list",
            'apt-get update -q && apt-get install -y -q nvidia-container-toolkit',
            'nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml',
            'nvidia-ctk runtime configure --runtime=docker && systemctl restart docker'
        )
    }
    ($lines -join "`n") | & wsl.exe -d $Distro -u root -- sh -s
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Docker Engine could not be installed in the helper's Linux (no internet, or Docker's repository refused it)."
        Write-Host 'Check the internet connection and open this file again; it goes on from where it stopped.'
        return $false
    }
    return $true
}

# Docker for this helper: Docker Desktop when it runs, else (W5) the helper's own Linux with Docker Engine, set up step by step.
function Initialize-Docker {
    if (Test-Docker) { return $true }
    if (-not (Test-Room)) { return $false }
    if (-not (Test-Wsl)) { return Install-Wsl }
    if (-not (Test-HelperDistro) -and -not (Install-Distro)) { return $false }
    $script:ViaWsl = $true
    return Install-Engine
}

# Keeps the helper's Linux awake while this supervisor runs: Windows stops WSL when no Windows program uses it (2026-11-13).
function Start-KeepAlive {
    if (-not $script:ViaWsl) { return }
    $awake = Get-CimInstance Win32_Process -Filter "Name = 'wsl.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*$Distro*sleep infinity*" }
    if (-not $awake) { Start-Process -FilePath 'wsl.exe' -ArgumentList '-d', $Distro, '-e', 'sleep', 'infinity' -WindowStyle Hidden }
}

# The installed pipeline image, by digest, as the server names it (worker.image); $null when it cannot say.
function Get-CurrentImage {
    try {
        $body = '{"data":{}}'
        $answer = Invoke-RestMethod -Method Post -Uri $ImageApi -ContentType 'application/json' -Body $body -TimeoutSec 30 -ErrorAction Stop
    } catch {
        return $null
    }
    $image = [string]$answer.result.image
    if ($image -cmatch $ImagePattern) { return $image }
    return $null
}

# The cleanup brief of 2026-11-14: the pipeline images but the one about to run and the one before it go (each about 10 GB); no other
# image is touched.
function Remove-OldPipelineImages($Current) {
    $kept = $null
    foreach ($each in @(& docker images --format '{{.Repository}}@{{.Digest}}' 2> $null | Where-Object { $_ -like "us-central1-docker.pkg.dev/$Project/hcm/pipeline@*" })) {
        if ($each -eq $Current) { continue }
        if (-not $kept) { $kept = $each; continue }
        & docker image rm $each *> $null
    }
}

# Says in the box why the sidecar cannot come (the panel shows it, the worker stops waiting); a word of this file only, never data.
function Set-AiRefused($WorkerImage, $Why) {
    Write-Host "local AI: unavailable ($Why)"
    # Octal, not a quote: a backslash escapes nothing in PowerShell, and Windows PowerShell strips a quote inside an argument; the worker reads JSON.
    $word = "printf '{\042state\042:\042unavailable\042,\042why\042:\042$Why\042}' > /ai/box/starter.json"
    & docker run --rm -u 10001:10001 --network none -v "${AiBox}:/ai/box" --entrypoint sh $WorkerImage -c $word *> $null
}

# Free kilobytes where Docker keeps images, read inside a container: on Docker Desktop this computer's disks say nothing of it.
function Get-DockerFreeKb($WorkerImage) {
    $lines = & docker run --rm --network none --entrypoint df $WorkerImage -Pk / 2> $null
    if ($lines.Count -lt 2) { return 0 }
    return [int64](($lines[1] -split '\s+')[3])
}

# The image on this computer: pulled once a frame needs it, when there is room for it, one already here used as it is (offline, or Docker
# Hub refusing, must not cost a working sidecar); its volumes owned by the sidecar's user.
function Get-AiImage($WorkerImage, $Wanted) {
    & docker image inspect $Wanted *> $null
    if ($LASTEXITCODE -eq 0) {
        & docker run --rm --network none -v "${AiFiles}:/ai/files" -v "${AiBox}:/ai/box" --entrypoint true $WorkerImage *> $null
        return $true
    }
    if ((Get-DockerFreeKb $WorkerImage) -lt $AiMinFreeKb) {
        Set-AiRefused $WorkerImage 'disk'
        return $false
    }
    Write-Host 'local AI: first use: about 10 GB to fetch, once; it runs on this computer, never in a cloud'
    & docker pull $Wanted *> $null
    if ($LASTEXITCODE -ne 0) {
        Set-AiRefused $WorkerImage 'pull'
        return $false
    }
    Set-AiImageNote $Wanted
    & docker run --rm --network none -v "${AiFiles}:/ai/files" -v "${AiBox}:/ai/box" --entrypoint true $WorkerImage *> $null
    return $true
}

# The images this file pulled, one a line: uninstall removes those and no other. A new pin's pull lets the earlier ones go at once, about
# 10 GB each; one Docker will not remove yet stays noted.
function Set-AiImageNote($Wanted) {
    Stop-Sidecar
    $kept = @()
    if (Test-Path -LiteralPath $AiImageNote) {
        foreach ($old in Get-Content -LiteralPath $AiImageNote) {
            if ($old -and $old -ne $Wanted) {
                & docker image rm $old *> $null
                if ($LASTEXITCODE -ne 0) { $kept += $old }
            }
        }
    }
    Set-Content -LiteralPath $AiImageNote -Value ($kept + $Wanted) -Encoding Ascii
}

# What PyTorch sees under these flags, inside the sidecar's own image: true when it may use the card; else why not, said: a Docker or a
# driver that refused this once is not a computer with no card. `none` is the reason's place: Windows PowerShell drops an empty argument.
function Test-AiGpu($Image, $Flags) {
    & docker run --rm @Flags @SidecarFlags -e "PYTHONPATH=/ai/files/code:/ai/files/$script:AiLib" $Image -m matcher.child probe gpu none *> $null
    $code = $LASTEXITCODE
    switch ($code) {
        0 {}
        77 { Write-Host 'local AI: no graphics card seen' }
        76 { Write-Host 'local AI: the graphics card has under 2 GB of memory' }
        default { Write-Host "local AI: Docker or the graphics driver refused the graphics card (code $code)" }
    }
    return $code -eq 0
}

# The sidecar itself, detached: this loop keeps reading /state.
function Start-Sidecar($Image, $Device, $Why, $Flags) {
    & docker rm -f $Matcher *> $null
    $limits = @('--memory', '4g', '--memory-swap', '4g', '--cpu-shares', '128', '--shm-size', '1g', '--pids-limit', '512')
    $path = "PYTHONPATH=/ai/files/code:/ai/files/$script:AiLib"
    & docker run -d --rm --name $Matcher @Flags @limits -e "HCM_AI_DEVICE=$Device" -e "HCM_AI_WHY=$Why" -e $path @SidecarFlags $Image -m matcher.serve *> $null
}

# The sidecar this loop started gone: what a frame no longer wants, or a worker no longer here, holds no container.
function Stop-Sidecar {
    if ($script:SidecarImage) {
        & docker rm -f $Matcher *> $null
        $script:SidecarImage = ''
    }
}

function Test-SidecarUp {
    return (& docker inspect --format '{{.State.Running}}' $Matcher 2> $null) -eq 'true'
}

# The sidecar of the image the worker names, up: a new pin, or one that ended (77, 76, a crash), starts again and probes again.
function Update-Sidecar($Image) {
    if ($script:SidecarImage -eq $Image -and (Test-SidecarUp)) { return }
    Stop-Sidecar
    Start-Matcher $Image
    $script:SidecarImage = $Image
}

# Graphics card first, through each way Docker offers one; only then the processor, said in plain words. Every start probes again, and a
# sidecar lives only while a frame wants it, so a driver installed later, or a card back from a suspend, is found by the next frame. A
# silent processor run is impossible: the sidecar refuses HCM_AI_DEVICE=cpu without a reason.
function Start-Matcher($Image) {
    $script:AiLib = 'lib'
    $workerImage = & docker inspect --format '{{.Config.Image}}' $Name 2> $null
    if ($Image -eq $workerImage) {
        $script:AiLib = 'lib-cpu'
        Write-Host "local AI: on the processor, in the worker's own image (no NVIDIA card on this computer)"
        Start-Sidecar $Image 'cpu' 'no-gpu' @()
    } elseif (Test-AiGpu $Image @('--gpus', 'all')) {
        Write-Host 'local AI: graphics card found'
        Start-Sidecar $Image 'gpu' '' @('--gpus', 'all')
    } elseif (((& docker info 2> $null) -match 'nvidia\.com/gpu') -and (Test-AiGpu $Image @('--device', 'nvidia.com/gpu=all'))) {
        Write-Host 'local AI: graphics card found'
        Start-Sidecar $Image 'gpu' '' @('--device', 'nvidia.com/gpu=all')
    } else {
        Write-Host 'local AI: no usable graphics card; using the processor (slower)'
        Start-Sidecar $Image 'cpu' 'no-gpu' @()
    }
}

# Beside the worker, in a process of its own, for as long as the supervisor that started it lives: polls /state, and while a frame wants
# the AI and its files are there, keeps the sidecar up; once none does, or the worker has not answered twice running, removes it. A sidecar
# an earlier loop left goes first.
function Start-MatcherLoop($Supervisor) {
    $pulled = ''
    $missed = 0
    & docker rm -f $Matcher *> $null
    while (Get-Process -Id $Supervisor -ErrorAction SilentlyContinue) {
        try {
            $state = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/state" -TimeoutSec 5 -ErrorAction Stop
        } catch {
            $state = $null
        }
        if (-not $state) {
            $missed += 1
            if ($missed -ge 2) { Stop-Sidecar }
        } elseif ($state.ai.wanted) {
            $missed = 0
            $wanted = [string]$state.ai.image
            $workerImage = & docker inspect --format '{{.Config.Image}}' $Name 2> $null
            if ($wanted -ceq 'worker' -and $workerImage) { $wanted = $workerImage }
            if ($wanted -cnotmatch $AiImagePattern -and $wanted -ne $workerImage) {
                Write-Host 'local AI: refused an unexpected program image'
            } elseif ($workerImage) {
                if ($pulled -ne $wanted -and $wanted -eq $workerImage) { $pulled = $wanted }
                if ($pulled -ne $wanted -and (Get-AiImage $workerImage $wanted)) { $pulled = $wanted }
                if ($pulled -eq $wanted -and $state.ai.files) { Update-Sidecar $wanted }
            }
        } else {
            $missed = 0
            Stop-Sidecar
        }
        Start-Sleep -Seconds $AiSeconds
    }
    Stop-Sidecar
}

# Seconds since the last keyboard or mouse input (GetLastInputInfo); $null when it cannot be read.
function Get-IdleSeconds {
    try {
        if (-not ('HcmIdle' -as [type])) {
            Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class HcmIdle {
    [StructLayout(LayoutKind.Sequential)] struct Info { public uint Size; public uint Time; }
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref Info info);
    public static uint Seconds() { var i = new Info(); i.Size = (uint)Marshal.SizeOf(i); GetLastInputInfo(ref i); return ((uint)Environment.TickCount - i.Time) / 1000; }
}
'@
        }
        return [HcmIdle]::Seconds()
    } catch {
        return $null
    }
}

# The battery (Docker Desktop's VM cannot see it), and NVIDIA's cards through nvidia-smi (CUDA reaches them in WSL2).
function Get-HostHints {
    $hints = @{ at = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); idleS = Get-IdleSeconds; gpus = @(); npus = @() }
    $battery = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($battery) {
        $source = if ($battery.BatteryStatus -eq 1) { 'battery' } else { 'ac' }
        $hints.power = @{ source = $source; percent = [int]$battery.EstimatedChargeRemaining }
    }
    if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
        # Only a success's rows, in their shape: a failing nvidia-smi prints its reason on stdout, never a card's name.
        $rows = & nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu --format=csv,noheader,nounits 2> $null
        if ($LASTEXITCODE -ne 0) { $rows = @() }
        foreach ($row in @($rows)) {
            $f = $row -split ',\s*'
            if ($f.Count -ne 5 -or $f[0] -eq '' -or $f[1] -notmatch '^\d+$' -or $f[2] -notmatch '^\d+$') { continue }
            $busy = if ($f[3] -match '^\d+$') { [int]$f[3] } else { 0 }
            $temp = if ($f[4] -match '^\d+$') { [int]$f[4] } else { 0 }
            $name = ($f[0] -replace '["\\]', '')
            $hints.gpus += @{ vendor = 'nvidia'; name = $name.Substring(0, [Math]::Min(120, $name.Length)); vramMb = [int]$f[1]; othersMb = [int]$f[2]; busyPct = $busy; tempC = $temp; via = 'cuda' }
        }
    }
    return $hints
}

# Beside the worker, in a process of its own, for as long as the supervisor lives: the hints in the worker's volume (through its own
# container) and the budget's threads as its CPU quota (`docker update --cpus`, only when they change; a pause keeps the last quota).
function Start-GovernorLoop($Supervisor) {
    $quota = 0
    $looked = Get-Date
    while (Get-Process -Id $Supervisor -ErrorAction SilentlyContinue) {
        if (((Get-Date) - $looked).TotalSeconds -ge $UpdateSeconds) {
            $looked = Get-Date
            Invoke-DailyLook
        }
        $json = Get-HostHints | ConvertTo-Json -Compress -Depth 4
        $json | & docker exec -i $Name sh -c "cat > $Hints.part && mv $Hints.part $Hints" *> $null
        try {
            $threads = [int](Invoke-RestMethod -Uri "http://127.0.0.1:$Port/state" -TimeoutSec 3 -ErrorAction Stop).machine.budget.threads
        } catch {
            $threads = 0
        }
        if ($threads -gt 0 -and $threads -ne $quota) {
            & docker update --cpus $threads $Name *> $null
            if ($LASTEXITCODE -eq 0) { $quota = $threads; Write-Host "governor: the worker may use $threads cores" }
        }
        Start-Sleep -Seconds $GovernSeconds
    }
}

# What the worker may use of this computer (reports/resource-audit.md): at most 60 % of the memory Docker has, and a light
# weight against other containers. HCM_WORKER_MEMORY (a Docker size as 8g, or none) and HCM_WORKER_THREADS (GDAL's threads)
# in the environment change that.
# Which sidecar this computer gets (docs/research/M26-governor.md §5): gpu when an NVIDIA card answers here, PyTorch's own image of
# about 10 GB; else cpu, the worker's own image and PyTorch for the processor in the AI's volume, about 1 GB. HCM_AI_VARIANT decides.
function Get-AiVariant {
    if ($env:HCM_AI_VARIANT -ceq 'gpu' -or $env:HCM_AI_VARIANT -ceq 'cpu') { return $env:HCM_AI_VARIANT }
    if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
        if ((& nvidia-smi -L 2> $null) -match '^GPU') { return 'gpu' }
    }
    return 'cpu'
}

function Get-WorkerLimits {
    $limits = @('--cpu-shares', '256')
    $memory = $env:HCM_WORKER_MEMORY
    if (-not $memory) {
        $said = & docker info --format '{{.MemTotal}}' 2> $null
        $total = [int64]0
        if ([int64]::TryParse([string]$said, [ref]$total) -and $total -gt 0) {
            $memory = [string]([int64][math]::Floor($total / 100) * 60)
        }
    }
    if ($memory -and $memory -ne 'none') { $limits += @('--memory', $memory, '--memory-swap', $memory) }
    if ($env:HCM_WORKER_THREADS) { $limits += @('-e', "GDAL_NUM_THREADS=$($env:HCM_WORKER_THREADS)") }
    return $limits
}

# The version written in the installed copy (once the daily look replaced it).
function Get-StarterOnDisk {
    $found = Select-String -LiteralPath $Installed -Pattern '^\$StarterVersion = ''([0-9a-f]+)''$' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.Matches[0].Groups[1].Value }
    return ''
}

# The template a served file was filled from: LF line ends and its three values put back as the marks (written here in pieces:
# the server fills every whole mark of this file).
function ConvertTo-Template($Text) {
    $u = '_'
    $text = $Text -replace "`r`n", "`n"
    foreach ($field in 'PROJECT', 'CITY', 'ACTION') {
        $text = $text -replace "(?m)^set `"HCM_$field=.*`"$", "set `"HCM_$field=$u${u}HCM_$field$u$u`""
    }
    return $text
}

function Get-TextSha256($Text) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    return (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)) | ForEach-Object { $_.ToString('x2') }) -join '')
}

# One look at the starter the installed release publishes: $true when a newer one, whose SHA-256 is the release's list's, replaced the
# installed copy; else $false, and UpdateSaid says why not: current, not-installed, no-list, no-file, bad-sum, read-only.
function Update-Starter {
    if ($PSCommandPath -ne $Installed) { $script:UpdateSaid = 'not-installed'; return $false }
    try { $listed = Invoke-RestMethod -Uri $StarterList -TimeoutSec 30 -ErrorAction Stop } catch { $listed = $null }
    $version = [string]$listed.version
    $sum = [string]$listed.sha256.windows
    if ($version -notmatch '^[0-9a-f]{12}$' -or $sum -notmatch '^[0-9a-f]{64}$') { $script:UpdateSaid = 'no-list'; return $false }
    if ($version -eq $StarterVersion) { $script:UpdateSaid = 'current'; return $false }
    $script:UpdateSaid = Set-NewStarter $version $sum
    Write-Host "starter: the look for a newer starter said $($script:UpdateSaid)"
    return $script:UpdateSaid -eq 'updated'
}

# The newer file fetched, checked against the list (its SHA-256 as a template, its version line), and put in place by a rename.
function Set-NewStarter($Version, $Sum) {
    try {
        $content = (Invoke-WebRequest -UseBasicParsing -Uri "${StarterApi}?city=$City&os=windows&action=install" -TimeoutSec 60 -ErrorAction Stop).Content
    } catch { return 'no-file' }
    if ($content -is [byte[]]) { $content = [Text.Encoding]::UTF8.GetString($content) }
    $template = ConvertTo-Template $content
    if ((Get-TextSha256 $template) -ne $Sum -or $template -notmatch "(?m)^\`$StarterVersion = '$Version'$") { return 'bad-sum' }
    $part = ($template -split ('#PS' + '-BEGIN'), 2)[1] -replace "`n", "`r`n"
    $header = "`$env:HCM_PROJECT = '$Project'`r`n`$env:HCM_CITY = '$City'`r`n`$env:HCM_ACTION = 'run'`r`n"
    try {
        Set-Content -LiteralPath "$Installed.new" -Value ($header + $part) -Encoding Ascii -ErrorAction Stop
        Move-Item -LiteralPath "$Installed.new" -Destination $Installed -Force -ErrorAction Stop
    } catch { return 'read-only' }
    return 'updated'
}

# Once a day beside the worker (the governor's loop): a newer file waits for the worker to be idle, then the worker stops and the
# supervisor starts the file.
function Invoke-DailyLook {
    if (-not (Update-Starter)) { return }
    while ((Invoke-RestMethod -Uri "http://127.0.0.1:$Port/state" -TimeoutSec 5 -ErrorAction SilentlyContinue).state -eq 'busy') {
        Start-Sleep -Seconds 60
    }
    & docker stop $Name *> $null
}

# This process gives way to the newer file: a new supervisor of it (which stops the loops beside this one) and this one ends.
function Restart-Starter {
    Write-Host 'starter: starting the updated file'
    Start-Process -FilePath 'powershell.exe' -ArgumentList $Run -WindowStyle Hidden
    exit 0
}

# The supervisor: the worker in the foreground, started again whenever it ends: at once after an outdated image (75), else
# after a wait that grows to five minutes while it keeps failing (and starts small again after a long run). A worker that
# refuses the supervisor's arguments (usage error 2) three times in a row runs an image older than this starter: that is
# said once, and the supervisor asks again every five minutes until the map is updated.
function Start-Supervisor {
    if (Update-Starter) { Restart-Starter }
    Stop-Processes "*$Name.ps1*matcher*"
    Stop-Processes "*$Name.ps1*governor*"
    Start-Process -FilePath 'powershell.exe' -ArgumentList "$Run matcher $PID" -WindowStyle Hidden
    Start-Process -FilePath 'powershell.exe' -ArgumentList "$Run governor $PID" -WindowStyle Hidden
    Start-KeepAlive
    $wait = 10
    $refused = 0
    while ($true) {
        $image = Get-CurrentImage
        if ($image) {
            & docker pull $image *> $null
            if ($LASTEXITCODE -eq 0) {
                & docker rm -f $Name *> $null
                Remove-OldPipelineImages $image
                $started = Get-Date
                $digest = 'sha256:' + $image.Split('@')[1].Substring(7)
                $arguments = @('run', '--restart', 'unless-stopped', '--name', $Name) + (Get-WorkerLimits) + @('-p', "127.0.0.1:${Port}:${Port}", '-v', "${Name}:/work")
                $arch = & docker version --format '{{.Server.Arch}}' 2> $null
                $arguments += @('-v', "${AiFiles}:/ai/files", '-v', "${AiBox}:/ai/box", '-e', "HCM_STARTER=$StarterVersion")
                $arguments += @('-e', "HCM_STARTER_UPDATE=$($script:UpdateSaid)", '-e', "HCM_DOCKER_ARCH=$arch")
                # W5: this computer's name and system for the admin's list of the city's computers.
                $arguments += @('-e', "HCM_HOST_NAME=$($env:COMPUTERNAME -replace '[^A-Za-z0-9._-]', '')", '-e', 'HCM_HOST_OS=windows')
                $arguments += @('-e', 'HCM_REMOVABLE=1')
                $arguments += @('-e', "HCM_AI_VARIANT=$(Get-AiVariant)", $image)
                $arguments += @('worker', '--city', $City, '--project', $Project, '--supervised', '--image', $digest)
                & docker @arguments
                $code = $LASTEXITCODE
                # The supervisor decides what follows, not Docker's restart policy (that one is for a reboot before this runs).
                & docker rm -f $Name *> $null
                if ($code -ge $RemoveExit -and $code -le $RemoveExit + 3) { Remove-ByOrder $code $image $digest }
                if ($code -eq $Outdated -or ((Get-Date) - $started).TotalSeconds -gt 600) { $wait = 0 }
                if ($code -eq $Usage) { $refused += 1 } else { $refused = 0 }
            }
        }
        if ($refused -eq $Refusals) {
            Write-Host "The server named an image that does not support this computer's starter: update the map."
            Write-Host 'In the admin: Setup, Update the map. The worker is asked for again every 5 minutes.'
        }
        if ($refused -ge $Refusals) { $wait = 300 }
        Start-Sleep -Seconds $wait
        if ((Get-StarterOnDisk) -ne $StarterVersion -or (Update-Starter)) { Restart-Starter }
        $wait = [Math]::Min(300, $wait * 2 + 10)
    }
}

# The processes of this file whose command line looks like this.
function Stop-Processes($Like) {
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like $Like } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

# The supervisors of an earlier setup, stopped (a new setup or the removal replaces them).
function Stop-Supervisors {
    Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    Stop-Processes "*$Name.ps1*"
    & docker rm -f $Name $Matcher *> $null
}

# The installed copy, which the task at logon runs (and the setup resumes from after WSL's restart).
function Write-InstalledCopy {
    New-Item -ItemType Directory -Force -Path $Folder | Out-Null
    $part = (Get-Content -LiteralPath $env:HCM_SELF -Raw) -split ('#PS' + '-BEGIN'), 2
    $header = "`$env:HCM_PROJECT = '$Project'`r`n`$env:HCM_CITY = '$City'`r`n`$env:HCM_ACTION = 'run'`r`n"
    Set-Content -LiteralPath $Installed -Value ($header + $part[1]) -Encoding Ascii
}

# Settings > Apps lists the helper, and its Uninstall runs this file's removal (no administrator rights: the current user's list).
function Register-UninstallEntry {
    New-Item -Path $UninstallKey -Force | Out-Null
    $entry = @{
        DisplayName = 'Historic City Map Maker helper'; DisplayVersion = $StarterVersion; Publisher = 'Historic City Map Maker'
        UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$Installed`" uninstall"; NoModify = 1; NoRepair = 1
    }
    foreach ($key in $entry.Keys) { Set-ItemProperty -Path $UninstallKey -Name $key -Value $entry[$key] }
}

function Install-Worker {
    $code = Read-PairCode
    if ($env:HCM_SELF) { Write-InstalledCopy }
    if (-not (Initialize-Docker)) {
        Write-Host "Get Docker by hand instead: $GetDocker"
        return
    }
    Stop-Supervisors
    try {
        $taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $Run
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $Name -Action $taskAction -Trigger $trigger -Settings $settings -Force -ErrorAction Stop | Out-Null
        Start-ScheduledTask -TaskName $Name -ErrorAction Stop
    } catch {
        # Without the Task Scheduler: the Startup folder at the next logon, and the supervisor started now.
        Set-Content -LiteralPath $Startup -Value "@start `"`" powershell.exe $Run" -Encoding Ascii
        Start-Process -FilePath 'powershell.exe' -ArgumentList $Run -WindowStyle Hidden
    }
    Register-UninstallEntry
    Write-Host 'This computer is set up: the worker runs in the background and starts when you log on.'
    if ($script:ViaWsl) { Write-Host "It keeps the helper's Linux awake while it runs; Settings, Apps, Historic City Map Maker helper removes all of it." }
    if ($code) { Connect-WithCode $code } else { Write-Host 'Go back to the admin: it connects this computer by itself.' }
}

# W5: the one-time code of "Add another computer"'s line (HCM_PAIR_CODE), cleared at once so nothing started from here inherits it.
function Read-PairCode {
    $code = [string]$env:HCM_PAIR_CODE
    Remove-Item Env:HCM_PAIR_CODE -ErrorAction SilentlyContinue
    if ($code -cmatch '^[a-z2-7]{26}$') { return $code }
    if ($code) { Write-Host 'That is not a code from the admin: it is ignored. Copy the whole line again from Add another computer.' }
    return $null
}

# Waits for the worker (the first start downloads the pipeline) and hands it the code, as the admin's auto-pair does from a browser.
function Connect-WithCode($Code) {
    Write-Host 'Connecting this computer to your map. The first start downloads the pipeline (about 3 GB): 5 to 20 minutes.'
    $headers = @{ Origin = $Origin }
    $posted = $false
    for ($waited = 0; $waited -lt 2700; $waited += 10) {
        try { $state = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/state" -Headers $headers -TimeoutSec 5 -ErrorAction Stop } catch { $state = $null }
        if ($state.signedIn -eq $true) { Write-Host "This computer is connected. The admin lists it as $env:COMPUTERNAME."; return }
        if ($state.lastError -eq 'apiError.worker.pairCode') {
            Write-Host 'The map refused the code: it was used already or ran out. In the admin, Add another computer gives a new line.'
            return
        }
        if ($state.pairable -eq $true -and -not $posted) {
            $body = '{"code":"' + $Code + '"}'
            try { Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/pair" -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 10 -ErrorAction Stop | Out-Null; $posted = $true } catch { $posted = $false }
        }
        Start-Sleep -Seconds 10
    }
    Write-Host 'This computer did not start within 45 minutes, so its code ran out. In the admin, Add another computer gives a new line.'
}

# The local AI's sidecar, volumes and the images this file pulled for it (by the names it noted: the owner's other images stay).
function Remove-Ai {
    & docker rm -f $Matcher *> $null
    & docker volume rm $AiFiles $AiBox *> $null
    if (Test-Path -LiteralPath $AiImageNote) {
        foreach ($each in Get-Content -LiteralPath $AiImageNote) { if ($each) { & docker image rm $each *> $null } }
    }
}

# The worker's container, its volume (or, keeping the scanned maps, only its sign-in), the pipeline's images.
function Remove-WorkerFiles($Keep, $Image) {
    & docker rm -f $Name *> $null
    if ($Keep) {
        & docker run --rm -v "${Name}:/work" --entrypoint sh $Image -c 'rm -f /work/.hcm-session-*' *> $null
    } else {
        & docker volume rm $Name *> $null
    }
    $prefix = "us-central1-docker.pkg.dev/$Project/hcm/pipeline@"
    foreach ($each in (& docker images --format '{{.Repository}}@{{.Digest}}' 2> $null)) {
        if ($each.StartsWith($prefix)) { & docker image rm $each *> $null }
    }
}

# The task at logon, the Startup entry, Settings' entry, a pending resume and this folder; last, since it may end this process.
function Remove-Service {
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $Startup -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $UninstallKey -Recurse -Force -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $ResumeKey -Name $Name -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $Folder -Recurse -Force -ErrorAction SilentlyContinue
}

# W5, Remove this computer: the worker accepted the admin's order and ended with 76-79. Clean up first; the worker then says done
# (the server disconnects it); then the rest. Docker goes only when asked and it lives in the helper's own Linux (its note).
function Remove-ByOrder($Code, $Image, $Digest) {
    $flags = $Code - $RemoveExit
    Write-Host 'The admin asked to remove this computer: cleaning up.'
    Stop-Processes "*$Name.ps1*matcher*"
    Stop-Processes "*$Name.ps1*governor*"
    Remove-Ai
    & docker run --rm --name $Name -v "${Name}:/work" -e HCM_REMOVAL=done -e HCM_REMOVAL_DOCKER_LEFT=false $Image worker --city $City --project $Project --supervised --image $Digest *> $null
    Remove-WorkerFiles ($flags -ge 2) $Image
    $ownLinux = $script:ViaWsl -and (Test-Path -LiteralPath $DistroNote)
    Remove-Service
    if (($flags % 2) -eq 1 -and $ownLinux) { & wsl.exe --unregister $Distro *> $null }
    Write-Host 'This computer no longer works for the map.'
    exit 0
}

function Uninstall-Worker {
    $ownLinux = Test-Path -LiteralPath $DistroNote
    $ownWsl = Test-Path -LiteralPath $WslNote
    if (-not (Test-Docker) -and (Test-HelperDistro)) { $script:ViaWsl = $true }
    Stop-Supervisors
    Remove-Ai
    $image = @(& docker images --format '{{.Repository}}@{{.Digest}}' 2> $null | Where-Object { $_ -like "us-central1-docker.pkg.dev/$Project/hcm/pipeline@*" })[0]
    Remove-WorkerFiles $false $image
    Remove-Service
    Write-Host 'The worker is removed from this computer.'
    if ($ownLinux -and (Read-Host "This helper installed its own Linux with Docker in it. Remove it too? [Y/n]") -notmatch '^[nN]') {
        & wsl.exe --unregister $Distro *> $null
        Write-Host "The helper's Linux and its Docker are removed."
    }
    if ($ownWsl -and (Read-Host 'This helper turned WSL on. Turn it off too (Windows asks your permission)? [y/N]') -match '^[yY]') {
        Start-Process -FilePath 'wsl.exe' -ArgumentList '--uninstall' -Verb RunAs -Wait -ErrorAction SilentlyContinue
    }
}

# The installed copy started with the word `matcher` and its supervisor's process id is the sidecar's loop (Start-Supervisor starts it).
if ($args -contains 'matcher') { $Action = 'matcher' }
if ($args -contains 'governor') { $Action = 'governor' }
if ($args -contains 'install') { $Action = 'install' }
if ($args -contains 'uninstall') { $Action = 'uninstall' }
# W5: no Docker Desktop, but the helper's own Linux: every docker command runs there.
if ($Action -ne 'install' -and -not (Test-Docker) -and (Test-HelperDistro)) { $script:ViaWsl = $true }
switch ($Action) {
    'run' { Start-Supervisor }
    'matcher' { Start-MatcherLoop ([int]$args[1]) }
    'governor' { Start-GovernorLoop ([int]$args[1]) }
    'uninstall' { Uninstall-Worker }
    default { Install-Worker }
}
