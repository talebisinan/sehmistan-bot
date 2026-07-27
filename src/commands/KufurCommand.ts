import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { CommandContext, SlashCommand } from "../core/SlashCommand";

/** `/kufur` — reply with a random Turkish swear (and TTS it to the channel). */
export class KufurCommand implements SlashCommand {
  /** Obfuscated only to keep the source listing readable, not for security. */
  private static readonly ENCODED_SWEARS =
    "WyJzaWt0aXIiLCJhbWsiLCLFn2FrbGFiYW4uIiwiw6dlbnRpaydpbiBoYXPEsSBraW15b25sYSwgcMSxdHTEscSfxLFuIGhhc8SxIG1pbnlvbmRlIG9sdXIuIiwic2VuaSBtw7xqZGVsZXllbiBsZXlsZWtsZXJpbiB5b2wgaGFyaXRhc8SxbsSxIHNpa2V5aW0iLCJvw6ciLCJrYWhwZSIsImfDtnR2ZXJlbiIsInlhcnJhayBrYWZhbMSxIiwic2VuaSB0b3JuYSB0ZXpnYWhpbmRhIHNpa2VyaW0iLCJpdCBvxJ9sdSBpdCIsImFsbGFoIGNhbsSxbcSxIGFsc2EgZGEgw7ZsbcO8xZ9sZXJpbmkgc2lrc2VtLiIsImvDvHJ0YWpkYW4gc2HEnyDDp8Sxa23EscWfIG9yb3NwdSDDp29jdcSfdSIsImXFn2VrIGhlcmlmIiwib2UiLCJvw6ciLCJhbmFuxLEga8SxeW1hIG1ha2luZXNpbmUgYXRhciwgeWFyxLFzxLFuxLEga8SxeWFyLCB5YXLEsXPEsW7EsSBzaWtpcCBhdGFyxLFtLiIsIkFsaWsgT8OHIiwiQmlyIGRhaGEgeWF6ZMSxxJ/EsW7EsSBnw7ZyZW0sIGJhY8SxbsSxIHNpa2VtIiwiZGFsbGFtYSIsImXFn8Wfb8SfdWx1ZcWfxZ9layIsIllhcnJhayIsIlRhxZ/Fn2FrIiwiT3Jvc3B1bnVuIGbEsXJsYXR0xLHEn8SxIiwiWcSxcnTEsWsgYW3EsW4gZmVyeWFkxLEiXQ==";

  readonly data = new SlashCommandBuilder()
    .setName("kufur")
    .setDescription("Rastgele bir Türkçe küfür söyler");

  async execute({ interaction }: CommandContext): Promise<void> {
    const swears = this.loadSwears();
    const word = swears[Math.floor(Math.random() * swears.length)] ?? "...";

    await interaction.reply({ content: word, flags: MessageFlags.Ephemeral });

    const channel = interaction.channel;
    if (channel?.isTextBased() && !channel.isThread() && "send" in channel) {
      await channel.send({ content: word, tts: true });
    }
  }

  private loadSwears(): string[] {
    return JSON.parse(
      Buffer.from(KufurCommand.ENCODED_SWEARS, "base64").toString("utf-8"),
    );
  }
}
