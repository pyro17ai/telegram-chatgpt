import {build} from 'esbuild';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
await build({entryPoints:['src/executor.js'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/test-executor.mjs',external:['node:*'],loader:{'.txt':'text'},plugins:[{name:'wasm-node',setup(b){b.onResolve({filter:/\.wasm$/},args=>({path:args.path,namespace:'wasm'}));b.onLoad({filter:/.*/,namespace:'wasm'},args=>({contents:`import fs from 'node:fs';export default new WebAssembly.Module(fs.readFileSync(${JSON.stringify(resolve(args.path.includes('quickjs')?'node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm':'node_modules/@mtcute/wasm/mtcute.wasm'))}));`,loader:'js'}));}}]});
const {execute}=await import('../.sites-runtime/test-executor.mjs?'+Date.now());
let closed=0;
class User{get id(){return 42}get name(){return 'Test'}}
class FakeSDK{async getMe(){return new User}async *iterDialogs(){yield {id:1};yield {id:2}}async call(params){return {method:params._,ok:true}}}
const connect=async()=>({tg:new FakeSDK,me:new User,close:async()=>closed++});
let r=await execute('const nums:number[]=[1,2,3]; console.log(nums.map(x=>x*x));',{},{});
assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.stdout[0],'[1,4,9]');
r=await execute("import {withTelegram} from '/example/.codex/skills/telegram-account-sdk/scripts/client.ts'; await withTelegram(async (tg,me)=>{console.log(me.id); console.log((await tg.getMe()).name); const ids=[]; for await(const d of tg.iterDialogs())ids.push(d.id); console.log(ids); console.log(await tg.call({_:'test'}));});",{},{connect});
assert.equal(r.ok,true,JSON.stringify(r));assert.deepEqual(r.stdout,['42','Test','[1,2]','{"method":"test","ok":true}']);assert.equal(closed,1);
r=await execute('throw new Error("expected")',{});assert.equal(r.ok,false);assert.match(r.error.message,/expected/);
r=await execute('while(true){}',{}, {timeoutMs:50});assert.equal(r.ok,false);
r=await execute('while(true){}',{}, {timeoutMs:45000,maxInterrupts:10});assert.equal(r.ok,false);
console.log('PASS: arbitrary TypeScript, preserved client import, async SDK calls, object getters, async iterators, error propagation, execution deadline');
r=await execute('await withTelegram(async(tg)=>{console.log((await tg.getMe()).id);});',{}, {connect:async()=>({tg:new FakeSDK,me:new User,close:async()=>{throw new Error('R2 failed');}})});
assert.equal(r.ok,false);assert.deepEqual(r.stdout,['42']);assert.equal(r.storageError.message,'R2 failed');assert.equal(r.error.name,'StorageError');
console.log('PASS: storage failures retain stdout and report completed execution');
