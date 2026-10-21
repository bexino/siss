# AGENTS.md

Static scheduling app (能工智人排班系统): a 5-step wizard that generates duty rosters where every person works an exactly equal number of shifts. Plain HTML + vanilla JS — no package.json, no build, no linter, no test runner.

## Running & verifying

- 依赖：`npm install`（Vite + Tailwind v4 插件，见 package.json）。开发用 `npm run dev`（热更新）；部署/分发用 `npm run build` 产出 `dist/`（相对路径 base，`dist/index.html` 可直接双击打开）。`dist/` 与 `node_modules/` 不入库。
- `js/scheduler.js` has a `module.exports` guard at the bottom, so its pure logic can be sanity-checked in Node without any test framework, e.g.:
  `node -e "console.log(require('./js/scheduler.js').calculateCycle(22,4))"`

## Structure & conventions

- `js/scheduler.js` = pure logic, no DOM. `js/app.js` = all DOM/state/UI and must load after it; script order in `index.html` matters.
- Functions called from inline `onclick=` attributes (`goToStep`, `handleCalendarCellClick`, `removeHolidayTag`, `removeManualWorkdayTag`, `setTableSearch` — in index.html and in JS-generated markup) must stay global. Do not wrap app.js in modules/IIFEs.
- New UI elements: add the ID in `index.html` and register it in the `elements` map at the top of `app.js` — elements are looked up once at script load (scripts sit at end of `<body>`; moving them breaks this).
- All UI text and code comments are Simplified Chinese (`lang="zh-CN"`); keep that convention.
- Dates are keyed as local-time `YYYY-MM-DD` strings via `formatDate`/`parseDate` (used as Set/Map keys for holidays and makeup workdays). Don't introduce `toISOString()` — the UTC shift corrupts those keys.
- 样式规则：UI 颜色、圆角、阴影等视觉规格一律使用标准 Tailwind 工具类（如 `bg-indigo-600`、`rounded-xl`），非必要不硬编码 HEX/px。仅 `generateStandaloneHtml` 的导出内联 CSS、scrollbar 伪元素等无法用工具类表达的少数位置例外（须注释标注对应 Tailwind 色值）。保留壳类（JS 动态引用的类名）内部用 `@apply` 引用标准工具类。
- 图标规则：UI 中任何图标一律使用 **Material Symbols**（Material Design 图标）。图标字体**本地缓存**在 `assets/fonts/material-symbols-outlined.woff2`（由 `css/style.css` 顶部 `@font-face` 加载），运行时**禁止任何云端请求**。仅当需要更新字体时，才初次（重新）从 LoliNet 镜像获取：带完整 Chrome UA 请求 `https://fonts.loli.net/icon?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block`，取 CSS 中 `gstatic.loli.net/s/materialsymbolsoutlined/...` 的 woff2 下载为上述文件（注意需 `curl --compressed`，否则得到 brotli 原始体，魔数应为 `wOF2`）。用 fontTools 验证连字覆盖所有使用的图标名。

## Gotchas

- `generateStandaloneHtml` in `app.js` exports a fully self-contained HTML file with its own inlined CSS/JS that duplicates the table/cards view, search, and CSV-export logic (no Tailwind). Behavior changes to search/filter/CSV must be mirrored there too.
- The sample roster is 22 hardcoded names in `SAMPLE_NAMES_TEXT`. Comments/toasts referencing "docs/1.md" or "49 人" are stale — no such file exists.
- Core invariant: `calculateCycle(N, K)` builds the minimal no-remainder cycle (`totalDays = N/gcd(N,K)`, `shiftsPerPerson = K/gcd(N,K)`), and each person appears exactly `shiftsPerPerson` times. Step-2 Markdown editing (`parseAndValidateAssignmentsMarkdown`) rejects any edit that changes day count, per-day headcount, roster membership, or that equality.
