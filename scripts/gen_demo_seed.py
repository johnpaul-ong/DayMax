#!/usr/bin/env python3
"""Generates supabase/seed/demo_marvel.sql — the Avengers demo universe.
Regenerate with:  python3 scripts/gen_demo_seed.py
Every statement is self-contained (no temp tables) so it works in the
Supabase SQL editor even when statements run in separate sessions.
"""
import random, datetime

random.seed(616)

START = datetime.date(2026, 1, 1)
END = datetime.date(2026, 9, 4)

USERS = {
    "bruce": ("11111111-1111-4111-8111-111111111101", "bruce@demo.daymax.app", "Bruce Banner"),
    "tony": ("11111111-1111-4111-8111-111111111102", "tony@demo.daymax.app", "Tony Stark"),
    "thor": ("11111111-1111-4111-8111-111111111103", "thor@demo.daymax.app", "Thor Odinson"),
    "steve": ("11111111-1111-4111-8111-111111111104", "steve@demo.daymax.app", "Steve Rogers"),
    "natasha": ("11111111-1111-4111-8111-111111111105", "natasha@demo.daymax.app", "Natasha Romanoff"),
}
TRACK_ID = "22222222-2222-4222-8222-222222222201"

def esc(s):
    return s.replace("'", "''")

def fill(p, h1, m1, h2, m2, cat):
    a, b = h1 * 4 + m1 // 15, h2 * 4 + m2 // 15
    for s in range(a, min(b, 96)):
        p[s] = str(cat)

def bruce_day(hulk, posthulk):
    p = ["0"] * 96
    if hulk:
        fill(p, 0, 0, 6, 0, 0); fill(p, 6, 0, 9, 0, 1)
        fill(p, 9, 0, 23, 45, 6); fill(p, 23, 0, 23, 45, 4)
        return p
    if posthulk:
        fill(p, 0, 0, 11, 0, 0); fill(p, 11, 0, 12, 0, 7); fill(p, 12, 0, 18, 0, 9)
        fill(p, 18, 0, 20, 0, 5); fill(p, 20, 0, 23, 45, 0)
        return p
    fill(p, 0, 0, 7, 0, 0); fill(p, 7, 0, 7, 30, 5); fill(p, 7, 30, 8, 0, 7)
    fill(p, 8, 0, 12, 30, 1); fill(p, 12, 30, 13, 0, 7); fill(p, 13, 0, 18, 30, 1)
    fill(p, 18, 30, 19, 30, 2); fill(p, 19, 30, 20, 0, 7)
    fill(p, 20, 0, 21, 30, 9); fill(p, 21, 30, 22, 0, 5); fill(p, 22, 0, 23, 45, 0)
    return p

def tony_day(r):
    p = ["0"] * 96
    late = r.random() < 0.5
    fill(p, 0, 0, 4, 0, 0) if late else fill(p, 0, 0, 6, 0, 0)
    if late:
        fill(p, 4, 0, 6, 0, 1)
    fill(p, 6, 0, 6, 30, 7); fill(p, 6, 30, 12, 30, 1)
    fill(p, 12, 30, 13, 0, 7); fill(p, 13, 0, 19, 0, 1)
    if r.random() < 0.35:
        fill(p, 19, 0, 23, 45, 3)
    elif r.random() < 0.5:
        fill(p, 19, 0, 22, 0, 9); fill(p, 22, 0, 23, 45, 6)
    else:
        fill(p, 19, 0, 20, 0, 2); fill(p, 20, 0, 23, 45, 1)
    return p

def thor_day(r, lokiweek):
    p = ["0"] * 96
    fill(p, 0, 0, 8, 0, 0); fill(p, 8, 0, 10, 0, 7)
    if lokiweek:
        fill(p, 10, 0, 16, 0, 6); fill(p, 16, 0, 20, 0, 3); fill(p, 20, 0, 23, 45, 6)
        return p
    fill(p, 10, 0, 14, 0, 2); fill(p, 14, 0, 15, 30, 7); fill(p, 15, 30, 18, 0, 2)
    fill(p, 18, 0, 22, 0, 3); fill(p, 22, 0, 23, 45, 7)
    return p

def steve_day(r):
    p = ["0"] * 96
    fill(p, 0, 0, 5, 0, 0); fill(p, 5, 0, 7, 0, 2)
    fill(p, 7, 0, 7, 30, 7); fill(p, 7, 30, 12, 0, 1)
    fill(p, 12, 0, 12, 30, 7); fill(p, 12, 30, 17, 0, 1)
    fill(p, 17, 0, 18, 30, 2); fill(p, 18, 30, 19, 0, 7)
    fill(p, 19, 0, 20, 30, 3 if r.random() < 0.4 else 8)
    fill(p, 20, 30, 21, 30, 9); fill(p, 21, 30, 23, 45, 0)
    return p

def nat_day(r):
    p = ["0"] * 96
    fill(p, 0, 0, 6, 0, 0); fill(p, 6, 0, 8, 0, 2)
    fill(p, 8, 0, 8, 30, 7); fill(p, 8, 30, 13, 0, 1)
    fill(p, 13, 0, 13, 30, 7); fill(p, 13, 30, 18, 0, 1)
    if r.random() < 0.15:
        fill(p, 18, 0, 23, 45, 4)
    else:
        fill(p, 18, 0, 19, 30, 2); fill(p, 19, 30, 20, 0, 7)
        fill(p, 20, 0, 21, 0, 9); fill(p, 21, 0, 23, 45, 0)
    return p

hulk_days = set()
d = START
while d <= END:
    r = random.Random(f"hulk{d.month}")
    for day in sorted(r.sample(range(1, 26), r.randint(2, 3))):
        hd = datetime.date(2026, d.month, day)
        if START <= hd <= END:
            hulk_days.add(hd)
    d = (d.replace(day=1) + datetime.timedelta(days=32)).replace(day=1)
posthulk_days = {h + datetime.timedelta(days=1) for h in hulk_days}
loki_weeks = {(2026, 14), (2026, 27)}

NOTES = {
    "bruce_hulk": ["Woke up 40 miles away. No pants. Again.", "Insurance premiums going up.", "Note to self: avoid traffic jams.", "The other guy leg-pressed a building."],
    "bruce_post": ["Everything hurts. Ate 14 eggs.", "Found my glasses in a tree.", "Apologised to the city council."],
    "bruce_norm": ["Quiet day. Kept the heart rate under 120.", "Gamma readings stable. So am I.", "Jazz and green tea. Lots of green tea."],
    "tony": ["Genius, billionaire, tracked my day in 15-minute slots.", "JARVIS logged this for me. Obviously.", "Told the board it was strategic leisure.", "Built a new suit instead of sleeping. Worth it."],
    "thor": ["A GLORIOUS DAY OF TRAINING AND FEASTING!", "The hammer felt light today. As always.", "Midgardian burritos are a worthy feast.", "Another flagon! ANOTHER!"],
    "thor_loki": ["Brother trouble. Again.", "I am NOT crying. It is Asgardian rain."],
    "steve": ["I can do this all day.", "Good day. Helped Mrs. Nussbaum with her groceries.", "Early to bed, early to rise.", "Ran past Sam 23 times. On your left."],
    "nat": ["\u2588\u2588\u2588\u2588 \u2588\u2588\u2588.", "Handled it.", "Budapest could never.", "Cleaned the ledger a little more."],
}

patterns, day_metrics, daily_metrics = [], [], []
for key, (uid_, email, name) in USERS.items():
    d = START
    while d <= END:
        r = random.Random(f"{key}{d}")
        iso = d.isocalendar()
        if key == "bruce":
            hulk, post = d in hulk_days, d in posthulk_days
            p = bruce_day(hulk, post)
            emo = 0 if hulk else (4 if post else round(r.uniform(6, 8) * 2) / 2)
            tired = 9 if post else round(r.uniform(3, 6))
            note = r.choice(NOTES["bruce_hulk"]) if hulk else (r.choice(NOTES["bruce_post"]) if post else (r.choice(NOTES["bruce_norm"]) if r.random() < 0.3 else None))
            weight = 640 if hulk else round(r.uniform(69, 72), 1)
        elif key == "tony":
            p = tony_day(r); emo = round(r.uniform(7, 9.5) * 2) / 2; tired = round(r.uniform(4, 8))
            note = r.choice(NOTES["tony"]) if r.random() < 0.25 else None
            weight = round(r.uniform(77, 79), 1)
        elif key == "thor":
            loki = (iso[0], iso[1]) in loki_weeks
            p = thor_day(r, loki); emo = 2.5 if loki else round(r.uniform(8, 10) * 2) / 2; tired = 2
            note = (r.choice(NOTES["thor_loki"]) if loki else r.choice(NOTES["thor"])) if r.random() < 0.35 else None
            weight = round(r.uniform(288, 292), 1)
        elif key == "steve":
            p = steve_day(r); emo = 8; tired = round(r.uniform(2, 4))
            note = r.choice(NOTES["steve"]) if r.random() < 0.25 else None
            weight = round(r.uniform(108, 110), 1)
        else:
            p = nat_day(r); emo = round(r.uniform(6, 8) * 2) / 2; tired = round(r.uniform(3, 6))
            note = r.choice(NOTES["nat"]) if r.random() < 0.2 else None
            weight = round(r.uniform(59, 61), 1)
        if key != "steve" and r.random() < 0.06:
            d += datetime.timedelta(days=1)
            continue
        patterns.append((uid_, d.isoformat(), "".join(p)))
        day_metrics.append((uid_, d.isoformat(), emo, tired, note))
        if r.random() < 0.8:
            daily_metrics.append((uid_, d.isoformat(), weight))
        d += datetime.timedelta(days=1)

lifts = []
for key, (uid_, email, name) in USERS.items():
    d, i = START, 0
    while d <= END:
        r = random.Random(f"lift{key}{d}")
        if key == "bruce":
            if d in hulk_days:
                lifts.append((uid_, d.isoformat(), "Deadlift", 50000 + r.randint(0, 9000), "1", "HULK STRONGEST THERE IS"))
            elif d.weekday() in (1, 4):
                lifts.append((uid_, d.isoformat(), "Bench", round(92 + min(18, i * 0.25), 1), "5", "keeping it calm"))
        elif key == "tony":
            if d.weekday() == 2:
                lifts.append((uid_, d.isoformat(), "Suit-Assisted Deadlift", 500 + i, "3", "the suit did most of it"))
            if d.weekday() == 5:
                lifts.append((uid_, d.isoformat(), "Bench", round(78 + min(12, i * 0.15), 1), "8", None))
        elif key == "thor":
            if d.weekday() in (0, 2, 4):
                lifts.append((uid_, d.isoformat(), "Mjolnir Curls", 1000, "12", "still worthy"))
                if r.random() < 0.5:
                    lifts.append((uid_, d.isoformat(), "Deadlift", 800 + r.randint(-20, 20), "5", "warm-up"))
        elif key == "steve":
            if d.weekday() in (0, 3):
                lifts.append((uid_, d.isoformat(), "Bench", round(200 + i * 0.45, 1), "5", "I can do this all day"))
            if d.weekday() == 5:
                lifts.append((uid_, d.isoformat(), "Squat", round(240 + i * 0.5, 1), "5", None))
        else:
            if d.weekday() in (1, 4):
                lifts.append((uid_, d.isoformat(), "Pull Ups", 20, str(15 + int(i * 0.15)), None))
                lifts.append((uid_, d.isoformat(), "Squat", round(85 + i * 0.2, 1), "5", None))
        i += 1
        d += datetime.timedelta(days=1)

goals = [
    (USERS["bruce"][0], "Bench", 115, "kg"),
    (USERS["tony"][0], "Suit-Assisted Deadlift", 1000, "kg"),
    (USERS["thor"][0], "Deadlift", 1000, "kg"),
    (USERS["steve"][0], "Bench", 280, "kg"),
    (USERS["natasha"][0], "Pull Ups", 60, "reps"),
]

LABEL_CASE = """
       case substr(p.pattern, s.slot + 1, 1)
         when '1' then (case p.user_id
            when '{bruce}' then (array['gamma research','lab work','avoiding stress'])[1 + (s.slot % 3)]
            when '{tony}' then (array['suit R&D','arc reactor v52','avoiding board meetings'])[1 + (s.slot % 3)]
            when '{thor}' then 'royal duties'
            when '{steve}' then (array['helping old ladies','shield duty','motivational posters'])[1 + (s.slot % 3)]
            else '\u2588\u2588\u2588\u2588 classified' end)
         when '2' then (case p.user_id
            when '{bruce}' then 'calming yoga'
            when '{tony}' then 'suit cardio'
            when '{thor}' then 'hammer training'
            when '{steve}' then 'on your left'
            else 'sparring' end)
         when '6' then (case p.user_id
            when '{bruce}' then 'SMASH'
            when '{tony}' then 'lab youtube spiral'
            when '{thor}' then 'moping about Loki'
            else 'doomscrolling' end)
         when '3' then (case p.user_id when '{thor}' then 'tavern' when '{tony}' then 'gala' else 'friends' end)
         when '4' then (case p.user_id when '{bruce}' then 'fleeing the scene' else 'travel' end)
         when '7' then (case p.user_id when '{thor}' then 'FEAST' else null end)
         else null
       end""".replace("{bruce}", USERS["bruce"][0]).replace("{tony}", USERS["tony"][0]).replace("{thor}", USERS["thor"][0]).replace("{steve}", USERS["steve"][0])

out = []
out.append("-- DayMax demo seed (GENERATED by scripts/gen_demo_seed.py - do not hand-edit).")
out.append("-- Run AFTER migrations 0001-0008. Safe to re-run: wipes previous demo data first.")
out.append("-- Every statement is self-contained; no temp tables.\n")
ids = "','".join(u[0] for u in USERS.values())
out.append("delete from public.tracks where is_demo;")
out.append(f"delete from auth.users where id in ('{ids}');\n")
for uid_, email, name in USERS.values():
    out.append(
        f"insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at) values ('{uid_}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','{email}', now(), now(), now());"
    )
out.append("")
BDAY = {"bruce": "1985-12-18", "tony": "1978-05-29", "thor": "1982-08-11", "steve": "1990-07-04", "natasha": "1988-11-22"}
for k, (uid_, email, name) in USERS.items():
    out.append(
        f"update public.profiles set display_name='{esc(name)}', is_demo=true, birth_date='{BDAY[k]}', country='United States', profile_sections='[\"ranking\",\"hours\",\"lifts\"]'::jsonb where id='{uid_}';"
    )
out.append("")
out.append(f"insert into public.tracks (id, owner_id, kind, name, is_demo) values ('{TRACK_ID}','{USERS['tony'][0]}','day','Avengers Assemble', true);")
for k, (uid_, email, name) in USERS.items():
    if k == "tony":
        out.append(f"update public.track_members set share_rule='raw_labels' where track_id='{TRACK_ID}' and user_id='{uid_}';")
    else:
        out.append(f"insert into public.track_members (track_id, user_id, role, share_rule) values ('{TRACK_ID}','{uid_}','member','raw_labels');")
out.append("")
out.append("-- day entries: each statement carries its own pattern rows (self-contained)")
CHUNK = 150
prows = [f"('{u}','{d}','{p}')" for u, d, p in patterns]
for i in range(0, len(prows), CHUNK):
    out.append("with p(user_id, date, pattern) as (values")
    out.append(",\n".join(prows[i : i + CHUNK]))
    out.append(")")
    out.append("insert into public.day_entries (user_id, date, slot, category, label)")
    out.append("select p.user_id::uuid, p.date::date, s.slot::smallint, substr(p.pattern, s.slot + 1, 1)::smallint,")
    out.append(LABEL_CASE)
    out.append("from p cross join (select generate_series(0, 95) as slot) s;")
    out.append("")
def emit_values(table_cols, rows, chunk=300):
    for i in range(0, len(rows), chunk):
        out.append(f"insert into {table_cols} values")
        out.append(",\n".join(rows[i : i + chunk]) + ";")
emit_values(
    "public.day_metrics (user_id, date, emotional_score, tired, notes)",
    [f"('{u}','{d}',{e},{t},{'null' if n is None else chr(39) + esc(n) + chr(39)})" for u, d, e, t, n in day_metrics],
)
emit_values(
    "public.daily_metrics (user_id, date, metric, value)",
    [f"('{u}','{d}','bodyweight_kg',{w})" for u, d, w in daily_metrics],
)
emit_values(
    "public.lift_entries (user_id, date, exercise, weight_kg, reps, notes)",
    [f"('{u}','{d}','{esc(ex)}',{w},'{esc(rp)}',{'null' if n is None else chr(39) + esc(n) + chr(39)})" for u, d, ex, w, rp, n in lifts],
)
emit_values(
    "public.lift_goals (user_id, exercise, target_weight_kg, unit)",
    [f"('{u}','{esc(ex)}',{t},'{unit}')" for u, ex, t, unit in goals],
)
out.append("\n-- bring the legends up to today and keep them living (needs migration 0008)")
out.append("select public.demo_fill_to_today();")

sql = "\n".join(out)
import io, pathlib
pathlib.Path(__file__).resolve().parent.parent.joinpath("supabase/seed/demo_marvel.sql").write_text(sql)
print(f"patterns={len(patterns)} lifts={len(lifts)} hulk_days={len(hulk_days)} size={len(sql)//1024}KB")
code = "\n".join(l for l in sql.splitlines() if not l.strip().startswith("--"))
assert code.count("(") == code.count(")"), "paren mismatch"
assert code.count("'") % 2 == 0, "quote mismatch"
print("SQL sanity OK")
