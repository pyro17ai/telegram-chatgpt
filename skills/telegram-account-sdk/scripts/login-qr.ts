import { TelegramClient, accountDirectory, readAccountConfig } from './client.ts'
import QRCode from 'qrcode@1.5.4'
import { join } from 'node:path'
import { chmod } from 'node:fs/promises'

process.umask(0o077)
const directory = accountDirectory()
const config = await readAccountConfig(directory)
const tg = new TelegramClient({ apiId: config.apiId, apiHash: config.apiHash, storage: join(directory, 'session.sqlite') })
const token = crypto.randomUUID()
let state = 'Подключаюсь к Telegram…'
let qr = ''
let needsPassword = false
let completed = false
let passwordResolve: ((value: string) => void) | undefined
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Вход в Telegram</title><style>body{font:18px system-ui;max-width:600px;margin:50px auto;padding:24px;background:#f5f7fa;color:#182536}#qr{width:300px;margin:25px auto}input,button{font:inherit;padding:12px}button{cursor:pointer}form{display:none}</style><h1>Вход в Telegram</h1><p>Откройте Telegram на телефоне: Настройки → Устройства → Подключить устройство. Наведите камеру на QR-код.</p><div id="qr"></div><p id="status"></p><form><p>Введите облачный пароль Telegram. Он передаётся локальному процессу входа и не сохраняется.</p><input type="password" autocomplete="off" required aria-label="Облачный пароль"><button>Войти</button></form><script>const base=location.pathname;async function update(){const r=await fetch(base+'/state');const s=await r.json();document.querySelector('#status').textContent=s.state;document.querySelector('#qr').innerHTML=s.qr;document.querySelector('form').style.display=s.needsPassword?'block':'none';if(!s.completed)setTimeout(update,1000)}document.querySelector('form').onsubmit=async e=>{e.preventDefault();const i=document.querySelector('input');const password=i.value;i.value='';await fetch(base+'/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})})};update()</script></html>`
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'" }
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  const url = new URL(req.url)
  if (req.headers.get('host') !== `127.0.0.1:${server.port}`) return new Response(null,{status:403})
  if (url.pathname === `/${token}` && req.method === 'GET') return new Response(html, {headers:{...headers,'Content-Type':'text/html; charset=utf-8'}})
  if (url.pathname === `/${token}/state` && req.method === 'GET') return Response.json({state,qr,needsPassword,completed},{headers})
  if (url.pathname === `/${token}/password` && req.method === 'POST') {
    if (req.headers.get('origin') !== `http://127.0.0.1:${server.port}`) return new Response(null,{status:403})
    const body = await req.json()
    if (!passwordResolve || typeof body.password !== 'string' || !body.password) return new Response(null,{status:400})
    const resolve = passwordResolve; passwordResolve = undefined; needsPassword = false; state = 'Проверяю пароль…'; resolve(body.password)
    return new Response('ok',{headers})
  }
  return new Response(null,{status:404})
}})
console.log(`LOGIN_PAGE=http://127.0.0.1:${server.port}/${token}`)
const timeout = setTimeout(async () => { await tg.destroy(); server.stop(true); process.exit(0) }, 20*60*1000)
try {
  const me = await tg.start({
    qrCodeHandler: (url) => { state = 'Отсканируйте QR-код в Telegram.'; void QRCode.toString(url,{type:'svg',margin:4}).then(svg => { if (!needsPassword && !completed) qr = svg }) },
    password: () => { qr=''; needsPassword=true; state='Telegram запросил облачный пароль.'; return new Promise<string>(resolve => {passwordResolve=resolve}) },
    invalidCodeCallback: () => {state='Пароль не подошёл. Повторите ввод.'},
  })
  if (me.isBot || me.phoneNumber?.replace(/^\+/, '') !== config.phone.slice(1) || (config.userId !== null && me.id !== config.userId)) throw new Error('Владелец сессии не совпал с выбранным аккаунтом.')
  const configPath = join(directory,'config.json')
  await Bun.write(configPath, JSON.stringify({...config,userId:me.id},null,2)+'\n')
  await chmod(configPath,0o600)
  const checked = await tg.getMe()
  if (checked.id !== me.id) throw new Error('Проверка владельца не пройдена.')
  state='Вход выполнен. Глобальный скилл подключён к вашему аккаунту.'; qr=''; completed=true; needsPassword=false
  console.log(JSON.stringify({connected:true,userId:me.id,ownerVerified:true}))
} catch(error) {
  state='Вход не завершён: '+(error instanceof Error ? error.message : 'ошибка Telegram'); qr=''; completed=true; needsPassword=false
  console.error(state)
} finally {
  await tg.destroy()
  clearTimeout(timeout)
  setTimeout(() => {server.stop(true);process.exit(0)},60_000)
}
