"""Focused rendered-text contrast audit, not accessibility certification.
Excludes disabled controls, decorative separators, hidden text, and native options.
Requires the same local Python Playwright setup as the journey tests.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import json
import re
ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'artifacts'/'ui-upgrade'
OUTPUT.mkdir(parents=True,exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
AUDIT=r'''() => {
 const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number);
 const lum=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4)}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
 if(Math.abs(contrast([119,119,119],[255,255,255])-4.478089)>0.00001) throw new Error('Contrast fixture failed');
 const background=el=>{let color=[255,255,255];const ancestors=[];for(let e=el;e;e=e.parentElement)ancestors.unshift(e);for(const e of ancestors){const values=rgb(getComputedStyle(e).backgroundColor);if(values.length>=3){const alpha=values.length>3?values[3]:1;color=color.map((v,i)=>values[i]*alpha+v*(1-alpha));}}return color;};
 const issues=[];let sampled=0;
 const modal=document.querySelector('dialog[open]');
 const nodes=modal?modal.querySelectorAll('*'):document.querySelectorAll('main *, .sidebar *, .topbar *, .prototype-strip *');
 for(const e of nodes){
  if(![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())||e.closest('script,style,option,.sr-only,.inline-dot,button:disabled,select:disabled'))continue;
  const r=e.getBoundingClientRect(),s=getComputedStyle(e);if(r.width<2||r.height<2||s.visibility==='hidden'||s.display==='none')continue;
  let foreground=rgb(e instanceof SVGElement?s.fill:s.color);if(foreground.length<3)continue;
  const bg=background(e);let opacity=foreground.length>3?foreground[3]:1;
  for(let a=e;a;a=a.parentElement)opacity*=Number(getComputedStyle(a).opacity);
  foreground=foreground.slice(0,3).map((v,i)=>v*opacity+bg[i]*(1-opacity));
  const ratio=contrast(foreground,bg),size=parseFloat(s.fontSize),large=size>=24||(size>=18.66&&parseInt(s.fontWeight)>=700);sampled++;
  if(ratio<(large?3:4.5))issues.push({selector:typeof e.className==='string'?e.className:'svg-text',tag:e.tagName,text:e.textContent.trim().slice(0,75),color:s.color,fontSize:size,ratio:+ratio.toFixed(2)});
 }
 return {sampled,issues};
}'''
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT/'dist')))
Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':900});report={}
  def sample(name):
   page.wait_for_timeout(250)
   result=page.evaluate(AUDIT);report[name]=result
   print(f'{name}: {result["sampled"]} text samples, {len(result["issues"])} below threshold',flush=True)
   unique={}
   for issue in result['issues']: unique.setdefault(issue['color'],issue)
   if unique: print(json.dumps(list(unique.values()),indent=2))
  for route in ['overview','statements','planning','consolidation','imports','excel','activity','settings']:
   page.goto(f'http://127.0.0.1:{server.server_port}/#/{route}',wait_until='networkidle',timeout=15000);page.wait_for_timeout(250)
   sample(route)
  page.goto(f'http://127.0.0.1:{server.server_port}/#/overview',wait_until='networkidle')
  page.get_by_role('button',name='Review revenue variance',exact=True).click();sample('variance-drawer')
  page.get_by_role('button',name='Inspect Synthetic Packaging revenue variance',exact=True).click();sample('business-variance')
  page.get_by_role('tab',name='Source & lineage',exact=True).click();sample('source-lineage')
  page.keyboard.press('Escape');page.locator('.business-driver-card').first.click();sample('sector-profile');page.keyboard.press('Escape')
  page.goto(f'http://127.0.0.1:{server.server_port}/#/consolidation',wait_until='networkidle')
  page.get_by_role('button',name=re.compile('^6 Review')).click();sample('blocked-reporting-review')
  page.get_by_role('button',name=re.compile('Missing USD')).click();sample('missing-rate-drawer');page.keyboard.press('Escape')
  page.goto(f'http://127.0.0.1:{server.server_port}/#/imports',wait_until='networkidle')
  page.get_by_role('button',name='Use provided example',exact=True).click();sample('import-mapping')
  page.get_by_label('Target for revenue_thousands',exact=True).select_option('')
  page.get_by_role('button',name='Continue',exact=True).click()
  page.get_by_role('button',name='Run demo checks',exact=True).click()
  expect(page.get_by_role('button',name='Fix mappings',exact=True)).to_be_visible();sample('import-error-recovery')
  page.goto(f'http://127.0.0.1:{server.server_port}/#/excel',wait_until='networkidle')
  page.get_by_role('button',name='Check availability · demo',exact=True).click()
  expect(page.get_by_role('button',name='Retry demo check',exact=True)).to_be_visible();sample('excel-unavailable')
  page.get_by_role('tab',name='Write-back preview',exact=True).click();sample('write-preview')
  page.goto(f'http://127.0.0.1:{server.server_port}/#/activity',wait_until='networkidle')
  page.get_by_role('button',name='Open MOCK-003 details',exact=True).click();sample('activity-drawer');page.keyboard.press('Escape')
  page.keyboard.press('Control+k');sample('command-palette')
  page.keyboard.press('Escape');page.set_viewport_size({'width':390,'height':844})
  page.goto(f'http://127.0.0.1:{server.server_port}/#/overview',wait_until='networkidle');sample('overview-mobile')
  page.get_by_role('button',name='Review revenue variance',exact=True).click();sample('variance-mobile')
  (OUTPUT/'contrast-report.json').write_text(json.dumps(report,indent=2))
  total=sum(len(result['issues']) for result in report.values())
  print(f'Total: {sum(result["sampled"] for result in report.values())} text samples across {len(report)} states; {total} below threshold.',flush=True)
  browser.close()
  if total: raise AssertionError(f'{total} sampled text nodes are below the contrast threshold. See contrast-report.json.')
finally: server.shutdown();server.server_close()
