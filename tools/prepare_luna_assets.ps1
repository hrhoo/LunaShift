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
      // Remove only near-white pixels connected to the canvas border. Unlike
      // fixed row/ear splits, this follows the actual crown and preserves ink.
      var exterior = new bool[w * h];
      var queue = new Queue<int>();
      for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
       if (x != 0 && y != 0 && x != w - 1 && y != h - 1) continue;
       var pixel = crop.GetPixel(x, y);
       if (pixel.A == 0 || (pixel.R >= 245 && pixel.G >= 245 && pixel.B >= 245)) {
        int index = y * w + x;
        exterior[index] = true; queue.Enqueue(index);
       }
      }
      while (queue.Count > 0) {
       int index = queue.Dequeue(), x = index % w, y = index / w;
       int[] neighbours = { x > 0 ? index - 1 : -1, x + 1 < w ? index + 1 : -1,
        y > 0 ? index - w : -1, y + 1 < h ? index + w : -1 };
       foreach (int next in neighbours) {
        if (next < 0 || exterior[next]) continue;
        var pixel = crop.GetPixel(next % w, next / w);
        if (pixel.A == 0 || (pixel.R >= 245 && pixel.G >= 245 && pixel.B >= 245)) {
         exterior[next] = true; queue.Enqueue(next);
        }
       }
      }
      for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
       if (exterior[y * w + x]) crop.SetPixel(x, y, Color.Transparent);
      // Remove the white antialias matte at the transparent perimeter, keeping
      // the original black outline smooth on the dark chat background.
      using (var outline = (Bitmap)crop.Clone()) {
       for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
        var pixel = outline.GetPixel(x, y);
        if (pixel.A == 0 || (pixel.R == 0 && pixel.G == 0 && pixel.B == 0)) continue;
        bool touchesExterior = false;
        for (int dy = -2; dy <= 2 && !touchesExterior; dy++) for (int dx = -2; dx <= 2; dx++) {
         int nx = x + dx, ny = y + dy;
         if (nx < 0 || nx >= w || ny < 0 || ny >= h || outline.GetPixel(nx, ny).A == 0) { touchesExterior = true; break; }
        }
        if (touchesExterior) {
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
