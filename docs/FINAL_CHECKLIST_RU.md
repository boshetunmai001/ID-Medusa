# План завершения Envoy ID × Medusa

Обновлено 19 ноября 2026 года.

Обозначения: `[x]` готово, `[ ]` осталось, `[~]` ограничение или решение по объёму.

Проверен локальный npm-архив версии 0.1.0 с SHA-256 `802378ee2bc2807d1a9bfc663e8a98dd41d54e06f78e95dffb957f5d347f2ac9`. Чистая установка в отдельный проект Medusa 2.22.2, сборка, все 52 теста и вход и выход покупателя и сотрудника в Chrome и Safari прошли. [Подробные результаты](verification.md)

Для целевого сервера остаётся проверка конфигурации Nginx после развёртывания. Для публичного пакета остаётся проверка установки из npm после публикации. Локальные проверки выполнены на одноразовом стенде.

## Уже готово

- [x] OIDC-провайдер для Medusa v2 с отдельными потоками клиента и сотрудника.
- [x] Защита state, S256 PKCE, nonce, replay и привязка сотрудника администратором; автосоздание сотрудника запрещено.
- [x] Demo storefront, клиентский профиль и виджет входа сотрудников в Admin.
- [x] Автотесты: полный набор 31/31 03.11.2026 на Node.js 22.23.3; повторный изолированный OIDC fixture 17/17 03.11.2026. Проверены отказы для неверных подписи ID-токена, issuer, audience и nonce; оба PostgreSQL-интеграционных теста прошли в полном прогоне.
- [x] `npm run build`, `npm run typecheck` и `git diff --check` прошли.
- [x] MIT LICENSE лежит в `packages/auth-encvoy`; `npm pack --dry-run` включает лицензию, README и `dist`.
- [x] Финальный локальный archive D `medusa-plugin-encvoy-id@0.1.0`, 14 891 байт, SHA-1 `dfbffc858341a000f676acecdcfaf61ce373ae35`, независимо установлен в чистый Medusa 2.22.2 consumer без workspace links. `npm ci`, audits, `npm ls`, typecheck, production Backend/Admin build и полный HTTP acceptance с отказом сессии до создания аккаунта и employee revocation прошли 16.11.2026. В Chrome 157.0.8103.51 и Safari 18.6 на archive D проверены покупательский вход, профиль, выход и повторный вход; в обоих браузерах сотрудник вошёл в Admin/Orders и вышел. В Safari повторное открытие `/app/orders` после выхода вернуло на `/app/login`. Более ранние проверки архивов A–C остаются историческими.
- [x] Чистая сборка обнаружила недостающие `ts-node` и `typescript` в devDependencies примера; добавлены существующие зафиксированные версии `10.9.2` и `5.9.3`, после чего чистая сборка прошла.
- [x] Чистый сервер Medusa 2.22.2 выполнил полный живой HTTP acceptance против Encvoy 3.6.19 на клоне отдельной синтетической PostgreSQL-БД; прошли клиентский и повторный вход, создание сессии, запрет refresh клиентского и сотруднического JWT, logout, права сотрудника, отказ outsider, replay/cancellation, concurrency и защита существующего гостя.
- [x] Пользователь вручную проверил в Firefox вход и профиль; после выхода защищённый API `/encvoy/profile` вернул `Unauthorized` (30.10 и 01.11.2026). Повторный вход вернул тот же синтетический customer.
- [x] 01.11.2026 на скриншотах подтверждены вход и профиль в Chrome и Safari с тем же синтетическим Customer ID. В Safari переход вперёд по истории восстановил профиль с активной сессией.
- [x] В Safari после реального выхода и перехода по `Protected profile` показана графическая страница с предложением войти; сырой JSON не отображается (01.11.2026).
- [x] Исправлен UX после выхода: `/demo/profile` теперь отдаёт страницу демо и показывает состояние «You are signed out» с кнопкой входа; защита данных остаётся на `/encvoy/profile` (проверено: страница 200, API 401).
- [x] Браузерный вход на `http://localhost:9000` ведёт на демо; прямое открытие `/encvoy/profile` как HTML ведёт в графический профиль, а запросы API по-прежнему получают `401` без сессии. Ошибки загрузки/API отображаются понятным сообщением, а не сырым JSON.
- [x] HTTP acceptance проверил сотрудника с заранее привязанным subject, конфликты, отмену (`access_denied`), replay, state/PKCE и logout.
- [x] README, `llms.txt`, `AGENTS.md`, статья и черновик карточки Medusa подготовлены.

## Журнал приёмки и открытые пункты

### Результаты краш-теста и сквозного аудита (02.11.2026)

В запуске 02.11.2026 текущая ограниченная среда не позволила выполнить полный прогон: `npm test` остановился на `initdb` из-за запрета SysV shared memory (`shmget: Operation not permitted`); сетевой OIDC-мок и проверка свободного порта для Admin-сборки блокировались запретом loopback bind. Прямой запуск без этих подсистем дал 12 успешных тестов, два PostgreSQL-теста были пропущены, OIDC fixture заблокирован `EPERM`. Это ограничение относится только к тому запуску. Позже полный набор прошёл 31/31 03.11.2026 на временной PostgreSQL-БД; повтор 31/31 на Node.js 22.23.5 выполнен 13.11.2026 и записан ниже.

- [x] Перед push найден и закрыт опасный путь source-build: guard теперь разрешает миграции только на выделенной БД `localhost:55433/encvoy_source`; прежняя `localhost:55432/encvoy` явно запрещена. БД и миграции не запускались.

- Историческое замечание (02.11.2026): после исправления сообщения logout браузерная проверка нового build ещё не была выполнена. Позже пользователь подтвердил клиентский Chrome/Safari flow 03.11.2026; Safari customer и employee flow повторены на runtime-архиве 13.11.2026.
- [x] `npm pack --dry-run` содержит LICENSE, README и собранный `dist`; четыре публичных экспорта импортируются.
- [x] Финальный tarball `medusa-plugin-encvoy-id@0.1.0` независимо установлен в отдельный Medusa 2.22.2 проект (свыше 1 000 пакетов из npm registry); `npm ci`, typecheck и production-сборка backend/Admin прошли на Node.js 22.23.5 (13.11.2026).
- [x] Полный PostgreSQL и OIDC набор на текущем коде: `npm test`, Node.js 22.23.3, 31/31, 03.11.2026.
- [x] Текущие браузерные проверки Chrome/Safari: пользователь подтвердил клиентский вход/выход/повторный вход; вход сотрудника и logout из Admin повторены 03.11.2026 в Chrome 156.0.8078.80 и Safari 18.6.
- [x] Node.js обновлён с 22.23.3 до 22.23.5. На 22.23.5 прошли `npm run typecheck`, `npm test` (31/31, включая PostgreSQL на отдельном временном synthetic-кластере), сборка provider и полная сборка backend/Admin Medusa. Это не новый live/browser acceptance.
- [x] Encvoy 3.6.19 переведён с PostgreSQL 14.4 на 16.16 через проверенный backup/restore в новый том. На клоне прошли восстановление и Prisma migration check (142 миграции без изменений), все шесть сервисов healthy, OIDC discovery/JWKS HTTP 200. Исходный том 14.4 сохранён для отката.
- [x] 16.11.2026 на итоговом коде `npm test` прошёл 33/33, включая PostgreSQL, employee-grant и middleware checks; workspace typecheck и clean-consumer production build прошли. Live HTTP acceptance на D прошёл все сценарии, включая отказ следующего Admin-запроса с ранее выданным JWT после operator revocation.

- [x] `npm test` на Node 22.23.3: 29/29 тестов прошли. PostgreSQL создавался отдельно в `/tmp` (`medusa_test`, Unix socket) и удалён после успешной остановки.
- [x] Provider и example typecheck, сборка provider, production build Medusa 2.22.2 прошли после чистой установки.
- [x] Беззаписочный HTTP smoke: 20 параллельных GET-запросов к Medusa `/demo` и Encvoy discovery; все ответы 200. Это небольшой burst-check, не нагрузочный предел.
- [x] `/demo` и `/demo/profile` получают `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`; неавторизованный `/encvoy/profile` возвращает 401.
- [x] Admin Vite GET/HEAD responses `/app/login` отдают CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff` и `Referrer-Policy: no-referrer`. Production Nginx snippets для security headers, rate limits и безопасных access logs проверены на временном proxy; фактический deployment proxy не настраивался.
- [x] Storefront и Admin browser fetch используют 10-секундный deadline; тесты подтверждают подключение `AbortSignal` и Admin header middleware.
- [x] Customer и employee JWT refresh закрыт с `reauthentication_required`; customer JWT напрямую устанавливает native session только один раз. В примере session cookie и employee grant имеют срок 30 минут. Customer logout уничтожает native session и cookie, но скопированный customer bearer JWT остаётся пригоден для разрешённых ему API до `exp` (не более 30 минут после выдачи). Admin работает в session-режиме: logout отзывает конкретный employee grant и уничтожает серверную сессию; скопированный JWT этой сессии после этого отклоняется. Если хранилище grant недоступно, выход возвращает ошибку и сессия не считается завершённой. Ни один logout не завершает Encvoy SSO; новый вход может пройти без пароля, если SSO-сессия ещё активна. Её TTL задаёт Encvoy.
- [x] Блокировка сотрудника в Encvoy сама по себе не отзывает уже выданную Medusa JWT/grant. Для немедленного offboarding сначала блокируют Encvoy identity, затем запускают `examples/medusa/src/scripts/revoke-employee.ts` с проверенным Medusa user ID. Общий PostgreSQL registry проверяется на каждом защищённом Admin API запросе без positive cache; после revoke следующий такой запрос со старым JWT получает отказ. Команда не завершает Encvoy SSO и не удаляет identity binding. Немедленный отзыв customer JWT в проекте не реализован.
- [x] Ручная проверка 16.11.2026: после отзыва одной активной записи пользователь прислал скриншот Chrome с экраном `/app/login`; read-only проверка подтвердила, что у тестового пользователя нет активных grants. Повторный вход не выполнялся, чтобы не создать новую grant-запись.
- [x] Workspace обновлён до Medusa 2.22.2; full live HTTP acceptance прошёл 02.11.2026. Клиентские Chrome/Safari сценарии подтверждены пользователем 03.11.2026; вход сотрудника и logout из Admin прошли в Chrome 156.0.8078.80 и Safari 18.6.
- [x] Dependency audit: шесть Medusa overrides сокращают исходный аудит с 83 до шести Low записей по SendGrid/`deepmerge`. Седьмой scoped consumer override `@sendgrid/helpers → deepmerge@4.1.2` выбирает последний релиз ниже диапазона GHSA 4.2.0–4.3.1; после него полный и production `npm audit` в чистом Medusa 2.22.2 consumer показывают 0 findings. Проверены `npm ci`, `npm ls --all`, typecheck, production Backend/Admin build и SendGrid Personalization merge. Pin ниже заявленного `@sendgrid/helpers` `^4.2.2`; `npm explain deepmerge` явно показывает, что override заменяет это требование. Совместимость подтверждена для данного набора зависимостей.
- [x] Live Encvoy HTTP acceptance на Medusa 2.22.2 полностью прошёл 02.11.2026 на клоне `medusa_clean_final_222_codex` в `/tmp`-кластере (55439). Перед клонированием исходная synthetic БД сохранена через `pg_dump` и архив проверен. Весь customer/staff, logout/refresh, replay/cancellation, concurrency и account-conflict сценарии прошли. Encvoy использовал persistent local stand 3.6.19.

### 1. Сверить редакцию задания и версию Encvoy

- [~] Проверена точная трёхстраничная копия задания, доступная с передачей материалов: в ней указаны готовые образы Encvoy на базе 1.2 (стр. 1–2), Chrome/Safari smoke (стр. 1 и 3). Ревьюер сообщает, что в предоставленной ему редакции указана 3.6.19; отдельная копия этой редакции для сверки не была доступна. В документах версия 1.2 относится только к проверенной копии PDF, а не к редакции, описанной ревьюером.
- [x] Фактическая интеграция проверена на vendor-образах Encvoy 3.6.19, закреплённых digest. Это не утверждение, что они собраны из GitHub snapshot 1.2.0: связь source snapshot с vendor-образами не подтверждена. В отчётах разделяем версию текста задания, версию тестовых образов и версию исходного snapshot.

### 2. Статус браузерных проверок

- [x] Приложенный PDF требует Chrome и Safari. Пользователь подтвердил клиентский вход, профиль, logout и повторный вход в Chrome и Safari 03.11.2026; в тот же день employee Admin/logout и error-state сценарии также прошли в этих браузерах на Medusa 2.22.2 и Encvoy 3.6.19.
- [x] Safari 18.6 прошёл customer profile/logout и pre-authorized employee Admin login/logout на runtime-архиве A 13.11.2026.
- [x] Chrome 157.0.8103.51 на archive D: customer login/profile/logout/repeat-login и pre-authorized employee login/Admin Orders/logout проверены в чистом consumer (16.11.2026).
- [x] Safari 18.6 на archive D: customer login/profile/logout/repeat-login и pre-authorized employee login/Admin Orders/logout проверены в чистом consumer (16.11.2026); после выхода прямой переход на Orders вернул на `/app/login`. Пароль не сохранён браузером.
- [x] Ранее выполненные Chrome archive C и Safari archive A сценарии оставлены как дополнительная историческая evidence.
- Дополнительные браузеры: Firefox, Opera и Yandex Browser прошли указанные в журнале сценарии 03.11.2026; Edge на машине не установлен. Они не входят в Chrome/Safari-матрицу приложенного PDF.
- [x] Отмена входа через `access_denied` и сообщение о недоступности Encvoy (`provider_unavailable`) проверены в Chrome и Safari; отдельной кнопки отмены на Encvoy UI нет.
- [x] README, `AGENTS.md`, `llms.txt`, статья и журнал синхронизированы с результатами archive F и чистого consumer. Chrome/Safari результаты archive D помечены как исторические; Chrome/Safari F пройдены. Локальный Encvoy Nginx проверен; production Nginx Medusa в стенде не развёрнут.

### 3. Проверить чистую установку зависимостей

- [x] Final archive D SHA-1 `dfbffc858341a000f676acecdcfaf61ce373ae35` прошёл независимую чистую установку, `npm ci`, audits, `npm ls`, typecheck, production Backend/Admin build и полный HTTP acceptance на Encvoy 3.6.19 под Node.js 22.23.5. Проверено, что незавершённый customer identity не создаёт Medusa session; операторская CLI-команда отзыва сотрудника приводит к отказу следующего запроса с прежним JWT.
- [x] Safari 18.6 на runtime-архиве, чистом Medusa 2.22.2 и synthetic `.invalid` fixture: покупатель вошёл, открыл профиль и вышел; сотрудник вошёл в Admin, открыл Orders, вышел из меню, повторное открытие `/app/orders` вернуло на `/app/login` (13.11.2026). Запуск выполнен на настроенном origin `http://localhost:9000`; пароль в Safari не сохранялся.
- [x] Следующий security follow-up: Admin middleware сначала проверяет `user`-контекст; HTTP acceptance подтверждает отказ отозванному employee JWT даже при customer cookie. Admin работает в session mode; `DELETE /auth/session` отзывает grant и завершает серверную сессию. Полный workspace suite прошёл 46/46; typecheck и clean-consumer production build прошли.
- [x] Archive F (`c62d6d4d6f672fbbc3fe8f5a8c333375262140e1`, 16 948 байт) повторно собран после обновления README и независимо установлен из точного tarball в чистый Medusa 2.22.2 consumer; `npm ci` установил 1 088 пакетов, `npm ls`, typecheck и production build прошли. Исходники и исполняемый код плагина не менялись. В Chrome и Safari проверены вход сотрудника, Orders, выход и возврат на `/app/login` при повторном открытии Orders.
- [~] Production Admin `/app/login` не получает security headers при прямой подаче Medusa; Nginx snippets прошли временную proxy-проверку, но actual deployment proxy не запускался и не проверялся.

### 4. Подготовить и выполнить публикацию

- [x] Право записи в `boshetunmai001/ID-Medusa` подтверждено успешным `git push origin main` 03.11.2026; опубликован коммит с документацией результатов проверок.
- [~] npm-вход отложен до подготовки публикации по решению пользователя. Последняя известная проверка `npm whoami` вернула `ENEEDAUTH`; публикация пакета не выполнялась.
- [x] Собрать локальный release review tarball `0.1.0`; `npm pack --dry-run --json` подтверждает 11 файлов с LICENSE, README, metadata и `dist`.
- [x] Runtime-архив установлен в чистый Medusa 2.22.2 проект с независимым разрешением зависимостей; установка, сборка и live HTTP acceptance прошли 13.11.2026. README-expanded архив позже прошёл чистую установку и аудит.
- [ ] Опубликовать пакет в npm и проверить установку опубликованной версии в чистом проекте.
- [ ] После публикации обновить документацию и отчёт ссылкой на npm-пакет.

Публикация сделает пакет публичным. До `npm publish` требуется отдельное явное разрешение пользователя на конкретную версию и пакет.

### 5. Подать заявку в каталог Medusa

- [ ] После публикации проверить актуальный процесс подачи и отправить подготовленную карточку из `docs/medusa-directory-listing.md`.
- [ ] Записать ссылку/номер заявки и обновить статус после решения каталога.

Это внешняя публикация; перед отправкой нужно отдельное явное разрешение пользователя.

### 6. Передать исходники и отчёт

- [ ] Просмотреть текущие изменения Git и убедиться, что в сдаваемый набор не попали `.local/`, `.env`, секреты и временные файлы.
- [x] Сводка по редакции задания, PostgreSQL и браузерным smoke-проверкам синхронизирована; расхождение редакций и точные границы проверок archive A/C указаны явно.
- [ ] Решить, какие изменения оформить локальным коммитом. Push требует отдельного разрешения.

## Условные пункты

- [~] Публичный HTTPS demo делать только если он входит в согласованный объём работ; в ТЗ это условие помечено как опциональное.
- [~] Employee smoke в чистой временной базе потребует создания синтетического пользователя и явной subject-привязки. Не привязывать сотрудника по email или домену.

## Текущий локальный запуск

Проверочный Medusa-проект запускался из `/tmp/encvoy-package-Q5Tqzh/final-install`, с временной PostgreSQL-базой `medusa_clean_final` и временным Redis на `127.0.0.1:56380`; Encvoy использовал локальный стенд `localhost:9090`. После перезапуска компьютера проверь, что эти временные процессы ещё работают, прежде чем использовать `localhost:9000`.

- [x] Archive F: в Chrome 157.0.8103.51 проверены вход сотрудника, Orders, выход и возврат на `/app/login` при повторном открытии Orders (18.11.2026, чистый consumer).
- [x] Полный сотруднический вход/выход на F прошёл в Safari 18.6: Encvoy login, Admin Orders, logout, повторное открытие Orders вернуло на `/app/login`.
- [x] На временном Nginx proxy изолированного consumer прошли `nginx -t`, security headers, безопасный access log без callback query и rate limit (из 30 синтетических POST 19 получили 429, 11 — ожидаемый upstream 403 из-за отсутствующего допустимого Origin).
- [x] Nginx фактического локального Encvoy front-контейнера прошёл `nginx -t`; Safari OIDC flow использовал этот Nginx. Medusa headers/rate-limit/access-log snippets прошли на тестовом proxy. Production Medusa Nginx в этом стенде не развёрнут.
