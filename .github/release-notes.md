Free, open-source WhatsApp desktop app with scheduling and automation. Unofficial; not affiliated with WhatsApp or Meta.

## What's new in 0.5

- **Chat like on your phone**: replies, reactions, forwards, edits and deletes; polls, locations and contact cards; profile pictures; archive, pin, mute and labels; status updates; channels; group admin tools; call log; link by phone number; several WhatsApp numbers in one app.
- **Search every message** in every chat and jump to it.
- **Scheduling** in the recipient's time zone, and a content calendar.
- **Automation**: quick replies (`/`), rules for keyword replies, away and welcome messages, declining calls with a message, follow-up reminders, CSV contact lists and broadcasts with safety limits and opt-outs, and webhooks.
- **Insights** and **exports** of chats and group members.
- **Updates itself** from GitHub Releases, verified against SHA256SUMS.

Versions before 0.5 don't update themselves: install this one with a command below, and later versions arrive automatically.

## Install

**macOS and Linux**

```sh
curl -fsSL https://github.com/imbikramsaha/WA-Premium-Plus/releases/latest/download/install.sh | sh
```

**Windows** (PowerShell)

```powershell
irm https://github.com/imbikramsaha/WA-Premium-Plus/releases/latest/download/install.ps1 | iex
```

Or download a file below:

| Your computer | File |
|---|---|
| Mac with Apple silicon (M1 and later) | `WA-Premium-Plus-mac-arm64.dmg` |
| Mac with Intel processor | `WA-Premium-Plus-mac-x64.dmg` |
| Windows 10 or 11 | `WA-Premium-Plus-windows-setup.exe` |
| Ubuntu, Debian (x64 / ARM64) | `WA-Premium-Plus-linux-amd64.deb` / `WA-Premium-Plus-linux-arm64.deb` |
| Other Linux (x64 / ARM64) | `WA-Premium-Plus-linux-x64.AppImage` / `WA-Premium-Plus-linux-arm64.AppImage` |

Files with a version number in their name are the same builds. `SHA256SUMS` lists every file's checksum.

**The builds aren't code-signed yet.** When downloading in a browser: on macOS, open the app, then go to **System Settings → Privacy & Security** and click **Open Anyway**; on Windows, click **More info → Run anyway** if SmartScreen appears. The install commands avoid both prompts.

Then, on your phone, open WhatsApp → **Linked devices** → **Link a device**, and scan the QR code.

See the [README](https://github.com/imbikramsaha/WA-Premium-Plus#readme) for everything you can do.
