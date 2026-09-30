// Manual local profiling, not a field-INP or CI timing assertion.
// node scripts/profile-public-search.mjs http://localhost:4182/ /tmp/search-profile.json
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
try {
 const page = await browser.newPage({viewport:{width:390,height:844}});
 await page.route('https://fonts.googleapis.com/**',r=>r.abort());
 const client = await page.context().newCDPSession(page);
 await client.send('Emulation.setCPUThrottlingRate',{rate:6});
 const loaded=Promise.all(['reviews-index','bibliography','summaries','tags'].map(name=>page.waitForResponse(r=>r.url().endsWith(`/data/${name}.json`) && r.status()===200)));
 await page.goto(process.argv[2] || 'http://localhost:4182/');await loaded;
 await page.waitForSelector('nav[aria-label="分類快速導覽"]');
 await page.waitForTimeout(500);
 const results=[];
 for(let run=0;run<5;run++) for(const query of ['ACL','knee','review']) {
  await page.getByRole('searchbox').fill(''); await page.waitForFunction(()=>!document.querySelector('section[aria-label="搜尋結果"]'));
  await page.evaluate(query=>{
   window.__measurement=null;
   const input=document.querySelector('input[type="search"]');
   input.addEventListener('input',()=>{
    const start=performance.now();let nextFrame=null;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{nextFrame=performance.now()-start;}));
    const check=()=>{
     const section=document.querySelector('section[aria-label="搜尋結果"]');
     if(section?.querySelector('p')?.textContent?.includes(`「${query}」`)) {
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
       window.__measurement={query,inputToPaintMs:Math.round(nextFrame??0),resultsSettledMs:Math.round(performance.now()-start),rows:section.querySelectorAll('li').length,domNodes:document.querySelectorAll('*').length,overflow:document.documentElement.scrollWidth>innerWidth};
      }));
     }else requestAnimationFrame(check);
    };requestAnimationFrame(check);
   },{once:true});
  },query);
  await page.getByRole('searchbox').fill(query);
  await page.waitForFunction(()=>window.__measurement!==null,{},{timeout:30000});
  results.push({run,...await page.evaluate(()=>window.__measurement)});
 }
 const report={at:new Date().toISOString(),viewport:'390x844',cpuThrottle:6,browser:browser.version(),method:'Local preview, five runs per query; input event to double RAF and results settled double RAF, not field INP. Fonts blocked.',results};
 await writeFile(process.argv[3]||'/private/tmp/review-search-profile.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await browser.close();}
