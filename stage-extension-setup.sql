create table if not exists public."StageExtensionRequests" (
    request_id text primary key,
    stage_id text not null,
    proj_id text not null,
    contractor_id text not null,
    requested_days integer not null check (requested_days > 0),
    reason text not null,
    status text not null default 'Pending',
    requested_date date not null default current_date
);
