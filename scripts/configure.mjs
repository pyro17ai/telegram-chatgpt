import fs from 'node:fs';
import crypto from 'node:crypto';
import {createInterface} from 'node:readline/promises';
if(fs.existsSync('.env'))throw new Error('.env already exists. Keep the encryption key when updating.');
let value=process.argv[process.argv.indexOf('--domain')+1];if(!process.argv.includes('--domain')){const rl=createInterface({input:process.stdin,output:process.stdout});value=await rl.question('Домен сервера (или localhost для проверки): ');rl.close();}
const url=new URL(value.includes('://')?value:(value==='localhost'?'http://localhost:3000':'https://'+value));
if(url.pathname!=='/'||url.search||url.hash||url.username||url.password||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('Введите домен без пути. Для внешнего сервера требуется HTTPS.');
const token=crypto.randomBytes(32).toString('hex'),key=crypto.randomBytes(32).toString('base64');
fs.writeFileSync('.env',`PUBLIC_ORIGIN=${url.origin}\nDOMAIN=${url.host}\nTG_STATE_KEY=${key}\nSETUP_TOKEN=${token}\nDEPLOY_TARGET=server\nHOST=127.0.0.1\nPORT=3000\nDATA_DIR=./data\n`,{mode:0o600,flag:'wx'});
console.log(`Настройки записаны в .env (права 600).\nСтраница входа: ${url.origin}\nКлюч владельца: ${token}\nСохраните ключ в менеджере паролей. Не публикуйте .env.`);
