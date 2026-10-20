import fs from 'node:fs';
import crypto from 'node:crypto';
import {isIP} from 'node:net';
import {Resolver} from 'node:dns/promises';
import {pathToFileURL} from 'node:url';

export function publicIPv4(value) {
  if (isIP(value) !== 4) return false;
  const [a,b,c] = value.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && (b === 168 || b === 0 && [0,2].includes(c) || b === 88 && c === 99) ||
    a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
    a === 203 && b === 0 && c === 113);
}

export async function detectIPv4(fetchFn = fetch) {
  for (const endpoint of ['https://api.ipify.org', 'https://checkip.amazonaws.com']) {
    try {
      const response = await fetchFn(endpoint, {signal: AbortSignal.timeout(6000)});
      if (!response.ok) continue;
      const ip = (await response.text()).trim();
      if (publicIPv4(ip)) return ip;
    } catch {}
  }
  throw new Error('Не удалось определить публичный IPv4. Запустите установку на сервере с --ip ПУБЛИЧНЫЙ_IP.');
}

export function parseOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!['--domain','--ip','--dns-suffix'].includes(name) || !args[i+1] || args[i+1].startsWith('--')) {
      throw new Error('Параметры: --ip ПУБЛИЧНЫЙ_IP, --dns-suffix sslip.io|nip.io или --domain СВОЙ_ДОМЕН. Без параметров адрес создаётся автоматически.');
    }
    if (options[name]) throw new Error('Параметр указан дважды: '+name);
    options[name] = args[++i];
  }
  if (options['--domain'] && (options['--ip'] || options['--dns-suffix'])) {
    throw new Error('--domain нельзя сочетать с параметрами бесплатного адреса.');
  }
  return options;
}

export async function resolveAddress(args, dependencies = {}) {
  const options = parseOptions(args);
  if (options['--domain']) {
    const value = options['--domain'];
    const url = new URL(value.includes('://') ? value : value === 'localhost' ? 'http://localhost:3000' : 'https://'+value);
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password ||
      !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) {
      throw new Error('Укажите адрес без пути. Для внешнего сервера требуется HTTPS.');
    }
    if (url.protocol === 'https:' && isIP(url.hostname.replace(/^\[|\]$/g,''))) {
      throw new Error('Для публичного IP используйте --ip: установщик добавит бесплатное DNS-имя и настроит HTTPS.');
    }
    return {origin: url.origin, host: url.host, mode: 'custom'};
  }
  const suffix = options['--dns-suffix'] || 'sslip.io';
  if (!['sslip.io','nip.io'].includes(suffix)) throw new Error('Поддерживаются sslip.io и nip.io.');
  const ip = options['--ip'] || await (dependencies.detectIP || detectIPv4)();
  if (!publicIPv4(ip)) throw new Error('--ip должен содержать публичный IPv4 сервера, доступный из интернета.');
  const host = 'telegram.'+ip.replaceAll('.','-')+'.'+suffix;
  const resolver = new Resolver({timeout: 3000, tries: 2});
  let addresses;
  try { addresses = await (dependencies.resolve4 || (name => resolver.resolve4(name)))(host); }
  catch { throw new Error('Не удалось проверить DNS для '+host+'. Повторите позже или используйте --dns-suffix nip.io.'); }
  if (!addresses.length || addresses.some(value => value !== ip)) throw new Error('DNS-адрес не совпадает с IP сервера: '+host);
  return {origin: 'https://'+host, host, mode: 'free-dns', ip};
}

export async function configure(args, {directory = '.', ...dependencies} = {}) {
  const filename = directory+'/.env';
  if (fs.existsSync(filename)) throw new Error('.env уже существует. При обновлении сохраните адрес и ключ шифрования; используйте bash scripts/deploy.sh без параметров.');
  const address = await resolveAddress(args, dependencies);
  const token = crypto.randomBytes(32).toString('hex');
  const key = crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(filename, `PUBLIC_ORIGIN=${address.origin}\nDOMAIN=${address.host}\nTG_STATE_KEY=${key}\nSETUP_TOKEN=${token}\nDEPLOY_TARGET=server\nHOST=127.0.0.1\nPORT=3000\nDATA_DIR=./data\n`, {mode: 0o600, flag: 'wx'});
  return {address, loginUrl: address.origin+'/#setup='+token};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await configure(process.argv.slice(2));
    console.log(`Настройки записаны в .env (права 600).\nПубличный адрес: ${result.address.origin}\nПерсональная ссылка владельца: ${result.loginUrl}\nСохраните ссылку в менеджере паролей. Не публикуйте её или .env.\nПосле запуска Caddy дождитесь готовности HTTPS.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
