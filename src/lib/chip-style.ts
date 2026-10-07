import type { CSSProperties } from "react";

/**
 * Inline style for a "tinted chip": a project/tag/team colour used as a
 * faint background with text in the same hue.
 *
 * The text used to be the raw colour on a 14% tint of itself, which across
 * `dotColors` measured as low as 2.39:1 in light mode and 3.07:1 in dark —
 * under WCAG AA's 4.5:1 for normal text. Mixing the text 60/40 towards the
 * theme's own foreground keeps the hue but pulls it darker in light mode and
 * lighter in dark, giving at least 4.99:1 for every palette colour in both
 * themes. `var(--foreground)` flips with the theme, so one style covers both.
 */
export function tintedChipStyle(color: string): CSSProperties {
  return {
    backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
    color: `color-mix(in oklab, ${color} 60%, var(--foreground))`,
  };
}
