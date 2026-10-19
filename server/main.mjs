import http from 'node:http';
import worker from '../src/worker.js';
import {createStorage} from './storage.mjs';
import {origin} from '../src/http.js';
const env={...process.env,...createStorage(process.env.DATA_DIR||'./data'),DEPLOY_TARGET:'server'};
origin(env);
if(!/^[a-f0-9]{64}$/.test(env.SETUP_TOKEN||'')||Buffer.from(env.TG_STATE_KEY||'','base64').length!==32)throw new Error('Run npm run configure first');
const server=http.createServer(async(req,res)=>{
 try{
  const parts=[];let length=0;for await(const p of req){length+=p.length;if(length>150000){res.writeHead(413);res.end();return;}parts.push(p);}
  const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value&&!key.startsWith('oai-')&&key!=='x-bridge-client-ip')headers.set(key,Array.isArray(value)?value.join(','):value);
  headers.set('x-bridge-client-ip',process.env.TRUST_PROXY==='1'?String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',').at(-1).trim():req.socket.remoteAddress||'unknown');
  const response=await worker.fetch(new Request(origin(env)+(req.url||'/'),{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(parts),duplex:'half'}),env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500,{'content-type':'application/json'});res.end('{"error":"Internal server error"}');}
});
server.requestTimeout=180000;
server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('Telegram bridge is listening on '+origin(env)));
const cleanup=setInterval(()=>{const now=Date.now();Promise.all([env.DB.prepare('DELETE FROM auth WHERE expires<?').bind(now).run(),env.DB.prepare('DELETE FROM rate_limits WHERE expires<?').bind(now).run()]).catch(()=>{});},3600000);cleanup.unref();
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(()=>{env.close();process.exit(0);}));
