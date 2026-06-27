const guildIds = (process.env.GUILD_IDS ?? process.env.GUILD_ID ?? "")
  .split(",")
  .map((guildId) => guildId.trim())
  .filter(Boolean);

export const config = {
  token: process.env.DISCORD_TOKEN!,
  clientId: process.env.CLIENT_ID!,
  guildIds,
};
