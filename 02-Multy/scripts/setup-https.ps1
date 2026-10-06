param([string[]]$Names = @(), [switch]$Force)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
    throw '找不到 mkcert。請先依 https://github.com/FiloSottile/mkcert 安裝，再執行本腳本。'
}
if (-not $Names.Count) {
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } | Select-Object IPAddress, InterfaceAlias)
    if (-not $addresses.Count) { throw '找不到 LAN IPv4；請使用 -Names 明確指定主機名稱或 IP。' }
    for ($index = 0; $index -lt $addresses.Count; $index++) { Write-Host "[$index] $($addresses[$index].IPAddress) — $($addresses[$index].InterfaceAlias)" }
    $choice = Read-Host '請選擇 iPhone 可連線的網卡編號（避免 VPN／虛擬網卡）'
    $selectedIndex = 0
    if (-not [int]::TryParse($choice, [ref]$selectedIndex) -or $selectedIndex -lt 0 -or $selectedIndex -ge $addresses.Count) { throw '網卡編號無效。' }
    $Names = @($addresses[$selectedIndex].IPAddress)
}
foreach ($name in $Names) {
    if ($name -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.:-]*$') { throw "主機名稱或 IP 無效：$name" }
}
$projectDir = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $projectDir 'certs'
$certFile = Join-Path $certDir 'server.pem'
$keyFile = Join-Path $certDir 'server-key.pem'
if (-not $Force -and ((Test-Path -LiteralPath $certFile) -or (Test-Path -LiteralPath $keyFile))) { throw '憑證檔已存在；需要取代時請明確指定 -Force。' }
New-Item -ItemType Directory -Path $certDir -Force | Out-Null
& mkcert -install
if ($LASTEXITCODE -ne 0) { throw '安裝本機 CA 失敗。' }
$certNames = @('localhost', '127.0.0.1') + $Names | Select-Object -Unique
& mkcert -cert-file $certFile -key-file $keyFile @certNames
if ($LASTEXITCODE -ne 0) { throw '產生伺服器憑證失敗。' }
$caDir = (& mkcert -CAROOT).Trim()
if ($LASTEXITCODE -ne 0) { throw '讀取 CA 路徑失敗。' }
Copy-Item -LiteralPath (Join-Path $caDir 'rootCA.pem') -Destination (Join-Path $certDir 'iphone-rootCA.crt')
Write-Host '請在 02-Multy 目錄執行：'
Write-Host ('$env:TLS_CERT_FILE = ' + "'" + $certFile.Replace("'", "''") + "'")
Write-Host ('$env:TLS_KEY_FILE = ' + "'" + $keyFile.Replace("'", "''") + "'")
Write-Host '$env:HOST = ''0.0.0.0'''
Write-Host 'node server.js'
Write-Host "iPhone 網址：https://$($Names[0]):3443"
Write-Host '只將 certs/iphone-rootCA.crt 傳到 iPhone 安裝，並手動啟用完整信任。勿傳送 server-key.pem 或 CA 私鑰。'
Write-Host 'LAN IP 改變時請使用新的 -Names 與 -Force 重新產生憑證；CA 不變時不用重新安裝手機根憑證。'
