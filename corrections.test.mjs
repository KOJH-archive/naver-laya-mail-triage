import {test} from 'node:test';import assert from 'node:assert/strict';import {applyCorrections} from './corrections.mjs';
const mail={id:'new',sender:'notify@example.com',subject:'로그인 알림 2026',body:'새로운 기기에서 로그인되었습니다. 본인이 아니면 확인해주세요.'};
const prediction={category:'개인',urgency:'보통',needsReply:false,confidence:0.9};
const reviewed={...mail,id:'old',reviewed:true,category:'안내'};
test('similar reviewed template corrects category and retains model prediction',()=>{const result=applyCorrections(mail,prediction,[reviewed]);assert.equal(result.category,'안내');assert.equal(result.modelPrediction.category,'개인');assert.equal(result.reviewNeeded,true);});
test('same sender alone cannot change category',()=>assert.equal(applyCorrections({...mail,subject:'특별 할인 행사',body:'지금 상품을 구매하세요'},prediction,[reviewed]).decisionSource,'laya'));
test('unreviewed and conflicting labels cannot override model',()=>{assert.equal(applyCorrections(mail,prediction,[{...reviewed,reviewed:false}]).category,'개인');assert.equal(applyCorrections(mail,prediction,[reviewed,{...reviewed,id:'other',category:'광고'}]).category,'개인');});
