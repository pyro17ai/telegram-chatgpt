import {MemoryStorage,networkMiddlewares} from '@mtcute/core';
import {TelegramClient,WebCryptoProvider} from '@mtcute/web';
import mtcuteWasm from './mtcute.wasm';
import {readState,writeState} from './storage.js';
import {installDialogCompatibility} from './dialogs-compat.js';
export function createClient(config,saved){
 const storage=new MemoryStorage();
 if(saved)for(const name of ['kv','authKeys','peers','refMessages']){const state=saved.get(name);if(state!==undefined){storage[name].state=state;storage.driver.states.set(name,state);}}
 const tg=new TelegramClient({apiId:config.apiId,apiHash:config.apiHash,storage,crypto:new WebCryptoProvider({wasmInput:mtcuteWasm}),disableUpdates:true,logLevel:0,network:{middlewares:[(ctx,next)=>next({...ctx,params:{floodSleepThreshold:0,maxRetryCount:0,timeout:15000,...ctx.params}}),...networkMiddlewares.basic()]}});
 installDialogCompatibility(tg);return {tg,storage};
}
export async function connectTelegram(env){
 const account=await readState(env,'account');if(!account)throw new Error('Откройте страницу сервера и войдите в Telegram.');
 const saved=await readState(env,'telegram-storage');const {tg,storage}=createClient(account,saved);let closed=false;
 async function close(){if(closed)return;closed=true;await tg.destroy();await writeState(env,'telegram-storage',storage.driver.states);}
 try{if(!saved)await tg.importSession(account.session);const me=await tg.getMe();if(me.isBot||me.id!==account.userId)throw new Error('Владелец Telegram-сессии не совпал с настройками');return {tg,me,close};}catch(e){await tg.destroy();throw e;}
}
