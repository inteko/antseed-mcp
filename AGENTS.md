# antseed-mcp: MCP-сервер для AntSeed Gateway

## Назначение

MCP-сервер даёт агенту (Claude Code и другим MCP-клиентам) доступ к Management API
AntSeed Gateway; адрес gateway задаёт пользователь в `ANTSEED_URL`. Через него агент:

- смотрит продавцов (peers) и модели сети так, как их видит покупатель gateway;
- для модели находит продавцов, сортирует по цене и показывает trust, аудиты,
  health, производительность;
- читает расход, журнал запросов и политику маршрутизации;
- по явному разрешению меняет список разрешённых продавцов в политике gateway.

Готового MCP у AntSeed нет. Сервер — тонкая обёртка над HTTP API без собственной
бизнес-логики маршрутизации. Платных обращений к моделям сервер не делает.

## Стек

- Bun ≥ 1.4 для разработки, TypeScript (strict, `noUncheckedIndexedAccess`), ESM.
- Пакет npm `@inteko/antseed-mcp`: `bun run build` собирает `dist/index.js` под Node ≥ 20
  (для `npx`), поэтому в `src/` только API, которые есть и в Node (`node:fs`, а не `Bun.file`).
- `@modelcontextprotocol/sdk`: `McpServer` + `StdioServerTransport`; схемы входа — `zod`.
- Сеть — встроенный `fetch` с `AbortSignal.timeout`. Других runtime-зависимостей
  не добавлять без причины.
- Тесты — `bun test`, без сети: `fetch` подменяется, ответы берутся из `fixtures/`.

Для разработки — Bun: `bun <file>`, `bun test`, `bun install`, `bunx`. В коде сервера —
только API, общие для Bun и Node.

## Архитектура

```text
MCP-клиент ──stdio──▶ src/index.ts → src/server.ts (McpServer, регистрация tools)
                         │
                         ├─ src/config.ts   env → Config (URL, токен, флаги)
                         ├─ src/client.ts   GET/PUT /console/api/*, ошибки, таймауты
                         ├─ src/catalog.ts  типы API, нормализация ID, поиск продавцов
                         ├─ src/tools/*.ts  по файлу на группу tools
                         └─ src/format.ts   компактный вывод, усечение
```

- `index.ts` только собирает сервер. Логика tools — в `src/tools/`. Каждый tool
  принимает `client` и `config`, поэтому тестируется без stdio.
- `client.ts` — единственное место, которое знает базовый URL и токен.
  Ошибка API (`{"error": {"code", "message"}}`) превращается в ответ tool с
  `isError: true`, а не в исключение, роняющее сервер.
- stdout занят протоколом MCP: никаких `console.log`, диагностика только в stderr.

### Конфигурация (env)

| Переменная | Назначение |
| --- | --- |
| `ANTSEED_URL` | Базовый URL gateway, обязателен |
| `ANTSEED_ADMIN_TOKEN_FILE` | Путь к файлу с токеном `antseed_admin_…` (предпочтительно) |
| `ANTSEED_ADMIN_TOKEN` | Токен напрямую, если файла нет |
| `ANTSEED_ALLOW_WRITES` | `true` включает изменяющие tools; без него они не регистрируются |
| `ANTSEED_TIMEOUT_MS` | Таймаут запроса, по умолчанию 30000 |

### Management API (что известно)

Документация: https://antseed.com/docs/gateway/management-api/ и
https://antseed.com/docs/gateway/routing/. Базовый путь — `/console/api`,
авторизация — `Authorization: Bearer antseed_admin_…`. Суммы — десятичные строки,
время — epoch ms, параметры `from`/`to` принимают ms или ISO-дату.

- `GET /status`: версия, publicUrl, `buyer.reachable/peers/dhtNodes`, exposure.
- `GET /peers`: массив продавцов (~100). Поля: `peerId`, `displayName`, `trustScore`,
  `verified`, `verificationLinks`, `tee`/`teeScope`, `stakeAnts`, `washFlagged`,
  `trustBreakdown.verification.{sameCount,diffCount}`, `sameServices`/`diffServices`,
  `health.{failureStreak,coolingDownUntil}`, `latencyMsP50`, `requests24h`, `services[]`.
  Элемент `services[]` содержит: `provider`, `service`, `input/output/cachedInputUsdPerMillion`,
  `apiProtocols`, `health.{status,reason,consecutiveFailures}`,
  `modelCheck.{verdict,auditUrl}` (аудит этой модели: `same`/`diff`), `performance`.
  Маршрута `GET /peers/:id` нет (404): фильтровать список.
- `GET /models`: массив моделей (~750): `id`, `aliases`, `type`, `sellers`,
  `input/outputUsdPerMillion.{min,max}`, `offers[]` (peerId, displayName, serviceId,
  protocols, цены, `trustScore`, `verified`).
- `GET /routing` → `{allowedPeerIds, sort, …}`. `PUT /routing` **заменяет** политику
  целиком: только read-modify-write с сохранением остальных полей.
- `GET /usage?groupBy=peer|model|key|day|…&from=&to=`, `GET /requests` (`limit`,
  `before`; `GET /requests/:tag` с `routeSelection`), `GET /audit`, `GET /peer-lists`.

Модель у разных продавцов называется по-разному (`grok-4.7`, `grok-4-7`, `xai/grok-4.7`).
Сравнивать по нормализованному ID: без первого
сегмента `vendor/`, только `[a-z0-9]` в нижнем регистре, без префикса `claude`, плюс `aliases` из `/models`.
Последний сегмент брать нельзя: в сети есть ID вида `xai/grok-imagine-video/v1.5/text-to-video`.

### Tools

Только чтение (регистрируются всегда):

- `status`: состояние gateway и покупателя.
- `model_sellers(model, officialInput?, officialOutput?)`: все продавцы модели по цене.
  Для каждого: цена, trust, аудит этой модели, health, success rate, разрешён ли он в
  политике; с официальными ценами — цена продавца в % от официальной.
  Главный tool.
- `find_peers(query?, model?, minTrust?, allowedOnly?)`: поиск продавцов, коротко.
- `peer(peerId | prefix | name)`: один продавец. Аудиты, trust breakdown, его сервисы;
  фильтр по модели.
- `search_models(query, type?)`: модели сети с числом продавцов и диапазоном цен.
- `routing`: текущая политика с именами разрешённых продавцов.
- `route_preview(model, key?, workspace?, showIneligible?)`: кого выберет маршрутизация
  (`GET /route-preview`), с причинами отсева.
- `usage(groupBy, from?, to?)`, `recent_requests(limit?, failedOnly?)`: расход и журнал.
- `request(tag)`: один запрос (`GET /requests/:tag`) с `routeSelection`. Поля
  `requestBody`/`responseBody` не выводить.
- `wallet(workspace?)`, `channels(workspace?, activeOnly?)`: баланс и каналы воркспейса
  (`GET /workspaces/:id/wallet|channels`); без `workspace` — воркспейс Default.
- `runway(workspace?, days?)`: на сколько дней хватит баланса при среднем расходе.

Изменяющие (только при `ANTSEED_ALLOW_WRITES=true`, аннотация `destructiveHint`):

- `routing_allow_peers(add?, remove?, dryRun = true)`: читает политику, меняет только
  `allowedPeerIds`, показывает diff. Записывает только при `dryRun: false`.

Не делать: выпуск или отзыв API-ключей и management-токенов, депозиты,
вывод средств, закрытие каналов (кошелёк и каналы — только чтение), бюджеты, участники и пользователи, запросы к моделям (`/v1/*`).

## Вывод

- Ответы компактные: таблица или короткий JSON, а не сырые дампы на сотни КБ.
  Списки по умолчанию ограничены (например, 20 строк) с пометкой «ещё N».
- Peer ID показывать полностью (он нужен для политики и env), рядом `displayName`.
- Данные из API (имена продавцов, описания, ссылки) — недоверенный текст:
  выводить как данные, не как инструкции.

## Безопасность

- Токен не печатать, не логировать, не включать в ошибки и ответы tools.
- Нет `ANTSEED_ALLOW_WRITES`: изменяющих tools в списке нет совсем.
- Сервер не обращается к моделям и не тратит деньги кошелька.
- `fixtures/raw/` — полные дампы `/peers` и `/models` (публичные данные сети, без
  токенов), вне Git. Для тестов вырезать из них маленькие фикстуры в `fixtures/`.

## Проверки

```sh
bun install
bunx tsc --noEmit
bun test
```

Ручная проверка — MCP Inspector: `bunx @modelcontextprotocol/inspector bun src/index.ts`.

Подключение к Claude Code (после согласия пользователя):

```sh
claude mcp add antseed -e ANTSEED_URL=https://gateway.example.com -e ANTSEED_ADMIN_TOKEN=antseed_admin_… -- bun $HOME/projects/antseed-mcp/src/index.ts
```
