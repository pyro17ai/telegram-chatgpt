import {json,randomToken,sha,origin,requireSameOrigin,readJson,escapeHtml} from './http.js';
import {putAuth,getAuth,isAdmin} from './auth.js';
const ttl=86400000;
function allowedRedirect(value,env){try{const u=new URL(value);if(u.username||u.password||u.hash)return false;if(value==='https://chatgpt.com/connector_platform_oauth_redirect')return true;if(u.origin==='https://chatgpt.com'&&/^\/connector\/oauth\/[a-zA-Z0-9_-]+$/.test(u.pathname)&&!u.search)return true;return (env.OAUTH_EXTRA_REDIRECT_URIS||'').split(',').filter(Boolean).includes(value);}catch{return false;}}
async function validate(params,env){
 const client=await getAuth(env,'client:'+params.client_id);
 if(!client||!client.redirect_uris.includes(params.redirect_uri)||!allowedRedirect(params.redirect_uri,env))throw new Error('invalid_client');
 if(params.response_type!=='code'||params.code_challenge_method!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge||''))throw new Error('invalid_request');
 if(params.resource!==origin(env)+'/mcp')throw new Error('invalid_target');
 const scopes=(params.scope||'telegram').split(' ');if(!scopes.includes('telegram')||scopes.some(s=>!['telegram','offline_access'].includes(s)))throw new Error('invalid_scope');
 if((params.state||'').length>2048)throw new Error('invalid_request');return client;
}
function challenge(verifier){return crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)).then(x=>btoa(String.fromCharCode(...new Uint8Array(x))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'));}
async function tokens(env,record){const access=randomToken(),refresh=randomToken();await putAuth(env,'access:'+await sha(access),record,3600000);await putAuth(env,'refresh:'+await sha(refresh),record,30*ttl);return json({access_token:access,token_type:'Bearer',expires_in:3600,refresh_token:refresh,scope:record.scope},200,{pragma:'no-cache'});}
export function unauthorized(env){return json({error:'unauthorized'},401,{'www-authenticate':`Bearer resource_metadata="${origin(env)}/.well-known/oauth-protected-resource", scope="telegram"`});}
export async function handleOAuth(req,env,path){
 if(env.DEPLOY_TARGET==='sites')return null;
 const base=origin(env);
 if(path==='/.well-known/oauth-protected-resource'||path==='/.well-known/oauth-protected-resource/mcp')return json({resource:base+'/mcp',authorization_servers:[base],scopes_supported:['telegram','offline_access']});
 if(path==='/.well-known/oauth-authorization-server')return json({issuer:base,authorization_endpoint:base+'/oauth/authorize',token_endpoint:base+'/oauth/token',registration_endpoint:base+'/oauth/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:['telegram','offline_access'],authorization_response_iss_parameter_supported:true});
 if(path==='/oauth/register'&&req.method==='POST'){
  const b=await readJson(req,8192);
  if(!Array.isArray(b.redirect_uris)||!b.redirect_uris.length||b.redirect_uris.length>5||!b.redirect_uris.every(u=>allowedRedirect(u,env)))return json({error:'invalid_redirect_uri'},400);
  if(b.token_endpoint_auth_method&&b.token_endpoint_auth_method!=='none')return json({error:'invalid_client_metadata'},400);
  const bucket='register:'+await sha(req.headers.get('x-bridge-client-ip')||'unknown')+':'+Math.floor(Date.now()/3600000);const count=await env.DB.prepare('INSERT INTO rate_limits(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind(bucket,Date.now()+7200000).first();if(count.count>30)return json({error:'rate_limit'},429);
  const client_id=randomToken();const record={client_id,client_name:String(b.client_name||'ChatGPT').slice(0,120),redirect_uris:b.redirect_uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']};await putAuth(env,'client:'+client_id,record,365*ttl);return json(record,201);
 }
 if(path==='/oauth/authorize'&&req.method==='GET'){
  const params=Object.fromEntries(new URL(req.url).searchParams);const client=await validate(params,env);
  if(!await isAdmin(req,env))return new Response(null,{status:303,headers:{location:'/?returnTo='+encodeURIComponent('/oauth/authorize?'+new URLSearchParams(params)),'cache-control':'no-store'}});
  const ticket=randomToken();await putAuth(env,'consent:'+await sha(ticket),params,600000);
  return new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Подключить Telegram</title><style>body{font:17px/1.6 system-ui;max-width:480px;margin:12vh auto;padding:24px}button{padding:12px 20px;font:inherit}small{color:#555}</style><h1>Подключить Telegram?</h1><p>${escapeHtml(client.client_name)} получит доступ к вашему Telegram через этот сервер. Плагин сможет читать переписку и выполнять порученные действия от вашего имени.</p><small>${escapeHtml(base)}</small><form method="post"><input type="hidden" name="ticket" value="${ticket}"><p><button name="decision" value="allow">Подключить</button> <button name="decision" value="deny">Отмена</button></p></form></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"}});
 }
 if(path==='/oauth/authorize'&&req.method==='POST'){
  requireSameOrigin(req,env);if(!await isAdmin(req,env))return json({error:'unauthorized'},401);
  const form=new URLSearchParams(await req.text());const params=await getAuth(env,'consent:'+await sha(form.get('ticket')||''),true);if(!params)return json({error:'expired_consent'},400);await validate(params,env);
  const target=new URL(params.redirect_uri);if(params.state)target.searchParams.set('state',params.state);target.searchParams.set('iss',base);
  if(form.get('decision')!=='allow'){target.searchParams.set('error','access_denied');}else{const code=randomToken();await putAuth(env,'code:'+await sha(code),params,120000);target.searchParams.set('code',code);}
  return new Response(null,{status:303,headers:{location:target.href,'cache-control':'no-store','referrer-policy':'no-referrer'}});
 }
 if(path==='/oauth/token'&&req.method==='POST'){
  const raw=await req.text();if(raw.length>8192)return json({error:'invalid_request'},400);const p=Object.fromEntries(new URLSearchParams(raw));
  if(p.resource!==base+'/mcp')return json({error:'invalid_target'},400);
  if(p.grant_type==='authorization_code'){
   if(!/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier||''))return json({error:'invalid_grant'},400);
   const key='code:'+await sha(p.code||'');const record=await getAuth(env,key);
   if(!record||record.client_id!==p.client_id||record.redirect_uri!==p.redirect_uri||record.resource!==p.resource||record.code_challenge!==await challenge(p.code_verifier))return json({error:'invalid_grant'},400);
   if(!await getAuth(env,key,true))return json({error:'invalid_grant'},400);
   return tokens(env,{client_id:p.client_id,resource:p.resource,scope:record.scope||'telegram'});
  }
  if(p.grant_type==='refresh_token'){
   const key='refresh:'+await sha(p.refresh_token||'');const r=await getAuth(env,key);if(!r||r.client_id!==p.client_id||r.resource!==p.resource)return json({error:'invalid_grant'},400);
   if(!await getAuth(env,key,true))return json({error:'invalid_grant'},400);return tokens(env,r);
  }
  return json({error:'unsupported_grant_type'},400);
 }
 return null;
}
