---
sidebar_position: 12
title: WhatsApp
---

# WhatsApp

Connect WhatsApp to your Pawz agents. Messages come in, your agent replies — all on your machine.

## Setup

1. In Pawz, go to **Settings → Channels**
2. Select **WhatsApp**
3. Choose who can message your agent (defaults are fine to start)
4. Click **Save**, then click **Start** on the WhatsApp card
5. A QR code will appear — scan it with your phone
   - WhatsApp → Settings → Linked Devices → Link a Device
6. Done! Your agent is now live on WhatsApp

## Configuration

| Setting | Description |
|---------|-------------|
| Who can message your agent? | Open (anyone) / Pairing (approval required) / Allowlist |
| Reply in group chats too | Whether the agent responds in groups (default: off) |
| Allowed phone numbers | Only needed if using allowlist mode — include country code |
| Agent | Leave blank for default, or pick a specific agent |

## How it works

```
WhatsApp message → Pawz receives it → Agent processes → Reply sent back
```

All WhatsApp traffic stays on your machine. Nothing is exposed to the internet.

## Features

- QR code authentication (scan with your phone to link)
- Direct messages and group chat support
- Per-user sessions with memory
- Prompt injection scanning on all incoming messages
- Agent routing via channel routing rules
- Everything runs locally — nothing exposed to the internet

## Tips

- The QR code expires after a few minutes — scan it promptly
- If you lose connection, stop and restart the channel to get a fresh QR code
- Phone numbers in allowlist should include country code (e.g., `15551234567`)
