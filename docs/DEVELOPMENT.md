# Development

## Requirements

- [Node.js](https://nodejs.org) 22.18 or newer
- macOS, Windows or Linux

## Run from source

```bash
git clone https://github.com/imbikramsaha/WA-Premium-Plus.git
cd WA-Premium-Plus
npm install
npm run dev
```

Then link WhatsApp from your phone: **Linked devices → Link a device**, and scan the QR code.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app with hot reload |
| `npm run dev:debug` | Same, with Chrome DevTools remote debugging on port 9333 |
| `npm test` | Run the tests (scheduler, repeat rules, group changes, database, voice-note conversion) |
| `npm run typecheck` | Type-check the main process and the window |
| `npm run build` | Build into `out/` |
| `npm run dist` | Build installers for the current OS into `release/` |
| `npm run icons` | Regenerate app and tray icons from the logo geometry |

## Environment variables

| Variable | Effect |
|---|---|
| `WAPP_DATA_DIR=/some/folder` | Use a separate profile, for example to test with a second WhatsApp account |
| `WAPP_LOG_LEVEL=debug` | Print WhatsApp connection logs |
| `WAPP_OFFLINE=1` | Show the stored chats without connecting to WhatsApp. With `WAPP_DATA_DIR` pointing at a copy of a profile (without its `auth` folder), this tests the window against real data without disturbing that account's session |

## Project layout

```
src/main/       background process: WhatsApp connection, database, scheduler, tray, calls window
src/preload/    the bridge that exposes a small API to the window
src/renderer/   the window (React)
src/shared/     types and pure logic shared by both sides (repeat rules, group changes)
tests/          tests (node:test)
scripts/        install scripts and icon generator
```

## Releasing

Push a version tag. The release workflow builds the installers on macOS, Windows and Linux, publishes them with stable file names, `SHA256SUMS` and the install scripts, and then tests the one-line installers on all three systems.

```bash
npm version patch   # or minor / major
git push --follow-tags
```
