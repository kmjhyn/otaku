# Supabase Setup for OTAKU

This app can use Supabase as a tiny shared backend while keeping the current Python app code.

## 1. Create a Supabase project

Use the Free plan. As of Supabase's pricing page, Free includes 500 MB database, 50,000 monthly active users, and projects may pause after 1 week of inactivity.

## 2. Create the storage table

In Supabase Dashboard > SQL Editor, run:

```sql
create table if not exists public.otaku_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.otaku_state enable row level security;
```

No public policies are needed because the Python server uses the server-side service role key. Do not put the service role key in browser JavaScript.

## 3. Get the credentials

In Supabase Dashboard > Project Settings > API, copy:

- Project URL -> `SUPABASE_URL`
- service_role key -> `SUPABASE_SERVICE_ROLE_KEY`

The service role key is secret. Use it only as a server/deployment environment variable.

## 4. Run locally with Supabase

```bash
export SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="YOUR-SERVICE-ROLE-KEY"
python3 main.py
```

If those env vars are not set, the app keeps using `otaku_data.json`.

## 5. Migrate current local data to Supabase

Once the env vars are set, run:

```bash
python3 scripts/push_local_data_to_supabase.py
```

## 6. What URL do friends use?

Supabase is the database, not the page your friends open.

Your friends should open the URL from wherever the Python app is hosted, for example:

- Render: `https://your-app-name.onrender.com`
- Railway/Fly/etc: their public app URL

GitHub stores the code. Supabase stores shared data. A host like Render serves the actual web app.
