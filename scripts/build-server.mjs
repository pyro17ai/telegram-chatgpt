import fs from 'node:fs';
import {build} from 'esbuild';
import './build.mjs';
fs.mkdirSync('dist/node',{recursive:true});
await build({entryPoints:['server/main.mjs'],bundle:true,platform:'node',format:'esm',target:'node24',outfile:'dist/node/server.mjs',external:['node:*'],loader:{'.txt':'text','.html':'text'},plugins:[{name:'wasm-node',setup(b){b.onResolve({filter:/\.wasm$/},args=>({path:args.path,namespace:'wasm'}));b.onLoad({filter:/.*/,namespace:'wasm'},args=>({contents:`import fs from 'node:fs';export default new WebAssembly.Module(fs.readFileSync(new URL(${JSON.stringify(args.path.includes('quickjs')?'./quickjs.wasm':'./mtcute.wasm')},import.meta.url)));`,loader:'js'}));}}]});
for(const name of ['quickjs.wasm','mtcute.wasm'])fs.copyFileSync('dist/server/'+name,'dist/node/'+name);
fs.mkdirSync('dist/node/licenses',{recursive:true});
for(const file of fs.readdirSync('node_modules',{recursive:true}).filter(x=>/(^|\/)LICEN[CS]E(?:\.[^/]*)?$/i.test(x))){const full='node_modules/'+file;if(fs.statSync(full).isFile())fs.copyFileSync(full,'dist/node/licenses/'+file.replaceAll('/','__'));}
console.log('Built standalone server');
