import {test} from 'node:test';import assert from 'node:assert/strict';import {normalize,buildExport,applyUrgencyPolicy} from './triage.mjs';
const mail=(subject,body='')=>({subject,body});
const decision=(category,urgency='보통',needsReply=false)=>({category,urgency,needsReply,reviewNeeded:false});
test('promotions and routine notices are low',()=>{assert.equal(applyUrgencyPolicy(mail('가을 할인'),decision('광고')).urgency,'낮음');assert.equal(applyUrgencyPolicy(mail('로그인 알림','새 기기에서 로그인했습니다.'),decision('안내')).urgency,'낮음');assert.equal(applyUrgencyPolicy(mail('결제 완료','영수증입니다.'),decision('결제·배송')).urgency,'낮음')});
test('explicit action and reply requests are medium',()=>{assert.equal(applyUrgencyPolicy(mail('본인 확인 요청','본인 확인이 필요합니다.'),decision('안내')).urgency,'보통');assert.equal(applyUrgencyPolicy(mail('회의 일정'),decision('업무','낮음',true)).urgency,'보통')});
test('security risk and imminent deadline are high and need review',()=>{for(const subject of ['의심스러운 로그인 감지','오늘까지 제출']){const result=applyUrgencyPolicy(mail(subject),decision('안내'));assert.equal(result.urgency,'높음');assert.equal(result.reviewNeeded,true)}});
test('uncertain reply requires review',()=>{assert.equal(normalize({answers:{category:{choice:'업무',probabilities:{'업무':0.9}},urgency:{choice:'보통'},needs_reply:{noul:0.55}}}).reviewNeeded,true)});
test('missing model outputs cannot be saved as classifications',()=>assert.throws(()=>normalize({answers:{}})));
test('export preserves source and sanitizes subject',()=>{const r=buildExport({id:'x',category:'업무',subject:'hello\r\nworld',sender:'a',body:'original',collectedAt:'today'});assert.equal(r.sourceId,'x');assert.ok(!r.subject.includes('\n'));assert.ok(r.body.includes('original'));});
