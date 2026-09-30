# Gera os ícones PNG do app (mesmo desenho do icons/icon.svg).
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File tools/icons.ps1
Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force $out | Out-Null

function C($hex) { [System.Drawing.ColorTranslator]::FromHtml($hex) }

function New-Icon([int]$size, [string]$name, [double]$scale) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear((C '#030405'))
  $c = $size / 2
  $u = $size / 2 * $scale          # raio de referência
  $w = [Math]::Max(1, $size / 110)  # espessura base

  $ring = {
    param($r, $color, $width)
    $p = New-Object System.Drawing.Pen (C $color), $width
    $g.DrawEllipse($p, $c - $r, $c - $r, 2 * $r, 2 * $r)
    $p.Dispose()
  }
  $dot = {
    param($x, $y, $r, $color)
    $b = New-Object System.Drawing.SolidBrush (C $color)
    $g.FillEllipse($b, $x - $r, $y - $r, 2 * $r, 2 * $r)
    $b.Dispose()
  }

  & $ring (0.88 * $u) '#2a3038' $w
  & $ring (0.64 * $u) '#9dc3df' ($w * 1.6)
  & $ring (0.40 * $u) '#2a3038' $w
  # vetor do centro até o nó ativo
  $p = New-Object System.Drawing.Pen (C '#4f6574'), $w
  $g.DrawLine($p, $c, $c, $c, $c - 0.64 * $u)
  $p.Dispose()
  & $dot $c ($c - 0.64 * $u) (0.085 * $u) '#46e38b'
  & $dot $c $c (0.11 * $u) '#9dc3df'

  $file = Join-Path $out $name
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "ok $name"
}

New-Icon 32  'icon-32.png'           0.95
New-Icon 180 'apple-touch-icon.png'  0.80
New-Icon 192 'icon-192.png'          0.90
New-Icon 512 'icon-512.png'          0.90
New-Icon 512 'icon-maskable-512.png' 0.62   # com margem: Android recorta em círculo/gota
