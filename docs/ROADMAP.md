# Roadmap

## Foundation (done)
- [x] Desktop app for macOS, Windows and Linux (Electron)
- [x] Built-in WhatsApp connection, no server or Docker needed
- [x] Link by QR code
- [x] Local SQLite database for chats, messages and schedules
- [x] Runs in the system tray; optional open at login
- [x] CI builds on macOS, Windows and Linux

## Messaging basics
- [x] Chat list with unread counts and search
- [x] Text conversations with delivery and read ticks
- [x] Desktop notifications
- [x] Load older messages
- [x] Link by phone number (pairing code) as well as QR
- [x] Profile pictures
- [x] Media: view and send images, video, documents, voice notes, stickers
- [x] Show edited and deleted messages
- [x] Replies, reactions, forwards
- [x] Polls, locations and contact cards
- [x] Groups: sender names, member list, admins, invite link
- [x] Group admin tools (add/remove members, edit info)
- [x] Status: view and post
- [x] Channels
- [x] Archive, pin, mute, labels
- [x] Voice and video calls through the official WhatsApp Web window
- [x] Call log
- [x] Multiple WhatsApp numbers

## Scheduling
- [x] Scheduled messages: one-off and repeating (daily, weekly, monthly)
- [x] Edit, cancel, send now; missed and failed handling
- [x] Edit and delete sent messages
- [x] Schedule photos, videos and documents
- [x] Custom repeat rules (weekdays, every N days/weeks/months, chosen weekdays, yearly, end date)
- [x] Send in the recipient's time zone
- [x] Scheduled status posts
- [x] Content calendar view
- [x] Send one scheduled message to several chats
- [x] Scheduled group settings changes, with automatic switch-back for on/off settings

## Automation
- [x] Quick replies with `/shortcut`
- [x] Rules (when X happens, if Y, do Z): keyword auto-replies, away messages, welcome messages
- [x] Auto-reject calls with a reply message
- [x] Follow-up reminders ("remind me if no reply in 2 days")
- [x] Contact lists from CSV and personalized broadcasts, with safety limits (daily caps, random delays, opt-out)
- [x] Outbound webhooks (n8n, Zapier, CRMs)

## AI (optional, bring your own key)
- [ ] Suggested replies you approve
- [ ] Summaries of busy group chats
- [ ] Voice-note transcription and translation

## Data
- [x] Export chats
- [x] Export group members to CSV
- [x] Message search across all chats (full-text, any language)
- [x] Analytics: message volume and response times

## Distribution
- [x] Installers published to GitHub Releases (macOS DMG, Windows installer, Linux AppImage)
- [ ] Signed and notarized macOS build (needs a paid Apple Developer account)
- [ ] Signed Windows installer
- [x] Linux .deb in addition to AppImage (x64 and ARM64)
- [x] One-line install commands for macOS, Linux and Windows, verified against SHA256SUMS
- [x] Auto-update from GitHub Releases, verified against SHA256SUMS (macOS, Windows, Linux AppImage; .deb shows the update command)
