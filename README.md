# Discord music bot 'sehmistan'

![sehmistan bot](https://static1.personalitydatabase.net/2/pdb-images-prod/4c3713a1/profile_images/e94bf6963f1147de94294d202269ca2f.png)

## Commands

| Command | Description | Requires voice channel? |
|---|---|---|
| `/p <query>` | Play a song by name or YouTube URL. Plays the first search result immediately. Pass a playlist URL (`youtube.com/playlist?list=...`) to queue up to 100 tracks at once. Shows **Now Playing** when it starts immediately, or **Added to Queue** with its position if something is already playing. | ✅ |
| `/pl <query>` | Search YouTube and pick from a list of 5 results using a dropdown menu. | ✅ |
| `/s` | Skip the currently playing song. | ✅ |
| `/seek <position>` | Seek to a position in the current song. Accepts `mm:ss` (e.g. `1:30`) or seconds (e.g. `90`). | ✅ |
| `/q` | Show the full music queue — currently playing song at the top, then up to 10 upcoming songs with durations and who queued them. | ❌ |
| `/np` | Show the currently playing song as a clickable link with its duration and requester. | ❌ |
| `/kufur` | Reply with a random Turkish swear word. | ❌ |

The bot automatically disconnects from the voice channel after 3 minutes of inactivity.

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
GUILD_ID=your_server_id
```

- **DISCORD_TOKEN** — Bot token from the [Discord Developer Portal](https://discord.com/developers/applications)
- **CLIENT_ID** — Application ID, found on the General Information page of your app
- **GUILD_ID** — Your server's ID. Right-click the server name in Discord → **Copy Server ID** (requires Developer Mode: Settings → Advanced → Developer Mode)

### Age-restricted videos

If a video requires sign-in, set this optional variable to let yt-dlp borrow your browser's YouTube session:

```env
YTDLP_COOKIES_BROWSER=firefox
```

Supported values: `firefox`, `chrome`, `chromium`, `brave`, `edge`, `safari`

## Usage

```bash
bun run dev
```
