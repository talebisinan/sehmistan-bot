# Discord music bot 'sehmistan'

![sehmistan bot](https://static1.personalitydatabase.net/2/pdb-images-prod/4c3713a1/profile_images/e94bf6963f1147de94294d202269ca2f.png)

## Commands

| Command | Description | Requires voice channel? |
|---|---|---|
| `/p <query>` | Play a song by name or YouTube URL. Plays the first search result immediately. Pass a playlist URL (`youtube.com/playlist?list=...`) to queue up to 100 tracks at once. Shows **Now Playing** when it starts immediately, or **Added to Queue** with its position if something is already playing. | ✅ |
| `/pl <query>` | Search YouTube and pick from a list of 5 results using a dropdown menu. | ✅ |
| `/s` | Skip the currently playing song. | ✅ |
| `/seek <position>` | Seek to a position in the current song. Accepts `mm:ss` (e.g. `1:30`) or seconds (e.g. `90`). | ✅ |
| `/q` | Show the full music queue — currently playing song (as a clickable link with duration) at the top, then up to 10 upcoming songs with durations and who queued them. | ❌ |
| `/bam` | Disconnect other bot/app accounts from your current voice channel. Requires `Move Members` for both you and the bot. | ✅ |
| `/bambam` | Disconnect everyone from your current voice channel, including the bot itself. Requires `Move Members` for both you and the bot. | ✅ |
| `/takewalk <user>` | Pick someone in your current voice channel and move them through usable voice channels for 5 stops, then return them home. If there are fewer than 5 usable destination channels, the bot loops the usable channels. Requires `Move Members`; the bot also needs `Connect`. | ✅ |
| `/lottery` | Pick a random non-bot person from your current voice channel. | ✅ |
| `/kufur` | Reply with a random Turkish swear word. | ❌ |

The bot automatically disconnects from the voice channel after 3 minutes of inactivity.

## Permissions

Use `/perms` in Discord to show this list from the bot. It also checks the current text channel and your current voice channel, marking permissions as present (`✅`) or missing (`❌`).

| Feature / commands | Caller needs | Bot needs |
|---|---|---|
| Music: `/p`, `/pl`, `/radio`, `/s`, `/stop`, `/seek` | Be in a voice channel | `View Channel`, `Connect`, `Speak` in the voice channel. `Use Voice Activity` is recommended. |
| Voice moderation: `/bam`, `/bambam` | `Move Members` in the voice channel | `View Channel`, `Move Members` in the voice channel. Bot role must be high enough to move/disconnect targets. |
| Walk: `/takewalk` | `Move Members` in the original voice channel | `View Channel`, `Connect`, `Move Members` in the original and destination voice channels. The command uses 5 stops and loops usable destination channels if needed. This stops current music playback before moving the bot. |
| Cleanup: `/clean` | — | `Manage Messages` in the text channel. |
| General slash command usage | — | `Use Application Commands`, `Send Messages`, `Embed Links`, `Read Message History`. |

## Playback

Audio is streamed via `yt-dlp` → `ffmpeg` → Discord with two layers of buffering to prevent interruptions:

- **In-memory buffer** — a 10 MB PassThrough buffer sits between ffmpeg and the Discord player, absorbing up to ~50 seconds of network hiccups without cutting out.
- **Pre-fetch** — while a song plays, the next queue item is silently downloaded to a temp PCM file in the background. When its turn comes, playback reads from disk with no network dependency. Seek on a pre-fetched song is instant (constant-bitrate byte offset, no re-download).

## Installation

### Install Bun Runtime

```bash
curl -fsSL https://bun.sh/install | bash
```

### Install System Dependencies

#### Debian/Ubuntu (apt)

```bash
sudo apt install -y ffmpeg libopus0 libopus-dev yt-dlp
```

#### Fedora/RHEL/CentOS (dnf)

```bash
sudo dnf install -y ffmpeg opus opus-devel yt-dlp
```

### Install Project Dependencies

```bash
bun install
```

## Configuration

Create a `.env` file in the project root:

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
GUILD_IDS=your_first_server_id,your_second_server_id
```

- **DISCORD_TOKEN** — Bot token from the [Discord Developer Portal](https://discord.com/developers/applications)
- **CLIENT_ID** — Application ID, found on the General Information page of your app
- **GUILD_IDS** — Comma-separated Discord server IDs where slash commands should be registered. Right-click each server name in Discord → **Copy Server ID** (requires Developer Mode: Settings → Advanced → Developer Mode). For one server, you can provide a single ID.

### YouTube session import (optional)

If a video requires sign-in, set this optional variable to let yt-dlp borrow your browser's YouTube session:

```env
YTDLP_COOKIES_BROWSER=firefox
```

Supported values include `firefox`, `chrome`, `chromium`, `brave`, `edge`, and `safari`. You can also pass yt-dlp's full browser syntax, for example `firefox:default-release` for a specific Firefox profile.

If browser cookie import does not authenticate age-restricted videos, export YouTube cookies to a Netscape-format cookies file and use that instead:

```env
YTDLP_COOKIES_FILE=/absolute/path/to/youtube-cookies.txt
```

`YTDLP_COOKIES_FILE` takes precedence over `YTDLP_COOKIES_BROWSER` when both are set. The cookies must come from a YouTube account that can watch the video in a normal browser.

Optional yt-dlp tuning:

```env
YTDLP_JS_RUNTIMES=node:/absolute/path/to/node
YTDLP_YOUTUBE_PLAYER_CLIENT=web
```

If unset, `YTDLP_YOUTUBE_PLAYER_CLIENT` defaults to `android,tv_embedded`.


```
YTDLP_COOKIES_BROWSER=chrome:/home/sinan/.var/app/com.google.Chrome/config/google-chrome/Default
YTDLP_JS_RUNTIMES=node
YTDLP_YOUTUBE_PLAYER_CLIENT=default
```
## Usage

```bash
bun run dev
```
