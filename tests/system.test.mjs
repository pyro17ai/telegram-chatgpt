import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
import {createStorage} from '../server/storage.mjs';
import {readState,writeState} from '../src/storage.js';
import {putAuth} from '../src/auth.js';
import {sha} from '../src/http.js';
import {checkDeployment} from '../scripts/check-deployment.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'telegram-bridge-test-'));
const data=createStorage(dir);const secret=crypto.randomBytes(32).toString('hex');
const env={...data,DEPLOY_TARGET:'server',PUBLIC_ORIGIN:'http://localhost:3000',TG_STATE_KEY:crypto.randomBytes(32).toString('base64'),SETUP_TOKEN:secret};
after(()=>{data.close();fs.rmSync(dir,{recursive:true,force:true});});
await build({stdin:{contents:"export {default as worker,run} from './src/worker.js'; export {telegramLogin} from './src/telegram-login.js';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/test-system.mjs',external:['node:*'],loader:{'.txt':'text','.html':'text'},plugins:[{name:'wasm',setup(b){b.onResolve({filter:/\.wasm$/},a=>({path:a.path,namespace:'wasm'}));b.onLoad({filter:/.*/,namespace:'wasm'},a=>({contents:`import fs from 'node:fs';export default new WebAssembly.Module(fs.readFileSync(${JSON.stringify(path.resolve(a.path.includes('quickjs')?'node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm':'node_modules/@mtcute/wasm/mtcute.wasm'))}));`,loader:'js'}));}}]});
const {worker,run,telegramLogin}=await import('../.sites-runtime/test-system.mjs');
const req=(url,body,headers={},method=body?'POST':'GET')=>new Request(env.PUBLIC_ORIGIN+url,{method,headers:{...(body?{'content-type':'application/json',origin:env.PUBLIC_ORIGIN}:{}),...headers},body:body?JSON.stringify(body):undefined});
let cookie,client,access,refresh;
test('owner login, CSRF, forged identity, authenticated status',async()=>{
 assert.equal((await worker.fetch(req('/api/status'),env)).status,200);
 assert.equal((await (await worker.fetch(req('/api/status',null,{'oai-authenticated-user-email':'owner@example.com'}),env)).json()).authenticated,false);
 assert.equal((await worker.fetch(req('/api/login',{token:secret},{origin:'https://evil.example'}),env)).status,400);
 assert.equal((await worker.fetch(req('/api/login',{token:'wrong'}),env)).status,401);
 const r=await worker.fetch(req('/api/login',{token:secret}),env);assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];assert.match(r.headers.get('set-cookie'),/HttpOnly/);
 assert.equal((await (await worker.fetch(req('/api/status',null,{cookie}),env)).json()).authenticated,true);
 assert.equal((await worker.fetch(req('/api/telegram/start',{apiId:1},{origin:'https://evil.example',cookie}),env)).status,400);
});
test('OAuth DCR, PKCE, consent, single use, audience, refresh rotation',async()=>{
 const unauth=await worker.fetch(req('/mcp',{jsonrpc:'2.0',id:1,method:'tools/list'}),env);assert.equal(unauth.status,401);assert.match(unauth.headers.get('www-authenticate'),/resource_metadata/);
 const meta=await (await worker.fetch(req('/.well-known/oauth-authorization-server'),env)).json();assert.equal(meta.authorization_response_iss_parameter_supported,true);assert.deepEqual(meta.code_challenge_methods_supported,['S256']);
 assert.equal((await worker.fetch(req('/oauth/register',{redirect_uris:['https://evil.example/callback']}),env)).status,400);
 const redirect='https://chatgpt.com/connector_platform_oauth_redirect';client=await (await worker.fetch(req('/oauth/register',{redirect_uris:[redirect],client_name:'ChatGPT',token_endpoint_auth_method:'none'}),env)).json();assert.ok(client.client_id);
 const verifier=crypto.randomBytes(32).toString('base64url'),challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
 const params=new URLSearchParams({client_id:client.client_id,redirect_uri:redirect,response_type:'code',code_challenge:challenge,code_challenge_method:'S256',resource:env.PUBLIC_ORIGIN+'/mcp',scope:'telegram offline_access',state:'state-test'});
 const consent=await worker.fetch(req('/oauth/authorize?'+params,null,{cookie}),env);assert.equal(consent.status,200);const ticket=(await consent.text()).match(/name="ticket" value="([a-f0-9]+)"/)[1];
 const approved=await worker.fetch(new Request(env.PUBLIC_ORIGIN+'/oauth/authorize',{method:'POST',headers:{cookie,origin:env.PUBLIC_ORIGIN,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket,decision:'allow'})}),env);const callback=new URL(approved.headers.get('location'));assert.equal(callback.searchParams.get('iss'),env.PUBLIC_ORIGIN);assert.equal(callback.searchParams.get('state'),'state-test');
 const form={grant_type:'authorization_code',client_id:client.client_id,redirect_uri:redirect,code:callback.searchParams.get('code'),code_verifier:verifier,resource:env.PUBLIC_ORIGIN+'/mcp'};
 const exchange=async p=>worker.fetch(new Request(env.PUBLIC_ORIGIN+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(p)}),env);
 assert.equal((await exchange({...form,resource:'https://evil.example/mcp'})).status,400);
 assert.equal((await exchange({...form,code_verifier:crypto.randomBytes(32).toString('base64url')})).status,400);
 const result=await exchange(form);assert.equal(result.status,200);({access_token:access,refresh_token:refresh}=await result.json());assert.equal((await exchange(form)).status,400);
 const rotate={grant_type:'refresh_token',client_id:client.client_id,refresh_token:refresh,resource:env.PUBLIC_ORIGIN+'/mcp'};assert.equal((await exchange({...rotate,client_id:'wrong'})).status,400);const rotated=await exchange(rotate);assert.equal(rotated.status,200);assert.equal((await exchange(rotate)).status,400);
 const listed=await (await worker.fetch(req('/mcp',{jsonrpc:'2.0',id:2,method:'tools/list'},{authorization:'Bearer '+access}),env)).json();assert.equal(listed.result.tools.length,4);assert.ok(listed.result.tools.every(t=>t.securitySchemes[0].type==='oauth2'));
});
test('real interpreter through MCP, idempotency and large R2 payload',async()=>{
 const args={request_id:'test-request-0001',code:"const n=Number(await files.read('counter')||0)+1; await files.write('counter',String(n)); console.log(n);"};
 const call=async a=>(await (await worker.fetch(req('/mcp',{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'execute_typescript',arguments:a}},{authorization:'Bearer '+access}),env)).json()).result;
 let r=JSON.parse((await call()).content[0].text); // Missing arguments must be a handled error.
 assert.equal(r.ok,false);
 r=JSON.parse((await call(args)).content[0].text);assert.equal(r.ok,true);assert.deepEqual(r.stdout,['1']);
 r=JSON.parse((await call(args)).content[0].text);assert.equal(r.replayed,true);assert.equal(await readState(env,'file:counter'),'1');
 assert.equal(JSON.parse((await call({...args,code:'console.log(2)'})).content[0].text).ok,false);
 const large='я'.repeat(1000000);await writeState(env,'file:unicode',large);assert.equal(await readState(env,'file:unicode'),large);
});
test('Telegram OTP then 2FA across reconstructed clients; no plaintext secrets',async()=>{
 const apiHash=crypto.randomBytes(16).toString('hex'),password='only-in-memory-'+crypto.randomUUID();let destroyed=0;
 const factory=(config,saved)=>({storage:{driver:{states:saved||new Map([['kv',{ready:true}]])}},tg:{async sendCode(){return {phoneCodeHash:'test-hash',type:'app'};},async signIn(p){if(p.phoneCode==='00000')throw {text:'PHONE_CODE_INVALID'};throw {text:'SESSION_PASSWORD_NEEDED'};},async checkPassword(p){assert.equal(p,password);return {id:42,isBot:false,displayName:'Test'};},async exportSession(){return 'test-session-'+apiHash;},async destroy(){destroyed++;}}});
 assert.equal((await telegramLogin(env,'start',{apiId:1,apiHash,phone:'+15550001234'},factory)).stage,'code');
 await assert.rejects(telegramLogin(env,'code',{code:'00000'},factory),e=>e.text==='PHONE_CODE_INVALID');
 assert.equal((await telegramLogin(env,'code',{code:'12345'},factory)).stage,'password');
 assert.equal((await telegramLogin(env,'password',{password},factory)).stage,'connected');assert.equal(destroyed,4);
 const a=await readState(env,'account');assert.equal(a.userId,42);assert.equal(await readState(env,'login-pending'),null);
 for(const file of fs.readdirSync(path.join(dir,'objects'))){const stored=fs.readFileSync(path.join(dir,'objects',file),'utf8');assert.ok(!stored.includes(password)&&!stored.includes(apiHash));}
 await assert.rejects(telegramLogin(env,'start',{apiId:1,apiHash,phone:'+15550001234'},factory),/ALREADY_CONNECTED/);
});
test('Sites authorization is explicit and fails closed without configured owner',async()=>{
 const sites={...env,DEPLOY_TARGET:'sites',TG_OWNER_EMAIL:'owner@example.com'};
 assert.equal((await (await worker.fetch(req('/api/status',null,{'oai-authenticated-user-email':'owner@example.com'}),sites)).json()).authenticated,true);
 assert.equal((await (await worker.fetch(req('/api/status',null,{'oai-authenticated-user-email':'other@example.com'}),sites)).json()).authenticated,false);
 assert.equal((await (await worker.fetch(req('/api/status',null,{cookie}),{...sites,TG_OWNER_EMAIL:''})).json()).authenticated,false);
});
test('plugin archive includes skills and no installation secrets',async()=>{
 const r=await worker.fetch(req('/plugin.zip',null,{cookie}),env);assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(bytes.readUInt32LE(0),0x04034b50);const text=bytes.toString();assert.ok(text.includes('skills/telegram-account-sdk/SKILL.md'));assert.ok(text.includes(env.PUBLIC_ORIGIN+'/mcp'));assert.ok(!text.includes(secret)&&!text.includes(env.TG_STATE_KEY));
});
test('failed sendCode and expired code return to credentials; restart is explicit',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'telegram-login-retry-')),store=createStorage(folder),e={...env,...store};
 const params={apiId:1,apiHash:crypto.randomBytes(16).toString('hex'),phone:'+15550001234'};
 const bad=()=>({storage:{driver:{states:new Map()}},tg:{async sendCode(){throw {text:'API_ID_INVALID'};},async destroy(){}}});
 try{await assert.rejects(telegramLogin(e,'start',params,bad));assert.equal((await readState(e,'login-pending')).stage,'credentials');
 assert.equal((await telegramLogin(e,'cancel',{},bad)).stage,'credentials');assert.equal(await readState(e,'login-pending'),null);
 const expired=()=>({storage:{driver:{states:new Map()}},tg:{async sendCode(){return {phoneCodeHash:'test-hash'};},async signIn(){throw {text:'PHONE_CODE_EXPIRED'};},async destroy(){}}});
 await telegramLogin(e,'start',params,expired);await assert.rejects(telegramLogin(e,'code',{code:'12345'},expired));assert.equal(await readState(e,'login-pending'),null);
 }finally{store.close();fs.rmSync(folder,{recursive:true,force:true});}
});
test('failed login flood cannot lock out a valid owner key',async()=>{
 for(let i=0;i<12;i++)await worker.fetch(req('/api/login',{token:'wrong'}),env);
 assert.equal((await worker.fetch(req('/api/login',{token:secret}),env)).status,200);
});
test('free hostname is used consistently by live OAuth and the generated plugin',async()=>{
 const configured={...env,PUBLIC_ORIGIN:'https://telegram.93-184-216-34.sslip.io'};
 await checkDeployment(configured.PUBLIC_ORIGIN,(url,options)=>worker.fetch(new Request(url,options),configured));
 const login=await worker.fetch(new Request(configured.PUBLIC_ORIGIN+'/api/login',{method:'POST',headers:{'content-type':'application/json',origin:configured.PUBLIC_ORIGIN},body:JSON.stringify({token:secret})}),configured);
 assert.equal(login.status,200);
 const ownerCookie=login.headers.get('set-cookie').split(';')[0];
 const archive=await worker.fetch(new Request(configured.PUBLIC_ORIGIN+'/plugin.zip',{headers:{cookie:ownerCookie}}),configured);
 assert.equal(archive.status,200);
 assert.ok(Buffer.from(await archive.arrayBuffer()).includes(Buffer.from(configured.PUBLIC_ORIGIN+'/mcp')));
});
