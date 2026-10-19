import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024});
const rules=[
 ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
 ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
 ['telegram-bot-token',/\b\d{8,12}:AA[A-Za-z0-9_-]{30,}\b/],
 ['telegram-api-hash-literal',/\bapiHash\s*[:=]\s*['"][a-fA-F0-9]{32}['"]/],
 ['environment-secret',/^(?:TG_STATE_KEY|SETUP_TOKEN|TG_SERVICE_KEY|TELEGRAM_API_HASH|OPENAI_API_KEY)[ \t]*=[ \t]*[A-Za-z0-9+/_=-]{20,}[ \t]*$/m],
 ['cloud-key',/\b(?:AKIA[0-9A-Z]{16}|sk-proj-[A-Za-z0-9_-]{30,})\b/],
 ['credential-url',/https?:\/\/[^\s/@]+:[^\s/@]+@/],
 ['personal-installation',/\/Users\/[a-zA-Z0-9._-]+\/|\b(?:appgprj|appgdep|asdk_app_sites)_[a-f0-9]{20,}\b/],
];
const forbidden=/(^|\/)(?:\.env(?:\.(?!example$)[^/]+)?|data|node_modules|\.sites-runtime|\.DS_Store)(?:\/|$)|\.(?:session|sqlite(?:-wal|-shm)?|db|pem|p12)$/;
const findings=[];let checked=0;
function inspect(label,text){checked++;for(const [name,re] of rules)if(re.test(text))findings.push({file:label,rule:name});}
let files;
try{files=git('ls-files','-z').split('\0').filter(Boolean);}catch{throw new Error('Initialize Git and stage the public source before scanning.');}
if(!files.length)throw new Error('No tracked files to scan. Stage the public source first.');
for(const file of files){if(forbidden.test(file))findings.push({file,rule:'forbidden-file'});if(fs.existsSync(file))inspect(file,fs.readFileSync(file,'utf8'));}
let objects=[];try{objects=git('rev-list','--objects','--all').trim().split('\n').filter(Boolean);}catch{}
for(const entry of objects){const [id,...rest]=entry.split(' '),name=rest.join(' ');if(git('cat-file','-t',id).trim()!=='blob')continue;if(forbidden.test(name))findings.push({file:name,rule:'forbidden-history-file'});inspect('history:'+id.slice(0,12)+':'+name,git('cat-file','blob',id));}
console.log(JSON.stringify({ok:!findings.length,trackedFiles:files.length,objectsChecked:checked,findings},null,2));if(findings.length)process.exitCode=1;
