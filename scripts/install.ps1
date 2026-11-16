# Installs WA Premium Plus on Windows:
#
#   irm https://github.com/imbikramsaha/WA-Premium-Plus/releases/latest/download/install.ps1 | iex
#
# It downloads the installer, checks it against the release's SHA256SUMS, installs it for
# the current user (no administrator rights needed) and starts the app.
#
# Options (environment variables):
#   $env:WAPP_VERSION = '0.4.2'   install that version instead of the latest
#   $env:WAPP_NO_LAUNCH = '1'     don't start the app after installing

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # much faster downloads in Windows PowerShell

$Repo = 'imbikramsaha/WA-Premium-Plus'
$App = 'WA Premium Plus'
$Name = 'WA-Premium-Plus-windows-setup.exe'
$Base = if ($env:WAPP_VERSION) {
  "https://github.com/$Repo/releases/download/v$($env:WAPP_VERSION.TrimStart('v'))"
} else {
  "https://github.com/$Repo/releases/latest/download"
}

function Say([string]$Text) { Write-Host $Text }

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("wa-premium-plus-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  Say "Installing $App..."

  $Sums = Join-Path $Tmp 'SHA256SUMS'
  $Setup = Join-Path $Tmp $Name
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/SHA256SUMS" -OutFile $Sums
  Say "Downloading $Name..."
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Name" -OutFile $Setup

  $line = Get-Content $Sums | Where-Object { $_ -match "\s\*?$([regex]::Escape($Name))$" } | Select-Object -First 1
  if (-not $line) { throw "$Name isn't listed in the release's SHA256SUMS." }
  $want = ($line -split '\s+')[0].ToLowerInvariant()
  $got = (Get-FileHash -Algorithm SHA256 -Path $Setup).Hash.ToLowerInvariant()
  if ($got -ne $want) { throw "$Name doesn't match its checksum; the download may be corrupted. Please try again." }
  Say "Verified $Name"
  Unblock-File -Path $Setup

  # Close a running copy so it can be replaced.
  Get-Process -Name $App -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

  Say 'Installing...'
  # Wait for the installer process alone (Start-Process -Wait would also wait for anything
  # the installer starts).
  $p = Start-Process -FilePath $Setup -ArgumentList '/S' -PassThru
  $null = $p.Handle # keeps the exit code readable after the process ends
  $p.WaitForExit()
  if ($p.ExitCode -ne 0) { throw "The installer exited with code $($p.ExitCode)." }

  $Exe = Join-Path $env:LOCALAPPDATA "Programs\$App\$App.exe"
  if (-not (Test-Path $Exe)) { throw "The app wasn't found at $Exe after installing." }
  Say "Installed $Exe"

  if (-not $env:WAPP_NO_LAUNCH) {
    Start-Process -FilePath $Exe
    Say "$App is starting. Scan the QR code with WhatsApp on your phone (Linked devices > Link a device)."
  }
} finally {
  Remove-Item -Recurse -Force -Path $Tmp -ErrorAction SilentlyContinue
}
