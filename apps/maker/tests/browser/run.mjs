/* Browser checks, headless, on the built apps: the maker, an exported page, and the desktop host on
   the fake exe the unit tests use, with real pages for its windows. Buddies do as they please, so a
   check never counts on one standing still: it either steers them or waits for what it asks for.
   Needs a Chromium that is already installed: set CHROME_PATH, or it looks in Playwright's cache.
     pnpm test:browser */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { build } from 'vite';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const MAKER = path.join(REPO, 'apps/maker/dist'), APP = path.join(REPO, 'apps/desktop/dist/app');
const SP = fs.mkdtempSync(path.join(os.tmpdir(), 'buddies-browser-'));
fs.mkdirSync(SP + '/shots');
console.log('screenshots in', SP + '/shots');
/* the fake exe, bundled for node, so this run and the unit tests share one set of rules */
await build({ root: path.join(REPO, 'apps/desktop'), configFile: false, logLevel: 'error', publicDir: false, build: { outDir: SP + '/fake', emptyOutDir: false, minify: false, lib: { entry: path.join(REPO, 'apps/desktop/src/shell-fake.ts'), formats: ['es'], fileName: () => 'shell-fake.mjs' } } });
const { createFakeExe } = await import(pathToFileURL(SP + '/fake/shell-fake.mjs').href);
/* the engine, for its lines and its guess at a bubble's size */
await build({ root: path.join(REPO, 'packages/engine'), configFile: false, logLevel: 'error', publicDir: false, build: { outDir: SP + '/engine', emptyOutDir: false, minify: false, lib: { entry: path.join(REPO, 'packages/engine/src/index.ts'), formats: ['es'], fileName: () => 'engine.mjs' } } });
const { LINES, bubbleSize } = await import(pathToFileURL(SP + '/engine/engine.mjs').href);
/* the bubble probe: the real engine and view on one screen, see bubble-probe.ts */
await build({ root: REPO, configFile: false, logLevel: 'error', publicDir: false, build: { outDir: SP + '/probe', emptyOutDir: false, minify: false, lib: { entry: path.join(REPO, 'apps/maker/tests/browser/bubble-probe.ts'), formats: ['iife'], name: 'BubbleProbe', fileName: () => 'bubble-probe.js' } } });
/* an artist's lengths, up to 38 letters, and one word longer than a bubble is wide */
const LONG_LINES = ['Have you been staring at that all day?', 'Hey! That tickles, please stop it now!', 'Mmm, that is the good spot right there', 'I think I will take a little nap here.', 'Supercalifragilisticexpialidociously!!', 'Pneumonoultramicroscopicsilicovolcanoconiosis'];

function chrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  const found = fs.existsSync(cache) ? fs.readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1]) : [];
  if (found.length) return path.join(cache, found[0], 'chrome-linux64/chrome');
  throw new Error('no Chromium found: set CHROME_PATH');
}
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };
/* Port 0: the system picks a free one, so runs side by side can't collide. Resolves to the server and its origin. */
/* `as`: paths answered from elsewhere, like the test's own seed in place of whatever a build ships */
function serve(dir, as = {}) {
  return new Promise(r => {
    const s = http.createServer((q, a) => {
      let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
      const f = as[p] ?? path.join(dir, p);
      if (!(p in as) && !f.startsWith(dir) || !fs.existsSync(f)) { a.writeHead(404); return a.end(); }
      a.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); a.end(fs.readFileSync(f));
    }).listen(0, '127.0.0.1', () => r({ server: s, origin: `http://127.0.0.1:${s.address().port}` }));
  });
}
const results=[];const ok=(n,c,x)=>{results.push([!!c,n,x]);console.log((c?'ok  ':'FAIL')+' '+n+(x!==undefined?' :: '+x:''));};
const watch=(page,errs)=>{page.on('pageerror',e=>errs.push('pageerror '+e.message));page.on('console',m=>{if(m.type()==='error'&&!/ERR_|Failed to load resource/.test(m.text()))errs.push(m.text());});};
(async()=>{
 const maker=await serve(MAKER),app=await serve(APP,{'/seed.json':path.join(REPO,'packages/test-support/fixtures/sample.json')}),scratch=await serve(SP),servers=[maker.server,app.server,scratch.server];
 const browser=await chromium.launch({headless:true,executablePath:chrome(),args:['--no-sandbox']});
 try{
 // ---- the built folders
 {const list=fs.readdirSync(APP).filter(f=>f!=='seed.json').sort().join();ok('the app folder holds what the exe needs, and a seed only if the build has one',list==='buddy-menu.css,buddy-menu.html,buddy-menu.js,fonts,hub.html,hub.js,maker.css,maker.html,maker.js,manager.css,manager.html,manager.js,overlay.html,overlay.js,style.css,tray.png,world.js',list);
  const html=fs.readFileSync(APP+'/overlay.html','utf8'),mk=fs.readFileSync(MAKER+'/index.html','utf8');
  ok('asset paths are relative',![html,mk].some(h=>/(src|href)="\/[^/]/.test(h)));
  ok('overlay scripts are classic',!/type="module"/.test(html)&&!/type="module"/.test(mk));
  for(const f of ['world.js','overlay.js','hub.js']){const js=fs.readFileSync(APP+'/'+f,'utf8');let classic=true;try{new Function(js)}catch{classic=false}ok(f+' is one classic script',classic&&!/importScripts|import\.meta/.test(js));}}
 // ---- the maker straight from a file
 {const ctx=await browser.newContext({viewport:{width:1280,height:720}});const page=await ctx.newPage();await page.route(/fonts\.g/,r=>r.abort());
  await page.goto('file://'+MAKER+'/index.html');await page.waitForSelector('.pn-count:not(:empty)',{timeout:8000});await page.click('.pn-sample >> nth=0');await page.waitForSelector('.db-pet',{timeout:8000});ok('the built maker opens from a file',true);await ctx.close();}
 // ---- maker
 {const ctx=await browser.newContext({viewport:{width:1280,height:720},acceptDownloads:true});const page=await ctx.newPage();const errs=[];watch(page,errs);
  await page.route(/fonts\.g/,r=>r.abort());
  // a first start holds no buddy: the samples are offered, and she's added from one
  await page.goto(maker.origin+'/');await page.waitForSelector('.pn-count:not(:empty)');await page.waitForTimeout(300);
  const first=await page.evaluate(`({pets:document.querySelectorAll('.db-pet').length,tabs:document.querySelectorAll('.pn-pet').length,count:document.querySelector('.pn-count').textContent,editor:document.querySelector('.pn-ed').hidden,samples:[...document.querySelectorAll('.pn-sample')].map(b=>b.getAttribute('aria-label')),add:!!document.querySelector('.pn-add'),world:buddies.pets.size})`);
  ok('a first start holds no buddy, and offers the samples and Add',first.pets===0&&first.tabs===0&&first.world===0&&/^0 \//.test(first.count)&&first.editor&&first.add&&first.samples.length===3&&first.samples.map(l=>l.split(' ')[1]).join()==='Pip,Pudding,Sprout',JSON.stringify(first));
  await page.click('.pn-sample >> nth=0');await page.waitForSelector('.db-pet');await page.waitForTimeout(1200);
  const a=await page.evaluate(`({n:document.querySelectorAll('.db-pet').length,tf:document.querySelector('.db-pet').style.transform,src:document.querySelector('.db-pet img').src.slice(0,22),count:document.querySelector('.pn-count').textContent,k:[...buddies.pets.values()][0].P.k,surf:[...buddies.pets.values()][0].P.surf})`);
  ok('maker shows Pip',a.n===1&&a.src.startsWith('data:image/png'),JSON.stringify(a));
  fs.writeFileSync(SP+'/broken.png','not an image');await page.setInputFiles('.pn-add input',SP+'/broken.png');
  const said=await page.waitForFunction(`document.querySelector('#toast').textContent==="Couldn't open that image"`,null,{timeout:4000}).then(()=>true,()=>false);
  ok('a broken image says so',said,await page.evaluate(`document.querySelector('#toast').textContent`));
  await page.screenshot({path:SP+'/shots/maker.png'});
  const offered=()=>page.evaluate(`[...document.querySelectorAll('.pn-acts .pn-act')].filter(b=>b.offsetParent).map(b=>b.dataset.a).join()`);
  const pip=await offered();
  await page.click('.pn-sample >> nth=1');await page.waitForTimeout(300);
  const pudding=await offered();ok('the menu hides what a character has no art for',!pudding.includes('dance')&&pudding.includes('love'),pip.length+' vs '+pudding.length);
  await page.click('.pn-pets .pn-pet >> nth=0');await page.waitForTimeout(100);
  await page.click('.pn-pets .pn-pet >> nth=1');await page.click('.pn-rm');await page.click('.pn-rm');await page.waitForTimeout(1500);
  // availability follows pose edits, for the buddy and for everyone
  const dance=sel=>page.evaluate(`[...document.querySelectorAll('${sel}')].filter(b=>b.dataset.a==='dance').every(b=>b.offsetParent!==null)`);
  await page.click('.pn-pose:has-text("Dance")');await page.click('.pn-pe-clear');await page.waitForTimeout(100);
  ok('clearing the frames takes Dance out of the menus',!(await dance('.pn-acts .pn-act'))&&!(await dance('.pn-all .pn-act')));
  const png=await page.evaluate(`(()=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.fillStyle='#f33';x.fillRect(16,16,32,32);return c.toDataURL('image/png').split(',')[1]})()`);
  fs.writeFileSync(SP+'/dance_1.png',Buffer.from(png,'base64'));
  await page.setInputFiles('.pn-pose-ed input[type=file]',SP+'/dance_1.png');await page.waitForTimeout(500);
  ok('first frames put Dance back in the menus',await dance('.pn-acts .pn-act')&&await dance('.pn-all .pn-act'));
  ok('new slots are in the pose grid, and files name them',await page.evaluate(`document.querySelector('.pn-poses').textContent.includes('Stand from sit')&&buddies.tools.poseFromFile('stand_from_sit_2.png')==='stand_from_sit'&&buddies.tools.poseFromFile('stand_up.png')==='stand_up'&&buddies.tools.poseFromFile('stand_1.png')==='stand'`));
  /* Hearts plays on the floor, so one asked for in the air waits for her landing: give it that long, and say where she was if not. */
  const was=await page.evaluate(`[...buddies.pets.values()].map(p=>p.P.state+'/'+p.P.surf).join()`);
  await page.click('.pn-acts button:has-text("Hearts")');
  const hearts=await page.waitForFunction(`document.querySelectorAll('.db-fx-heart').length>0`,null,{timeout:3000}).then(()=>true,()=>false);
  ok('action spawns hearts',hearts,hearts?undefined:{asked:was,now:await page.evaluate(`[...buddies.pets.values()].map(p=>p.P.state+'/'+p.P.surf).join()`)});
  await page.waitForTimeout(2600);
  await page.click('.pn-acts button:has-text("Climb wall")');
  await page.waitForFunction(`['left','right'].includes([...buddies.pets.values()][0].P.surf)`,null,{timeout:30000});
  await page.waitForTimeout(300);await page.screenshot({path:SP+'/shots/maker-wall.png'});
  ok('climbs a wall',true,await page.evaluate(`document.querySelector('.db-body').style.transform.slice(0,40)`));
  await page.click('.pn-acts button:has-text("Come down")');await page.waitForFunction(`[...buddies.pets.values()][0].P.surf==='floor'`,null,{timeout:8000});
  const box=await page.evaluate(`(()=>{const P=[...buddies.pets.values()][0].P;return {x:P.x,y:P.y-40}})()`);
  await page.waitForTimeout(600);
  const box2=await page.evaluate(`(()=>{const P=[...buddies.pets.values()][0].P;buddies.pause();return {x:P.x,y:P.y-40}})()`);await page.waitForTimeout(60);
  // thrown inward: she has just been on a wall, and a throw into one that's under her grip speed is a catch, not a flight
  const inward=box2.x<640?1:-1;
  await page.click('.pn-fold');await page.mouse.move(box2.x,box2.y);await page.mouse.down();await page.evaluate(`buddies.pause(false)`);await page.mouse.move(box2.x+inward*60,box2.y-120,{steps:4});await page.mouse.move(box2.x+inward*200,box2.y-300,{steps:6});
  const held=await page.evaluate(`[...buddies.pets.values()][0].P.state+' '+document.querySelector('.db-pet').classList.contains('grab')`);
  await page.mouse.up();ok('real pointer drag holds and grabs',held==='held true',held);
  await page.waitForTimeout(100);const thrown=await page.evaluate(`(()=>{const P=[...buddies.pets.values()][0].P;return {state:P.state,surf:P.surf,x:Math.round(P.x),y:Math.round(P.y),vx:P.vx,vy:P.vy}})()`);ok('release throws',thrown.state==='air',JSON.stringify({...thrown,from:box2}));
  await page.setViewportSize({width:900,height:500});await page.waitForTimeout(1500);
  ok('resize refits',await page.evaluate(`(()=>{const P=[...buddies.pets.values()][0].P;return P.y<=500&&P.x<=900})()`));
  await page.setViewportSize({width:1280,height:720});await page.click('.pn-fold');
  // buddy file round trip
  const dl=page.waitForEvent('download');await page.click('.pn-export');const f=await dl;ok('saves as .buddy',/\.buddy$/.test(f.suggestedFilename()),f.suggestedFilename());const fp=SP+'/pip.buddy';await f.saveAs(fp);
  const J=JSON.parse(fs.readFileSync(fp));ok('save buddy file is v2 with a character',J.version===2&&!!J.buddy.character&&!J.buddy.id,J.buddy.character);
  await page.setInputFiles('.pn-import',fp);await page.waitForFunction(`document.querySelectorAll('.db-pet').length===2`,null,{timeout:4000});
  ok('import keeps the character',await page.evaluate(`(async()=>{const d=await new Promise((res)=>{const r=indexedDB.open('desktop-buddies');r.onsuccess=()=>{const q=r.result.transaction('kv').objectStore('kv').get('state');q.onsuccess=()=>res(q.result)}});return d.pets[1].character})()`)===J.buddy.character);
  const v1=JSON.parse(JSON.stringify(J));v1.version=1;delete v1.buddy.character;fs.writeFileSync(SP+'/v1.buddy.json',JSON.stringify(v1));
  await page.setInputFiles('.pn-import',SP+'/v1.buddy.json');await page.waitForFunction(`document.querySelectorAll('.db-pet').length===3`,null,{timeout:4000});
  ok('v1 file imports and upgrades',await page.evaluate(`(async()=>{await new Promise(r=>setTimeout(r,200));const d=await new Promise((res)=>{const r=indexedDB.open('desktop-buddies');r.onsuccess=()=>{const q=r.result.transaction('kv').objectStore('kv').get('state');q.onsuccess=()=>res(q.result)}});return d.pets[2].character&&d.pets[2].character!==d.pets[0].character})()`));
  const evil=JSON.parse(JSON.stringify(J));evil.buddy.base.src='x" onerror="window.__pwned=1';fs.writeFileSync(SP+'/evil.buddy.json',JSON.stringify(evil));
  await page.setInputFiles('.pn-import',SP+'/evil.buddy.json');await page.waitForTimeout(200);
  ok('hostile file gets the toast',await page.evaluate(`document.querySelector('#toast').textContent`)==="That isn't a Desktop Buddies file");
  ok('no third import added',await page.evaluate(`document.querySelectorAll('.db-pet').length===3&&!window.__pwned`));
  // export
  const html=await page.evaluate(`(async()=>{const d=await new Promise((res)=>{const r=indexedDB.open('desktop-buddies');r.onsuccess=()=>{const q=r.result.transaction('kv').objectStore('kv').get('state');q.onsuccess=()=>res(q.result)}});return buddies.tools.build(d)})()`);
  fs.writeFileSync(SP+'/exported.html',html);ok('export builds one page, nothing to fetch',html.length>10000&&!/<script src=/.test(html)&&(html.match(/<script>/g)||[]).length===2,html.length);
  ok('maker has no errors',errs.length===0,errs.join(' | '));await ctx.close();}
 // ---- her lines in the bubble: wrapped inside it at spaces, and never more lines than the engine places it for
 {const ctx=await browser.newContext({viewport:{width:1280,height:720}});const page=await ctx.newPage();const errs=[];watch(page,errs);await page.route(/fonts\.g/,r=>r.abort());
  await page.goto(maker.origin+'/');await page.waitForSelector('.pn-count:not(:empty)');await page.click('.pn-sample >> nth=0');await page.waitForSelector('.db-pet');
  const lines=[...new Set(Object.values(LINES).flat().filter(Boolean))].concat(LONG_LINES);
  const got=await page.evaluate(lines=>lines.map(t=>{
   const b=document.createElement('div');b.className='db-bubble';b.textContent=t;document.body.append(b);
   const r=b.getBoundingClientRect(),s=getComputedStyle(b),range=document.createRange(),pen=document.createElement('canvas').getContext('2d');pen.font=s.font;
   const wide=b.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),broken=[];
   for(const m of t.matchAll(/\S+/g)){range.setStart(b.firstChild,m.index);range.setEnd(b.firstChild,m.index+m[0].length);if(new Set([...range.getClientRects()].map(q=>Math.round(q.top))).size>1&&pen.measureText(m[0]).width<=wide)broken.push(m[0]);}
   range.selectNodeContents(b);const x=range.getBoundingClientRect(),lh=parseFloat(s.lineHeight);b.remove();
   return {t,w:r.width,lines:Math.round(x.height/lh),inside:x.left>=r.left-1&&x.right<=r.right+1&&x.top>=r.top-1&&x.bottom<=r.bottom+1,broken};
  }),lines);
  const bad=got.filter(g=>!g.inside||g.broken.length||g.w>240.5);
  ok('every line wraps inside its bubble, at spaces, no wider than 240',!bad.length,JSON.stringify(bad.slice(0,3)));
  ok('an artist\'s 38 letters take one or two lines, in the bundled Nunito',got.filter(g=>g.t.length===38).every(g=>g.lines===1||g.lines===2),got.filter(g=>g.t.length===38).map(g=>g.lines).join());
  const short=got.filter(g=>g.lines>bubbleSize(g.t).lines);
  ok('the engine never places a bubble for fewer lines than it shows',!short.length,JSON.stringify(short.slice(0,3)));
  /* one said for real: over her head, all of it on the page, its tail under it at her */
  const said=async t=>{await page.evaluate(t=>{const p=[...buddies.pets.values()][0];p.say(t);},t);await page.waitForTimeout(400);
   return page.evaluate(()=>{const b=[...document.querySelectorAll('.db-bubble')].find(e=>!e.hidden),img=document.querySelector('.db-pet img').getBoundingClientRect();if(!b)return null;const r=b.getBoundingClientRect();
    return {below:b.classList.contains("below"),r:[r.left,r.top,r.right,r.bottom].map(Math.round),her:[img.left,img.top,img.right,img.bottom].map(Math.round),lines:Math.round((r.height-14)/parseFloat(getComputedStyle(b).lineHeight))};});};
  const one=await said(LONG_LINES[0]);
  ok('said for real: it wraps, whole on the page, over her',one&&one.lines>=2&&one.r[0]>=0&&one.r[2]<=1280&&one.r[1]>=0&&(one.below?one.r[1]>=(one.her[1]+one.her[3])/2:one.r[3]<=(one.her[1]+one.her[3])/2)&&(one.r[0]+one.r[2])/2>=one.her[0]-130&&(one.r[0]+one.r[2])/2<=one.her[2]+130,JSON.stringify(one));
  await page.screenshot({path:SP+'/shots/bubble-long.png'});
  ok('long lines, no errors',errs.length===0,errs.join(' | '));
  await ctx.close();}
 // ---- her bubble stays on the page, wherever she is and whatever the engine guessed, and its tail points at her.
 // The engine places it by a guess at its size: wide letters, other scripts and an app's badge can make it bigger
 // than guessed, and a big buddy can leave room on neither side of her. The view measures it and fixes that.
 {const ctx=await browser.newContext({viewport:{width:1280,height:720}});const page=await ctx.newPage();const errs=[];watch(page,errs);
  await page.setContent('<!doctype html><div id="root"></div>');
  await page.addStyleTag({content:fs.readFileSync(path.join(REPO,'packages/view/src/view.css'),'utf8')+' .db-bubble{animation:none!important}'});
  await page.addScriptTag({content:fs.readFileSync(SP+'/probe/bubble-probe.js','utf8')});
  const CASES=[
   ['against the left wall','Have you been staring at that all day?',{x:36,name:''},true],
   ['against the right wall','Have you been staring at that all day?',{x:1244,name:''},true],
   ['a big buddy with a long line, room on neither side','a '.repeat(149)+'a',{size:512,x:640}],
   ['a big buddy with a short line','Hi',{size:512,x:640}],
   ['an app\'s wide badge at the left wall','Hi',{x:36,from:'Very Wide App Name Here'},true],
   ['wide letters at the left wall','W'.repeat(27),{x:36},true],
   ['wide letters, many lines, near the top','W'.repeat(108),{x:640,floor:222}],
   ['wide letters, many lines, near the top, at the right wall','W'.repeat(108),{x:1244,floor:222},true],
   ['other scripts at the left wall','\u4f60\u597d\u5417\u4eca\u5929\u5929\u6c14\u5f88\u597d'.repeat(4),{x:36},true],
   ['a short line in the open','Hi there!',{x:640},true]];
  for(const [what,text,o,tail] of CASES){
   const g=await page.evaluate(({text,o})=>{const p=probe(text,o),b=document.querySelector('.db-bubble'),r=b.getBoundingClientRect(),t=getComputedStyle(b,'::after');
    return {her:p.her,r:[r.left,r.top,r.right,r.bottom].map(n=>Math.round(n*10)/10),tail:r.left+parseFloat(t.left),below:b.classList.contains('below')};},{text,o});
   ok(`bubble ${what}: all of it on the page`,g.r[0]>=-.5&&g.r[2]<=1280.5&&g.r[1]>=-.5&&g.r[3]<=720.5,JSON.stringify(g));
   if(tail)ok(`bubble ${what}: its tail points at her`,g.tail>=g.her[0]&&g.tail<=g.her[1]&&g.tail>=g.r[0]+14&&g.tail<=g.r[2]-14,JSON.stringify(g));
   await page.screenshot({path:`${SP}/shots/bubble-${what.replace(/\W+/g,'-')}.png`});
  }
  /* Two monitors: the overlay her middle is on shows her bubble, whole, and the other shows none of it.
     Fitting it into the neighbour once made a second bubble there with no buddy under it. */
  const whole=b=>b&&b[0]>=0&&b[2]<=1280&&b[1]>=0&&b[3]<=720;
  const LINE='Have you been staring at that all day?';
  /* the last: letters the engine's guess counts narrow, so its place spills over the seam, and the neighbour hides that */
  for(const [what,x,side,owner,text=LINE] of [['near the seam, on the left',1170,'right',0],['across the seam, her middle on the left',1260,'right',0],['across the seam, her middle on the right',1300,'right',1],['near the right wall, a monitor under her',1244,'below',0],['near the seam, a line wider than the engine guessed',1244,'right',0,'\u0174'.repeat(27)]]){
   const g=await page.evaluate(({x,side,text})=>pair(text,x,side),{x,side,text});
   const mine=g[owner],other=g[1-owner];
   ok(`two monitors, ${what}: her overlay shows her bubble whole, its tail at her`,whole(mine.bubble)&&mine.tail>=Math.max(mine.her[0],mine.bubble[0]+14)-.5&&mine.tail<=Math.min(mine.her[1],mine.bubble[2]-14)+.5,JSON.stringify(g));
   ok(`two monitors, ${what}: the other shows none of it`,other.bubble===null,JSON.stringify(g));
  }
  await page.screenshot({path:`${SP}/shots/bubble-two-monitors.png`});
  ok('bubble probe, no errors',errs.length===0,errs.join(' | '));
  await ctx.close();}
 // ---- exported page
 {const ctx=await browser.newContext({viewport:{width:1000,height:600}});const page=await ctx.newPage();const errs=[];watch(page,errs);await page.route(/fonts\.g/,r=>r.abort());
  await page.goto('file://'+SP+'/exported.html');await page.waitForSelector('.db-pet');await page.waitForTimeout(1500);
  ok('exported page runs from a file',await page.evaluate(`document.querySelectorAll('.db-pet').length`)===3);
  await page.evaluate(`buddies.pause()`);await page.waitForTimeout(50);
  const p=await page.evaluate(`(()=>{const P=[...buddies.pets.values()][0].P;const r=document.querySelector('.db-pet img').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,on:P.surf}})()`);
  await page.evaluate(`(()=>{const sync=buddies.sync;buddies.sync=s=>{window.__sent=s.pets.map(({id,character})=>({id,character}));return sync(s)};addEventListener('contextmenu',e=>{window.__under=[...document.querySelectorAll('.db-pet')].indexOf(e.target.closest('.db-pet'))},true)})()`);
  await page.mouse.click(p.x,p.y,{button:'right'});await page.waitForTimeout(100);
  ok('right click opens the menu',await page.evaluate(`!document.querySelector('.bm').hidden&&document.querySelector('.bm b').textContent.length>0`),await page.evaluate(`document.querySelector('.bm').innerText.replace(/\\n/g,' / ')`));
  await page.evaluate(`buddies.pause(false)`);
  await page.click('.bm button:has-text("Call another")');await page.waitForFunction(`document.querySelectorAll('.db-pet').length===4`,null,{timeout:3000});
  const sent=await page.evaluate(`window.__sent`),under=await page.evaluate(`window.__under`),copy=sent[3],source=sent[under];
  ok('call another shares the character, with a run of its own',sent.length===4&&!!copy.character&&copy.character===source.character&&new Set(sent.map(b=>b.id)).size===4&&await page.evaluate(`buddies.pets.has(${JSON.stringify(copy.id)})`),JSON.stringify({under,sent}));
  await page.evaluate(`buddies.pause()`);await page.waitForTimeout(50);
  const p2=await page.evaluate(`(()=>{const r=document.querySelector('.db-pet img').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await page.mouse.click(p2.x,p2.y,{button:'right'});await page.waitForTimeout(100);await page.evaluate(`buddies.pause(false)`);
  await page.click('.bm button:has-text("Dismiss all")');await page.waitForTimeout(2200);
  ok('dismiss all leaves the bring-back button',await page.evaluate(`document.querySelectorAll('.db-pet').length===0&&!document.querySelector('.bm-back').hidden`));
  await page.click('.bm-back');await page.waitForTimeout(300);ok('brought back',await page.evaluate(`document.querySelectorAll('.db-pet').length`)===3);
  await page.screenshot({path:SP+'/shots/exported.png'});
  ok('exported page has no errors',errs.length===0,errs.join(' | '));await ctx.close();}
 // ---- same run, original and refactor, in a real DOM
 {const seed=`(()=>{let a=12345;window.__reseed=()=>{a=12345};Math.random=()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};let n=0;performance.now=()=>n;const due=[],clear=clearTimeout;let id=1e6;window.__fakeTimers=()=>{window.setTimeout=(f,ms=0)=>{due.push({id:++id,at:n+ms,f});return id};window.clearTimeout=i=>{const k=due.findIndex(t=>t.id===i);if(k>=0)due.splice(k,1);else clear(i)}};window.__tick=v=>{n+=v;for(const t of due.filter(t=>t.at<=n).sort((a,b)=>a.at-b.at)){due.splice(due.indexOf(t),1);t.f()}};})();`;
  const scene=`(async()=>{if(window.buddies)buddies.pause();await new Promise(r=>setTimeout(r,300));__fakeTimers();if(window.__reseed)__reseed();let root=document.getElementById('root');if(window.buddies){root=document.createElement('div');document.body.append(root);}const ctl=(window.buddies?buddies.tools:DesktopBuddies).createWorld({root,bounds:()=>({w:1000,h:600})});ctl.pause();
   const art=k=>Object.fromEntries(['dance','sing','eat','think'].map(p=>[p,{fps:4,frames:[{src:'data:image/png;base64,iVBORw0KGgoAAA'+k,bb:{x0:.2,y0:.05,x1:.8,y1:1}}]}]));
   ctl.sync({pets:[{id:'a',name:'Ann',size:120,faces:'right',poses:art('a'),base:{src:'data:image/png;base64,iVBORw0KGgo=',bb:{x0:.2,y0:.05,x1:.8,y1:1}}},{id:'b',name:'Bo',size:90,faces:'left',poses:{...art('b'),walk:{fps:6,frames:[{src:'data:image/png;base64,iVBORw0KGgoA',bb:{x0:.1,y0:.1,x1:.9,y1:1}}]}},base:{src:'data:image/png;base64,iVBORw0KGgoAA',bb:{x0:.2,y0:.05,x1:.8,y1:1}}}]});
   const out=[];const raf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   for(let i=0;i<60;i++){for(let j=0;j<40;j++){__tick(16.667);ctl.step(1);}await raf();
     out.push([...root.children].map(e=>e.className+'|'+e.style.cssText+'|'+e.hidden+'|'+e.textContent+'|'+e.innerHTML.replace(/data:[^"]*/g,'')).join('\\n'));}
   return out;})()`;
  fs.mkdirSync(SP+'/orig',{recursive:true});
  fs.copyFileSync(path.join(REPO,'apps/maker/tests/golden/original/engine.js'),SP+'/orig/engine.js');
  fs.writeFileSync(SP+'/style.css',fs.readdirSync(MAKER+'/assets').filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(MAKER+'/assets/'+f,'utf8')).join(''));
  fs.writeFileSync(SP+'/orig/index.html','<!doctype html><link rel=stylesheet href=/style.css><div id=root></div><script src=/orig/engine.js></script>');
  // the maker draws random numbers as it starts, so it has to be done starting before the scene reseeds;
  // and the scene's clock is its own, so timers run on it, not on how busy the machine is
  const run=async(url,ready)=>{const ctx=await browser.newContext({viewport:{width:1000,height:600}});const page=await ctx.newPage();await page.route(/fonts\.g/,r=>r.abort());await page.addInitScript(seed);await page.goto(url);if(ready)await page.waitForSelector(ready);const r=await page.evaluate(scene);await ctx.close();return r;};
  const A=await run(scratch.origin+'/orig/index.html'),B=await run(maker.origin+'/','.pn-count:not(:empty)');
  let same=A.length===B.length,at=-1;for(let i=0;i<A.length;i++)if(A[i]!==B[i]){same=false;at=i;break;}
  ok('real DOM: original and refactor write the same strings over 2400 steps',same,same?A[59].length+' chars at the end':'differ at '+at+'\n'+A[at]+'\n---\n'+B[at]);}
 // ---- desktop: the real hub, overlays and world, on a fake exe
 {const MONS=[{i:0,name:'A',primary:true,scale:1,x:0,y:0,w:3440,h:1392,full:{x:0,y:0,w:3440,h:1440}},{i:1,name:'B',primary:false,scale:1.5,x:720,y:1440,w:1920,h:1008,full:{x:720,y:1440,w:1920,h:1080}}];
  const ctx=await browser.newContext({viewport:{width:3440,height:1392}});
  const exe=createFakeExe({monitors:MONS,args:['--buddies','3']}),files=exe.files,pages=new Map(),specs=new Map(),errs=[];
  /* The page's half of the door: bytes cross as base64, and what a test reads stays on the page. */
  const stub=boot=>`window.__BUDDIES__=${JSON.stringify(boot)};window.__calls=[];window.__log=[];window.__on={};
   const b64=u=>{let s='';for(const c of u)s+=String.fromCharCode(c);return btoa(s)},raw=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)).buffer;
   window.__TAURI__={core:{invoke:async(c,a,o)=>{window.__calls.push([c,a]);if(c==='log_line')window.__log.push(a.line);
    const r=await __exe(c,a instanceof Uint8Array?{bytes:b64(a)}:a,o);return r&&r.bytes!==undefined?raw(r.bytes):r;
   }},event:{listen:async(n,f)=>{(window.__on[n]=window.__on[n]||[]).push(f);}}};`;
  await ctx.route('**/library/**',r=>{const f=files.get(new URL(r.request().url()).pathname.slice(1));return f?r.fulfill({body:Buffer.from(f),contentType:'image/webp'}):r.fulfill({status:404});});
  /* The other half: the fake answers, and its windows become real pages here, sized in whole CSS pixels as a page is. */
  await ctx.exposeFunction('__exe',async(cmd,a,o)=>{
   const out=await exe.invoke(cmd,a&&a.bytes!==undefined?Buffer.from(a.bytes,'base64'):a,o);
   if(cmd==='window_open'){const m=a.spec.boot.me,p=await ctx.newPage();specs.set(a.spec.label,a.spec);await p.setViewportSize({width:Math.round(a.spec.w/m.scale),height:Math.round(a.spec.h/m.scale)});await p.addInitScript(stub(a.spec.boot));watch(p,errs);pages.set(a.spec.label,p);await p.goto(app.origin+'/'+a.spec.page);}
   if(cmd==='window_close'){await pages.get(a.label).close();pages.delete(a.label);}
   return out instanceof ArrayBuffer?{bytes:Buffer.from(out).toString('base64')}:out;
  });
  const hub=await ctx.newPage();await hub.addInitScript(stub(null));watch(hub,errs);await hub.goto(app.origin+'/hub.html');
  const opened=async l=>{for(let i=0;i<200&&!pages.has(l);i++)await hub.waitForTimeout(50);return pages.get(l);};
  const top=await opened('overlay0'),low=await opened('overlay1');
  await top.waitForSelector('.db-pet',{state:'attached',timeout:8000});await low.waitForSelector('.db-pet',{state:'attached',timeout:8000});
  ok('first run seeds the library as files',[...files.keys()].filter(k=>/\.webp$/.test(k)).length>20,files.size);
  const vis=p=>p.evaluate(`[...document.querySelectorAll('.db-pet')].map(e=>({hid:e.hidden,tf:e.style.transform,size:e.style.width}))`);
  // read them as they land: a moment later one may have chosen the trip down by herself
  const landed=l=>l.length===3&&l.every(e=>!e.hid&&parseFloat(e.tf.split(',')[1])>1100);
  let tv=await vis(top);for(let t=0;t<8000&&!landed(tv);t+=50){await top.waitForTimeout(50);tv=await vis(top);}
  const lv=await vis(low);ok('both overlays share one world',lv.length===3&&tv.length===3,JSON.stringify(tv));
  ok('buddies land on the top monitor and show there, not below',tv.every(e=>!e.hid),lv.map(e=>e.hid).join()+' / '+tv.map(e=>e.hid).join());
  // the seed's size at her largest pose scale, in design pixels; on this 1.5x monitor's maths she'd be half as big again
  const seeded=JSON.parse(fs.readFileSync(path.join(REPO,'packages/test-support/fixtures/sample.json'),'utf8')).buddy,most=seeded.size*Math.max(1,...Object.values(seeded.poses).map(p=>p.scale||1));
  ok('drawn at design size, not physical',tv.filter(e=>!e.hid).every(e=>parseFloat(e.size)<=most+1),tv.map(e=>e.size).join()+' vs '+most);
  const where=`(()=>{const e=[...document.querySelectorAll('.db-pet')].find(x=>!x.hidden);if(!e)return null;const r=e.querySelector('img').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height*.6}})()`;
  const feed=async c=>{for(const p of [hub,top,low])await p.evaluate(`window.__on.cursor.forEach(f=>f({payload:${JSON.stringify({right:false,...c})}}))`);};
  // she keeps moving, and on a busy machine she can be gone by the time the cursor gets there: aim again.
  // The top page's CSS pixels are screen pixels from its window's corner, a line down from the screen's.
  const point=p=>{const o=specs.get('overlay0');return {x:Math.round(o.x+p.x),y:Math.round(o.y+p.y)};};
  const captured=()=>top.evaluate(`window.__calls.filter(c=>c[0]==='capture').map(c=>c[1].on)`);
  let w,cap=[];for(let i=0;i<20&&!cap.includes(true);i++){w=point(await top.evaluate(where));await feed({...w,down:false});await top.waitForTimeout(80);cap=await captured();}
  ok('capture goes on over visible pixels',cap.includes(true),cap.join());
  await feed({x:5,y:5,down:false});await top.waitForTimeout(80);
  ok('capture off elsewhere',(await top.evaluate(`window.__calls.filter(c=>c[0]==='capture').map(c=>c[1].on).pop()`))===false);
  // each overlay is its screen less the line across from the taskbar, the taskbar's strip too, and over the strip where she isn't the taskbar keeps the mouse
  ok('the overlays are their screens less one line, never the whole monitor',JSON.stringify([specs.get('overlay0'),specs.get('overlay1')].map(s=>[s.x,s.y,s.w,s.h]))===JSON.stringify([[0,1,3440,1439],[720,1441,1920,1079]]),JSON.stringify([...specs.values()].map(s=>[s.x,s.y,s.w,s.h])));
  ok('each page is sized from its window',JSON.stringify([top.viewportSize(),low.viewportSize()])===JSON.stringify([{width:3440,height:1439},{width:1280,height:Math.round(1079/1.5)}]),JSON.stringify([top.viewportSize(),low.viewportSize()]));
  const strip=async()=>{for(const x of [40,1720,3400]){const her=await top.evaluate(`[...document.querySelectorAll('.db-pet')].some(e=>{if(e.hidden)return false;const r=e.getBoundingClientRect();return ${x}>=r.left&&${x}<=r.right})`);if(!her)return x;}return null;};
  let on=[];for(let i=0;i<20&&on.at(-1)!==true;i++){w=point(await top.evaluate(where));await feed({...w,down:false});await top.waitForTimeout(80);on=await captured();}
  const sx=await strip();await feed({x:sx,y:1420,down:false});await top.waitForTimeout(80);
  ok('over the taskbar strip and not her, the overlay lets the mouse go',on.at(-1)===true&&sx!==null&&(await top.evaluate(`window.__calls.filter(c=>c[0]==='capture').map(c=>c[1].on).pop()`))===false,sx);
  // a drag: press a buddy on the top page, then the stream takes it down to the low monitor
  const pressed=()=>hub.evaluate(`window.__log.some(l=>l.startsWith('press'))`);
  for(let i=0;i<20;i++){
   const again=await top.evaluate(where);w=point(again);await feed({...w,down:false});await top.waitForTimeout(50);
   await top.mouse.move(again.x,again.y);await top.mouse.down();await feed({...w,down:true});await top.waitForTimeout(40);
   if(await pressed())break;
   await top.mouse.up();await feed({...w,down:false});
  }
  for(let i=1;i<=30;i++){await feed({x:Math.round(w.x+(1500-w.x)*i/30),y:w.y+i*25,down:true});await top.waitForTimeout(16);}
  await top.waitForTimeout(60);
  const dragged=await low.evaluate(`[...document.querySelectorAll('.db-pet')].filter(x=>!x.hidden&&x.classList.contains('grab')).length`);
  ok('dragged across: the low overlay draws her held',dragged===1,dragged);
  ok('source overlay kept the mouse through the drag',(await top.evaluate(`window.__calls.filter(c=>c[0]==='capture').map(c=>c[1].on).pop()`))===true);
  await low.screenshot({path:SP+'/shots/desktop-low-held.png'});
  await feed({x:1500,y:w.y+760,down:false});await top.mouse.up();await top.waitForTimeout(800);
  ok('released: nobody is held',(await top.evaluate(`document.querySelectorAll('.db-pet.grab').length`))===0);
  const lg=await hub.evaluate(`window.__log`);ok('log shows press, release, crossing',['press','release','crossed'].every(k=>lg.some(l=>l.startsWith(k))),lg.filter(l=>/press|release|crossed/.test(l)).slice(0,6).join(' ; '));
  // the walls and ceilings, by asking
  await low.evaluate(`window.__w=new SharedWorker('world.js',{name:'world'}).port;window.__w.start();`);
  const act=a=>low.evaluate(`window.__w.postMessage({k:'act-all',a:${JSON.stringify(a)}})`);
  const count=p=>p.evaluate(`[...document.querySelectorAll('.db-pet')].filter(e=>!e.hidden).length`);
  await top.waitForTimeout(1500);
  // only a buddy standing on the floor over the low monitor can go: one on a wall, or further along, has to come back first
  const onLow=()=>low.evaluate(`[...document.querySelectorAll('.db-pet')].filter(e=>!e.hidden&&parseFloat(e.style.transform.split(',')[1])>300).length`);
  let asked=0;while(asked<4||(asked<12&&await onLow()<2)){await act('dropThrough');await top.waitForTimeout(1500);asked++;}
  const onlow=await onLow();ok('the trip down lands those over it on the low monitor',onlow>=2,onlow+' after asking '+asked+' times');
  await low.screenshot({path:SP+'/shots/desktop-low-trip.png'});
  await act('climbGo');await top.waitForTimeout(9000);await low.screenshot({path:SP+'/shots/desktop-low-climb.png'});
  await act('drop');await top.waitForTimeout(3000);await act('ceilGo');await top.waitForTimeout(3500);
  await low.screenshot({path:SP+'/shots/desktop-low-ceil.png'});
  // once up, she may climb or head for the ceiling, so any height on the top monitor counts; on a wall she can't jump, so down first.
  // a jump passes that height whether she lands or not, so it has to hold for longer than a jump lasts
  const onTop=()=>top.evaluate(`[...document.querySelectorAll('.db-pet')].filter(e=>!e.hidden&&parseFloat(e.style.transform.split(',')[1])<1392).length`);
  const allUp=async(ms,hold=2000)=>{let since=-1;for(let t=0;t<ms;t+=100){if(await onTop()===3){if(since<0)since=t;if(t-since>=hold)return true;}else since=-1;await top.waitForTimeout(100);}return false;};
  let rounds=0,up=false;while(!up&&rounds<6){await act('drop');await top.waitForTimeout(2500);await act('jumpThrough');up=await allUp(7000);rounds++;}
  ok('the trip up lands them on the top monitor',up,'after '+rounds+' tries, '+await onTop()+' up');
  await top.screenshot({path:SP+'/shots/desktop-top-back.png'});
  // a monitor goes while it runs, with buddies on it, and comes back
  for(let i=0;i<2;i++){await act('dropThrough');await top.waitForTimeout(1500);}
  const monitors=l=>{exe.monitors=l;return hub.evaluate(`window.__on.monitors.forEach(f=>f({payload:${JSON.stringify(l)}}))`);};
  await monitors([MONS[0]]);await top.waitForTimeout(4000);
  ok('its overlay closes',!pages.has('overlay1'));
  ok('everyone ends up on the monitor that is left',(await count(top))===3,await count(top));
  await monitors(MONS);const back=await opened('overlay1');await back.waitForSelector('.db-pet',{state:'attached',timeout:8000});
  ok('an overlay opens when it comes back',!!back);
  await top.waitForTimeout(1000);const drawn=(await count(top))+(await count(back));ok('and the world is still drawing',drawn>=3,drawn);
  ok('live run, no errors',errs.length===0,errs.join(' | '));
  await ctx.close();}
 }finally{await browser.close();servers.forEach(s=>s.close());}
 const bad=results.filter(r=>!r[0]);console.log(`\n${results.length-bad.length}/${results.length} passed`);
 process.exit(bad.length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
