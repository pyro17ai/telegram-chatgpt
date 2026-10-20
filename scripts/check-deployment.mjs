import {pathToFileURL} from 'node:url';
import {origin} from '../src/http.js';

export function validateConfig(env) {
  const base = origin(env);
  if (!base.startsWith('https://')) throw new Error('Для внешнего подключения нужен HTTPS. Локальную разработку запускайте через npm start.');
  if (new URL(base).host !== env.DOMAIN) throw new Error('DOMAIN и PUBLIC_ORIGIN в .env должны указывать на один адрес.');
  if (!/^[a-f0-9]{64}$/.test(env.SETUP_TOKEN || '') || Buffer.from(env.TG_STATE_KEY || '', 'base64').length !== 32) {
    throw new Error('Некорректные ключи установки. Сохраните исходный .env; не заменяйте ключи существующей сессии.');
  }
  return base;
}

export async function checkDeployment(base, fetchFn = fetch) {
  const get = path => fetchFn(base+path, {redirect: 'error', signal: AbortSignal.timeout(10000)});
  const health = await get('/health');
  if (!health.ok || (await health.json()).ok !== true) throw new Error('HTTP-процесс ещё не готов.');
  const oauthResponse = await get('/.well-known/oauth-authorization-server');
  if (!oauthResponse.ok) throw new Error('OAuth metadata недоступны.');
  const oauth = await oauthResponse.json();
  if (oauth.issuer !== base || oauth.authorization_endpoint !== base+'/oauth/authorize' ||
      oauth.token_endpoint !== base+'/oauth/token' || oauth.registration_endpoint !== base+'/oauth/register' ||
      !oauth.code_challenge_methods_supported?.includes('S256')) throw new Error('OAuth metadata не соответствуют публичному адресу.');
  const resourceResponse = await get('/.well-known/oauth-protected-resource');
  if (!resourceResponse.ok) throw new Error('MCP resource metadata недоступны.');
  const resource = await resourceResponse.json();
  if (resource.resource !== base+'/mcp' || !resource.authorization_servers?.includes(base)) throw new Error('Неверный адрес MCP в metadata.');
  const mcp = await get('/mcp');
  if (mcp.status !== 401 || !mcp.headers.get('www-authenticate')?.includes('resource_metadata')) {
    throw new Error('MCP должен требовать OAuth-авторизацию.');
  }
}

async function main() {
  const base = validateConfig(process.env);
  if (process.argv.includes('--config-only')) return;
  console.log('Ожидаю публичный HTTPS и проверяю OAuth: '+base);
  const deadline = Date.now()+180000;
  let lastError;
  do {
    try {
      await checkDeployment(base);
      console.log(`Сервис готов. HTTPS и OAuth metadata проверены.\nПерсональная ссылка владельца: ${base}/#setup=${process.env.SETUP_TOKEN}\nОткройте её, войдите в Telegram и скачайте плагин для ChatGPT.\nСсылка даёт доступ владельца. Сохраните её приватно, не добавляйте в Git или скриншоты.\nMCP: ${base}/mcp`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } while (Date.now() < deadline);
  throw new Error(`HTTPS ещё не готов: ${lastError.message}\nПроверьте входящие TCP 80/443 и публичный IP. Диагностика: docker compose logs --tail=80 caddy\nНе отключайте проверку TLS. После исправления повторите bash scripts/deploy.sh; .env и данные сохранятся.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
