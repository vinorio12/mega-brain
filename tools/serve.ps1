# Servidor local mínimo pra testar o Mega Brain no navegador.
# Usa só o PowerShell do Windows, sem instalar nada.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1
param([int]$Port = 5173)

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Mega Brain rodando em http://localhost:$Port  (ctrl+c pra parar)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
      if ($path.EndsWith('/')) { $path += 'index.html' }
      $file = [IO.Path]::GetFullPath((Join-Path $root $path.TrimStart('/')))
      $res.Headers.Add('Cache-Control', 'no-store')

      if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
        $ext = [IO.Path]::GetExtension($file).ToLower()
        if ($types.ContainsKey($ext)) { $res.ContentType = $types[$ext] } else { $res.ContentType = 'application/octet-stream' }
        $bytes = [IO.File]::ReadAllBytes($file)
        $res.ContentLength64 = $bytes.Length
        # pedidos HEAD só querem os cabeçalhos, sem o conteúdo
        if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
      } else {
        $res.StatusCode = 404
      }
      Write-Host "$($ctx.Request.HttpMethod) $path $($res.StatusCode)"
    } catch {
      Write-Host "erro em $($ctx.Request.Url): $_"
    } finally {
      try { $res.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
}
