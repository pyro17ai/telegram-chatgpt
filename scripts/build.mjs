import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const skills=[],allResources=[];
for(const name of fs.readdirSync('skills')){
const root = 'skills/'+name;
const files = fs.readdirSync(root, { recursive: true }).filter(p => !p.split(path.sep).some(part=>part.startsWith('.')) && fs.statSync(path.join(root,p)).isFile()).sort();
const resources = files.map(p => {
  const bytes = fs.readFileSync(path.join(root,p));
  return { uri: `skill://telegram/${name}/${p}`, digest:`sha256:${createHash('sha256').update(bytes).digest('hex')}`, text:bytes.toString('utf8') };
});
const md = resources.find(x=>x.uri.endsWith('/SKILL.md')).text;
const frontmatter = Object.fromEntries(md.split('---')[1].trim().split('\n').map(line => {const i=line.indexOf(':');return [line.slice(0,i),line.slice(i+1).trim()]}));
skills.push({uri:`skill://telegram/${name}/SKILL.md`,frontmatter,resources:resources.map(({uri,digest})=>({uri,digest}))});allResources.push(...resources);
}
const bundle={skills,resources:allResources};
fs.mkdirSync('dist/server',{recursive:true});
fs.writeFileSync('src/generated.js',`export default ${JSON.stringify(bundle)};\n`);
await build({entryPoints:['src/worker.js'],bundle:true,format:'esm',platform:'browser',conditions:['workerd','browser'],target:'es2022',outfile:'dist/server/index.js',external:['./quickjs.wasm','./mtcute.wasm','node:*'],loader:{'.txt':'text','.html':'text'},minify:true});
fs.copyFileSync('node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm','dist/server/quickjs.wasm');
fs.copyFileSync('node_modules/@mtcute/wasm/mtcute.wasm','dist/server/mtcute.wasm');
console.log(JSON.stringify({skills:skills.length,originalSkillDigest:allResources.find(x=>x.uri==='skill://telegram/telegram-account-sdk/SKILL.md').digest}));
