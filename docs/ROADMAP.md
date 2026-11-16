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
- [ ] Load older messages
- [ ] Link by phone number (pairing code) as well as QR
- [ ] Profile pictures
- [ ] Media: view and send images, video, documents, voice notes, stickers
- [ ] Replies, reactions, edits, deletes, forwards
- [ ] Polls, locations and contact cards
- [ ] Groups: member list, admin tools, invite links
- [ ] Status: view and post
- [ ] Channels
- [ ] Archive, pin, mute, labels
- [ ] Call log (calls themselves stay on the phone)
- [ ] Multiple WhatsApp numbers

## Scheduling
- [x] Scheduled messages: one-off and repeating (daily, weekly, monthly)
- [x] Edit, cancel, send now; missed and failed handling
- [ ] Schedule media and documents
- [ ] Custom repeat rules (weekdays only, every N days, end date)
- [ ] Send in the recipient's time zone
- [ ] Scheduled statuses with a content calendar
- [ ] Send one scheduled message to several chats

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
- [ ] Release builds published to GitHub Releases
- [ ] Signed and notarized macOS build
- [ ] Signed Windows installer
- [ ] Linux .deb in addition to AppImage
- [ ] Auto-update
