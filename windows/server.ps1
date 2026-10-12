# Minimaler statischer Webserver für MessWerk 3D (ohne Installation, nur Windows PowerShell).
param([int]$Port = 8080, [string]$Root = (Join-Path $PSScriptRoot "..\dist"))
$Root = (Resolve-Path $Root).Path
$mime = @{ ".html"="text/html; charset=utf-8"; ".js"="text/javascript"; ".mjs"="text/javascript"; ".css"="text/css";
  ".wasm"="application/wasm"; ".json"="application/json"; ".png"="image/png"; ".svg"="image/svg+xml";
  ".stl"="application/octet-stream"; ".ply"="application/octet-stream"; ".obj"="text/plain" }
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "MessWerk 3D läuft auf http://localhost:$Port/  (Fenster schließen zum Beenden)"
Start-Process "http://localhost:$Port/"
while ($l.IsListening) {
  $ctx = $l.GetContext()
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($path -eq "") { $path = "index.html" }
    $file = [IO.Path]::GetFullPath((Join-Path $Root $path))
    if (-not $file.StartsWith($Root) -or -not (Test-Path $file -PathType Leaf)) {
      $ctx.Response.StatusCode = 404
    } else {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $ctx.Response.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" })
      $bytes = [IO.File]::ReadAllBytes($file)
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch { $ctx.Response.StatusCode = 500 }
  finally { $ctx.Response.OutputStream.Close() }
}
