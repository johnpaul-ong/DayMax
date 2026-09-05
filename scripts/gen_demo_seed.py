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
    "bruce": ("11111111-1111-4111-8111-111111111101", "hulk@demo.daymax.app", "Bruce Banner"),
    "tony": ("11111111-1111-4111-8111-111111111102", "tony@demo.daymax.app", "Tony Stark"),
    "thor": ("11111111-1111-4111-8111-111111111103", "thor@demo.daymax.app", "Thor Odinson"),
    "steve": ("11111111-1111-4111-8111-111111111104", "captainamerica@demo.daymax.app", "Steve Rogers"),
    "natasha": ("11111111-1111-4111-8111-111111111105", "blackwidow@demo.daymax.app", "Natasha Romanoff"),
}
TRACK_ID = "22222222-2222-4222-8222-222222222201"

def esc(s):
    return s.replace("'", "''")

def fill(p, h1, m1, h2, m2, cat):
    a, b = h1 * 4 + m1 // 15, h2 * 4 + m2 // 15
    for s in range(a, min(b, 96)):
        p[s] = str(cat)

def q(p, t1, t2, cat):
    """fill from hour-float t1 to t2 (quarter-hour resolution)"""
    a, b = int(round(t1 * 4)), int(round(t2 * 4))
    for s in range(max(0, a), min(b, 96)):
        p[s] = str(cat)

def bruce_day(r, hulk, posthulk):
    p = ["0"] * 96
    if hulk:
        calm_until = 6 + r.uniform(0, 4)
        q(p, 0, 6, 0); q(p, 6, calm_until, 1)
        q(p, calm_until, 23.5 - r.uniform(0, 2), 6); q(p, 23.5, 24, 4)
        return p
    if posthulk:
        wake = 10 + r.uniform(0, 2)
        q(p, 0, wake, 0); q(p, wake, wake + 1, 7); q(p, wake + 1, 18 + r.uniform(-1, 1), 9)
        q(p, 18, 20, 5); q(p, 20, 24, 0)
        return p
    wake = 6.5 + r.uniform(0, 1.5)
    lunch = 12.5 + r.uniform(0, 1)
    workend = 17 + r.uniform(0, 2.5)
    q(p, 0, wake, 0); q(p, wake, wake + 0.5, 5); q(p, wake + 0.5, wake + 1, 7)
    q(p, wake + 1, lunch, 1); q(p, lunch, lunch + 0.5, 7); q(p, lunch + 0.5, workend, 1)
    t = workend
    if r.random() < 0.7:
        q(p, t, t + 1 + r.uniform(0, 0.75), 2); t += 1 + r.uniform(0, 0.75)
    q(p, t, t + 0.5, 7); t += 0.5
    q(p, t, t + 1 + r.uniform(0, 1.5), 9)
    bed = 21.5 + r.uniform(0, 1.5)
    q(p, bed, 24, 0)
    return p

def tony_day(r):
    p = ["0"] * 96
    if r.random() < 0.08:  # all-nighter
        q(p, 0, 3, 1); q(p, 3, 8, 0); q(p, 8, 8.5, 7)
        q(p, 8.5, 13, 1); q(p, 13, 13.5, 7); q(p, 13.5, 19 + r.uniform(0, 2), 1)
        q(p, 21, 24, 3)
        return p
    sleep_until = 5 + r.uniform(0, 2.5)
    q(p, 0, sleep_until, 0)
    q(p, sleep_until, sleep_until + 0.5, 7)
    lunch = 12 + r.uniform(0, 1.5)
    q(p, sleep_until + 0.5, lunch, 1)
    q(p, lunch, lunch + 0.5, 7)
    workend = 17.5 + r.uniform(0, 2.5)
    q(p, lunch + 0.5, workend, 1)
    roll = r.random()
    if roll < 0.30:
        q(p, workend, min(24, workend + 4 + r.uniform(0, 2)), 3)      # gala / party
    elif roll < 0.37:
        q(p, workend, workend + 1.5, 6)                                # rare: one youtube video, honest
        q(p, workend + 1.5, 24, 0)
    elif roll < 0.65:
        q(p, workend, workend + 2, 3); q(p, workend + 2, 24, 0)        # dinner with Pepper
    else:
        q(p, workend, min(23.5, workend + 3 + r.uniform(0, 2)), 1)     # back to the lab
    return p

def thor_day(r, lokiweek):
    p = ["0"] * 96
    wake = 7.5 + r.uniform(0, 1.5)
    q(p, 0, wake, 0)
    if lokiweek:
        q(p, wake, wake + 2, 7)
        q(p, wake + 2, 16 + r.uniform(-1, 1), 6); q(p, 16, 20, 3); q(p, 20, 23 + r.uniform(0, 1), 6)
        return p
    roll = r.random()
    if roll < 0.40:   # glorious training day
        q(p, wake, wake + 1.5, 7)
        t = wake + 1.5
        train = 3 + r.uniform(0, 2.5)
        q(p, t, t + train, 2); t += train
        q(p, t, t + 1.5, 7); t += 1.5
        q(p, t, min(22, t + 1.5), 2)
        q(p, 22, 24, 3)
    elif roll < 0.72: # feast & tavern day
        q(p, wake, wake + 2.5, 7)
        q(p, wake + 2.5, wake + 3.5, 2)
        q(p, wake + 3.5, 17, 3); q(p, 17, 18.5 + r.uniform(0, 1.5), 6)
        q(p, 19, 20, 7); q(p, 20, 23, 3); q(p, 23, 24, 9)
    elif roll < 0.87: # quest (mostly travel + a little smiting)
        q(p, wake, wake + 1, 7); q(p, wake + 1, 15 + r.uniform(0, 2), 4)
        q(p, 17, 19 + r.uniform(0, 1), 2); q(p, 20, 22, 7); q(p, 22, 24, 3)
    else:            # napping like Odin
        q(p, wake, wake + 1.5, 7); q(p, wake + 1.5, 14 + r.uniform(0, 2), 0)
        q(p, 15, 19, 6); q(p, 19, 21, 7); q(p, 21, 24, 9)
    return p

def steve_day(r):
    p = ["0"] * 96
    wake = 4.75 + r.uniform(0, 0.5)
    run = 1.5 + r.uniform(0, 1)
    q(p, 0, wake, 0); q(p, wake, wake + run, 2)
    q(p, wake + run, wake + run + 0.5, 7)
    lunch = 12 + r.uniform(0, 0.5)
    q(p, wake + run + 0.5, lunch, 1); q(p, lunch, lunch + 0.5, 7)
    workend = 16.5 + r.uniform(0, 1.5)
    q(p, lunch + 0.5, workend, 1)
    q(p, workend, workend + 1 + r.uniform(0, 0.75), 2)
    t = workend + 2
    q(p, t, t + 0.5, 7)
    q(p, t + 0.5, t + 2, 3 if r.random() < 0.4 else 8)
    q(p, t + 2, t + 2.75, 9)
    q(p, 21 + r.uniform(0, 1), 24, 0)
    return p

def nat_day(r):
    p = ["0"] * 96
    wake = 5.5 + r.uniform(0, 1.5)
    q(p, 0, wake, 0)
    if r.random() < 0.18:  # mission day
        q(p, wake, wake + 0.5, 7); q(p, wake + 0.5, wake + 3 + r.uniform(0, 2), 4)
        q(p, wake + 4, 20 + r.uniform(0, 2), 1); q(p, 22, 24, 0)
        return p
    spar = 1.5 + r.uniform(0, 1)
    q(p, wake, wake + spar, 2); q(p, wake + spar, wake + spar + 0.5, 7)
    lunch = 13 + r.uniform(0, 0.5)
    q(p, wake + spar + 0.5, lunch, 1); q(p, lunch, lunch + 0.5, 7)
    workend = 17 + r.uniform(0, 2)
    q(p, lunch + 0.5, workend, 1)
    if r.random() < 0.3:
        q(p, workend, workend + 1.5, 3)
    q(p, workend + 1.5, workend + 2.5, 9)
    q(p, 21.5 + r.uniform(0, 1), 24, 0)
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
            p = bruce_day(r, hulk, post)
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
            p = steve_day(r)
            if r.random() < 0.05:
                emo = 5.5
                note = "Thought about Peggy."
            else:
                emo = round(r.uniform(7, 9.5) * 2) / 2
                note = r.choice(NOTES["steve"]) if r.random() < 0.25 else None
            tired = round(r.uniform(2, 5))
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

class Lift:
    """Wave loading + deloads + bad days + PR attempts + plateaus + noise."""
    def __init__(self, base, drift, sigma, lo=None):
        self.base, self.drift, self.sigma = base, drift, sigma
        self.lo = lo or base * 0.8
        self.plateau = 0
    def session(self, r, week):
        if self.plateau > 0:
            self.plateau -= 1
        else:
            self.base += self.drift + r.gauss(0, self.sigma)
            if r.random() < 0.06:
                self.plateau = r.randint(6, 14)  # stuck for weeks, like a real human
        self.base = max(self.lo, self.base)
        note = None
        if week % 5 == 4:
            w = self.base * 0.87
            note = "deload week"
        else:
            w = self.base * (0.92 + 0.03 * (week % 4))  # wave loading
            if r.random() < 0.10:
                w *= 0.94
                note = r.choice(["not feeling it today", "slept badly", "long day, low energy"])
            elif r.random() < 0.07:
                w = self.base * 1.05
                if r.random() < 0.55:
                    note = "PR attempt - GOT IT"
                    self.base *= 1.015
                else:
                    note = "PR attempt - failed, next time"
                    w *= 0.94
        return round(w / 2.5) * 2.5, note

def reps_for(r):
    return str(r.choice([3, 4, 5, 5, 5, 6, 8]))

# one persistent RNG for progression walks: per-day seeded generators
# produce anti-correlated draws and the walk never goes anywhere
lift_rng = random.Random(909)

state = {
    "bruce": {"Bench": Lift(88, 0.12, 1.8)},
    "tony": {"Suit-Assisted Deadlift": Lift(480, 1.6, 14), "Bench": Lift(76, 0.08, 1.5)},
    "thor": {"Deadlift": Lift(810, 0.0, 9, lo=700)},
    "steve": {"Bench": Lift(198, 0.28, 1.2), "Squat": Lift(238, 0.32, 1.6)},
    "natasha": {"Squat": Lift(84, 0.18, 2.0)},
}
nat_pullups = 15.0
nat_pu_weight = 20.0

for key, (uid_, email, name) in USERS.items():
    d, i = START, 0
    while d <= END:
        r = random.Random(f"lift{key}{d}")
        week = i // 7
        skip = r.random() < 0.12  # everyone misses sessions sometimes
        if key == "bruce":
            if d in hulk_days:
                lifts.append((uid_, d.isoformat(), "Deadlift", 50000 + r.randint(0, 9000), "1", "HULK STRONGEST THERE IS"))
            elif d.weekday() in (1, 4) and not skip:
                w, note = state["bruce"]["Bench"].session(lift_rng, week)
                if (d - datetime.timedelta(days=1)) in hulk_days or (d - datetime.timedelta(days=2)) in hulk_days:
                    w = round(w * 1.12 / 2.5) * 2.5
                    note = "residual gamma. not asking questions"
                lifts.append((uid_, d.isoformat(), "Bench", w, reps_for(r), note or "keeping the HR down"))
        elif key == "tony":
            if d.weekday() == 2 and not skip:
                w, note = state["tony"]["Suit-Assisted Deadlift"].session(lift_rng, week)
                lifts.append((uid_, d.isoformat(), "Suit-Assisted Deadlift", w, "3", note or "the suit did most of it"))
            if d.weekday() == 5 and r.random() > 0.25:
                w, note = state["tony"]["Bench"].session(lift_rng, week)
                lifts.append((uid_, d.isoformat(), "Bench", w, reps_for(r), note))
        elif key == "thor":
            if d.weekday() in (0, 2, 4) and not skip:
                curls = 1000 if r.random() > 0.06 else 1200
                lifts.append((uid_, d.isoformat(), "Mjolnir Curls", curls, str(r.choice([8, 10, 12, 15, 20])),
                              "FELT EXTRA WORTHY" if curls == 1200 else r.choice(["still worthy", "the hammer approves", "light as a feather"])))
                if r.random() < 0.5:
                    w, note = state["thor"]["Deadlift"].session(lift_rng, week)
                    lifts.append((uid_, d.isoformat(), "Deadlift", w, reps_for(r), note or "warm-up"))
        elif key == "steve":
            if d.weekday() in (0, 3) and not (r.random() < 0.03):  # he almost never misses
                w, note = state["steve"]["Bench"].session(lift_rng, week)
                lifts.append((uid_, d.isoformat(), "Bench", w, reps_for(r), note or "I can do this all day"))
            if d.weekday() == 5 and not (r.random() < 0.03):
                w, note = state["steve"]["Squat"].session(lift_rng, week)
                lifts.append((uid_, d.isoformat(), "Squat", w, reps_for(r), note))
        else:
            if d.weekday() in (1, 4) and not skip:
                nat_pullups = max(10, nat_pullups + lift_rng.gauss(0.12, 0.7))
                nat_pu_weight = min(35, max(10, nat_pu_weight + lift_rng.gauss(0.06, 1.4)))
                lifts.append((uid_, d.isoformat(), "Pull Ups", round(nat_pu_weight / 2.5) * 2.5, str(int(nat_pullups)), None))
                w, note = state["natasha"]["Squat"].session(lift_rng, week)
                lifts.append((uid_, d.isoformat(), "Squat", w, reps_for(r), note))
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
            when '{thor}' then 'Midgardian television'
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
