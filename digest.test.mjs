import {test} from 'node:test';import assert from 'node:assert/strict';import {buildDigest} from './digest.mjs';
test('digest groups mail, escapes HTML, and highlights urgent items',()=>{
  const result=buildDigest([{category:'업무',subject:'긴급 <계약> 검토',sender:'a@example.com',urgency:'높음',needsReply:true,reviewNeeded:true},{category:'안내',subject:'로그인 알림',sender:'b@example.com',urgency:'낮음'}]);
  assert.equal(result.urgent,1);assert.equal(result.groups.length,2);
  assert.ok(result.html.includes('color:#b52d23'));assert.ok(result.html.includes('&lt;계약&gt;'));
  assert.ok(!result.html.includes('<계약>'));assert.ok(result.text.includes('[긴급]'));
});
