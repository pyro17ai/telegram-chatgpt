import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
export function createStorage(directory,migrations='drizzle'){
 mkdirSync(directory,{recursive:true,mode:0o700});mkdirSync(path.join(directory,'objects'),{recursive:true,mode:0o700});
 const db=new DatabaseSync(path.join(directory,'index.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY)');
 for(const name of readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort()){
  if(db.prepare('SELECT name FROM migrations WHERE name=?').get(name))continue;
  db.exec('BEGIN IMMEDIATE');try{db.exec(readFileSync(path.join(migrations,name),'utf8'));db.prepare('INSERT INTO migrations VALUES(?)').run(name);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 }
 const DB={prepare(sql){return {bind(...args){const q=db.prepare(sql);return {first:async()=>q.get(...args)??null,run:async()=>{const r=q.run(...args);return {meta:{changes:Number(r.changes)}}},all:async()=>({results:q.all(...args)})};}};}};
 function filename(key){if(!/^encrypted\/v1\/[a-f0-9]{64}$/.test(key))throw new Error('Invalid object key');return path.join(directory,'objects',key.split('/').at(-1));}
 const BUCKET={async put(key,value){const file=filename(key),tmp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,value,{mode:0o600,flag:'wx'});await fs.rename(tmp,file);return {key};},async get(key){try{const value=await fs.readFile(filename(key),'utf8');return {text:async()=>value};}catch(e){if(e.code==='ENOENT')return null;throw e;}}};
 return {DB,BUCKET,close:()=>db.close()};
}
