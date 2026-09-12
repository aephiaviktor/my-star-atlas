# My Star Atlas

## AI Install prompt
"Help me install My Star Atlas on my system.
Please first read the installation instructions here:
https://raw.githubusercontent.com/aephiaviktor/my-star-atlas/master/README-FIRST.txt
Then guide me through the installation one step at a time.
Do not change, delete, install, or reconfigure anything on my system without first explaining exactly what you want to do and obtaining my approval.
If something does not work, ask me for the exact error message or a screenshot and diagnose that specific problem before suggesting further changes."

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
