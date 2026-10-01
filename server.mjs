import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { buildExport, questions, normalize, applyUrgencyPolicy } from './triage.mjs';
import { loadCredentials, saveCredentials, loadRecipient, saveRecipient, loadAutoSend, saveDeliverySettings } from './env-config.mjs';
import { applyCorrections } from './corrections.mjs';
import { buildDigest } from './digest.mjs';
import { autoSendDeadline, autoSendDue } from './approval-policy.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const data = path.join(root, 'data');
await fs.mkdir(data, { recursive: true });
let records = JSON.parse(await fs.readFile(path.join(data, 'results.json'), 'utf8').catch(() => '[]'));
let credentials = null, busy = false;
const envFile=path.join(root,'.env');
let connectionMessage='';
let savedAccount=null;
let jobController=null;
let pendingApproval=null;
let recipient=await loadRecipient(envFile);
let autoSendEnabled=await loadAutoSend(envFile);
let deliveryMessage='';
const approvalFile=path.join(data,'approval-pending.json');
const savedApproval=await fs.readFile(approvalFile,'utf8').then(JSON.parse).catch(()=>null);
if(savedApproval?.status==='sending'){
  deliveryMessage='이전 발송 결과가 불확실합니다. Gmail 수신함을 확인해주세요.';
  await fs.rm(approvalFile,{force:true});
}else if(savedApproval?.token && Array.isArray(savedApproval.ids)){
  const selected=records.filter(record=>savedApproval.ids.includes(record.id));
  if(selected.length)pendingApproval={token:savedApproval.token,ids:savedApproval.ids,digest:buildDigest(selected),sending:false,autoSendAt:null};
}
let progress={stage:'idle',total:0,collected:0,completed:0,current:0,startedAt:null,finishedAt:null,error:''};
let trainingReport=await fs.readFile(path.join(data,'review-classifier-report.json'),'utf8').then(JSON.parse).catch(()=>null)
  || await fs.readFile(path.join(root,'seed','public-report.json'),'utf8').then(JSON.parse).catch(()=>null);
const MODEL_BODY_CHARS=1600;
function runClassifier(action,input,signal) {
  return new Promise((resolve,reject)=>{
    const worker=spawn(path.join(root,'.venv','Scripts','python.exe'),[path.join(root,'train_classifier.py'),...(action==='train'?['train']:[])],{windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    let output='';const timer=setTimeout(()=>{worker.kill();reject(new Error('학습 분류기의 실행 시간이 초과되었습니다.'));},90000);
    const abort=()=>{worker.kill();reject(new Error('사용자가 분류를 중단했습니다.'));};
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    worker.stdout.setEncoding('utf8');worker.stdout.on('data',chunk=>{output+=chunk;});worker.stderr.resume();
    worker.on('error',()=>{clearTimeout(timer);reject(new Error('학습 분류기를 실행할 수 없습니다.'));});
    worker.on('close',()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);try{const result=JSON.parse(output);if(result.error)reject(new Error(result.error));else resolve(result);}catch{reject(new Error('학습 분류기 응답을 확인할 수 없습니다.'));}});
    worker.stdin.on('error',()=>{});worker.stdin.end(JSON.stringify(input || {}));
  });
}
function readMail(config, onProgress=()=>{}, signal) {
  return new Promise((resolve,reject) => {
    const worker=spawn(path.join(root,'.venv','Scripts','python.exe'),[path.join(root,'mail_reader.py')],{windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    let output='';const timer=setTimeout(()=>{worker.kill();reject(new Error('메일 수집 시간이 초과되었습니다. 수집 수를 줄여주세요.'));},180000);
    const abort=()=>{worker.kill();reject(new Error('사용자가 분류를 중단했습니다.'));};
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    worker.stdout.setEncoding('utf8');worker.stdout.on('data',chunk=>{output+=chunk;});
    let events='';worker.stderr.setEncoding('utf8');worker.stderr.on('data',chunk=>{
      events+=chunk;let end;while((end=events.indexOf('\n'))>=0){const line=events.slice(0,end);events=events.slice(end+1);try{onProgress(JSON.parse(line));}catch{}}
    });
    worker.on('error',()=>{clearTimeout(timer);reject(new Error('메일 수집기를 실행할 수 없습니다.'));});
    worker.on('close',()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);try{const result=JSON.parse(output);if(result.error)reject(new Error(result.error));else resolve(result.messages);}catch{reject(new Error('메일 수집기 응답을 확인할 수 없습니다.'));}});
    worker.stdin.on('error',()=>{});worker.stdin.end(JSON.stringify(config));
  });
}
function sendDigest(config) {
  return new Promise((resolve,reject)=>{
    const worker=spawn(path.join(root,'.venv','Scripts','python.exe'),[path.join(root,'send_digest.py')],{windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    let output='';const timer=setTimeout(()=>{worker.kill();reject(new Error('메일 발송 결과를 확인할 수 없습니다. Gmail 수신함을 확인해주세요.'));},90000);
    worker.stdout.setEncoding('utf8');worker.stdout.on('data',chunk=>{output+=chunk;});worker.stderr.resume();
    worker.on('error',()=>{clearTimeout(timer);reject(new Error('메일 발송기를 실행할 수 없습니다.'));});
    worker.on('close',()=>{clearTimeout(timer);try{const result=JSON.parse(output);if(result.error)reject(new Error(result.error));else resolve(result);}catch{reject(new Error('메일 발송 결과를 확인할 수 없습니다. Gmail 수신함을 확인해주세요.'));}});
    worker.stdin.on('error',()=>{});worker.stdin.end(JSON.stringify(config));
  });
}
let autoSendTimer=null;
async function savePendingApproval(){
  if(pendingApproval)await fs.writeFile(approvalFile,JSON.stringify({token:pendingApproval.token,ids:pendingApproval.ids,autoSendAt:pendingApproval.autoSendAt,status:'pending'}));
}
function armAutoSend(){
  if(autoSendTimer)clearTimeout(autoSendTimer);
  autoSendTimer=null;
  if(!pendingApproval?.autoSendAt || !autoSendEnabled || !recipient || !credentials)return;
  const token=pendingApproval.token;
  const wait=Math.max(0,Date.parse(pendingApproval.autoSendAt)-Date.now());
  autoSendTimer=setTimeout(()=>{void autoSendIfDue(token);},wait);
}
async function deliverPending(to,mode){
  const approved=pendingApproval;
  if(!approved || approved.sending || busy || !credentials)throw new Error('메일 연결 또는 승인 상태를 확인해주세요.');
  approved.sending=true;busy=true;
  if(autoSendTimer)clearTimeout(autoSendTimer);
  autoSendTimer=null;
  try{
    await fs.writeFile(approvalFile,JSON.stringify({token:approved.token,ids:approved.ids,status:'sending'}));
    if(mode==='manual'){await saveRecipient(envFile,to);recipient=to;}
    const digest=buildDigest(records.filter(record=>approved.ids.includes(record.id)));
    await sendDigest({...credentials,recipient:to,subject:digest.subject,text:digest.text,html:digest.html});
    await fs.writeFile(path.join(data,`delivery-${approved.token}.json`),JSON.stringify({id:approved.token,recipient:to,total:approved.digest.total,mode,sentAt:new Date().toISOString()}));
    await fs.rm(approvalFile,{force:true});
    pendingApproval=null;
    deliveryMessage=mode==='auto'?'분류 결과가 1분 후 자동 발송되었습니다.':'분류 결과 메일을 보냈습니다.';
  }catch(error){
    await fs.rm(approvalFile,{force:true});
    pendingApproval=null;
    deliveryMessage='발송 결과를 확인할 수 없습니다. Gmail 수신함을 확인해주세요.';
    throw error;
  }finally{busy=false;}
}
async function autoSendIfDue(token){
  if(pendingApproval?.token!==token || !autoSendDue(pendingApproval,autoSendEnabled,recipient,!!credentials))return;
  if(busy){autoSendTimer=setTimeout(()=>{void autoSendIfDue(token);},1000);return;}
  try{await deliverPending(recipient,'auto');}
  catch(error){console.error('Unattended delivery failed:',error.message);}
}
async function resetAutoSendDeadline(){
  if(!pendingApproval)return;
  pendingApproval.autoSendAt=autoSendDeadline(autoSendEnabled,recipient,!!credentials);
  await savePendingApproval();
  armAutoSend();
}
let saving=Promise.resolve();
async function save() {const snapshot=JSON.stringify(records,null,2);const task=saving.catch(()=>{}).then(async()=>{await fs.writeFile(path.join(data,'results.tmp'),snapshot);await fs.rename(path.join(data,'results.tmp'),path.join(data,'results.json'));});saving=task;await task;}
async function collect(limit, unreadOnly) {
  if (!credentials) throw new Error('먼저 네이버 IMAP을 연결해주세요.');
  const signal=jobController.signal;
  const processed=[];
  const mails=await readMail({...credentials,limit,unreadOnly,known:records.map(r=>r.id)},event=>{progress={...progress,...event};},signal);
  progress.total=mails.length;
  const trained=trainingReport?.enabled && mails.length?await runClassifier('predict',mails,signal):[];
  signal.throwIfAborted();
  for (const [index,mail] of mails.entries()) {
    signal.throwIfAborted();
    progress.stage='classifying';progress.current=progress.completed+1;
    const text=mail.body, sender=mail.sender;
    const modelBody=mail.body.slice(0,MODEL_BODY_CHARS);
    const response = await fetch('http://127.0.0.1:8000/v1/systemone', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:{subject:mail.subject,sender,body:modelBody},questions,model:'multilingual',max_len:2048}),signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])});
    if (!response.ok) throw new Error(`Laya 분류 실패 (${response.status}). 로컬 모델 서버를 확인해주세요.`);
    const prediction=normalize(await response.json());signal.throwIfAborted();
    const modelBodyTruncated=mail.body.length>MODEL_BODY_CHARS || prediction.raw.usage?.truncated===true;
    let decision=applyCorrections(mail,prediction,records);
    const trainedDecision=trained[index];
    if(decision.decisionSource==='laya' && trainedDecision?.apply && trainedDecision.category!==decision.category){
      decision={...decision,category:trainedDecision.category,reviewNeeded:true,decisionSource:'trained-local',trainingConfidence:trainedDecision.confidence};
    }
    decision=applyUrgencyPolicy(mail,decision);
    records.unshift({...mail,collectedAt:new Date().toISOString(),...decision,modelBodyTruncated,reviewNeeded:decision.reviewNeeded || modelBodyTruncated});
    progress.stage='saving';
    await save();
    processed.push(mail.id);
    progress.completed++;
  }
  signal.throwIfAborted();progress.stage='done';progress.finishedAt=new Date().toISOString();
  return processed;
}
const server = http.createServer(async (req,res) => {
  const reply = (status,value,type='application/json') => {res.writeHead(status,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(type==='application/json'?JSON.stringify(value):value);};
  try {
    const expected = `127.0.0.1:${process.env.PORT || 4327}`;
    if (req.headers.host !== expected && req.headers.host !== `localhost:${process.env.PORT || 4327}`) return reply(403,{error:'Host rejected'});
    if (req.method !== 'GET' && req.headers.origin !== `http://${req.headers.host}`) return reply(403,{error:'Origin rejected'});
    if (req.method==='GET' && req.url==='/') return reply(200,await fs.readFile(path.join(root,'index.html'),'utf8'),'text/html');
    if (req.method==='GET' && req.url==='/api/results') return reply(200,{records,busy,connected:!!credentials,connectedAccount:credentials?.account || null,savedAccount,connectionMessage,deliveryMessage});
    if (req.method==='GET' && req.url==='/api/progress') return reply(200,{...progress,busy,canStop:!!jobController && !jobController.signal.aborted});
    if (req.method==='GET' && req.url==='/api/training') return reply(200,{report:trainingReport});
    if (req.method==='GET' && req.url==='/api/approval') return reply(200,{approval:pendingApproval?{token:pendingApproval.token,digest:buildDigest(records.filter(record=>pendingApproval.ids.includes(record.id))),recipient,autoSendAt:pendingApproval.autoSendAt,sending:pendingApproval.sending,autoSendEnabled}:null});
    if (req.method==='GET' && req.url==='/api/delivery-settings') return reply(200,{recipient,autoSendEnabled});
    if (req.method==='GET' && req.url==='/api/health') {const ready=await fetch('http://127.0.0.1:8000/health',{signal:AbortSignal.timeout(2000)}).then(r=>r.ok).catch(()=>false);return reply(200,{model:ready});}
    let input='';for await(const chunk of req){input+=chunk;if(input.length>100000) throw new Error('요청이 너무 큽니다.');}
    const payload=JSON.parse(input || '{}');
    if(req.method==='POST' && req.url==='/api/decline') {if(!pendingApproval || pendingApproval.sending || payload.token!==pendingApproval.token)throw new Error('승인 요청이 만료됐거나 발송 중입니다.');if(autoSendTimer)clearTimeout(autoSendTimer);autoSendTimer=null;await fs.rm(approvalFile,{force:true});pendingApproval=null;return reply(200,{ok:true});}
    if(req.method==='POST' && req.url==='/api/pause-approval') {
      if(!pendingApproval || pendingApproval.sending || payload.token!==pendingApproval.token)throw new Error('승인 요청이 만료됐거나 발송 중입니다.');
      if(autoSendTimer)clearTimeout(autoSendTimer);
      autoSendTimer=null;pendingApproval.autoSendAt=null;
      await savePendingApproval();
      return reply(200,{ok:true});
    }
    if(req.method==='POST' && req.url==='/api/delivery-settings') {
      if(busy || pendingApproval?.sending)throw new Error('현재 작업이 끝난 뒤 설정을 변경해주세요.');
      const to=String(payload.recipient || '').trim().toLowerCase();
      if(!/^[a-z0-9._%+-]+@gmail\.com$/.test(to))throw new Error('받을 Gmail 주소를 입력해주세요.');
      await saveDeliverySettings(envFile,to,payload.autoSendEnabled===true);
      recipient=to;autoSendEnabled=payload.autoSendEnabled===true;
      await resetAutoSendDeadline();
      return reply(200,{ok:true,recipient,autoSendEnabled});
    }
    if(req.method==='POST' && req.url==='/api/send') {
      if(busy || !credentials)throw new Error('메일 연결 또는 다른 작업 상태를 확인해주세요.');
      if(!pendingApproval || pendingApproval.sending || payload.token!==pendingApproval.token || payload.confirmed!==true)throw new Error('최종승인이 필요하거나 이미 처리한 요청입니다.');
      const to=String(payload.recipient || '').trim().toLowerCase();
      if(!/^[a-z0-9._%+-]+@gmail\.com$/.test(to))throw new Error('받을 Gmail 주소를 입력해주세요.');
      await deliverPending(to,'manual');return reply(200,{ok:true});
    }
    if(req.method==='POST' && req.url==='/api/stop') {if(jobController){jobController.abort();progress.stage='stopping';}return reply(200,{ok:true});}
    if(req.method==='POST' && req.url==='/api/train') {if(busy) throw new Error('현재 작업이 끝난 뒤 재학습해주세요.');busy=true;try{trainingReport=await runClassifier('train');return reply(200,{report:trainingReport});}finally{busy=false;}}
    if(req.method==='POST' && req.url==='/api/connect') {
      if(busy) throw new Error('분류 또는 연결이 진행 중입니다.');
      const account=String(payload.account || '').trim().toLowerCase();
      if(!/^[a-z0-9._-]+@naver\.com$/.test(account) || typeof payload.password!=='string' || !payload.password.trim()) throw new Error('네이버 메일 주소와 앱 비밀번호를 입력해주세요.');
      busy=true;try{const next={account,password:payload.password.replace(/\s/g,'')};await readMail({...next,action:'connect'});if(payload.remember===true){await saveCredentials(envFile,next);savedAccount=account;}credentials=next;connectionMessage='';await resetAutoSendDeadline();return reply(200,{ok:true});}finally{busy=false;}
    }
    if(req.method==='POST' && req.url==='/api/disconnect') {if(busy) throw new Error('작업 완료 후 연결을 해제해주세요.');credentials=null;connectionMessage='연결 해제됨';await resetAutoSendDeadline();return reply(200,{ok:true});}
    if(req.method==='POST' && req.url==='/api/reconnect') {if(busy) throw new Error('작업 완료 후 다시 연결해주세요.');busy=true;try{const saved=await loadCredentials(envFile);if(!saved)throw new Error('저장된 연결 정보가 없습니다.');await readMail({...saved,action:'connect'});credentials=saved;savedAccount=saved.account;connectionMessage='';await resetAutoSendDeadline();return reply(200,{ok:true});}finally{busy=false;}}
    if(req.method==='POST' && req.url==='/api/classify') {
      if(busy) throw new Error('이미 작업 중입니다.');
      if(pendingApproval)throw new Error('먼저 이전 분류 결과의 전송 여부를 결정해주세요.');
      busy=true;
      jobController=new AbortController();
      progress={stage:'connecting',total:0,collected:0,completed:0,current:0,startedAt:new Date().toISOString(),finishedAt:null,error:''};
      try{const ids=await collect(Math.min(50,Math.max(1,Number(payload.limit)||10)),payload.unreadOnly===true);if(ids.length){const token=randomUUID();pendingApproval={token,ids,digest:buildDigest(records.filter(record=>ids.includes(record.id))),sending:false,autoSendAt:autoSendDeadline(autoSendEnabled,recipient,!!credentials)};await savePendingApproval();armAutoSend();}return reply(200,{ok:true,approvalPending:!!pendingApproval});}
      catch(error){const cancelled=jobController.signal.aborted;progress.stage=cancelled?'cancelled':'error';progress.error=cancelled?'사용자가 분류를 중단했습니다.':error.message;progress.finishedAt=new Date().toISOString();if(cancelled)return reply(200,{ok:true,cancelled:true});throw error;}
      finally{busy=false;jobController=null;}
    }
    if(req.method==='POST' && req.url==='/api/update') {const r=records.find(r=>r.id===payload.id);if(!r) throw new Error('메일을 찾을 수 없습니다.');if(!['업무','개인','안내','결제·배송','광고','기타'].includes(payload.category)) throw new Error('분류가 올바르지 않습니다.');if(!['낮음','보통','높음'].includes(payload.urgency)) throw new Error('긴급도가 올바르지 않습니다.');r.category=payload.category;r.urgency=payload.urgency;r.needsReply=payload.needsReply===true;r.reviewed=true;r.reviewedAt=new Date().toISOString();await save();return reply(200,{ok:true});}
    if(req.method==='POST' && req.url==='/api/export') {const selected=records.filter(r=>payload.ids?.includes(r.id));if(!selected.length) throw new Error('메일을 선택해주세요.');return reply(200,selected.map(buildExport));}
    reply(404,{error:'Not found'});
  } catch(e){reply(400,{error:e.message});}
});
server.listen(Number(process.env.PORT || 4327),'127.0.0.1',()=>console.log('http://127.0.0.1:'+ (process.env.PORT || 4327)));
busy=true;
try {
  const saved=await loadCredentials(envFile);
  if(saved){savedAccount=saved.account;await readMail({...saved,action:'connect'});credentials=saved;}
}catch(error){connectionMessage=error.message;}
finally{busy=false;}
if(pendingApproval)await resetAutoSendDeadline();
