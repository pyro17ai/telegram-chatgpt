import { TelegramClient, type User } from '@mtcute/bun@0.32.2'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export { TelegramClient }

export interface AccountConfig {
  apiId: number
  apiHash: string
  phone: string
  userId: number | null
}

export function accountDirectory(): string {
  return resolve(process.env.TG_ACCOUNT_DIR ?? join(homedir(), '.codex', 'telegram-account-sdk-account'))
}

export async function readAccountConfig(directory = accountDirectory()): Promise<AccountConfig> {
  const file = Bun.file(join(directory, 'config.json'))
  if (!(await file.exists())) {
    throw new Error('Нет config.json выбранного аккаунта. Прочитай references/setup.md.')
  }

  let value: unknown
  try {
    value = await file.json()
  } catch {
    throw new Error('Не удалось прочитать JSON настроек аккаунта; содержимое не выводится.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('config.json должен содержать объект с настройками аккаунта.')
  }

  const config = value as Partial<AccountConfig>
  if (!Number.isSafeInteger(config.apiId) || Number(config.apiId) <= 0
    || typeof config.apiHash !== 'string' || !/^[a-f0-9]{32}$/i.test(config.apiHash)
    || typeof config.phone !== 'string' || !/^\+[1-9]\d{6,14}$/.test(config.phone)
    || !(config.userId === null || (Number.isSafeInteger(config.userId) && Number(config.userId) > 0))) {
    throw new Error('Проверь apiId, apiHash, phone и userId в config.json; значения не выводятся.')
  }

  return config as AccountConfig
}

export async function withTelegram<T>(
  task: (tg: TelegramClient, me: User) => Promise<T>,
): Promise<T> {
  const directory = accountDirectory()
  const config = await readAccountConfig(directory)
  if (config.userId === null) {
    throw new Error('Владелец аккаунта ещё не закреплён. Заверши настройку из references/setup.md.')
  }

  const session = join(directory, 'session.sqlite')
  if (!(await Bun.file(session).exists())) {
    throw new Error('Сохранённой сессии нет. Нужен первый вход по references/setup.md.')
  }

  const previousMask = process.umask(0o077)
  let tg: TelegramClient | undefined
  try {
    tg = new TelegramClient({
      apiId: config.apiId,
      apiHash: config.apiHash,
      storage: session,
    })
    const me = await tg.getMe()
    if (me.isBot || me.id !== config.userId) {
      throw new Error('Сессия принадлежит другому пользователю или боту. Задача не запущена.')
    }
    return await task(tg, me)
  } finally {
    try {
      await tg?.destroy()
    } finally {
      process.umask(previousMask)
    }
  }
}
