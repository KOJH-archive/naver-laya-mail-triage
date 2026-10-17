import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

function windowsProtect(secret, unprotect=false, legacy=false){
  if(process.platform!=='win32')return Promise.reject(new Error('Windows 사용자 계정 보호는 Windows에서만 지원됩니다.'));
  const script=unprotect
    ? (legacy
      ? '$encoded=[Console]::In.ReadToEnd().Trim(); Add-Type -AssemblyName System.Security; $bytes=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($encoded),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))'
      : '$encoded=[Console]::In.ReadToEnd().Trim(); Add-Type -AssemblyName System.Security; $bytes=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($encoded),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($bytes))')
    : '$encoded=[Console]::In.ReadToEnd().Trim(); Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String($encoded); $protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($protected))';
  return new Promise((resolve,reject)=>{
    const worker=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true});
    let output='',error='';worker.stdout.setEncoding('utf8');worker.stderr.setEncoding('utf8');
    worker.stdout.on('data',chunk=>{output+=chunk;});worker.stderr.on('data',chunk=>{error+=chunk;});
    worker.on('error',()=>reject(new Error('Windows 보호 저장소를 실행할 수 없습니다.')));
    worker.on('close',code=>code===0 && output ? resolve(unprotect && !legacy?Buffer.from(output.trim(),'base64').toString('utf8'):output.trim()) : reject(new Error(error.trim() || 'Windows 보호 저장소 처리에 실패했습니다.')));
    worker.stdin.end(unprotect?secret:Buffer.from(secret,'utf8').toString('base64'));
  });
}

export function protectText(value){return windowsProtect(value,false);}
export function unprotectText(value){return windowsProtect(value,true);}
export function unprotectLegacyText(value){return windowsProtect(value,true,true);}

export async function loadProtectedRecords(resultsFile,vaultFile){
  const text=await fs.readFile(resultsFile,'utf8').catch(error=>{if(error.code==='ENOENT')return '[]';throw error;});
  const rows=JSON.parse(text);
  const vaultText=await fs.readFile(vaultFile,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
  let migrated=false,vault={};
  if(vaultText){
    let decrypted=await unprotectText(vaultText);
    try{vault=JSON.parse(decrypted);}catch{decrypted=await unprotectLegacyText(vaultText);vault=JSON.parse(decrypted);migrated=true;}
  }
  const records=rows.map(row=>{
    if(typeof row.body==='string')migrated=true;
    const body=typeof row.body==='string'?row.body:vault[row.id];
    return body===undefined?row:{...row,body};
  });
  if(Object.keys(vault).length && records.some(row=>typeof row.body!=='string'))throw new Error('메일 원문 보호 저장소와 분류 결과의 연결을 확인해주세요.');
  return {records,migrated:migrated || rows.some(row=>typeof row.body==='string') || !vaultText && rows.some(row=>row.body)};
}

export async function saveProtectedRecords(resultsFile,vaultFile,records){
  const vault={};
  const metadata=records.map(row=>{
    const {body,...rest}=row;
    if(typeof body==='string')vault[row.id]=body;
    return rest;
  });
  const protectedVault=await protectText(JSON.stringify(vault));
  await fs.writeFile(`${resultsFile}.tmp`,JSON.stringify(metadata,null,2));
  await fs.writeFile(`${vaultFile}.tmp`,protectedVault,{mode:0o600});
  await fs.rename(`${resultsFile}.tmp`,resultsFile);
  await fs.rename(`${vaultFile}.tmp`,vaultFile);
}
