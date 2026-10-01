const categories=['업무','개인','안내','결제·배송','광고','기타'];
const clean=value=>String(value || '').replace(/[\r\n\t]+/g,' ').trim();
const escape=value=>clean(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function buildDigest(records){
  const groups=categories.map(category=>({category,items:records.filter(record=>record.category===category).map(record=>({subject:clean(record.subject).slice(0,160),sender:clean(record.sender).slice(0,120),urgency:record.urgency,needsReply:!!record.needsReply,reviewNeeded:!!record.reviewNeeded && !record.reviewed}))})).filter(group=>group.items.length);
  const urgent=records.filter(record=>record.urgency==='높음').length;
  const subject=`[Laya분류결과] ${records.length}건 · 긴급 ${urgent}건`;
  const text=[`분류 결과 ${records.length}건 · 긴급 ${urgent}건`,'',...groups.flatMap(group=>[`[${group.category}] ${group.items.length}건`,...group.items.map(item=>`${item.urgency==='높음'?'[긴급] ':''}${item.subject} · ${item.sender}${item.needsReply?' · 답장 필요':''}${item.reviewNeeded?' · 확인 필요':''}`),''])].join('\n');
  const sections=groups.map(group=>`<section style="margin:20px 0"><h2 style="font-size:17px;border-bottom:1px solid #dce3df;padding-bottom:7px">${escape(group.category)} <span style="font-weight:400;color:#56645d">${group.items.length}건</span></h2><ul style="padding-left:20px">${group.items.map(item=>`<li style="margin:12px 0;${item.urgency==='높음'?'border-left:4px solid #c83d31;padding-left:10px;background:#fff4f2;':''}"><strong>${item.urgency==='높음'?'<span style="color:#b52d23">긴급 · </span>':''}${escape(item.subject)}</strong><br><span style="color:#54645c">${escape(item.sender)}${item.needsReply?' · 답장 필요':''}${item.reviewNeeded?' · 확인 필요':''}</span></li>`).join('')}</ul></section>`).join('');
  const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><body style="font-family:Arial,sans-serif;color:#1e2a25;max-width:720px;margin:auto;padding:24px"><h1 style="font-size:22px;margin:0 0 8px">Laya 분류 결과</h1><p style="margin:0;color:#54645c">총 ${records.length}건 · <strong style="color:#b52d23">긴급 ${urgent}건</strong></p>${sections}<p style="font-size:12px;color:#75827b">분류 결과는 확인이 필요할 수 있습니다.</p></body></html>`;
  return {subject,text,html,groups,total:records.length,urgent};
}
