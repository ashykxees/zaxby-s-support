# Zaxby's Support Ticket Bot

A Discord bot for handling support tickets with department selection, private ticket channels, and transcript logging.

## Features

- Support panel embed with a department dropdown
- Modal form for case title and description
- Private ticket channels created under a configured category
- Only the ticket opener and support team role can view the channel
- Pings the opener and support team role on ticket creation
- `/close` command and in-channel button to close a ticket
- Transcripts posted to a configured log channel

## Setup

1. Copy `.env.example` to `.env` and fill in the values:

```env
DISCORD_TOKEN=your_bot_token
GUILD_ID=your_guild_id
SUPPORT_ROLE_ID=your_support_role_id
PANEL_CHANNEL_ID=1541433935475769445
TICKET_CATEGORY_ID=1541462926324408444
TRANSCRIPT_CHANNEL_ID=1541463149872680980
```

2. Install dependencies and start:

```bash
npm install
npm start
```

3. Make sure the bot has the `bot` and `applications.commands` scopes and permissions to manage channels, send messages, and read message history.

## Environment variables

- `DISCORD_TOKEN` — Discord bot token
- `GUILD_ID` — Guild to register slash commands in
- `SUPPORT_ROLE_ID` — Role ID for the support team
- `PANEL_CHANNEL_ID` — Channel ID where the support panel is posted
- `TICKET_CATEGORY_ID` — Category ID where ticket channels are created
- `TRANSCRIPT_CHANNEL_ID` — Channel ID where transcripts are posted
