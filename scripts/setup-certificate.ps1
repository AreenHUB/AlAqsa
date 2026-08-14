<#
=============================================================================
 AlAqsa - Self-signed code-signing certificate setup
 ---------------------------------------------------------------------------
 PURPOSE
   Creates a code-signing certificate, trusts it on THIS machine, and (with
   -SignPath) signs the AlAqsa executables/installer. Once the certificate is
   trusted, Windows treats the app as a known publisher and stops showing the
   "unknown publisher / SmartScreen" warning on this machine.

 IMPORTANT
   This is for IN-SHOP use on machines you control. A self-signed certificate
   is only trusted on machines where it has been installed (this script does
   that). Distributing the app to an unrelated third party would still warn
   them unless they install the certificate too, or unless you buy a
   commercial OV/EV certificate.

 KEEP THIS FILE PRIVATE - it is the developer's tooling, not the shop's.

 USAGE (run PowerShell as Administrator)
   .\setup-certificate.ps1                       # create + trust certificate
   .\setup-certificate.ps1 -SignPath ..\release  # also sign everything there
   .\setup-certificate.ps1 -ExportPfx            # export a .pfx for backup

 Author: Areen Abou Fakher  <arin.aboufakher@gmail.com>  +971509471769
=============================================================================
#>

[CmdletBinding()]
param(
    [string] $Subject      = 'AlAqsa CCTV Software',
    [string] $FriendlyName = 'AlAqsa Code Signing',
    [int]    $ValidYears   = 10,
    [string] $SignPath     = '',
    [switch] $ExportPfx,
    [string] $PfxPassword  = '',
    [switch] $AddDefenderExclusion
)

$ErrorActionPreference = 'Stop'

function Write-Step  ($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok    ($m) { Write-Host "    [OK] $m" -ForegroundColor Green }
function Write-Warn2 ($m) { Write-Host "    [!]  $m" -ForegroundColor Yellow }
function Write-Fail  ($m) { Write-Host "    [X]  $m" -ForegroundColor Red }

# --- Administrator check ----------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Fail 'This script must run as Administrator.'
    Write-Host '     Right-click PowerShell and choose "Run as administrator", then re-run.' -ForegroundColor Yellow
    exit 1
}

Write-Host ''
Write-Host '  ===========================================================' -ForegroundColor Cyan
Write-Host '    AlAqsa - Code Signing Setup'                              -ForegroundColor Cyan
Write-Host '    Developer: Areen Abou Fakher (AreenHUB)'                  -ForegroundColor Cyan
Write-Host '  ===========================================================' -ForegroundColor Cyan

# --- 1) Find or create the certificate --------------------------------------
Write-Step "Looking for an existing certificate: CN=$Subject"

$cert = Get-ChildItem Cert:\CurrentUser\My |
        Where-Object { $_.Subject -eq "CN=$Subject" -and $_.HasPrivateKey } |
        Sort-Object NotAfter -Descending |
        Select-Object -First 1

if ($cert -and $cert.NotAfter -gt (Get-Date).AddDays(30)) {
    Write-Ok "Found existing certificate (valid until $($cert.NotAfter.ToString('yyyy-MM-dd')))"
} else {
    Write-Step 'Creating a new self-signed code-signing certificate'
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject "CN=$Subject" `
        -FriendlyName $FriendlyName `
        -CertStoreLocation 'Cert:\CurrentUser\My' `
        -KeyExportPolicy Exportable `
        -KeyUsage DigitalSignature `
        -KeyLength 3072 `
        -HashAlgorithm SHA256 `
        -NotAfter (Get-Date).AddYears($ValidYears)
    Write-Ok "Created. Thumbprint: $($cert.Thumbprint)"
}

# --- 2) Trust it on this machine -------------------------------------------
Write-Step 'Installing the certificate into the machine trust stores'

$tmp = Join-Path $env:TEMP "alaqsa-cert-$(Get-Random).cer"
Export-Certificate -Cert $cert -FilePath $tmp -Force | Out-Null

foreach ($store in @('Root', 'TrustedPublisher')) {
    try {
        Import-Certificate -FilePath $tmp -CertStoreLocation "Cert:\LocalMachine\$store" | Out-Null
        Write-Ok "Installed into LocalMachine\$store"
    } catch {
        Write-Warn2 "Could not install into $store : $($_.Exception.Message)"
    }
}
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

# --- 3) Optional PFX export (backup / use on another machine) ---------------
if ($ExportPfx) {
    Write-Step 'Exporting a .pfx backup of the certificate'
    if (-not $PfxPassword) {
        $sec = Read-Host 'Enter a password to protect the .pfx' -AsSecureString
    } else {
        $sec = ConvertTo-SecureString -String $PfxPassword -Force -AsPlainText
    }
    $pfx = Join-Path $PSScriptRoot '..\certs\alaqsa-codesign.pfx'
    New-Item -ItemType Directory -Force -Path (Split-Path $pfx) | Out-Null
    Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $sec | Out-Null
    Write-Ok "Saved: $pfx"
    Write-Warn2 'Keep this file and its password private. It is never committed to git.'
}

# --- 4) Locate signtool -----------------------------------------------------
function Find-SignTool {
    $candidates = @()
    # Note: ProgramFiles(x86) is read via Get-Item because the parentheses in
    # the variable name are not valid inside a ${...} expression.
    $pf86 = (Get-Item 'Env:ProgramFiles(x86)' -ErrorAction SilentlyContinue).Value
    $pf   = $env:ProgramFiles
    foreach ($base in @(
        (Join-Path $pf86 'Windows Kits\10\bin'),
        (Join-Path $pf   'Windows Kits\10\bin')
    )) {
        if (-not $base) { continue }
        if (Test-Path $base) {
            $candidates += Get-ChildItem $base -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
                           Where-Object { $_.FullName -match '\\x64\\' }
        }
    }
    if ($candidates.Count -gt 0) {
        return ($candidates | Sort-Object FullName -Descending | Select-Object -First 1).FullName
    }
    return $null
}

# --- 5) Sign the build ------------------------------------------------------
if ($SignPath) {
    Write-Step "Signing binaries under: $SignPath"

    if (-not (Test-Path $SignPath)) {
        Write-Fail "Path not found: $SignPath"
        exit 1
    }

    $signtool = Find-SignTool
    if (-not $signtool) {
        Write-Warn2 'signtool.exe was not found (Windows SDK is not installed).'
        Write-Warn2 'Falling back to PowerShell Set-AuthenticodeSignature.'
    } else {
        Write-Ok "Using: $signtool"
    }

    $targets = Get-ChildItem -Path $SignPath -Recurse -Include *.exe, *.dll -ErrorAction SilentlyContinue
    if ($targets.Count -eq 0) {
        Write-Warn2 'No .exe/.dll files found to sign.'
    }

    $signed = 0; $failed = 0
    foreach ($f in $targets) {
        try {
            if ($signtool) {
                & $signtool sign /fd SHA256 /sha1 $cert.Thumbprint `
                    /tr http://timestamp.digicert.com /td SHA256 `
                    "$($f.FullName)" 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) { throw "signtool exit $LASTEXITCODE" }
            } else {
                $r = Set-AuthenticodeSignature -FilePath $f.FullName -Certificate $cert `
                        -TimestampServer 'http://timestamp.digicert.com' -HashAlgorithm SHA256
                if ($r.Status -ne 'Valid') { throw $r.StatusMessage }
            }
            $signed++
        } catch {
            $failed++
            Write-Warn2 "Failed: $($f.Name) - $($_.Exception.Message)"
        }
    }
    Write-Ok "Signed $signed file(s). Failed: $failed"
}

# --- 6) Optional Defender exclusion ----------------------------------------
if ($AddDefenderExclusion) {
    Write-Step 'Adding a Windows Defender exclusion for the install folder'
    try {
        $installDir = Join-Path $env:LOCALAPPDATA 'Programs\AlAqsa'
        Add-MpPreference -ExclusionPath $installDir -ErrorAction Stop
        Write-Ok "Excluded: $installDir"
    } catch {
        Write-Warn2 "Could not add exclusion: $($_.Exception.Message)"
    }
}

Write-Host ''
Write-Host '  ===========================================================' -ForegroundColor Cyan
Write-Host '    Done.'                                                    -ForegroundColor Cyan
Write-Host ''
Write-Host ("    Certificate : CN=" + $Subject)                           -ForegroundColor Cyan
Write-Host ("    Thumbprint  : " + $cert.Thumbprint)                      -ForegroundColor Cyan
Write-Host ("    Expires     : " + $cert.NotAfter.ToString('yyyy-MM-dd')) -ForegroundColor Cyan
Write-Host ''
Write-Host '    Next steps:'                                              -ForegroundColor Cyan
Write-Host '      1. Build the installer:  npm run package'               -ForegroundColor Cyan
Write-Host '      2. Sign it:              .\scripts\setup-certificate.ps1 -SignPath .\release' -ForegroundColor Cyan
Write-Host '      3. Install AlAqsa-Setup-1.0.0.exe'                      -ForegroundColor Cyan
Write-Host ''
Write-Host '    Run this script once on EACH shop computer so Windows'    -ForegroundColor Cyan
Write-Host '    trusts the application there.'                            -ForegroundColor Cyan
Write-Host '  ===========================================================' -ForegroundColor Cyan
Write-Host ''
