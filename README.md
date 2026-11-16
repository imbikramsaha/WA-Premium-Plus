<p align="center">
  <img src="assets/logo.svg" width="96" alt="WA Premium Plus logo" />
</p>

<h1 align="center">WA Premium Plus</h1>

<p align="center">
  A free, open-source WhatsApp desktop app for macOS, Windows and Linux,<br />
  with message scheduling and automation built in.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-green.svg"></a>
  <a href="https://github.com/imbikramsaha/WA-Premium-Plus/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/imbikramsaha/WA-Premium-Plus/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Status: early development" src="https://img.shields.io/badge/status-early%20development-orange.svg">
</p>

> **Unofficial.** WA Premium Plus is an independent open-source project. It is not affiliated with, endorsed by or sponsored by WhatsApp or Meta. "WhatsApp" is a trademark of WhatsApp LLC.

## What it is

WA Premium Plus is a desktop app that links to your WhatsApp account the same way WhatsApp Web does: you scan a QR code with your phone. Everything runs on your own computer. There is no server to set up, no account to create and no cost.

On top of normal chatting, it adds the things WhatsApp doesn't have, starting with **message scheduling**: write a message now and have it sent later, once or on repeat.

## What works today

- Link your WhatsApp by QR code
- Chat list with unread counts, search and message previews
- Read and send text messages, with delivery and read ticks
- **Scheduled messages**
  - Send once, or repeat every day, week or month
  - Quick picks: "In 1 hour", "Tomorrow 9:00", "Monday 9:00"
  - Edit, cancel, or "Send now" from the Scheduled screen
  - If the computer was off at the scheduled time, the message is marked *Missed* rather than sent hours late, and you choose what to do
- Keeps running in the system tray when you close the window, so scheduled messages still go out
- Optional "Open at login" (macOS and Windows)
- Desktop notifications for new messages
- Light and dark themes that follow your system

See the [roadmap](docs/ROADMAP.md) for what comes next: media, groups, status, multiple numbers, automation rules and more.

## Known limitations

- **No voice or video calls.** No open-source WhatsApp library supports call audio or video, so calls stay on your phone.
- **Keep the app running for scheduled messages.** Messages are sent from your computer. If it is off or asleep at the scheduled time, the message waits; after an hour it is marked *Missed*.
- **Bulk messaging can get a number banned.** WA Premium Plus connects as an unofficial linked device. Normal use is fine, but sending large volumes of messages, especially to people who haven't messaged you, can get a number banned by WhatsApp.
- **Features we won't build:** keeping messages the sender deleted, saving view-once media, and other modded-client tricks that break other people's privacy expectations.

## How it works

```
WA Premium Plus (one desktop app)
├─ Window (React)        chats, conversation, scheduled messages
└─ Background (Electron main process, keeps running in the tray)
   ├─ WhatsApp connection   Baileys, the open-source library behind WAHA's NOWEB engine
   ├─ Local database        SQLite (built into Node), stored in your user data folder
   └─ Scheduler             checks every 15 seconds and sends what is due
```

Your chats, scheduled messages and WhatsApp login stay in the app's data folder on your computer:

| OS | Location |
|---|---|
| macOS | `~/Library/Application Support/WA Premium Plus` |
| Windows | `%APPDATA%\WA Premium Plus` |
| Linux | `~/.config/WA Premium Plus` |

## Getting started

Installers for macOS, Windows and Linux will be published on the [Releases](https://github.com/imbikramsaha/WA-Premium-Plus/releases) page. Until then, run it from source:

1. Install [Node.js](https://nodejs.org) 22.18 or newer.
2. Clone and start the app:
   ```bash
   git clone https://github.com/imbikramsaha/WA-Premium-Plus.git
   cd WA-Premium-Plus
   npm install
   npm run dev
   ```
3. In WhatsApp on your phone, open **Linked devices → Link a device** and scan the QR code.

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Start the app with hot reload |
| `npm test` | Run the scheduler tests |
| `npm run typecheck` | Type-check the main process and the window |
| `npm run build` | Build into `out/` |
| `npm run dist` | Build installers for the current OS into `release/` |
| `npm run icons` | Regenerate app and tray icons from the logo geometry |

Environment variables for development:

- `WAPP_DATA_DIR=/some/folder` uses a separate profile, for example to test with a second WhatsApp account.
- `WAPP_LOG_LEVEL=debug` prints WhatsApp connection logs.

Project layout:

```
src/main/       background process: WhatsApp connection, database, scheduler, tray
src/preload/    the bridge that exposes a small API to the window
src/renderer/   the window (React)
src/shared/     types shared by both sides
tests/          scheduler tests (node:test)
```

## Contributing

Issues and pull requests are welcome. For larger changes, please open an issue first so we can agree on the approach.

## Credits

- [Baileys](https://github.com/WhiskeySockets/Baileys) (MIT) for the WhatsApp connection
- [WAHA](https://github.com/devlikeapro/waha), whose NOWEB engine is built on the same library

## License

[MIT](LICENSE)
