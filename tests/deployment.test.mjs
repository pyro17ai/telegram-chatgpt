import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {configure, detectIPv4, parseOptions, publicIPv4, resolveAddress} from '../scripts/configure.mjs';
import {checkDeployment, validateConfig} from '../scripts/check-deployment.mjs';

const ip = '93.184.216.34';
const dependencies = {detectIP: async () => ip, resolve4: async () => [ip]};

test('automatic address needs no registration and validates the matching public DNS', async () => {
  const first = await resolveAddress([], dependencies);
  assert.equal(first.origin, 'https://telegram.93-184-216-34.sslip.io');
  assert.deepEqual(await resolveAddress([], dependencies), first);
  assert.equal((await resolveAddress(['--ip',ip,'--dns-suffix','nip.io'], dependencies)).host, 'telegram.93-184-216-34.nip.io');
  await assert.rejects(resolveAddress([], {...dependencies,resolve4: async () => ['127.0.0.1']}), /не совпадает/);
  await assert.rejects(resolveAddress([], {...dependencies,resolve4: async () => []}), /не совпадает/);
  await assert.rejects(resolveAddress(['--dns-suffix','attacker.example'],dependencies), /Поддерживаются/);
});

test('IP discovery tries a second provider and refuses private or reserved addresses', async () => {
  let calls = 0;
  assert.equal(await detectIPv4(async () => new Response(++calls === 1 ? '10.0.0.1' : ip)), ip);
  assert.equal(calls,2);
  await assert.rejects(detectIPv4(async () => new Response('127.0.0.1')), /определить/);
  for (const value of ['0.0.0.0','10.2.3.4','100.64.0.1','127.0.0.1','169.254.1.1','172.16.0.1','192.168.1.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','1.2.3.999','::1','example.com']) {
    assert.equal(publicIPv4(value), false, value);
  }
  assert.equal(publicIPv4(ip),true);
  await assert.rejects(resolveAddress(['--ip','10.0.0.1'],dependencies), /публичный IPv4/);
});

test('configuration keeps the original address and encryption key when run again', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'telegram-config-test-'));
  try {
    const result = await configure([], {...dependencies,directory});
    const filename = path.join(directory,'.env');
    const original = fs.readFileSync(filename,'utf8');
    assert.equal(fs.statSync(filename).mode & 0o777,0o600);
    const env = Object.fromEntries(original.trim().split('\n').map(line => [line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)]));
    assert.equal(validateConfig(env),result.address.origin);
    assert.equal(new URL(result.loginUrl).search,'');
    assert.equal(new URLSearchParams(new URL(result.loginUrl).hash.slice(1)).get('setup'),env.SETUP_TOKEN);
    await assert.rejects(configure(['--ip','1.1.1.1'],{...dependencies,directory}), /уже существует/);
    assert.equal(fs.readFileSync(filename,'utf8'),original);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});

test('explicit domain and local development still work; malformed arguments fail', async () => {
  assert.equal((await resolveAddress(['--domain','telegram.example.com'])).origin,'https://telegram.example.com');
  assert.equal((await resolveAddress(['--domain','http://localhost:3000'])).origin,'http://localhost:3000');
  for (const args of [['--ip'],['--unknown','value'],['--ip',ip,'--ip',ip],['--domain','example.com','--ip',ip]]) {
    assert.throws(() => parseOptions(args));
  }
  const credentialUrl = new URL('https://example.com');
  credentialUrl.username = 'test';
  credentialUrl.password = crypto.randomUUID();
  for (const value of ['http://example.com',credentialUrl.href,'https://example.com/path','https://example.com/?x=1','https://'+ip]) {
    await assert.rejects(resolveAddress(['--domain',value]));
  }
});

test('readiness rejects broken OAuth metadata and never posts installation secrets', async () => {
  const base = 'https://telegram.'+ip.replaceAll('.','-')+'.sslip.io';
  const metadata = {
    '/health': {ok:true},
    '/.well-known/oauth-authorization-server': {issuer:base,authorization_endpoint:base+'/oauth/authorize',token_endpoint:base+'/oauth/token',registration_endpoint:base+'/oauth/register',code_challenge_methods_supported:['S256']},
    '/.well-known/oauth-protected-resource': {resource:base+'/mcp',authorization_servers:[base]},
  };
  const fetchFn = async (url,options) => {
    assert.equal(options.redirect,'error');
    assert.equal(options.body,undefined);
    const pathname = new URL(url).pathname;
    return pathname === '/mcp'
      ? new Response('',{status:401,headers:{'www-authenticate':'Bearer resource_metadata="'+base+'/.well-known/oauth-protected-resource"'}})
      : Response.json(metadata[pathname]);
  };
  await checkDeployment(base,fetchFn);
  metadata['/.well-known/oauth-authorization-server'].issuer = 'https://wrong.example';
  await assert.rejects(checkDeployment(base,fetchFn), /metadata/);
});

const pageScript = fs.readFileSync(new URL('../src/setup.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
async function openLoginLink(fragment, rejectLogin = false) {
  const elements = new Map();
  const events = [];
  const location = {hash:fragment,pathname:'/',search:'',origin:'http://localhost:3000',assign(){throw new Error('Unexpected navigation');}};
  const context = {
    location, URLSearchParams,
    document: {
      getElementById(id) { if(!elements.has(id))elements.set(id,{hidden:false,value:'',textContent:''}); return elements.get(id); },
      querySelectorAll() { return []; },
    },
    history: {replaceState(_state,_title,url) { events.push({type:'clear',url}); location.hash=''; }},
    async fetch(url,options) {
      assert.equal(location.hash,'');
      events.push({type:'request',url,body:options.body});
      if(url==='/api/login')return Response.json(rejectLogin ? {error:'unauthorized'} : {ok:true},{status:rejectLogin?401:200});
      assert.equal(url,'/api/status');
      return Response.json({authenticated:true,connected:false,stage:'credentials',target:'server'});
    },
  };
  await vm.runInNewContext(pageScript,context);
  return {events,elements,location};
}

test('personal link clears its secret before requests and opens the Telegram form', async () => {
  const token = crypto.randomBytes(32).toString('hex');
  const {events,elements,location} = await openLoginLink('#setup='+token);
  assert.deepEqual(events.map(event => event.type),['clear','request','request']);
  assert.equal(JSON.parse(events[1].body).token,token);
  assert.equal(events[1].url,'/api/login');
  assert.equal(events[2].url,'/api/status');
  assert.equal(elements.get('credentials').hidden,false);
  assert.equal(elements.get('owner').hidden,true);
  assert.equal(location.hash,'');
});

test('invalid personal link clears the fragment and leaves manual login available', async () => {
  const malformed = await openLoginLink('#setup=broken');
  assert.equal(malformed.events.length,1);
  assert.equal(malformed.elements.get('owner').hidden,false);
  const token = crypto.randomBytes(32).toString('hex');
  const denied = await openLoginLink('#setup='+token,true);
  assert.equal(denied.events.length,2);
  assert.equal(denied.elements.get('owner').hidden,false);
  assert.ok(!denied.elements.get('error').textContent.includes(token));
});
