"""Package the complete app as one offline HTML file, without external assets.
The same ES modules and classic Worker are used; no separate calculation engine.
"""
from pathlib import Path
import base64,json,re
root=Path(__file__).resolve().parents[1];web=root/'web'
order=['solar-model.js','mission-model.js','decision-model.js','visual-geometry.js','camera-geometry.js','sky-visuals.js','sky-model.js','polar-geometry.js','polar-scene.js','overview.js','assets/vendor/three.core.js','assets/vendor/three.module.js','assets/vendor/OrbitControls.js','scene.js','scene-fallback.js','comparison-scene.js','help-content.js','worker.bundle.js','planner-insights.js','planner-chart.js','planner-experience.js','app.js']
html=(web/'index.html').read_text()
html=re.sub(r'<link\b[^>]*>','',html)
html=re.sub(r'<script\b[^>]*>.*?</script>','',html,flags=re.S)
css=(web/'styles.css').read_text()+'\n'+(web/'planner.css').read_text()
# Inline CSS image assets as well as JavaScript assets so the standalone file
# remains visually complete when opened directly from disk.
for name,mime in [('earth','image/webp'),('sun','image/webp')]:
    asset=web/f'assets/{name}-illustration.webp'
    if asset.exists():
        uri=f'data:{mime};base64,'+base64.b64encode(asset.read_bytes()).decode()
        css=css.replace(f"assets/{name}-illustration.webp",uri)
html=html.replace('</head>','<style>'+css+'</style></head>')
modules=[{'name':n,'source':(web/n).read_text()} for n in order]
payload={'modules':modules,'texture':'data:image/jpeg;base64,'+base64.b64encode((web/'assets/moon-color.jpg').read_bytes()).decode()}
payload['sky']={name:'data:image/webp;base64,'+base64.b64encode((web/('assets/'+name+'-illustration.webp')).read_bytes()).decode() for name in ['sun','earth']}
assets=json.dumps(payload,separators=(',',':')).replace('</','<\\/')
data=(web/'data/lunar-data.json').read_text().replace('</','<\\/')
boot=r'''
<script id="lunashift-embedded-assets" type="application/json">ASSETS</script>
<script id="lunashift-embedded-data" type="application/json">DATA</script>
<script>
(async()=>{
 const payload=JSON.parse(document.getElementById('lunashift-embedded-assets').textContent);
 document.getElementById('lunashift-embedded-assets').remove();
 const originalFetch=window.fetch.bind(window);
 window.fetch=async function(path,options){
  if(String(path)==='data/lunar-data.json')return new Response(document.getElementById('lunashift-embedded-data').textContent,{status:200,headers:{'Content-Type':'application/json'}});
  return originalFetch(path,options);
 };
 const urls={};
 function resolve(from,path){
  if(path==='three')return 'assets/vendor/three.module.js';
  const parts=from.split('/');parts.pop();
  for(const p of path.split('/')){if(p==='.'||!p)continue;if(p==='..')parts.pop();else parts.push(p);}
  return parts.join('/');
 }
 for(const m of payload.modules){
  let source=m.source.replace(/(["'])(\.?\.?\/[^"']+\.js|three)\1/g,(all,q,path)=>{
   const key=resolve(m.name,path);return urls[key]?q+urls[key]+q:all;
  });
  source=source.replaceAll('./assets/moon-color.jpg',payload.texture);
  for(const name of ['sun','earth'])source=source.replaceAll('./assets/'+name+'-illustration.webp',payload.sky[name]);
  urls[m.name]=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
 }
 await import(urls['app.js']);
})().catch(error=>{
 const box=document.getElementById('toast');box.textContent='This browser could not start the offline app: '+error.message+'. Use the included Python launcher instead.';box.className='visible error';
 console.error(error);
});
</script>
'''
# Literal substitution avoids accidental replacement inside source strings.
boot=boot.replace('>ASSETS</script>','>'+assets+'</script>').replace('>DATA</script>','>'+data+'</script>')
html=html.replace('</body>',boot+'</body>')
(root/'LunaShift_Open.html').write_text(html)
print('Built LunaShift_Open.html',len(html.encode()),'bytes')
