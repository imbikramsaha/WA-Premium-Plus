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

On top of normal chatting, it adds what WhatsApp doesn't have, starting with **message scheduling**: write a message now and have it sent later, once or on any repeating schedule.

## Download

Get the installer for your computer from the [latest release](https://github.com/imbikramsaha/WA-Premium-Plus/releases/latest):

| Your computer | File |
|---|---|
| Mac with Apple silicon (M1 and later) | `WA-Premium-Plus-<version>-mac-arm64.dmg` |
| Mac with Intel processor | `WA-Premium-Plus-<version>-mac-x64.dmg` |
| Windows 10 or 11 | `WA-Premium-Plus-<version>-windows-setup.exe` |
| Linux | `WA-Premium-Plus-<version>-linux-x86_64.AppImage` |

The app isn't signed by Apple or Microsoft (that costs money every year), so your system asks you to confirm the first launch:

- **macOS:** drag the app to Applications and open it. When macOS says it can't verify the developer, go to **System Settings → Privacy & Security** and click **Open Anyway**.
- **Windows:** if SmartScreen appears, click **More info → Run anyway**.
- **Linux:** make the file executable (`chmod +x WA-Premium-Plus-*.AppImage`) and run it.

Then, in WhatsApp on your phone, open **Linked devices → Link a device** and scan the QR code.

## Features

**Chats**
- Chat list with unread counts, search, and All / Unread / Groups filters
- Text messages with delivery and read ticks; edited and deleted messages shown as such
- Photos, videos, stickers, voice notes and documents: view, play, open and save
- Send photos, videos and documents (pick, drag and drop, or paste), with a caption
- Record and send voice notes
- Group sender names, and a group info panel with members, admins and the invite link
- Load older messages; desktop notifications for new ones

**Scheduled messages**
- Send once, or repeat every day, every weekday, every week, month or year
- Custom repeats: every N days, weeks or months, on chosen days of the week, with an optional end date
- Send to several chats at once, attach a photo, video or document, or post to your status
- A preview of the next send times before you save
- Edit, cancel, or "Send now"; if the computer was off at the scheduled time, the message is marked *Missed* rather than sent hours late

**Calls**
- Voice and video calls open the official WhatsApp Web in a separate window (see Known limitations)

**Runs in the background**
- Keeps running in the system tray when you close the window, so scheduled messages still go out
- Optional "Open at login" (macOS and Windows)
- Light and dark themes that follow your system

See the [roadmap](docs/ROADMAP.md) for what comes next.

## Known limitations

- **Calls use WhatsApp Web.** No open-source WhatsApp library can carry call audio or video, so the call buttons open the official WhatsApp Web in its own window. Link it once by scanning its QR code. Whether WhatsApp Web can make calls depends on WhatsApp's rollout for your account; if it can't, use the official WhatsApp desktop app for calls.
- **Keep the app running for scheduled messages.** Messages are sent from your computer. If it is off or asleep at the scheduled time, the message waits; after an hour it is marked *Missed*.
- **Media from before you linked** may not be downloadable; open it on your phone.
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

## Run from source

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
| `npm test` | Run the tests (scheduler, repeat rules, database, voice-note conversion) |
| `npm run typecheck` | Type-check the main process and the window |
| `npm run build` | Build into `out/` |
| `npm run dist` | Build installers for the current OS into `release/` |
| `git tag vX.Y.Z && git push --tags` | Build installers for all platforms on GitHub and publish a release |
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
tests/          tests (node:test)
```

## Contributing

Issues and pull requests are welcome. For larger changes, please open an issue first so we can agree on the approach.

## Credits

- [Baileys](https://github.com/WhiskeySockets/Baileys) (MIT) for the WhatsApp connection
- [WAHA](https://github.com/devlikeapro/waha), whose NOWEB engine is built on the same library

## License

[MIT](LICENSE)
