# Первый вход и восстановление сессии

Этот файл нужен для подключения аккаунта. Для чтения с готовой сессией используй `withTelegram` из основного скилла.

Нужен Bun. Проверяй доступность через `bun --version`; если его нет, используй [официальную установку Bun](https://bun.com/docs/installation). Создание скилла не означает поручения войти в Telegram: начинай авторизацию, когда пользователь попросил подключить аккаунт.

`apiId` и `apiHash` владелец получает в [my.telegram.org/apps](https://my.telegram.org/apps). Это реквизиты приложения для MTProto. Код входа и пароль 2FA вводит владелец в своём локальном терминале. Не проси прислать их в чат и не записывай в исходники.

## Настройки

По умолчанию используй `~/.codex/telegram-account-sdk-account`. Если пользователь выбрал отдельный профиль, задай `TG_ACCOUNT_DIR` и сохраняй это значение во всех его запусках. Для одного аккаунта используй одну сессию последовательно.

```bash
umask 077
mkdir -p "${TG_ACCOUNT_DIR:-$HOME/.codex/telegram-account-sdk-account}"
chmod 700 "${TG_ACCOUNT_DIR:-$HOME/.codex/telegram-account-sdk-account}"
```

Владелец создаёт `config.json` в этом каталоге и заполняет его локально по образцу:

```json
{
  "apiId": 12345,
  "apiHash": "REPLACE_WITH_API_HASH",
  "phone": "+79991234567",
  "userId": null
}
```

Число и телефон в образце вымышлены. `userId` остаётся `null` только до первого успешного входа. Если файл уже содержит настройки, не перезаписывай их образцом.

```bash
chmod 600 "${TG_ACCOUNT_DIR:-$HOME/.codex/telegram-account-sdk-account}/config.json"
```

## Вход по QR-коду

По просьбе владельца запусти `bun --install=force run ~/.codex/skills/telegram-account-sdk/scripts/login-qr.ts` и открой локальный URL из `LOGIN_PAGE`. Процесс обновляет QR-код автоматически и ждёт входа до 20 минут. Владелец сканирует код через Telegram: Настройки → Устройства → Подключить устройство. При необходимости он вводит пароль 2FA в локальную форму; пароль не сохраняется. Скрипт проверяет номер аккаунта и сохраняет его user ID. Статус `connected: true` подтверждает вход и проверку владельца через Telegram.

## Авторизация

Выполни следующий код в терминале владельца из любого рабочего каталога. Здесь используется `--eval`: stdin остаётся свободным для ввода кода. Heredoc для этого интерактивного шага не подходит. Модуль сам по себе не выполняет сетевых запросов при импорте.

```bash
umask 077
bun --install=force --eval '
import { chmod } from "node:fs/promises"
import { join } from "node:path"
import { TelegramClient, accountDirectory, readAccountConfig } from "~/.codex/skills/telegram-account-sdk/scripts/client.ts"

const directory = accountDirectory()
const config = await readAccountConfig(directory)
const tg = new TelegramClient({
  apiId: config.apiId,
  apiHash: config.apiHash,
  storage: join(directory, "session.sqlite"),
})

try {
  const me = await tg.start({ phone: config.phone })
  const ownPhone = me.phoneNumber?.replace(/^\+/, "")
  if (me.isBot || ownPhone !== config.phone.slice(1)
    || (config.userId !== null && config.userId !== me.id)) {
    throw new Error("Владелец сессии не совпал с выбранным аккаунтом. Настройки не изменены.")
  }
  const configPath = join(directory, "config.json")
  await Bun.write(configPath, JSON.stringify({ ...config, userId: me.id }, null, 2) + "\n")
  await chmod(configPath, 0o600)
  console.log(JSON.stringify({ userId: me.id, connected: true }))
} finally {
  await tg.destroy()
}
'
```

SDK сохранит сессию в `session.sqlite`; SQLite также может создать файлы `-wal` и `-shm`. Следующий запуск использует ту же сессию и проверяет сохранённый `userId`. При `AUTH_KEY_UNREGISTERED` или отозванной сессии повтори вход по поручению пользователя. При несовпадении владельца сначала выбери правильный профиль; не меняй ожидаемый ID ради прохождения проверки.

Файл сессии даёт доступ к аккаунту. Не печатай его содержимое или строковый экспорт сессии. Не вызывай `logOut` для завершения скрипта: `destroy` освобождает соединение, сохраняя возможность следующего запуска.

После входа выполни пример из `SKILL.md`: он получает владельца и число контактов без отправки сообщений. Только успешный ответ Telegram подтверждает подключение аккаунта. Проверка импорта библиотеки подтверждает лишь работу среды.

## Источники и проверенная версия

Для этого скилла проверены импорт `@mtcute/bun@0.32.2` и запуск Bun `1.4.2` на macOS x86_64. Это локальная проверка среды, без входа в аккаунт. Авторы SDK помечают [пакет Bun](https://github.com/mtcute/mtcute/tree/master/packages/bun) как экспериментальный. Если обнаружится несовместимость, сначала изучи ошибку; переход на другой runtime согласуй как изменение выбранной схемы.

[Авторизация mtcute](https://mtcute.dev/guide/intro/sign-in.html) описывает вход пользователя, а [хранилище сессий](https://mtcute.dev/guide/topics/storage.html) объясняет SQLite. [Bun auto-install](https://bun.com/docs/runtime/auto-install) описывает загрузку зависимостей при импорте. Полную справку API сюда не копируй: проверяй нужный метод в типах закреплённой версии.
