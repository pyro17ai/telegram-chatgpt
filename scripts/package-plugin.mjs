import fs from 'node:fs';
import {pluginFiles,zipFiles} from '../src/plugin-package.js';
const index=process.argv.indexOf('--url');if(index<0)throw new Error('Usage: npm run build && npm run package:plugin -- --url https://telegram.example.com');
const url=new URL(process.argv[index+1]);if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('Use an HTTPS origin');
fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/Telegram.zip',zipFiles(pluginFiles(url.origin)));console.log('Created dist/Telegram.zip without credentials.');
