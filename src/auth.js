import {json,randomToken,sha,sameSecret,origin,requireSameOrigin,readJson} from './http.js';
const cookieName='tg_admin';
export function sitesOwner(req,env){return env.DEPLOY_TARGET==='sites'&&!!env.TG_OWNER_EMAIL&&req.headers.get('oai-authenticated-user-email')?.toLowerCase()===env.TG_OWNER_EMAIL.toLowerCase();}
export async function putAuth(env,id,value,ttl){await env.DB.prepare('INSERT OR REPLACE INTO auth(id,value,expires) VALUES(?,?,?)').bind(id,JSON.stringify(value),Date.now()+ttl).run();}
export async function getAuth(env,id,consume=false){const sql=consume?'DELETE FROM auth WHERE id=? AND expires>? RETURNING value':'SELECT value FROM auth WHERE id=? AND expires>?';const row=await env.DB.prepare(sql).bind(id,Date.now()).first();return row?JSON.parse(row.value):null;}
export async function isAdmin(req,env){if(sitesOwner(req,env))return true;if(env.DEPLOY_TARGET==='sites')return false;const match=req.headers.get('cookie')?.match(/(?:^|;\s*)tg_admin=([a-f0-9]{64})(?:;|$)/);return !!(match&&await getAuth(env,'session:'+await sha(match[1])));}
export async function isMcpAuthorized(req,env){if(sitesOwner(req,env))return true;if(env.DEPLOY_TARGET==='sites')return false;const token=req.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)return false;const record=await getAuth(env,'access:'+await sha(token));return record?.resource===origin(env)+'/mcp';}
function cookie(token,env,maxAge=43200){return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${origin(env).startsWith('https:')?'; Secure':''}`;}
export async function handleAdmin(req,env,path){
 if(path==='/api/login'&&req.method==='POST'){
  requireSameOrigin(req,env);if(env.DEPLOY_TARGET==='sites')return json({error:'Войдите через ChatGPT.'},403);
  const body=await readJson(req,4096);
  if(!await sameSecret(body.token,env.SETUP_TOKEN)){
   const bucket='login:'+await sha(req.headers.get('x-bridge-client-ip')||'unknown')+':'+Math.floor(Date.now()/60000);
   const rate=await env.DB.prepare('INSERT INTO rate_limits(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind(bucket,Date.now()+120000).first();
   return json({error:rate.count>10?'Повторите через минуту.':'Неверный ключ владельца.'},rate.count>10?429:401);
  }
  const token=randomToken();await putAuth(env,'session:'+await sha(token),{},43200000);return json({ok:true},200,{'set-cookie':cookie(token,env)});
 }
 if(path==='/api/logout'&&req.method==='POST'){
  requireSameOrigin(req,env);const token=req.headers.get('cookie')?.match(/(?:^|;\s*)tg_admin=([a-f0-9]{64})/)?.[1];if(token)await env.DB.prepare('DELETE FROM auth WHERE id=?').bind('session:'+await sha(token)).run();return json({ok:true},200,{'set-cookie':cookie('',env,0)});
 }
 return null;
}
