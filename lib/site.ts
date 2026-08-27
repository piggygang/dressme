export const SITE = {
  name: "Piggy Dress Me",
  tagline: "Dress your piggy for any occasion.",
} as const;

export type Social = {
  label: string;
  href: string;
  /** Key into ICONS in components/site-footer.tsx */
  icon: "x" | "discord" | "github";
};

/** Kept in sync with the footer links in ../website (lib/site.ts). */
export const SOCIALS: Social[] = [
  { label: "X", href: "https://x.com/PiggySolGang", icon: "x" },
  { label: "Discord", href: "https://discord.gg/8SjGR8Srvz", icon: "discord" },
  { label: "GitHub", href: "https://github.com/piggygang", icon: "github" },
];
