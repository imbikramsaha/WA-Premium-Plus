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
| `npm test` | Run the tests (database, message parsing, scheduler and time zones, automation, broadcasts, webhooks, exports, insights, updates) |
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
| `WAPP_FAKE_VERSION=0.4.0` | Pretend to be an older version, to test updates (with a packaged build from `npm run dist:dir`) |
| `WAPP_UPDATE_API=https://…` | Read the "latest release" from another URL, to test updates against a local server |

## Project layout

```
src/main/            background process
  index.ts           app start-up, window, tray, notifications, updater
  accounts.ts        the linked WhatsApp numbers; account.ts wires up one of them
  whatsapp.ts        the WhatsApp connection (Baileys) and everything it sends
  messages.ts        turns WhatsApp messages into the app's message shape
  store.ts           the local SQLite database (with a full-text search index)
  scheduler.ts       scheduled messages, statuses and group changes
  automation.ts      rules, quick replies, call auto-reject, opt-outs
  reminders.ts       follow-up reminders
  broadcasts.ts      contact lists and broadcasts with safety limits
  webhooks.ts        signed outbound webhooks
  analytics.ts       insights; export.ts: chat exports
  updater.ts         updates from GitHub Releases
  ipc*.ts            the window's requests
src/preload/         the bridge that exposes a small API to the window
src/renderer/        the window (React)
src/shared/          types and pure logic shared by both sides (repeat rules, time zones,
                     templates, CSV, rule matching, versions)
tests/               tests (node:test)
scripts/             install scripts and icon generator
```

## Releasing

Push a version tag. The release workflow builds the installers on macOS, Windows and Linux, publishes them with stable file names, `SHA256SUMS` and the install scripts, and then tests the one-line installers on all three systems.

```bash
npm version patch   # or minor / major
git push --follow-tags
```

A version with a suffix, like `0.6.0-beta.1`, is published as a pre-release: the installers are built and tested, but the download links, install commands and auto-update keep using the latest full release.
