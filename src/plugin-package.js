import bundle from './generated.js';
export function pluginFiles(base){
 const root={'$schema':'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',name:'telegram-account',version:'1.0.0',description:'Личный Telegram через SDK и MCP',extensions:{'com.openai':{interface:{displayName:'Telegram',shortDescription:'Личный Telegram через SDK',capabilities:[]}}}};
 const mcp={'$schema':'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',mcpServers:{telegram:{type:'streamable-http',url:base+'/mcp',extensions:{'com.openai':{auth:{type:'oauth',client:{mode:'dcr'},baseScopes:['telegram'],defaultScopes:['telegram','offline_access']}}}}}};
 const files={'plugin.json':JSON.stringify(root,null,2),'mcp.json':JSON.stringify(mcp,null,2)};
 for(const r of bundle.resources)files['skills/'+r.uri.slice('skill://telegram/'.length)]=r.text;
 return files;
}
// ZIP with stored entries: no dependency, no filesystem access, identical on Workers/Node.
export function zipFiles(files){
 const enc=new TextEncoder(),parts=[],central=[];let offset=0;
 const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 for(const [name,value] of Object.entries(files)){
  const n=enc.encode(name),data=enc.encode(value),sum=crc(data),local=new Uint8Array(30+n.length),v=new DataView(local.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,sum,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,n.length,true);local.set(n,30);
  const cent=new Uint8Array(46+n.length),c=new DataView(cent.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint32(16,sum,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,n.length,true);c.setUint32(42,offset,true);cent.set(n,46);parts.push(local,data);central.push(cent);offset+=local.length+data.length;
 }
 const end=new Uint8Array(22),e=new DataView(end.buffer),size=central.reduce((n,x)=>n+x.length,0);e.setUint32(0,0x06054b50,true);e.setUint16(8,central.length,true);e.setUint16(10,central.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);parts.push(...central,end);const out=new Uint8Array(offset+size+22);let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length;}return out;
}
