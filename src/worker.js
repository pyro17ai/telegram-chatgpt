import skillBundle from './generated.js';
import {execute} from './executor.js';
import {readState,storePayload,loadPayload} from './storage.js';
import references from './references.json';
import setupHtml from './setup.html';
import {json,sha,origin,requireSameOrigin,readJson,withLease} from './http.js';
import {isAdmin,isMcpAuthorized,handleAdmin} from './auth.js';
import {handleOAuth,unauthorized} from './oauth.js';
import {telegramLogin} from './telegram-login.js';
import {pluginFiles,zipFiles} from './plugin-package.js';
const serverInfo={name:'Telegram',version:'1.0.0'};
const tools=[
 {name:'read_skill_file',description:'Читает точные исходные файлы навыков Telegram. Если навыки не смонтированы в файловую систему ChatGPT, прочитай через этот инструмент telegram-account-sdk/SKILL.md и telegram-sites-runtime/SKILL.md и продолжай работу. Список доступных файлов возвращается при пустом path.',inputSchema:{type:'object',properties:{path:{type:'string',description:'Например telegram-account-sdk/SKILL.md или telegram-sites-runtime/SKILL.md'}},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
 {name:'execute_typescript',description:'Исполняет произвольный JavaScript/TypeScript на Sites с mtcute 0.32.2. Глобальная withTelegram(async(tg,me)=>{...}) даёт полный SDK, включая tg.call и async iterators. stdout возвращается в ответе. Всегда используй telegram-sites-runtime вместе с telegram-account-sdk. Только владелец. Bash/Bun ОС не поддерживаются. Не выполняй без поручения записи или отправки сообщений.',inputSchema:{type:'object',properties:{code:{type:'string',description:'Полный TypeScript без shell/heredoc. Вывод через console.log.'},request_id:{type:'string',description:'Уникальный ID запуска. Повтор с тем же кодом и ID не исполняет код повторно.'}},required:['code','request_id'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}},
 {name:'sdk_reference',description:'Точные TypeScript-декларации методов mtcute 0.32.2. Используй перед незнакомым вызовом SDK.',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
 {name:'runtime_diagnostics',description:'Проверяет исполнение TypeScript в интерпретаторе Sites и наличие сохранённой Telegram-сессии, без чтения переписки.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
];
export async function run(args,env){
 if(typeof args.code!=='string'||args.code.length>100000||typeof args.request_id!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(args.request_id))throw new Error('Нужны code до 100000 символов и request_id из 8–100 букв, цифр, дефисов или подчёркиваний');
 const hash=await sha(args.code);
 const replay=async()=>{const old=await env.DB.prepare('SELECT * FROM runs WHERE id=?').bind(args.request_id).first();if(!old)return null;if(old.hash!==hash)throw new Error('Этот request_id уже использован для другого кода');return old.result?{...await loadPayload(env,old.result),replayed:true}:{ok:false,error:{message:'Запуск уже начат. Результат пока неизвестен; не повторяй запись с новым ID.'}};};
 const cached=await replay();if(cached)return cached;
 return withLease(env,async()=>{const again=await replay();if(again)return again;
  await env.DB.prepare("INSERT INTO runs(id,hash,status,created) VALUES(?,?,'running',?)").bind(args.request_id,hash,Date.now()).run();
  const result=await execute(args.code,env);
  await env.DB.prepare("UPDATE runs SET status='finished',result=? WHERE id=?").bind(await storePayload(env,'run:'+args.request_id,result),args.request_id).run();return result;
 });
}
async function diagnostics(env){return {runtime:'QuickJS WASM',sdk:'mtcute 0.32.2',telegramSessionStored:!!await readState(env,'account'),shell:false};}
async function mcp(message,request,env){
 const {id,method,params={}}=message;
 const result=value=>json({jsonrpc:'2.0',id,result:value});
 const error=(code,message)=>json({jsonrpc:'2.0',id,error:{code,message}});
 const capabilities={tools:{},resources:{},extensions:{'io.modelcontextprotocol/skills':{}}};
 if(method==='initialize')return result({protocolVersion:params.protocolVersion??'2025-06-18',capabilities,serverInfo,instructions:'Для работы с Telegram прочитай оба навыка: telegram-account-sdk и telegram-sites-runtime. Выполняй TypeScript через execute_typescript на Sites. Используй sdk_reference для точных сигнатур. Исходный telegram-account-sdk сохранён без изменений; техническую адаптацию задаёт telegram-sites-runtime.'});
 if(method==='server/discover')return result({resultType:'complete',supportedVersions:['2026-07-28'],capabilities,serverInfo});
 if(method?.startsWith('notifications/'))return new Response(null,{status:202});
 if(method==='ping')return result({});
 if(method==='tools/list')return result({tools:env.DEPLOY_TARGET==='sites'?tools:tools.map(t=>({...t,securitySchemes:[{type:'oauth2',scopes:['telegram']}],_meta:{securitySchemes:[{type:'oauth2',scopes:['telegram']}]}}))});
 if(method==='skills/list')return result({skills:skillBundle.skills});
 if(method==='skills/get'){const skill=skillBundle.skills.find(s=>s.uri===params.uri);return skill?result({skill}):error(-32602,'Неизвестный навык');}
 if(method==='resources/list')return result({resources:skillBundle.resources.map(({uri})=>({uri,name:uri.split('/').at(-1),mimeType:'text/plain'}))});
 if(method==='resources/read'){const resource=skillBundle.resources.find(x=>x.uri===params.uri);return resource?result({contents:[{uri:resource.uri,mimeType:'text/plain',text:resource.text}]}):error(-32602,'Неизвестный ресурс');}
 if(method==='tools/call'){
  if(!await isMcpAuthorized(request,env))return new Response('Доступ только владельцу Telegram',{status:403});
  try{
   let value;
   if(params.name==='read_skill_file'){
    const path=String(params.arguments?.path??'');
    const resource=skillBundle.resources.find(r=>r.uri===`skill://telegram/${path}`);
    value=!path?{files:skillBundle.resources.map(r=>r.uri.slice('skill://telegram/'.length))}:resource?{path,sha256:resource.digest,text:resource.text}:{ok:false,error:{message:'Файл навыка не найден'}};
   }
   else if(params.name==='execute_typescript')value=await run(params.arguments??{},env);
   else if(params.name==='runtime_diagnostics')value=await diagnostics(env);
   else if(params.name==='sdk_reference'){
    const q=String(params.arguments?.query??'').toLowerCase();if(!q)return error(-32602,'Укажи имя метода');
    const matches=Object.entries(references).filter(([name,text])=>name.toLowerCase().includes(q)||text.toLowerCase().includes(q));
    value={matches:matches.slice(0,5).map(([file,text])=>({file,text:text.slice(0,25000)})),totalMatches:matches.length};
   }else return error(-32602,'Неизвестный инструмент');
   return result({content:[{type:'text',text:JSON.stringify(value)}],isError:value?.ok===false});
  }catch(e){return result({content:[{type:'text',text:JSON.stringify({ok:false,error:{name:e.name,message:e.message}})}],isError:true});}
 }
 return error(-32601,'Метод не поддерживается');
}

export default {async fetch(request,env){
 try{
  const path=new URL(request.url).pathname;
  if(path==='/health')return json({ok:true});
  if(!env.TG_STATE_KEY||!env.PUBLIC_ORIGIN||!['server','sites'].includes(env.DEPLOY_TARGET))return json({error:'Сервер ещё не настроен. Проверьте переменные окружения.'},503);
  origin(env);
  const admin=await handleAdmin(request,env,path);if(admin)return admin;
  const oauth=await handleOAuth(request,env,path);if(oauth)return oauth;
  if(path==='/')return new Response(setupHtml,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}});
  if(path==='/api/status'){
   if(!await isAdmin(request,env))return json({authenticated:false});
   const a=await readState(env,'account'),p=await readState(env,'login-pending');
   return json({authenticated:true,connected:!!a,userId:a?.userId,stage:p?.expires>Date.now()?p.stage:'credentials',target:env.DEPLOY_TARGET,pluginUrl:env.PLUGIN_URL||undefined});
  }
  if(path.startsWith('/api/telegram/')&&request.method==='POST'){
   if(!await isAdmin(request,env))return json({error:'unauthorized'},401);requireSameOrigin(request,env);
   try{return json(await telegramLogin(env,path.split('/').at(-1),await readJson(request,8192)));}catch(e){const known=['ALREADY_CONNECTED','INVALID_CREDENTIALS','WAIT_BEFORE_RESEND','LOGIN_EXPIRED','INVALID_ACTION','INVALID_CODE','INVALID_PASSWORD','USER_ACCOUNT_REQUIRED','BUSY'];const text=e.text||e.message;return json({error:known.includes(text)||/^[A-Z][A-Z0-9_]{3,80}$/.test(text)?text:'Не удалось подключиться к Telegram. Проверьте данные и повторите.'},400);}
  }
  if(path==='/plugin.zip'){
   if(!await isAdmin(request,env))return json({error:'unauthorized'},401);
   return new Response(zipFiles(pluginFiles(origin(env))),{headers:{'content-type':'application/zip','content-disposition':'attachment; filename="Telegram.zip"','cache-control':'no-store'}});
  }
  if(path==='/mcp'){
   // Sites authenticates discovery itself. Standalone servers require OAuth throughout.
   if(env.DEPLOY_TARGET!=='sites'&&!await isMcpAuthorized(request,env))return unauthorized(env);
   if(request.method!=='POST')return new Response(null,{status:405,headers:{allow:'POST'}});
   const msg=await readJson(request);if(!msg||typeof msg!=='object'||Array.isArray(msg))return json({error:'Нужен объект JSON-RPC'},400);
   return mcp(msg,request,env);
  }
  return json({error:'not_found'},404);
 }catch{return json({error:'Запрос отклонён. Проверьте настройки сервера и параметры.'},400);}
}};
