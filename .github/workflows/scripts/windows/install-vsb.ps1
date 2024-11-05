$VSB='https://aka.ms/vs/17/release/vs_buildtools.exe'
$VSB_SHA256='99C7677154366062A43082921F40F3CE00EF2614DBF94DB23B244DD13DC9443D'
Write-Host -NoNewLine ('Downloading {0} ... ' -f ${VSB})
Invoke-WebRequest -Uri $VSB -OutFile $env:TEMP\vs_buildtools.exe
Write-Host 'SUCCESS'
Write-Host -NoNewLine ('Verifying SHA256 ({0}) ... ' -f $VSB_SHA256)
$Hash = Get-FileHash $env:TEMP\vs_buildtools.exe -Algorithm sha256
if ($Hash.Hash -eq $VSB_SHA256) {
    Write-Host 'SUCCESS'
} else {
    Write-Host  ('FAILED ({0})' -f $Hash.Hash)
    exit 1
}
Write-Host -NoNewLine 'Installing Visual Studio Build Tools ... '
$Process =
    Start-Process $env:TEMP\vs_buildtools.exe -Wait -PassThru -NoNewWindow -ArgumentList @(
        '--quiet',
        '--wait',
        '--norestart',
        '--nocache',
        '--add', 'Microsoft.VisualStudio.Component.Windows11SDK.22000',
        '--add', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64'
    )
if ($Process.ExitCode -eq 0 -or $Process.ExitCode -eq 3010) {
    Write-Host 'SUCCESS'
} else {
    Write-Host  ('FAILED ({0})' -f $Process.ExitCode)
    exit 1
}
Remove-Item -Force $env:TEMP\vs_buildtools.exe