<#
=============================================================================
 AlAqsa - Local network (LAN) setup for sharing data between shop computers
 ---------------------------------------------------------------------------
 One computer acts as the HOST (it holds the encrypted database). The other
 computers connect to it as CLIENTS over the shop's Wi-Fi/LAN and see the very
 same data live.

 This script opens the firewall port on the HOST machine and prints the
 address the other machines should connect to. The app itself can also find
 the host automatically (mDNS), in which case no address is needed.

 KEEP THIS FILE PRIVATE - developer tooling.

 USAGE (run PowerShell as Administrator)
   .\setup-network.ps1 -Role Host      # on the main computer
   .\setup-network.ps1 -Role Client    # on the other computers (checks only)
   .\setup-network.ps1 -Role Host -Remove   # undo the firewall rule

 Author: Areen Abou Fakher  <arin.aboufakher@gmail.com>  +971509471769
=============================================================================
#>

[CmdletBinding()]
param(
    [ValidateSet('Host', 'Client')]
    [string] $Role = 'Host',
    [int]    $Port = 7431,
    [switch] $Remove
)

$ErrorActionPreference = 'Stop'
$RuleName = 'AlAqsa Sync'

function Write-Step  ($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok    ($m) { Write-Host "    [OK] $m" -ForegroundColor Green }
function Write-Warn2 ($m) { Write-Host "    [!]  $m" -ForegroundColor Yellow }
function Write-Fail  ($m) { Write-Host "    [X]  $m" -ForegroundColor Red }

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Fail 'This script must run as Administrator.'
    exit 1
}

Write-Host @'

  ===========================================================
    AlAqsa - Local Network Setup
  ===========================================================
'@ -ForegroundColor Cyan

# --- Remove mode ------------------------------------------------------------
if ($Remove) {
    Write-Step 'Removing the firewall rules'
    foreach ($n in @($RuleName, "$RuleName (mDNS)")) {
        try {
            Remove-NetFirewallRule -DisplayName $n -ErrorAction Stop
            Write-Ok "Removed: $n"
        } catch {
            Write-Warn2 "Not found: $n"
        }
    }
    exit 0
}

# --- Network profile sanity check ------------------------------------------
Write-Step 'Checking the network profile'
$profiles = Get-NetConnectionProfile
foreach ($p in $profiles) {
    Write-Host "    $($p.InterfaceAlias): $($p.NetworkCategory)"
    if ($p.NetworkCategory -eq 'Public') {
        Write-Warn2 "'$($p.InterfaceAlias)' is set to Public - discovery is blocked on public networks."
        Write-Warn2 "Set it to Private:  Set-NetConnectionProfile -InterfaceAlias '$($p.InterfaceAlias)' -NetworkCategory Private"
    }
}

if ($Role -eq 'Host') {
    # --- Firewall rules -----------------------------------------------------
    Write-Step "Opening TCP port $Port for AlAqsa sync"
    try { Remove-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue } catch {}
    New-NetFirewallRule `
        -DisplayName $RuleName `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort $Port `
        -Profile Private,Domain `
        -Description 'AlAqsa CCTV management - LAN data sharing' | Out-Null
    Write-Ok "Inbound TCP $Port allowed (Private/Domain profiles)"

    Write-Step 'Allowing mDNS so client machines can find this host automatically'
    try { Remove-NetFirewallRule -DisplayName "$RuleName (mDNS)" -ErrorAction SilentlyContinue } catch {}
    New-NetFirewallRule `
        -DisplayName "$RuleName (mDNS)" `
        -Direction Inbound `
        -Action Allow `
        -Protocol UDP `
        -LocalPort 5353 `
        -Profile Private,Domain `
        -Description 'AlAqsa CCTV management - automatic host discovery' | Out-Null
    Write-Ok 'Inbound UDP 5353 (mDNS) allowed'

    # --- Report the addresses ----------------------------------------------
    Write-Step 'This computer can be reached at'
    $addresses = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }
    foreach ($a in $addresses) {
        Write-Host "    $($a.IPAddress)  ($($a.InterfaceAlias))" -ForegroundColor White
    }

    Write-Host @"

  ===========================================================
    HOST setup complete.

    In AlAqsa on THIS computer:
      Settings -> Local network -> "Make this the host"

    On the OTHER computers:
      Settings -> Local network -> "Find host machine"
      (or enter one of the addresses above, port $Port)

    Note: this computer must stay switched on and the app
    running while the other computers are using AlAqsa.
  ===========================================================

"@ -ForegroundColor Cyan
}
else {
    Write-Step 'Client machine checks'
    Write-Ok 'No firewall changes are needed on a client machine.'

    Write-Host "`n    Testing whether a host can be reached..." -ForegroundColor White
    $hostIp = Read-Host '    Enter the host computer IP (or press Enter to skip)'
    if ($hostIp) {
        $r = Test-NetConnection -ComputerName $hostIp -Port $Port -WarningAction SilentlyContinue
        if ($r.TcpTestSucceeded) {
            Write-Ok "Reached $hostIp on port $Port"
        } else {
            Write-Fail "Could not reach $hostIp on port $Port"
            Write-Warn2 'Check that: the host app is running, the host script was run, and both PCs are on the same network.'
        }
    }

    Write-Host @"

  ===========================================================
    CLIENT setup complete.

    In AlAqsa on this computer:
      Settings -> Local network -> "Find host machine"
  ===========================================================

"@ -ForegroundColor Cyan
}
