# Подключение в ChatGPT

Основной путь для сервера: пройдите Telegram-вход на его главной странице и скачайте `Telegram.zip`. Он содержит `plugin.json`, `mcp.json` с адресом вашей установки и оба навыка. Секретов в ZIP нет. Передайте архив Plugin Creator и попросите создать приватный плагин; затем установите и подключите его. Если загрузка плагинов доступна в рабочем пространстве, архив можно добавить через Admin console → workspace → Plugins → Add → Upload plugin.

Запасной путь: Plugins → + → Add custom MCP server, адрес `https://ваш-домен/mcp`, OAuth, затем Create as a plugin. Этот путь подключает MCP; навыки добавьте через Plugin Creator. MCP также отдаёт исходные навыки через `read_skill_file` и сообщает об этом при инициализации. Для работы требуется разрешить инструмент исполнения: он помечен как способный изменять данные, потому что выполняет произвольный код SDK.

На странице OAuth введите ключ владельца сервера и подтвердите доступ. Пароль Telegram здесь не требуется: Telegram-сессия уже создана на этапе настройки. Авторизация использует Dynamic Client Registration, PKCE S256 и обновляемые токены. Встроенно разрешены официальные callback-адреса ChatGPT. Для другого доверенного MCP-клиента задайте точные адреса в `OAUTH_EXTRA_REDIRECT_URIS` через запятую, затем перезапустите сервер. Не добавляйте маски доменов.

На Sites используйте приватный плагин, который создала сама платформа. Не создавайте второй плагин поверх этого же сайта. Telegram ZIP на Sites для этого пути не требуется: агент добавляет навыки в канонический плагин.

Доступность custom MCP зависит от тарифа и настроек рабочего пространства. На 19 октября 2026 официальная справка описывает полный custom MCP для Business/Enterprise/Edu, а для Pro указывает ограничение read/fetch. Инструмент `execute_typescript` не следует выдавать за read-only ради обхода этого ограничения. Инструкция Sites описывает Sites-hosted plugins на планах с доступом к Sites. Перед установкой проверьте доступные действия в вашем аккаунте.

Источники: [плагины в ChatGPT](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt), [custom MCP](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt), [плагин на Sites](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites), [формат плагина](https://developers.openai.com/plugins/build/plugins), [OAuth](https://developers.openai.com/plugins/build/auth).
