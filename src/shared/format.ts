import type { PermissionResolvable, PermissionsBitField } from "discord.js";

/**
 * Parses a seek position given as `hh:mm:ss`, `mm:ss`, or a raw second count.
 * Returns -1 for unparseable input.
 */
export function parseSeekPosition(input: string): number {
  if (input.includes(":")) {
    const parts = input.split(":").map(Number);
    if (parts.length === 3)
      return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
    if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  }
  const n = parseInt(input, 10);
  return isNaN(n) ? -1 : n;
}

/** Renders a bulleted list capped at `maxItems`, truncated to Discord's field limit. */
export function formatBulletedList(items: string[], maxItems = 20): string {
  const shown = items.slice(0, maxItems).map((name) => `• ${name}`);
  if (items.length > maxItems) {
    shown.push(`• ...and ${items.length - maxItems} more`);
  }
  return shown.join("\n").slice(0, 1024);
}

/** Renders a single ✅/❌ permission line for the `/perms` report. */
export function permissionLine(
  permissions: Readonly<PermissionsBitField> | null | undefined,
  permission: PermissionResolvable,
  label: string,
): string {
  return `${permissions?.has(permission) ? "✅" : "❌"} \`${label}\``;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
