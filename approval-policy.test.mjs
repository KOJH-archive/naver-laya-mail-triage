import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AUTO_SEND_DELAY_MS,autoSendDeadline,autoSendDue} from './approval-policy.mjs';

test('unattended timer needs enabled setting, Gmail and connection',()=>{
  assert.equal(autoSendDeadline(false,'results@gmail.com',true,0),null);
  assert.equal(autoSendDeadline(true,null,true,0),null);
  assert.equal(autoSendDeadline(true,'results@gmail.com',false,0),null);
  assert.equal(autoSendDeadline(true,'results@gmail.com',true,0),new Date(AUTO_SEND_DELAY_MS).toISOString());
});
test('unattended delivery is due only after the deadline',()=>{
  const approval={sending:false,autoSendAt:new Date(AUTO_SEND_DELAY_MS).toISOString()};
  assert.equal(autoSendDue(approval,true,'results@gmail.com',true,AUTO_SEND_DELAY_MS-1),false);
  assert.equal(autoSendDue(approval,true,'results@gmail.com',true,AUTO_SEND_DELAY_MS),true);
  assert.equal(autoSendDue({...approval,sending:true},true,'results@gmail.com',true,AUTO_SEND_DELAY_MS),false);
});
