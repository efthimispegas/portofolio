-- PREPARATION ONLY: not applied to a live project. The application currently uses
-- a development-only SQLite adapter. Review this migration and implement the
-- production adapter and transition RPCs before deployment.
begin;
create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

create type public.provider_route as enum ('business','independent','household','employee','construction','occasional','other');
create type public.application_status as enum ('draft','submitted','needs_information','approved','rejected');

create table app_private.reviewers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table app_private.reviewers enable row level security;
-- No client insert/update/delete policies: provisioning is an operator action.
create function app_private.is_reviewer() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from app_private.reviewers where user_id = auth.uid()) $$;
revoke all on function app_private.is_reviewer() from public;
grant execute on function app_private.is_reviewer() to authenticated;

create table public.provider_applications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  route public.provider_route not null,
  status public.application_status not null default 'draft',
  -- Private bounded input including work evidence. Do not expose via public views.
  input jsonb not null check (jsonb_typeof(input)='object' and octet_length(input::text)<=24000),
  source_card_slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index provider_applications_owner on public.provider_applications(owner_id);
alter table public.provider_applications enable row level security;
create policy application_owner_read on public.provider_applications for select to authenticated using(owner_id=auth.uid());
create policy application_reviewer_read on public.provider_applications for select to authenticated using(app_private.is_reviewer() and status<>'draft');
-- Production submission/review must use a validated server transition. Client
-- insertion/editing is deliberately not enabled in this preparatory migration.

create table public.application_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.provider_applications(id),
  reviewer_id uuid not null references auth.users(id),
  decision text not null check(decision in('approve','request_information','reject')),
  reason text not null check(length(reason) between 10 and 1200),
  service_scope text not null default '' check(length(service_scope)<=600),
  checks jsonb not null,
  input_snapshot jsonb not null check(jsonb_typeof(input_snapshot)='object' and octet_length(input_snapshot::text)<=24000),
  created_at timestamptz not null default now(),
  check(decision<>'approve' or (length(service_scope)>=5 and checks @> '{"identity":true,"workBasis":true,"credentials":true,"representation":true}'))
);
alter table public.application_reviews enable row level security;
create policy review_owner_read on public.application_reviews for select to authenticated using(exists(select 1 from public.provider_applications a where a.id=application_id and a.owner_id=auth.uid()));
create policy review_reviewer_read on public.application_reviews for select to authenticated using(app_private.is_reviewer());

create table public.provider_cards (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check(slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  -- Explicit public fields only: no input/evidence JSON or tax identifiers.
  display_name text not null check(length(display_name) between 2 and 100),
  category text not null,
  area text not null check(length(area)<=100),
  description text not null check(length(description)<=1200),
  phone text not null check(length(phone)<=24),
  email text not null default '' check(length(email)<=254),
  website text not null default '' check(website='' or website ~ '^https://'),
  instagram_url text not null default '' check(length(instagram_url)<=300 and (instagram_url='' or instagram_url ~ '^https://')),
  facebook_url text not null default '' check(length(facebook_url)<=300 and (facebook_url='' or facebook_url ~ '^https://')),
  linkedin_url text not null default '' check(length(linkedin_url)<=300 and (linkedin_url='' or linkedin_url ~ '^https://')),
  route public.provider_route not null,
  service_scope text not null check(length(service_scope) between 5 and 600),
  verification_label text not null,
  published boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.provider_cards enable row level security;
create policy published_cards_read on public.provider_cards for select to anon,authenticated using(published=true);

-- Keep publication linkage private; avoid leaking application/owner identifiers.
create table app_private.card_publications (
  card_id uuid primary key references public.provider_cards(id),
  application_id uuid not null unique references public.provider_applications(id),
  review_id uuid not null references public.application_reviews(id)
);
alter table app_private.card_publications enable row level security;

revoke all on public.provider_applications,public.application_reviews,public.provider_cards from anon,authenticated;
grant select on public.provider_applications,public.application_reviews to authenticated;
grant select on public.provider_cards to anon,authenticated;
commit;
