import {readState,writeState} from './storage.js';
import {createClient} from './telegram.js';
import {withLease} from './http.js';
export async function telegramLogin(env,action,input,factory=createClient){return withLease(env,async()=>{
 if(await readState(env,'account'))throw new Error('ALREADY_CONNECTED');
 let pending=await readState(env,'login-pending');
 if(action==='cancel'){await writeState(env,'login-pending',null);return {stage:'credentials'};}
 if(action==='start'){
  if(!Number.isSafeInteger(input.apiId)||input.apiId<=0||!/^[a-f0-9]{32}$/i.test(input.apiHash||'')||!/^\+[1-9][0-9]{6,14}$/.test(input.phone||''))throw new Error('INVALID_CREDENTIALS');
  if(pending&&pending.expires>Date.now()&&Date.now()-pending.created<60000)throw new Error('WAIT_BEFORE_RESEND');
  pending={apiId:input.apiId,apiHash:input.apiHash,phone:input.phone,created:Date.now(),expires:Date.now()+600000,stage:'credentials',attempts:0};
 }else if(!pending||pending.expires<Date.now())throw new Error('LOGIN_EXPIRED');
 if(!['start','code','password'].includes(action))throw new Error('INVALID_ACTION');
 if(action==='code'&&(pending.stage!=='code'||!/^\d{4,8}$/.test(input.code||'')))throw new Error('INVALID_CODE');
 if(action==='password'&&(pending.stage!=='password'||typeof input.password!=='string'||!input.password||input.password.length>1024))throw new Error('INVALID_PASSWORD');
 if(++pending.attempts>10)throw new Error('LOGIN_EXPIRED');
 const {tg,storage}=factory(pending,pending.storage);let user,answer,success=false;
 try{
  if(action==='start'){const sent=await tg.sendCode({phone:pending.phone});if(sent.phoneCodeHash){pending.stage='code';pending.phoneCodeHash=sent.phoneCodeHash;answer={stage:'code',delivery:sent.type??'telegram'};}else user=sent;}
  if(action==='code'){try{user=await tg.signIn({phone:pending.phone,phoneCodeHash:pending.phoneCodeHash,phoneCode:input.code});}catch(e){if(e.text==='SESSION_PASSWORD_NEEDED'||e.message?.includes('SESSION_PASSWORD_NEEDED')){pending.stage='password';answer={stage:'password'};}else throw e;}}
  if(action==='password')user=await tg.checkPassword(input.password);
  if(user){if(user.isBot)throw new Error('USER_ACCOUNT_REQUIRED');const session=await tg.exportSession();await writeState(env,'telegram-storage',storage.driver.states);await writeState(env,'account',{apiId:pending.apiId,apiHash:pending.apiHash,userId:user.id,session});success=true;answer={stage:'connected',userId:user.id,displayName:user.displayName};}
  return answer;
 }catch(e){if(e.text==='PHONE_CODE_EXPIRED'||e.message?.includes('PHONE_CODE_EXPIRED'))pending.expires=0;throw e;
 }finally{await tg.destroy();if(success||pending.expires<Date.now()){await writeState(env,'login-pending',null);}else{pending.storage=storage.driver.states;await writeState(env,'login-pending',pending);}}
});}
