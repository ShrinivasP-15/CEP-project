alter table if exists public."Project"
add column if not exists "Description" text;

alter table if exists public."Project"
add column if not exists "Location" text;

alter table if exists public."Project"
add column if not exists "Pincode" text;

alter table if exists public."Project"
add column if not exists "Budget" numeric;

alter table if exists public."Project"
add column if not exists "Created Date" date;

alter table if exists public."Project"
add column if not exists "Assigned officer" text;

alter table if exists public."Stage Tracking"
add column if not exists image_url text;

alter table if exists public."Stage Tracking"
add column if not exists proof_image_url text;

alter table if exists public."Stage Tracking"
add column if not exists completion_date date;
