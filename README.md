# sehmistan-bot

A Discord music and voice utility bot powered by `discord.js`, `yt-dlp`, `ffmpeg`, and Bun.

## Features

- Play YouTube songs and playlists
- Search YouTube with a dropdown picker
- Queue, skip, stop, seek, and radio-style queue expansion
- Voice moderation helpers: `/bam`, `/bambam`, `/takewalk`, `/lottery`
- Utility commands: `/help`, `/perms`, `/clean`, `/kufur`

## Requirements

- [Bun](https://bun.sh/)
- `ffmpeg`
- `yt-dlp`
- Opus libraries

Install system dependencies:

```bash
# Debian/Ubuntu
sudo apt install -y ffmpeg libopus0 libopus-dev yt-dlp

# Fedora
sudo dnf install -y ffmpeg opus opus-devel yt-dlp
```

Install project dependencies:

```bash
bun install
```

## Configuration

Create `.env` in the project root:

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
GUILD_IDS=server_id_1,server_id_2
```

Optional yt-dlp settings:

```env
# Use browser cookies for age/sign-in-restricted YouTube videos
YTDLP_COOKIES_BROWSER=firefox

# Or use an exported Netscape cookies file
YTDLP_COOKIES_FILE=/absolute/path/to/youtube-cookies.txt

# Optional yt-dlp tuning
YTDLP_JS_RUNTIMES=node
YTDLP_YOUTUBE_PLAYER_CLIENT=default
```

## Run

```bash
bun run start
```

Development/watch mode:

```bash
bun run dev
```

## Commands

| Command | Description |
|---|---|
| `/p <query>` | Play a YouTube search result, URL, or playlist URL |
| `/pl <query>` | Search YouTube and choose from a dropdown |
| `/radio [query]` | Queue related tracks from the current song or query |
| `/q` | Show the queue |
| `/s` | Skip current song |
| `/stop` | Stop playback and clear queue |
| `/seek <position>` | Seek to `mm:ss` or seconds |
| `/bam` | Disconnect bot/app accounts from your voice channel |
| `/bambam` | Disconnect everyone from your voice channel |
| `/takewalk` | Move a selected user through voice channels and back |
| `/lottery` | Pick a random non-bot user from your voice channel |
| `/perms` | Show required permissions and current permission status |
| `/clean` | Bulk-delete recent bot messages |
| `/help` | Show command help |
| `/kufur` | Send a random Turkish swear word |

## Permissions

For music playback, the bot needs `View Channel`, `Connect`, and `Speak` in the voice channel.

For moderation commands like `/bam`, `/bambam`, and `/takewalk`, both the caller and bot need `Move Members` where applicable.

Use `/perms` in Discord for a live permission check.
