# DayMax — System Map

Six diagrams describing how DayMax works end to end: browser, Vercel, Supabase, the repo's internals, data flow, auth, privacy enforcement, and the demo/deploy pipeline.

> Mermaid diagrams — GitHub renders these automatically. Any AI can read the source or re-render it. The interactive version is `docs/SYSTEM_MAP.html`.

## 1. The big picture

Who talks to whom. The browser does almost all the work; Vercel serves the app; Supabase holds the data and enforces every rule.

```mermaid
flowchart LR
  subgraph You["Your devices"]
    desktop["Desktop browser<br/>(Month grid, Import, Overview)"]
    phone["Phone browser<br/>(Today, Lifts, Arena)"]
  end
  subgraph GitHub["GitHub (private repo)"]
    repo["daymax repo<br/>main branch"]
  end
  subgraph Vercel["Vercel"]
    build["Build: npm run build<br/>(Next.js compile + type check)"]
    edge["Hosting + middleware<br/>daymax-xxxx.vercel.app"]
  end
  subgraph Supabase["Supabase"]
    auth["Auth<br/>(email+password, magic links)"]
    pg[("Postgres<br/>RLS on every table")]
    cron["pg_cron<br/>(demo ticks)"]
  end
  dev["You + Claude<br/>writing code"] -->|git push| repo
  repo -->|auto-deploy| build --> edge
  desktop & phone -->|HTTPS| edge
  desktop & phone -->|"supabase-js<br/>(anon key + user JWT)"| pg
  desktop & phone -->|sign in / sign up| auth
  auth -->|JWT session cookie| edge
  cron -->|every 2h + nightly| pg
```

## 2. Repo anatomy — script to script

Pages are thin; all logic lives in src/lib. Pure logic (parsers, stats) has no dependencies so it's unit-testable.

```mermaid
flowchart TD
  subgraph pages["src/app (pages)"]
    home["/ Home<br/>score cards, life-in-weeks"]
    month["/day Month grid"]
    year["/year Year heatmap + strips"]
    today["/today Phone editor"]
    lifts["/lifts Log + goals + progression"]
    metricspg["/metrics Edit day metrics"]
    overview["/overview Custom analytics"]
    friendspg["/friends Tracks, invites, compare"]
    profile["/friends/[id] Profiles"]
    arena["/arena + /arena/compare"]
    importpg["/import"]
    exportpg["/export"]
    settings["/settings"]
    join["/join/[token]"]
    signin["/signin + /auth/callback"]
  end
  subgraph lib["src/lib (logic)"]
    data["data.ts<br/>my data CRUD (paged)"]
    friends["friends.ts<br/>tracks/invites/compare via RPC (rpcAll)"]
    ranking["ranking.ts<br/>buckets, focus score"]
    stats["stats.ts<br/>Pearson r, period aggregation"]
    parsers["gridParse / liftParse / sheet2Parse<br/>(pure, unit-tested)"]
    xlsxio["xlsxIO.ts<br/>SheetJS in browser only"]
    lifelib["life.ts<br/>life expectancy math"]
    themelib["theme.ts<br/>themes, bucket colours (localStorage)"]
    supa["supabase/client.ts + server.ts<br/>+ middleware.ts (session)"]
  end
  home & overview & arena --> ranking & stats
  month & today & year --> data
  lifts & metricspg --> data
  importpg & exportpg --> xlsxio --> parsers
  friendspg & profile & arena & join --> friends
  home & settings --> lifelib
  pages --> themelib
  data & friends --> supa
```

## 3. How your data gets in and out

Two ways in, one home, Excel round-trip out. Nothing is saved from an import without the preview step.

```mermaid
flowchart LR
  excel["Your workbook<br/>(month grids, Sheet4, Sheet2)"]
  ai["ChatGPT/Claude<br/>DayMax JSON (docs/DATA_CONTRACT.md)"]
  manual["Manual logging<br/>grid / phone / lifts form"]
  parse["Browser: SheetJS -> matrices<br/>-> parsers -> entries + warnings"]
  preview{"Import preview<br/>counts, conflicts,<br/>unparseable cells"}
  db[("day_entries (96/day)<br/>day_metrics · lift_entries<br/>daily_metrics")]
  views["Home · Month · Year · Overview<br/>Metrics · Lifts · Arena"]
  export["Export: month .xlsx<br/>that looks like the original"]
  excel --> parse
  ai -->|JSON upload| preview
  parse --> preview
  preview -->|you confirm| db
  manual -->|saved instantly| db
  db --> views
  db --> export
```

## 4. Auth — sign up to session

```mermaid
sequenceDiagram
  participant B as Browser
  participant V as Vercel (middleware)
  participant S as Supabase Auth
  participant P as Postgres
  B->>S: Sign up (email + password)
  S-->>B: Confirmation email (link to Site URL)
  Note over S: trigger handle_new_user()<br/>creates profiles row
  B->>S: Click link / sign in
  S-->>B: JWT session (cookie)
  B->>V: GET any page
  V->>S: refresh session (middleware)
  alt no session
    V-->>B: redirect /signin?next=...
  else session ok
    V-->>B: page
    B->>P: queries with JWT
    Note over P: RLS: user_id = auth.uid()<br/>on every table
  end
```

## 5. Friends & Compare — where privacy is enforced

The client never reads another user's tables (RLS makes it impossible). Everything social flows through SQL functions that check membership and share rules inside the database.

```mermaid
flowchart TD
  owner["Track owner"] -->|"create track"| tracks[("tracks")]
  tracks -->|trigger| members[("track_members<br/>share_rule: hidden /<br/>totals_only / raw_labels")]
  owner -->|"mint link"| invites[("invites<br/>token, 14-day expiry")]
  friend["Friend clicks /join/token"] --> accept["accept_invite()<br/>checks expiry, email lock,<br/>minor -> guardian_ack"]
  accept --> members
  subgraph funcs["SECURITY DEFINER functions (the only door)"]
    cdt["compare_day_totals<br/>bucket totals only"]
    clf["compare_lifts<br/>no notes"]
    strip["member_day_strip<br/>only raw_labels or demo"]
    mprof["member_profile<br/>name, @username, sections"]
    lb["leaderboard_day_totals + lifts<br/>demo + co-members, hidden excluded"]
  end
  members -.->|"share_rule checked<br/>inside each function"| funcs
  funcs --> ui["Compare · Profiles · Arena ·<br/>Side by side"]
  x["Direct query on someone<br/>else's day_entries"] -->|"blocked by RLS"| deny(("denied"))
```

## 6. The demo universe & deploy pipeline

```mermaid
flowchart LR
  subgraph demo["Avengers (is_demo)"]
    gen["scripts/gen_demo_seed.py<br/>characters, lift engine,<br/>Hulk days"] -->|generates| seed["seed/demo_marvel.sql"]
    seed -->|"paste in SQL editor"| ddata[("demo users + year of data<br/>+ Avengers Assemble track")]
    tick1["pg_cron nightly 00:05<br/>demo_fill_to_today()"] --> ddata
    tick2["pg_cron every 2h<br/>demo_intraday_tick()<br/>(today fills in live)"] --> ddata
    ddata -->|"readable by every user<br/>(writes still locked)"| arena2["Arena + demo profiles"]
  end
  subgraph deploy["Ship it"]
    code["Code change"] -->|git commit| main["main branch"]
    main -->|git push| gh["GitHub"]
    gh -->|webhook| vb["Vercel build<br/>+ env vars NEXT_PUBLIC_SUPABASE_*"]
    vb -->|green| live["Live at daymax-xxxx.vercel.app"]
    mig["supabase/migrations/0001-0011<br/>(run once each, in order)"] -->|SQL editor| sdb[("Supabase Postgres")]
    live --- sdb
  end
```
