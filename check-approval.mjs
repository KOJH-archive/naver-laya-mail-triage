import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {buildDigest} from './digest.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const html=await fs.readFile(new URL('./index.html',import.meta.url),'utf8');
const digest=buildDigest([{category:'업무',subject:'긴급 계약 검토',sender:'a@example.com',urgency:'높음',needsReply:true,reviewNeeded:true},{category:'안내',subject:'로그인 알림',sender:'b@example.com',urgency:'낮음'}]);
let sent=0,declined=0,received=null;
try{
  for(const choice of ['decline','approve']){
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    let pending=true;
    await page.route('http://127.0.0.1:4327/**',route=>{
      const pathname=new URL(route.request().url()).pathname;
      if(pathname==='/api/send'){sent++;received=route.request().postDataJSON();pending=false;}
      if(pathname==='/api/decline'){declined++;pending=false;}
      const data=pathname==='/api/results'?{records:[],connected:true,busy:false}:pathname==='/api/health'?{model:true}:pathname==='/api/training'?{report:null}:pathname==='/api/approval'?{approval:pending?{token:'test-token',digest,recipient:'results@gmail.com'}:null}:pathname==='/api/progress'?{stage:'idle'}:{ok:true};
      return route.fulfill({contentType:pathname==='/'?'text/html':'application/json',body:pathname==='/'?html:JSON.stringify(data)});
    });
    await page.goto('http://127.0.0.1:4327/');
    await page.getByRole('heading',{name:'최종승인 하겠습니까?'}).waitFor();
    assert.equal(sent,0);
    assert.equal(await page.locator('#recipient').inputValue(),'results@gmail.com');
    assert.ok((await page.locator('#approval-groups').innerText()).includes('긴급'));
    if(choice==='approve'){
      await page.screenshot({path:'approval-desktop.png'});
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:'approval-mobile.png'});
    }
    if(choice==='decline')await page.getByRole('button',{name:'아니오'}).click();
    else await page.getByRole('button',{name:'예, Gmail로 보내기'}).click();
    await page.locator('#approval').waitFor({state:'hidden'});
    assert.deepEqual(errors,[]);
    await page.close();
  }
  assert.equal(declined,1);assert.equal(sent,1);assert.equal(received.token,'test-token');assert.equal(received.confirmed,true);assert.equal(received.recipient,'results@gmail.com');
  console.log('Approval preview, decline, and explicit send request verified.');
}finally{await browser.close();}
