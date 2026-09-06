"use client";

/**
 * A name wearing its team colour.
 *
 * Deliberately understated: a 2px left edge and an ~8% tint, not a coloured
 * pill with a label. You should be able to read a leaderboard and take in the
 * numbers first, with team allegiance as peripheral information you notice on
 * the second pass. Anything louder and every list turns into a flag parade.
 */

import Link from "next/link";
import { teamMeta } from "@/lib/teams";

export function TeamDot({ team, className = "" }: { team: string; className?: string }) {
  const t = teamMeta(team);
  return (
    <span
      title={`Team ${t.label}`}
      aria-label={`Team ${t.label}`}
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${className}`}
      style={{ background: t.color }}
    />
  );
}

export function TeamName({
  name,
  team,
  href,
  className = "",
}: {
  name: string;
  team: string;
  href?: string;
  className?: string;
}) {
  const t = teamMeta(team);
  const inner = (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate">{name}</span>
      <TeamDot team={team} />
    </span>
  );
  return href ? (
    <Link href={href} title={`Team ${t.label}`} className={`min-w-0 hover:text-accent hover:underline ${className}`}>
      {inner}
    </Link>
  ) : (
    <span title={`Team ${t.label}`} className={`min-w-0 ${className}`}>
      {inner}
    </span>
  );
}

/** Row wrapper that carries the team colour on its left edge. */
export function teamRowStyle(team: string): React.CSSProperties {
  const c = teamMeta(team).color;
  return { boxShadow: `inset 2px 0 0 ${c}` };
}
