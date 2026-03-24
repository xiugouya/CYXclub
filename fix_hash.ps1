$salt = 'cyxclub_salt_2026'
$password = 'CYXclub2026!'
$input = $password + $salt
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$bytes = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($input))
$hash = ''
foreach ($b in $bytes) { $hash += $b.ToString('x2') }
Write-Output $hash
