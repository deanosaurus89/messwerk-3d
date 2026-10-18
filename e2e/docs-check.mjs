import { webkit, chromium, devices } from 'playwright';
const url='https://deanosaurus89.github.io/messwerk-3d/?v='+Date.now();
for (const [br,opt,name] of [[webkit,{viewport:{width:1600,height:1000}},'desktop'],[webkit,devices['iPhone 14'],'iphone']]) {
  const b=await br.launch(); const p=await (await b.newContext(opt)).newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(url,{waitUntil:'load'}); await p.waitForTimeout(4000);
  await p.evaluate(()=>{const x=document.querySelector('#btn-docs')||document.querySelector('#btn-docs2'); x.click();});
  await p.waitForTimeout(1000);
  for (const id of ['median','drf']) { await p.evaluate(i=>document.querySelector('#doc-'+i).scrollIntoView(),id); await p.waitForTimeout(2500);
    const r=await p.evaluate(i=>{const s=document.querySelector('#doc-'+i); const im=[...s.querySelectorAll('img')]; for(const x of im) x.loading='eager'; return {h:s.querySelector('h3').textContent, imgs:im.length}},id);
    await p.waitForTimeout(3000);
    const ok=await p.evaluate(i=>[...document.querySelectorAll('#doc-'+i+' img')].map(x=>x.complete&&x.naturalWidth),id);
    console.log(name,id,r.h,ok.join(',')); await p.screenshot({path:`/tmp/v2/live-${name}-${id}.png`}); }
  console.log(name,'version',await p.evaluate(()=>document.body.innerText.match(/2026\.0\.\d+/)?.[0]),'errors',errs.length);
  await b.close(); }
