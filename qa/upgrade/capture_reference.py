from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image
import json
r=Path(__file__).resolve().parents[2];out=r/'qa/upgrade'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-webgl'])
 page=b.new_page(viewport={'width':1600,'height':1100},device_scale_factor=1)
 page.set_content((r/'LunaShift_Open.html').read_text(),wait_until='load')
 page.wait_for_function('window.LunaShiftOverview?.sample')
 page.locator('#homePlay').click();page.locator('nav [data-page=planner]').click()
 page.wait_for_function('window.LunaShift.state.current&&!window.LunaShift.state.busy')
 page.locator('#findOption').click();page.wait_for_function('window.LunaShift.state.alternative&&!window.LunaShift.state.searching')
 page.locator('#focusAlternative').click();page.locator('#jumpRadio').click()
 page.locator('[data-chart=energy]').click();page.evaluate('scrollTo(0,0)');page.wait_for_timeout(4500)
 path=out/'final-planner.png';page.screenshot(path=str(path),full_page=True)
 im=Image.open(path)
 for id,filename in [('sceneStage','final-linked-views.png'),('scienceReadout','final-energy-link.png'),('decisionAtlas','final-atlas.png')]:
  rect=page.locator('#'+id).bounding_box();x,y,w,h=[rect[n] for n in ['x','y','width','height']];im.crop((round(x),round(y),round(x+w),round(y+h))).save(out/filename)
 page.locator('#dataRibbonOpen').click();page.locator('#dataDrawer').screenshot(path=str(out/'final-data-drawer.png'));page.locator('#dataDrawerClose').click()
 page.set_viewport_size({'width':1280,'height':900});page.evaluate('scrollTo(0,0)');page.screenshot(path=str(out/'final-laptop.png'),full_page=True)
 b.close()
 # Try ordinary browser WebGL without disabling graphics. No network policies are altered.
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1280,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content((r/'LunaShift_Open.html').read_text(),wait_until='load');page.wait_for_function('window.LunaShiftOverview?.sample')
 page.locator('nav [data-page=planner]').click();page.wait_for_function('window.LunaShift.state.current&&!window.LunaShift.state.busy')
 renderer=page.evaluate('window.LunaShift.state.scene.rendererName');page.screenshot(path=str(out/'default-renderer.png'),full_page=True)
 (out/'graphics-probe.json').write_text(json.dumps({'renderer':renderer,'errors':errors,'test':'Ordinary headless Chromium; graphics not disabled; no hardware acceleration was assumed.'},indent=2));print(renderer,errors)
 b.close()
