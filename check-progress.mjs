import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const html=await fs.readFile(new URL('./index.html',import.meta.url),'utf8');
  let stopped=false;
  await page.route('http://127.0.0.1:4327/**',route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/api/stop')stopped=true;
    const data=pathname==='/api/results'?{records:[],busy:!stopped,connected:true}:pathname==='/api/health'?{model:true}:{stage:stopped?'cancelled':'classifying',total:10,collected:10,completed:3,current:4,startedAt:new Date().toISOString(),busy:!stopped,canStop:!stopped};
    return route.fulfill({contentType:pathname==='/'?'text/html':'application/json',body:pathname==='/'?html:JSON.stringify(data)});
  });
  await page.goto('http://127.0.0.1:4327/');
  await page.getByText('Laya 모델 분류 중',{exact:true}).waitFor();
  assert.equal(await page.locator('#jobdetail').innerText(),'현재 4 / 10번째 · 저장 완료 3개');
  await page.screenshot({path:'progress-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'progress-mobile.png'});
  await page.getByRole('button',{name:'분류 중단',exact:true}).click();
  await page.getByText('분류 중단됨',{exact:true}).waitFor();
  assert.ok((await page.locator('#jobdetail').innerText()).includes('저장 완료 3개'));
  await page.evaluate(()=>renderProgress({stage:'error',total:10,completed:3,error:'연결 오류',startedAt:new Date().toISOString()}));
  assert.ok((await page.locator('#jobdetail').innerText()).includes('저장 완료 3개'));
  await page.evaluate(()=>renderProgress({stage:'done',total:0,completed:0,startedAt:new Date().toISOString()}));
  assert.equal(await page.locator('#joblabel').innerText(),'새로 처리할 메일이 없습니다');
  assert.deepEqual(errors,[]);
  console.log('Progress UI: running, stop button, interrupted, empty completion verified.');
}finally{await browser.close();}
