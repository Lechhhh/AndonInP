param([Parameter(Mandatory=$true)][string]$KeyFile,[string]$ServiceAccount=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$ErrorActionPreference='Stop'
$keyTarget=[IO.Path]::GetFullPath($KeyFile)
if(Test-Path -LiteralPath $keyTarget){throw 'Plik istnieje. Nie nadpisuję klucza danych.'}
$keyParent=Split-Path -Parent $keyTarget
if((Test-Path -LiteralPath $keyParent) -and @(Get-ChildItem -LiteralPath $keyParent -Force).Count -gt 0){throw 'Użyj nowego, pustego katalogu przeznaczonego wyłącznie na klucz.'}
if(-not(Test-Path -LiteralPath $keyParent)){New-Item -ItemType Directory -Path $keyParent | Out-Null}
# Najpierw ogranicz ACL katalogu, dopiero potem zapisz materiał klucza.
$acl=New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
foreach($account in @($ServiceAccount,'NT AUTHORITY\SYSTEM')){
 $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($account,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
 $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $keyParent -AclObject $acl
$keyBytes=New-Object byte[] 32
$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
try{$rng.GetBytes($keyBytes);[IO.File]::WriteAllText($keyTarget,[Convert]::ToBase64String($keyBytes))}finally{$rng.Dispose();[Array]::Clear($keyBytes,0,32)}
Write-Output 'Klucz utworzony w chronionym katalogu. Zachowaj jego osobną, chronioną kopię.'
