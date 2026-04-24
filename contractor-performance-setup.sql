alter table public.users
    add column if not exists performance_score integer default 100;

alter table public.users
    add column if not exists is_blacklisted boolean default false;

alter table public."Project"
    add column if not exists assigned_contractor_id text;

alter table public."Stage Tracking"
    add column if not exists contractor_id text;
