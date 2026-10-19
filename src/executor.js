import {newQuickJSWASMModuleFromVariant,newVariant} from 'quickjs-emscripten-core';
import baseVariant from '@jitl/quickjs-wasmfile-release-sync';
import qjsWasm from './quickjs.wasm';
import {transform} from 'sucrase';
import * as sdk from '@mtcute/core';
import Long from 'long';
import guest from './guest.txt';
import {connectTelegram} from './telegram.js';
import {readState,writeState} from './storage.js';

export async function execute(code,env,{timeoutMs=45000,maxInterrupts=10000,connect=()=>connectTelegram(env)}={}){
  const started=Date.now(),deadline=started+timeoutMs;
  const engine=await newQuickJSWASMModuleFromVariant(newVariant(baseVariant,{wasmModule:qjsWasm}));
  const vm=engine.newContext();
  vm.runtime.setMemoryLimit(32*1024*1024);vm.runtime.setMaxStackSize(512*1024);
  let interrupts=0;
  vm.runtime.setInterruptHandler(()=>++interrupts>maxInterrupts||Date.now()>deadline);
  const refs=new Map(),objects=new WeakMap(),pending=new Set(),deferred=new Set(),stdout=[];
  let nextId=1,alive=true,connection,connectionPromise,outputBytes=0;
  const blocked=new Set(['constructor','__proto__','prototype']);
  const errValue=e=>({name:e?.name??'Error',message:String(e?.message??e),...(e?.seconds!==undefined?{seconds:e.seconds}:{}),...(e?.text?{text:e.text}:{})});
  function pack(v,parent){
    if(v===undefined)return {$type:'undefined'};
    if(typeof v==='bigint')return {$type:'bigint',value:String(v)};
    if(v===null||typeof v!=='object'&&typeof v!=='function')return v;
    if(v instanceof Date)return {$type:'date',value:v.toISOString()};
    if(v instanceof Uint8Array)return {$type:'bytes',value:Array.from(v)};
    if(Array.isArray(v))return v.map(x=>pack(x));
    if(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null)return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,pack(x)]));
    let id=parent?undefined:objects.get(v);
    if(!id){id=nextId++;refs.set(id,{value:v,parent});if(!parent)objects.set(v,id);}
    return {$type:'ref',id,callable:typeof v==='function',name:v.constructor?.name};
  }
  function unpack(v){
    if(v===null||typeof v!=='object')return v;
    if(v.$type==='ref'){if(!refs.has(v.id))throw new Error('Неизвестная ссылка SDK');return refs.get(v.id).value;}
    if(v.$type==='undefined')return undefined;
    if(v.$type==='bigint')return BigInt(v.value);
    if(v.$type==='date')return new Date(v.value);
    if(v.$type==='bytes')return new Uint8Array(v.value);
    if(Array.isArray(v))return v.map(unpack);
    return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,unpack(x)]));
  }
  function toHandle(v,parent){return vm.unwrapResult(vm.evalCode(`__revive(${JSON.stringify(pack(v,parent))})`));}
  function result(v,parent){
    if(v&&typeof v.then==='function'){
      const p=vm.newPromise();deferred.add(p);
      const task=Promise.resolve(v).then(x=>{if(alive)toHandle(x).consume(h=>p.resolve(h));},e=>{if(alive)vm.newError(errValue(e)).consume(h=>p.reject(h));}).finally(()=>{pending.delete(task);if(deferred.delete(p))p.dispose();});
      pending.add(task);return p.handle;
    }
    return toHandle(v,parent);
  }
  function expose(name,fn){vm.newFunction(name,(...h)=>{try{return fn(...h)}catch(e){return {error:vm.newError(errValue(e))}}}).consume(h=>vm.setProp(vm.global,name,h));}
  expose('__get',(id,prop)=>{const p=vm.getString(prop);if(blocked.has(p))throw new Error('Доступ к прототипам среды запрещён');const obj=refs.get(vm.getNumber(id));if(!obj)throw new Error('Неизвестный объект');const value=obj.value[p];return result(value,typeof value==='function'?obj.value:undefined);});
  expose('__call',(id,args)=>{const obj=refs.get(vm.getNumber(id));return result(Reflect.apply(obj.value,obj.parent,unpack(JSON.parse(vm.getString(args)))));});
  expose('__construct',(id,args)=>result(Reflect.construct(refs.get(vm.getNumber(id)).value,unpack(JSON.parse(vm.getString(args))))));
  expose('__keys',id=>result(Object.keys(refs.get(vm.getNumber(id)).value).filter(k=>!blocked.has(k))));
  expose('__log',text=>{const line=vm.getString(text);outputBytes+=new TextEncoder().encode(line).length;if(outputBytes>240000)throw new Error('Вывод превысил 240 КБ. Сократи выборку или сохрани данные через files.write.');stdout.push(line);return vm.undefined;});
  expose('__connect',()=>{connectionPromise??=connect().then(x=>{connection=x;if(!alive){void x.close();throw new Error('Запуск уже завершён');}return {tg:x.tg,me:x.me}});return result(connectionPromise);});
  expose('__sdk',()=>result(sdk));
  expose('__long',()=>result(Long));
  expose('__fetch',(url,opts)=>result(fetch(vm.getString(url),unpack(JSON.parse(vm.getString(opts))))));
  expose('__file',(op,path,data)=>{
    const operation=vm.getString(op),name=vm.getString(path);
    if(operation==='read')return result(readState(env,'file:'+name));
    if(operation==='write'){const text=vm.getString(data);if(text.length>1000000)throw new Error('Файл больше 1 000 000 символов');return result(writeState(env,'file:'+name,text).then(()=>true));}
    return result(env.DB.prepare("SELECT key FROM state WHERE key LIKE 'file:%' ORDER BY key").all().then(r=>r.results.map(x=>x.key.slice(5))));
  });
  let promiseHandle,outcome;
  try{
    vm.unwrapResult(vm.evalCode(guest)).dispose();
    const compiled=transform(code,{transforms:['typescript','imports'],filePath:'task.ts',disableESTransforms:true}).code;
    promiseHandle=vm.unwrapResult(vm.evalCode(`(async()=>{const exports={};\n${compiled}\n})()`, 'task.js'));
    while(true){
      if(Date.now()>deadline)throw new Error('Время исполнения истекло. При записи проверь результат перед повтором.');
      const jobs=vm.runtime.executePendingJobs();if(jobs.error){const e=vm.dump(jobs.error);jobs.error.dispose();throw new Error(JSON.stringify(e));}
      const state=vm.getPromiseState(promiseHandle);
      if(state.type==='fulfilled'){const value=vm.dump(state.value);state.value.dispose();outcome={ok:true,stdout,returnValue:value,elapsedMs:Date.now()-started};break;}
      if(state.type==='rejected'){const error=vm.dump(state.error);state.error.dispose();outcome={ok:false,stdout,error,elapsedMs:Date.now()-started};break;}
      if(!pending.size)throw new Error('Promise не завершён: в этой среде нет активной операции, которая могла бы его завершить');
      await Promise.race([...pending,new Promise(resolve=>setTimeout(resolve,Math.min(250,Math.max(1,deadline-Date.now()))))]);
    }
  }catch(e){outcome={ok:false,stdout,error:errValue(e),elapsedMs:Date.now()-started};}
  finally{
    alive=false;
    try{await connection?.close();}catch(e){outcome={...outcome,ok:false,storageError:errValue(e),error:outcome?.error??{name:'StorageError',message:'Код выполнен, но сохранить состояние Telegram не удалось. Проверь результат перед повтором.'}};}finally{for(const p of deferred)p.dispose();deferred.clear();promiseHandle?.dispose();vm.dispose();}
  }
  return outcome;
}
