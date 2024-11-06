function Install-Swift {
    param (
        [string]$Url,
        [string]$Sha256
    )
    Set-Variable ErrorActionPreference Stop
    Set-Variable ProgressPreference SilentlyContinue
    Write-Host -NoNewLine ('Downloading {0} ... ' -f $url)
    Invoke-WebRequest -Uri $url -OutFile installer.exe
    Write-Host 'SUCCESS'
    Write-Host -NoNewLine ('Verifying SHA256 ({0}) ... ' -f $Sha256)
    $Hash = Get-FileHash installer.exe -Algorithm sha256
    if ($Hash.Hash -eq $Sha256 -or $Sha256 -eq "") {
        Write-Host 'SUCCESS'
    } else {
        Write-Host ('FAILED ({0})' -f $Hash.Hash)
        exit 1
    }
    Write-Host -NoNewLine 'Installing Swift ... '
    $Process = Start-Process installer.exe -Wait -PassThru -NoNewWindow -ArgumentList @(
        '/quiet',
        '/norestart'
    )
    if ($Process.ExitCode -eq 0) {
        Write-Host 'SUCCESS'
    } else {
        Write-Host ('FAILED ({0})' -f $Process.ExitCode)
        exit 1
    }
    Remove-Item -Force installer.exe
}