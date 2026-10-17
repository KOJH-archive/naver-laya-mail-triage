import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {categorySignal} from './category-policy.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const sinceArg=process.argv.find(arg=>arg.startsWith('--received-since='));
const since=sinceArg?.slice('--received-since='.length);
const collectedArg=process.argv.find(arg=>arg.startsWith('--collected-since='));
const collectedSince=collectedArg?.slice('--collected-since='.length);
const sampleOnly=process.argv.includes('--sample-only');
function kstMidnight(date){
  if(!date)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.');
  const [year,month,day]=date.split('-').map(Number);
  const calendar=new Date(Date.UTC(year,month-1,day));
  if(calendar.getUTCFullYear()!==year || calendar.getUTCMonth()+1!==month || calendar.getUTCDate()!==day)throw new Error('유효한 날짜를 입력해주세요.');
  const timestamp=Date.parse(`${date}T00:00:00+09:00`);
  return timestamp;
}
const receivedSinceAt=kstMidnight(since);
const collectedSinceAt=kstMidnight(collectedSince);

const categories=['업무','개인','안내','결제·배송','광고','기타'];
const resultText=await fs.readFile(path.join(root,'data','results.json'),'utf8').catch(error=>{
  if(error.code==='ENOENT')return '[]';
  throw error;
});
const rows=JSON.parse(resultText);
const examples=rows.filter(row=>row.reviewed && categories.includes(row.category) && (!sampleOnly || row.evaluationSample) && (receivedSinceAt===null || (Number.isFinite(Date.parse(row.receivedAt)) && Date.parse(row.receivedAt)>=receivedSinceAt)) && (collectedSinceAt===null || (Number.isFinite(Date.parse(row.collectedAt)) && Date.parse(row.collectedAt)>=collectedSinceAt)))
  .map(row=>{const signal=categorySignal(row);return {truth:row.category,baseline:row.modelPrediction?.category || row.raw?.answers?.category?.choice,policy:signal?.category,signal:signal?.reason,initial:row.initialDecision?.category,urgency:row.urgency,initialUrgency:row.initialDecision?.urgency,modelUrgency:row.raw?.answers?.urgency?.choice,automatedSender:/(?:no-?reply|notify|notification|news|marketing|mailer|alert|service|support|info)\b/i.test(row.sender || ''),consumerSender:/@(gmail\.com|naver\.com|daum\.net|kakao\.com|hanmail\.net|outlook\.com)/i.test(row.sender || '')};});
const baselineRows=examples.filter(row=>categories.includes(row.baseline));

function metrics(cohort,predictions){
  const correct=cohort.filter((row,index)=>predictions[index]===row.truth).length;
  const byCategory=Object.fromEntries(categories.map(category=>{
    const tp=cohort.filter((row,index)=>row.truth===category && predictions[index]===category).length;
    const actual=cohort.filter(row=>row.truth===category).length;
    const predicted=predictions.filter(value=>value===category).length;
    const precision=predicted?tp/predicted:null;
    const recall=actual?tp/actual:null;
    return [category,{support:actual,precision,recall,f1:precision===null || recall===null?null:precision+recall===0?0:2*precision*recall/(precision+recall)}];
  }));
  return {correct,total:cohort.length,accuracy:cohort.length?correct/cohort.length:null,byCategory};
}

const baseline=baselineRows.map(row=>row.baseline);
const withPolicy=baselineRows.map(row=>row.policy || row.baseline);
const initialRows=examples.filter(row=>categories.includes(row.initial));
const policyRows=baselineRows.filter(row=>row.policy);
const policyConfusion=Object.fromEntries(categories.map(truth=>[truth,Object.fromEntries(categories.map(predicted=>[predicted,policyRows.filter(row=>row.truth===truth && row.policy===predicted).length]).filter(([,count])=>count))]).filter(([,counts])=>Object.keys(counts).length));
const policyBySender=Object.fromEntries(['automatedSender','consumerSender'].map(key=>[key,{covered:policyRows.filter(row=>row[key]).length,correct:policyRows.filter(row=>row[key] && row.policy===row.truth).length}]));
const policyBySignal=Object.fromEntries(['payment','ad-tag','offer','notice'].map(reason=>[reason,{covered:policyRows.filter(row=>row.signal===reason).length,correct:policyRows.filter(row=>row.signal===reason && row.policy===row.truth).length}]));
const newlyCorrect=baselineRows.filter(row=>row.policy && row.baseline!==row.truth && row.policy===row.truth).length;
const newlyWrong=baselineRows.filter(row=>row.policy && row.baseline===row.truth && row.policy!==row.truth).length;
const urgent=examples.filter(row=>row.urgency==='높음');
const report={scope:{sampleOnly,receivedSince:since || null,collectedSince:collectedSince || null},selectionWarning:sampleOnly?'Only completed random reviews are measured; unfinished samples are excluded.':'Only manually reviewed mail is measured; this is not whole-inbox accuracy.',reviewedInScope:examples.length,totalStored:rows.length,randomSamplesPending:rows.filter(row=>row.evaluationSample && !row.reviewed).length,baseline:metrics(baselineRows,baseline),withPolicy:metrics(baselineRows,withPolicy),initialPipeline:metrics(initialRows,initialRows.map(row=>row.initial)),policy:{covered:policyRows.length,correct:policyRows.filter(row=>row.policy===row.truth).length,newlyCorrect,newlyWrong,confusion:policyConfusion,bySender:policyBySender,bySignal:policyBySignal},urgency:{highSupport:urgent.length,modelHighEvaluated:urgent.filter(row=>row.modelUrgency).length,modelHighMissed:urgent.filter(row=>row.modelUrgency && row.modelUrgency!=='높음').length,initialHighEvaluated:urgent.filter(row=>row.initialUrgency).length,initialHighMissed:urgent.filter(row=>row.initialUrgency && row.initialUrgency!=='높음').length}};
console.log(JSON.stringify(report,null,2));
