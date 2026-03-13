$headers = @{
    'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

$urls = @(
    "https://mp.weixin.qq.com/s/skYpnTUSoJT3wrsxUW17Wg",
    "https://mp.weixin.qq.com/s/zAwXI_lTbI2CWM-V-wds7w",
    "https://mp.weixin.qq.com/s/Rm3PlI5z5_V9hoI6GMaVpA",
    "https://mp.weixin.qq.com/s/HjLNCH-3ttX3ScQYEBq55A"
)

$outputDir = "C:\Users\cxk\.openclaw\workspace\cyx-club"

for ($i = 0; $i -lt $urls.Count; $i++) {
    try {
        $response = Invoke-WebRequest -Uri $urls[$i] -Headers $headers -TimeoutSec 15 -ErrorAction Stop
        $response.Content | Out-File -FilePath "$outputDir\weixin$($i+1).html" -Encoding UTF8
        Write-Host "Downloaded article $($i+1)"
    } catch {
        Write-Host "Failed to download article $($i+1): $_"
    }
}
