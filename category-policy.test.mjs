import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyByPolicy} from './category-policy.mjs';

test('clear transaction, promotion and account notices are classified',()=>{
  assert.equal(classifyByPolicy({subject:'주문 완료 안내'}),'결제·배송');
  assert.equal(classifyByPolicy({subject:'[광고] 가을 쿠폰 행사'}),'광고');
  assert.equal(classifyByPolicy({subject:'새 기기 로그인 알림'}),'안내');
});
test('conflicting and vague subjects remain undecided',()=>{
  assert.equal(classifyByPolicy({subject:'할인 주문 완료'}),null);
  assert.equal(classifyByPolicy({subject:'이번 주 일정 확인'}),null);
  assert.equal(classifyByPolicy({subject:'가입 환영 할인 쿠폰'}),'광고');
});
