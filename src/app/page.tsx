import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SignOutButton from "./signout-button";

export default async function HomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const today = new Date().toISOString().slice(0, 10);
  const [{ count: slotCount }, { count: liftCount }] = await Promise.all([
    supabase.from("day_entries").select("*", { count: "exact", head: true }).eq("date", today),
    supabase.from("lift_entries").select("*", { count: "exact", head: true }),
  ]);

  const cards = [
    { href: "/today", title: "Log today", desc: `${slotCount ?? 0}/96 slots filled today. Phone-friendly editor.` },
    { href: "/day", title: "Day grid", desc: "The Excel-like month grid. Fill ranges, copy yesterday." },
    { href: "/lifts", title: "Lifts", desc: `${liftCount ?? 0} lift entries logged. Log a set from the rack.` },
    { href: "/overview", title: "Overview", desc: "Productive vs brainrot ranking, graphs, raw data." },
    { href: "/import", title: "Import", desc: "Paste or upload your Excel workbook. Preview before saving." },
    { href: "/export", title: "Export", desc: "Download a month as an Excel grid that looks like yours." },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="text-sm text-slate-500">{user.email}</p>
        </div>
        <SignOutButton />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-xl border bg-white p-4 shadow-sm transition hover:shadow-md"
          >
            <h2 className="font-semibold">{c.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
