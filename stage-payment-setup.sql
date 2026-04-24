alter table if exists "Stage Tracking"
    add column if not exists stage_amount numeric default 0;

alter table if exists "Stage Tracking"
    add column if not exists proof_image_url text;

alter table if exists "Stage Tracking"
    add column if not exists payment_status text default 'Pending';

alter table if exists "Stage Tracking"
    add column if not exists payment_date date;

alter table if exists "Stage Tracking"
    add column if not exists completion_date date;
