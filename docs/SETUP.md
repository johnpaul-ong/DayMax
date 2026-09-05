# Setup — exact steps (10–15 minutes)

You need to do four things once. Everything else is built.

## 1. Install and run the app

Open Terminal:

```bash
cd ~/Code/daymax
npm install
```

(If `npm` isn't found, install Node from https://nodejs.org — the LTS button.)

## 2. Create the Supabase project

1. Go to https://supabase.com → sign in → **New project**.
2. Name: `daymax`. Pick the region closest to you (Sydney). Set a strong database password (save it somewhere).
3. Wait ~2 minutes for it to provision.
4. Left sidebar → **SQL Editor** → **New query** → paste the entire contents of `supabase/migrations/0001_init.sql` → **Run**. It should say "Success".
5. Left sidebar → **Authentication → Sign In / Up** (or Providers) → make sure **Email** is enabled. For instant testing, turn OFF "Confirm email" (you can turn it back on before inviting friends).

## 3. Connect the app to Supabase

1. Supabase dashboard → **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key.
3. In `~/Code/daymax`, duplicate `.env.local.example`, rename the copy to `.env.local`, and paste both values in.

## 4. Run it

```bash
npm run dev
```

Open http://localhost:3000 → **Sign up** tab → create your account → you're in. Go to **Import** and upload your real workbook from Desktop.

## Verify everything works

```bash
npm test        # parser + ranking unit tests, should all pass
npm run build   # production build, should complete without errors
```

## Push to GitHub (private)

```bash
cd ~/Code/daymax
git remote add origin https://github.com/YOUR_USERNAME/daymax.git   # after creating a PRIVATE repo named daymax on github.com
git push -u origin main
```

Double-check on github.com that no `.xlsx` other than `fixtures/sample_workbook.xlsx` and no `.env.local` appears.

## Later: deploy to Vercel (so your phone can reach it)

1. https://vercel.com → sign in with GitHub → **Add New Project** → import `daymax`.
2. Add the two environment variables from `.env.local`.
3. Deploy. Then in Supabase → Authentication → URL Configuration, set the Site URL to your Vercel URL (so magic links redirect correctly).
