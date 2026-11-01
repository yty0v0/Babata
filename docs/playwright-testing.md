# Playwright smoke test

Run the browser smoke check from the repository root:

```sh
bun run --cwd packages/core test:playwright
```

In PowerShell, if `bun` is blocked because it resolves to `bun.ps1`, run `bun.exe run --cwd packages/core test:playwright` instead.

The package script starts Playwright through Node.js. Do not run Playwright's Node API with `bun`; Bun can hang while opening Chromium's control pipe. The smoke test uses the browser version bundled for the installed Playwright package. If that browser is absent, it tries an installed system Chrome/Chromium and prints a warning. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to select another browser explicitly, or install the matching browser with:

```sh
node node_modules/playwright/cli.js install chromium
```

The local web app must already be running. Override its address with `PLAYWRIGHT_BASE_URL` when needed.
