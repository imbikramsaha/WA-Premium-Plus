# Roadmap

## Phase 0: Foundation
- [ ] Monorepo with desktop app, server and shared types
- [ ] Docker Compose setup for WAHA (GOWS engine)
- [ ] Link a WhatsApp number by QR code
- [ ] Send and receive text messages end to end
- [ ] CI builds on macOS, Windows and Linux

## Phase 1: WhatsApp features
- [ ] Message store in PostgreSQL (every incoming and outgoing message)
- [ ] Chat list and conversation view
- [ ] Media: images, video, documents, voice notes, stickers
- [ ] Replies, reactions, edits, deletes, forwards, polls, locations, contact cards
- [ ] Groups and group management
- [ ] Status: view and post
- [ ] Channels, labels, archive, pin, mute
- [ ] Call log and incoming-call notifications
- [ ] Multiple WhatsApp numbers

## Phase 2: Scheduling
- [ ] Scheduled and recurring messages, in the recipient's time zone
- [ ] Scheduled statuses with a content calendar
- [ ] Scheduled group announcements
- [ ] Drafts queue

## Phase 3: Campaigns and automation
- [ ] Contact lists and CSV import
- [ ] Campaign engine with safety limits (warm-up, daily caps, random delays, opt-out)
- [ ] Automation rules engine (trigger → condition → action)
- [ ] Outbound webhooks

## Phase 4: AI, teams and analytics
- [ ] AI reply suggestions, chat summaries, voice-note transcription, translation
- [ ] Team inbox: assignment, internal notes, roles, audit log
- [ ] Analytics dashboard
- [ ] Public REST API and MCP server

## Packaging
- [ ] Signed and notarized macOS build
- [ ] Signed Windows installer
- [ ] Linux AppImage and .deb
- [ ] Auto-update
