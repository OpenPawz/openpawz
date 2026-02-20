---
sidebar_position: 12
title: WhatsApp
---

# WhatsApp

Connect WhatsApp to your Pawz agents via a local Evolution API Docker container.

## Prerequisites

- **Docker** must be installed and running on your machine
- Pawz will automatically pull and manage the Evolution API container

## Setup

1. In Pawz, go to **Settings → Channels**
2. Select **WhatsApp**
3. Configure:
   - **API port** — port for Evolution API (default: `8085`)
   - **Webhook port** — port for inbound message delivery (default: `8086`)
   - **DM policy** — open / allowlist / pairing
   - **Allowed numbers** — phone numbers (for allowlist mode)
   - **Respond in groups** — whether to respond in group chats
4. Start the channel
5. Pawz will:
   - Pull the Evolution API Docker image (first time only)
   - Create and start the container (bound to `127.0.0.1`)
   - Generate a **QR code** — scan it with your phone's WhatsApp app
6. Once connected, your agent is live on WhatsApp

## Configuration

| Field | Required | Description |
|-------|----------|-------------|
| API port | Yes | Evolution API port (default: 8085) |
| Webhook port | Yes | Inbound message listener port (default: 8086) |
| DM policy | Yes | Who can message the agent |
| Allowed numbers | For allowlist | Comma-separated phone numbers |
| Respond in groups | No | Reply in group chats (default: off) |

## How it works

```
WhatsApp message
      ↓
Evolution API (Docker container)
      ↓ webhook (HTTP POST to localhost)
Pawz inbound handler
      ↓
Prompt injection scan → Access control → Agent routing
      ↓
Agent responds → Evolution REST API → WhatsApp
```

All WhatsApp protocol handling (WebSocket to Meta servers) stays inside the Docker container. Pawz only communicates with the container over local HTTP — no WhatsApp protocol code runs in Pawz itself.

## Features

- QR code authentication (scan with your phone to link)
- Direct messages and group chat support
- Per-user sessions with memory
- Prompt injection scanning on all incoming messages
- Agent routing via channel routing rules
- Docker container auto-managed (pull, create, start, health check)
- All traffic bound to localhost — nothing exposed to the internet

## Architecture

The WhatsApp bridge uses [Evolution API](https://github.com/EvolutionAPI/evolution-api), which wraps the [Baileys](https://github.com/WhiskeySockets/Baileys) library (WhatsApp Web multi-device protocol) in a REST API.

| Component | Runs in | Talks to |
|-----------|---------|----------|
| Evolution API | Docker container | WhatsApp servers (WebSocket) |
| Pawz webhook listener | Pawz process | Evolution container (HTTP) |
| Pawz message sender | Pawz process | Evolution container (HTTP) |

## Routing

Route specific users or groups to different agents using routing rules in **Settings → Channels → Routing**:

- **User filter** — route by phone number
- **Channel ID filter** — route by group JID

## Tips

- Keep Docker running — the WhatsApp connection lives in the container
- The QR code expires after a few minutes — scan it promptly when starting the channel
- If you lose connection, stop and restart the channel to get a fresh QR code
- Phone numbers in allowlist should include country code (e.g., `15551234567`)
- The Evolution API container is bound to `127.0.0.1` — it's not accessible from other machines
