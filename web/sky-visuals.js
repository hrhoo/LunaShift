/** Display-only Sun and Earth illustrations. Never used by the numerical model.
 * Earth coastline: Natural Earth (public domain). Colors, clouds and phase are
 * illustrative, NOT a prediction of Earth's appearance at the selected UTC.
 */
const images = {};
const listeners = new Set();
for (const [kind, path] of Object.entries({earth:'./assets/earth-illustration.webp', sun:'./assets/sun-illustration.webp'})) {
  const image = new Image();
  images[kind] = image;
  image.onload = () => { for (const listener of listeners) listener(); };
  image.src = path;
}
export function onSkyImagesReady(callback) { listeners.add(callback); return () => listeners.delete(callback); }
export function drawCelestial(ctx, kind, x, y, radius, {dim=false, glow=true}={}) {
  ctx.save();
  const sun = kind === 'sun';
  if (glow) {
    const g = ctx.createRadialGradient(x,y,radius*.72,x,y,radius*(sun?2:1.38));
    g.addColorStop(0,sun?'rgba(255,196,80,.25)':'rgba(81,167,249,.18)');
    g.addColorStop(.55,sun?'rgba(255,174,64,.08)':'rgba(81,167,249,.07)');
    g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,radius*(sun?2:1.38),0,Math.PI*2);ctx.fill();
  }
  ctx.globalAlpha *= dim ? .67 : 1;
  const image=images[kind];
  if (image?.complete && image.naturalWidth) {ctx.save();ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.clip();ctx.drawImage(image,x-radius,y-radius,radius*2,radius*2);ctx.restore();}
  else {
    const gradient=ctx.createRadialGradient(x-radius*.3,y-radius*.3,0,x,y,radius);
    gradient.addColorStop(0,sun?'#fff5c8':'#70b3d1');gradient.addColorStop(1,sun?'#d69a3a':'#143758');
    ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}
export function bodyStatus(sample, kind) {
  if(!sample)return {title:'Awaiting calculation',tone:'#97a7bb'};
  if(kind==='sun')return sample.eclipsed?{title:'Eclipse',tone:'#d9a0a0'}:sample.sunFraction<1e-6?{title:'Blocked by terrain',tone:'#eab3a1'}:sample.sunFraction<.999?{title:'Partially visible',tone:'#edc77d'}:{title:'Above terrain skyline',tone:'#d5e4d4'};
  return sample.earthVisible?{title:'Centre above skyline',tone:'#d5e4d4'}:{title:'Centre below skyline',tone:'#eab3a1'};
}
