import Long from 'long';
export function encode(value){
  if(value===undefined)return {$kind:'undefined'};
  if(typeof value==='bigint')return {$kind:'bigint',value:String(value)};
  if(value===null||typeof value!=='object')return value;
  if(Long.isLong(value))return {$kind:'long',low:value.low,high:value.high,unsigned:value.unsigned};
  if(value instanceof Uint8Array)return {$kind:'bytes',value:Array.from(value)};
  if(value instanceof Date)return {$kind:'date',value:value.toISOString()};
  if(value instanceof Map)return {$kind:'map',value:Array.from(value,([k,v])=>[encode(k),encode(v)])};
  if(value instanceof Set)return {$kind:'set',value:Array.from(value,encode)};
  if(Array.isArray(value))return value.map(encode);
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]));
}
export function decode(value){
  if(value===null||typeof value!=='object')return value;
  if(value.$kind==='undefined')return undefined;
  if(value.$kind==='bigint')return BigInt(value.value);
  if(value.$kind==='long')return Long.fromBits(value.low,value.high,value.unsigned);
  if(value.$kind==='bytes')return new Uint8Array(value.value);
  if(value.$kind==='date')return new Date(value.value);
  if(value.$kind==='map')return new Map(value.value.map(([k,v])=>[decode(k),decode(v)]));
  if(value.$kind==='set')return new Set(value.value.map(decode));
  if(Array.isArray(value))return value.map(decode);
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v)]));
}
async function key(env){return crypto.subtle.importKey('raw',Uint8Array.from(atob(env.TG_STATE_KEY),c=>c.charCodeAt(0)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
const b64=bytes=>{const view=new Uint8Array(bytes);let text='';for(let i=0;i<view.length;i+=32768)text+=String.fromCharCode(...view.subarray(i,i+32768));return btoa(text);};
export async function seal(env,value){const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(env),new TextEncoder().encode(JSON.stringify(encode(value))));return JSON.stringify({iv:b64(iv),data:b64(data)});}
export async function unseal(env,value){const x=JSON.parse(value);const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(atob(x.iv),c=>c.charCodeAt(0))},await key(env),Uint8Array.from(atob(x.data),c=>c.charCodeAt(0)));return decode(JSON.parse(new TextDecoder().decode(data)));}
// D1 stores small indexes. Encrypted payloads live in R2, including SDK peer caches.
// Stable keys replace snapshots rather than accumulating a full copy on every read.
export async function storePayload(env,id,value){
  if(!env.BUCKET)throw new Error('Не подключено хранилище R2 BUCKET');
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id)));
  const objectKey='encrypted/v1/'+Array.from(digest,x=>x.toString(16).padStart(2,'0')).join('');
  const payload=await seal(env,value);
  await env.BUCKET.put(objectKey,payload,{httpMetadata:{contentType:'application/octet-stream'}});
  return JSON.stringify({$storage:'r2-v1',key:objectKey});
}
export async function loadPayload(env,value){
  const record=JSON.parse(value);
  if(record.$storage!=='r2-v1')return unseal(env,value); // Existing D1 session and files remain readable.
  if(!env.BUCKET)throw new Error('Не подключено хранилище R2 BUCKET');
  const object=await env.BUCKET.get(record.key);
  if(!object)throw new Error('Сохранённые данные отсутствуют в R2');
  return unseal(env,await object.text());
}
export async function readState(env,id){const row=await env.DB.prepare('SELECT value FROM state WHERE key=?').bind(id).first();return row?loadPayload(env,row.value):null;}
export async function writeState(env,id,value){const pointer=await storePayload(env,'state:'+id,value);await env.DB.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(id,pointer).run();}
