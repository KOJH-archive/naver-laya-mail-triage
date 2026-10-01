import fs from 'node:fs/promises';
import { parseEnv } from 'node:util';

export async function loadCredentials(filename) {
  let values;
  try { values=parseEnv(await fs.readFile(filename,'utf8')); }
  catch(error) { if(error.code==='ENOENT') return null; throw new Error('.env 파일을 읽을 수 없습니다.'); }
  const account=String(values.NAVER_EMAIL || '').trim().toLowerCase();
  const password=String(values.NAVER_APP_PASSWORD || '').replace(/\s/g,'');
  if(!account && !password) return null;
  if(!/^[a-z0-9._-]+@naver\.com$/.test(account) || !password) throw new Error('.env의 네이버 메일 주소와 앱 비밀번호를 확인해주세요.');
  return {account,password};
}

export async function saveCredentials(filename, credentials) {
  if(/[\r\n"\\]/.test(credentials.account+credentials.password)) throw new Error('저장할 연결 정보 형식을 확인해주세요.');
  let content=await fs.readFile(filename,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
  // Preserve unrelated settings while replacing only this app's credential keys.
  content=content.split(/\r?\n/).filter(line=>!/^\s*(?:export\s+)?NAVER_(?:EMAIL|APP_PASSWORD)\s*=/.test(line)).join('\n').trimEnd();
  content+=(content?'\n':'')+`NAVER_EMAIL="${credentials.account}"\nNAVER_APP_PASSWORD="${credentials.password}"\n`;
  await fs.writeFile(filename,content,{mode:0o600});
}

export async function loadRecipient(filename) {
  try {
    const values=parseEnv(await fs.readFile(filename,'utf8'));
    const recipient=String(values.RESULT_GMAIL || '').trim().toLowerCase();
    return /^[a-z0-9._%+-]+@gmail\.com$/.test(recipient)?recipient:null;
  } catch(error) {if(error.code==='ENOENT')return null;throw new Error('.env의 Gmail 설정을 읽을 수 없습니다.');}
}

export async function saveRecipient(filename, recipient) {
  if(!/^[a-z0-9._%+-]+@gmail\.com$/.test(recipient))throw new Error('받을 Gmail 주소를 확인해주세요.');
  let content=await fs.readFile(filename,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
  content=content.split(/\r?\n/).filter(line=>!/^\s*(?:export\s+)?RESULT_GMAIL\s*=/.test(line)).join('\n').trimEnd();
  content+=(content?'\n':'')+`RESULT_GMAIL="${recipient}"\n`;
  await fs.writeFile(filename,content,{mode:0o600});
}

export async function loadAutoSend(filename) {
  try {
    const values=parseEnv(await fs.readFile(filename,'utf8'));
    return values.AUTO_SEND_UNATTENDED !== 'false';
  } catch(error) {if(error.code==='ENOENT')return true;throw new Error('.env의 자동 발송 설정을 읽을 수 없습니다.');}
}

export async function saveDeliverySettings(filename, recipient, autoSend) {
  if(!/^[a-z0-9._%+-]+@gmail\.com$/.test(recipient)) throw new Error('받을 Gmail 주소를 확인해주세요.');
  let content=await fs.readFile(filename,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
  content=content.split(/\r?\n/).filter(line=>!/^\s*(?:export\s+)?(?:RESULT_GMAIL|AUTO_SEND_UNATTENDED)\s*=/.test(line)).join('\n').trimEnd();
  content+=(content?'\n':'')+`RESULT_GMAIL="${recipient}"\nAUTO_SEND_UNATTENDED="${autoSend===true}"\n`;
  await fs.writeFile(filename,content,{mode:0o600});
}
