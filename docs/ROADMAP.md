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
- [ ] Link by phone number (pairing code) as well as QR
- [ ] Profile pictures
- [x] Media: view and send images, video, documents, voice notes, stickers
- [x] Show edited and deleted messages
- [ ] Replies, reactions, forwards
- [ ] Polls, locations and contact cards
- [x] Groups: sender names, member list, admins, invite link
- [ ] Group admin tools (add/remove members, edit info)
- [ ] Status: view and post
- [ ] Channels
- [ ] Archive, pin, mute, labels
- [x] Voice and video calls through the official WhatsApp Web window
- [ ] Call log
- [ ] Multiple WhatsApp numbers

## Scheduling
- [x] Scheduled messages: one-off and repeating (daily, weekly, monthly)
- [x] Edit, cancel, send now; missed and failed handling
- [x] Schedule photos, videos and documents
- [x] Custom repeat rules (weekdays, every N days/weeks/months, chosen weekdays, yearly, end date)
- [ ] Send in the recipient's time zone
- [x] Scheduled status posts
- [ ] Content calendar view
- [x] Send one scheduled message to several chats
- [x] Scheduled group settings changes, with automatic switch-back for on/off settings

## Automation
- [ ] Quick replies with `/shortcut`
- [ ] Rules (when X happens, if Y, do Z): keyword auto-replies, away messages, welcome messages
- [ ] Auto-reject calls with a reply message
- [ ] Follow-up reminders ("remind me if no reply in 2 days")
- [ ] Contact lists from CSV and personalized broadcasts, with safety limits (daily caps, random delays, opt-out)
- [ ] Outbound webhooks (n8n, Zapier, CRMs)

## AI (optional, bring your own key)
- [ ] Suggested replies you approve
- [ ] Summaries of busy group chats
- [ ] Voice-note transcription and translation

## Data
- [ ] Export chats
- [ ] Export group members to CSV
- [ ] Message search across all chats
- [ ] Analytics: message volume and response times

## Distribution
- [x] Installers published to GitHub Releases (macOS DMG, Windows installer, Linux AppImage)
- [ ] Signed and notarized macOS build (needs a paid Apple Developer account)
- [ ] Signed Windows installer
- [x] Linux .deb in addition to AppImage (x64 and ARM64)
- [x] One-line install commands for macOS, Linux and Windows, verified against SHA256SUMS
- [ ] Auto-update
