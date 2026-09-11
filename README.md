# My Star Atlas

Local Electron app for Star Atlas fleet performance dashboards.

## Current scope

- USTUR live/dev folder
- App shell with Production/Consumption, Optimization, Earnings, and Settings
- Local settings persistence
- No chain, RPC, or Influx reads yet

## Commands

```bash
npm install
npm run typecheck
npm start
```

## macOS packaging

`npm run package:mac` builds a universal (arm64 + x64) `.dmg` under `dist/`
via `electron-builder`; use `package:mac:arm64` / `package:mac:x64` for a
single-architecture build. This only affects the macOS distribution path —
it does not change the existing Windows portable-ZIP release. See
`.github/workflows/release-macos.yml` for how a tagged release attaches the
macOS artifact to the same GitHub Release as the Windows build.
