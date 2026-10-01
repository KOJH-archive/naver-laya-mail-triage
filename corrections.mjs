function senderKey(value){return (String(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || String(value)).toLowerCase().trim();}
function words(value){
  const text=String(value).toLowerCase().replace(/https?:\/\/\S+/g,' ').replace(/\d+/g,'#').replace(/[^\p{L}#]+/gu,' ').trim();
  return new Set(text.split(/\s+/).filter(Boolean));
}
function similarity(a,b){const x=words(a),y=words(b);let common=0;for(const token of x)if(y.has(token))common++;return x.size&&y.size?2*common/(x.size+y.size):0;}
export function applyCorrections(mail,prediction,records){
  const candidates=records.filter(r=>r.reviewed && r.id!==mail.id && senderKey(r.sender)===senderKey(mail.sender)).map(r=>({record:r,subject:similarity(mail.subject,r.subject),body:similarity(mail.body.slice(0,6000),r.body.slice(0,6000))})).filter(r=>r.subject>=0.9 && r.body>=0.8);
  const modelPrediction={category:prediction.category,urgency:prediction.urgency,needsReply:prediction.needsReply,confidence:prediction.confidence};
  if(!candidates.length || new Set(candidates.map(c=>c.record.category)).size!==1)return {...prediction,modelPrediction,decisionSource:'laya'};
  candidates.sort((a,b)=>(b.subject+b.body)-(a.subject+a.body));
  const best=candidates[0];
  // Category is reusable for similar templates; urgency and reply remain specific to the new mail.
  return {...prediction,modelPrediction,category:best.record.category,reviewNeeded:true,decisionSource:'review-memory',correction:{referenceId:best.record.id,subjectSimilarity:best.subject,bodySimilarity:best.body,examples:candidates.length}};
}
