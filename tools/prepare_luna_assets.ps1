# Run with Windows PowerShell (powershell.exe), which includes System.Drawing.
# Pack the supplied frames on a shared canvas. Remove only exterior white.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
public static class LunaAssets {
 public static void Pack(string[] files, string output) {
  const int w = 340, h = 400;
  using (var strip = new Bitmap(w * files.Length, h)) {
   using (var graphics = Graphics.FromImage(strip)) {
    for (int frame = 0; frame < files.Length; frame++) {
     using (var source = new Bitmap(files[frame]))
     using (var crop = source.Clone(new Rectangle(360, 380, w, h), PixelFormat.Format32bppArgb)) {
      // The chin is open between the paws, so a flood fill would erase the
      // face. Use each row's outer ink bounds, splitting ears and paws.
      for (int y = 0; y < h; y++) {
       int segments = y < 138 || y >= 320 ? 2 : 1;
       for (int segment = 0; segment < segments; segment++) {
        int start = segment * w / segments, end = (segment + 1) * w / segments;
        int left = end, right = start - 1;
        for (int x = start; x < end; x++) {
         var color = crop.GetPixel(x, y);
         if (color.R < 100 && color.G < 100 && color.B < 100) { left = Math.Min(left, x); right = Math.Max(right, x); }
        }
        for (int x = start; x < end; x++) {
         if (right < left) { crop.SetPixel(x, y, Color.Transparent); continue; }
         if (x <= left + 1 || x >= right - 1) {
          // The source outline was antialiased against opaque white. Convert
          // that outer matte into black with coverage alpha, instead of keeping
          // pale opaque edge pixels that form a halo on dark backgrounds.
          var edge = crop.GetPixel(x, y);
          int coverage = 255 - Math.Min(edge.R, Math.Min(edge.G, edge.B));
          crop.SetPixel(x, y, Color.FromArgb(coverage, 0, 0, 0));
         }
        }
       }
      }
      // Row bounds miss pale pixels on horizontal/diagonal contours, especially
      // the crown between the ears. Decontaminate the full two-pixel perimeter
      // from a snapshot so the operation cannot flood into the white face.
      using (var outline = (Bitmap)crop.Clone()) {
       for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
        var pixel = outline.GetPixel(x, y);
        if (pixel.A == 0 || (pixel.R == 0 && pixel.G == 0 && pixel.B == 0)) continue;
        bool exterior = false;
        for (int dy = -2; dy <= 2 && !exterior; dy++) for (int dx = -2; dx <= 2; dx++) {
         int nx = x + dx, ny = y + dy;
         if (nx < 0 || nx >= w || ny < 0 || ny >= h || outline.GetPixel(nx, ny).A == 0) { exterior = true; break; }
        }
        if (exterior) {
         int coverage = (255 - Math.Min(pixel.R, Math.Min(pixel.G, pixel.B))) * pixel.A / 255;
         crop.SetPixel(x, y, Color.FromArgb(coverage, 0, 0, 0));
        }
       }
      }
      graphics.DrawImageUnscaled(crop, frame * w, 0);
     }
    }
   }
   strip.Save(output, ImageFormat.Png);
  }
 }
}
'@
$lunaRoot = Split-Path $PSScriptRoot -Parent
$lunaOutput = Join-Path $lunaRoot 'public/assets/luna'
New-Item -ItemType Directory -Path $lunaOutput -Force | Out-Null
[LunaAssets]::Pack([string[]]@((Join-Path $lunaRoot 'public/assets/luna/idle/idle.png'), (Join-Path $lunaRoot 'public/assets/luna/idle/idle (1).png')), (Join-Path $lunaOutput 'idle.png'))
# Brief taps with a resting pose between the two paws and at the end.
$lunaBongoFrames = @(
 (Join-Path $lunaRoot 'public/assets/luna/bongo/bongo (1).png'),
 (Join-Path $lunaRoot 'public/assets/luna/idle/idle.png'),
 (Join-Path $lunaRoot 'public/assets/luna/bongo/bongo (7).png'),
 (Join-Path $lunaRoot 'public/assets/luna/idle/idle.png')
)
[LunaAssets]::Pack([string[]]$lunaBongoFrames, (Join-Path $lunaOutput 'bongo.png'))
