<p align="center">
  <img src="assets/logo.svg" width="96" alt="WA Premium Plus logo" />
</p>

<h1 align="center">WA Premium Plus</h1>

<p align="center">
  A free, open-source WhatsApp desktop client for macOS, Windows and Linux,<br />
  with scheduling, campaigns and automation built in.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-green.svg"></a>
  <img alt="Status: early development" src="https://img.shields.io/badge/status-early%20development-orange.svg">
</p>

> **Unofficial.** WA Premium Plus is an independent open-source project. It is not affiliated with, endorsed by or sponsored by WhatsApp or Meta. "WhatsApp" is a trademark of WhatsApp LLC.

## What it is

WA Premium Plus links to your WhatsApp account the same way WhatsApp Web does, by QR code or pairing code. It gives you:

1. **The WhatsApp features you already use:** chats, media, voice notes, groups, status and channels.
2. **Power tools WhatsApp doesn't have:** scheduled messages and statuses, campaigns, automation rules, AI help, one inbox for several numbers, and team features.

It runs on top of [WAHA](https://github.com/devlikeapro/waha), a self-hosted WhatsApp HTTP API.

## Features

### WhatsApp features
- Several WhatsApp numbers in one app
- Text, images, video, documents, voice notes, stickers, reactions, replies, edits, deletes, forwards, polls, locations and contact cards
- Read receipts, typing indicators and online status
- Groups: create them, manage admins and members, invite links, join requests
- Status: view your contacts' statuses; post text, image, video and voice statuses
- Channels, labels, archive, pin and mute
- Call log and incoming-call notifications

### Premium Plus features
| Area | What you get |
|---|---|
| Scheduling | One-off and recurring messages in the recipient's time zone, scheduled statuses with a content calendar, scheduled group announcements |
| Campaigns | Contact lists from CSV, `{{name}}` personalization, message variations, slow sending with random delays, daily limits per number, number rotation, delivered/read/replied stats, automatic STOP opt-out |
| Automation | Rules (when X happens, if Y, do Z): keyword auto-replies, welcome and away messages, auto-reject calls with a reply, auto-labels, hand-off to a teammate, outbound webhooks (n8n, Zapier, CRMs) |
| AI | Suggested replies you approve, group chat summaries, voice-note transcription, translation, lead tagging |
| Inbox | One inbox across all numbers, `/shortcut` quick replies, snooze, follow-up reminders, private notes, contact panel, search across every chat |
| Teams | Assign chats to people, warnings when two people answer the same chat, roles and permissions, activity log |
| Data and API | Chat export, group member export to CSV, analytics, backups, REST API, webhooks, MCP server |

See the [roadmap](docs/ROADMAP.md) for what is built and what comes next.

## Known limitations

- **No voice or video calls.** WAHA reports call events and can reject calls, but no open-source WhatsApp library carries call audio or video. WA Premium Plus shows your call log and notifies you of calls; you answer them on your phone.
- **Bulk messaging can get a number banned.** WAHA connects as an unofficial linked device. Normal use is fine, but sending many messages, especially to people who haven't messaged you, can get a number banned. The campaign engine ships with cautious limits. For large-scale marketing, use Meta's official WhatsApp Business Platform.
- **Features we won't build:** keeping messages the sender deleted, saving view-once media, and other modded-client tricks that break other people's privacy expectations.

## Architecture

```
Desktop app (macOS / Windows / Linux)          Server (Docker, self-hosted)
Electron + React + TypeScript  ── WebSocket ─►  WA Premium Plus server (Node.js / TypeScript)
                                                 ├─ PostgreSQL      messages, contacts, schedules, campaigns
                                                 ├─ Redis + BullMQ  scheduled jobs, rate limits
                                                 ├─ S3 / MinIO      media
                                                 └─ WAHA (GOWS)     one session per WhatsApp number
```

Scheduled messages and automations run on the server, so they still go out when your laptop is closed.

## Getting started

The project is in early development and not usable yet. Setup instructions will appear here with the first runnable version.

## Contributing

Issues and pull requests are welcome. For larger changes, please open an issue first so we can discuss the approach.

## License

[MIT](LICENSE)
