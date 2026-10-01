import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCredentials, saveCredentials, loadRecipient, saveRecipient, loadAutoSend, saveDeliverySettings } from './env-config.mjs';

test('credentials round-trip and unrelated settings are preserved',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'laya-env-'));
  const filename=path.join(dir,'.env');
  try{
    await fs.writeFile(filename,'OTHER="value"\nNAVER_EMAIL="old@naver.com"\n');
    await saveCredentials(filename,{account:'test@naver.com',password:'sample-only'});
    assert.deepEqual(await loadCredentials(filename),{account:'test@naver.com',password:'sample-only'});
    const text=await fs.readFile(filename,'utf8');
    assert.ok(text.includes('OTHER="value"'));
    assert.equal(text.match(/NAVER_EMAIL=/g).length,1);
  }finally{await fs.rm(filename,{force:true});await fs.rmdir(dir);}
});
test('empty settings do not connect',async()=>{
  assert.equal(await loadCredentials(path.join(os.tmpdir(),'laya-nonexistent-'+Date.now())),null);
});
test('recipient persists without replacing Naver credentials',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'laya-recipient-'));
  const filename=path.join(dir,'.env');
  try{
    await saveCredentials(filename,{account:'test@naver.com',password:'sample-only'});
    await saveRecipient(filename,'results@gmail.com');
    assert.equal(await loadRecipient(filename),'results@gmail.com');
    assert.equal((await loadCredentials(filename)).account,'test@naver.com');
  }finally{await fs.rm(filename,{force:true});await fs.rmdir(dir);}
});
test('unattended delivery defaults on and can be disabled',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'laya-auto-'));
  const filename=path.join(dir,'.env');
  try{
    assert.equal(await loadAutoSend(filename),true);
    await saveCredentials(filename,{account:'test@naver.com',password:'sample-only'});
    await saveDeliverySettings(filename,'results@gmail.com',true);
    assert.equal(await loadRecipient(filename),'results@gmail.com');
    assert.equal(await loadAutoSend(filename),true);
    await saveDeliverySettings(filename,'results@gmail.com',false);
    assert.equal(await loadAutoSend(filename),false);
    assert.equal((await loadCredentials(filename)).account,'test@naver.com');
  }finally{await fs.rm(filename,{force:true});await fs.rmdir(dir);}
});
