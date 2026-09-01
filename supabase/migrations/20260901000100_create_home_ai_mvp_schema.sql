-- HOME AI MVP - Core relational schema.
-- This migration is intentionally not coupled to the current static frontend.

create type public.app_role as enum ('customer', 'provider', 'admin');
create type public.account_status as enum ('active', 'suspended', 'disabled');
create type public.kyc_status as enum ('pending', 'verified', 'rejected');
create type public.mission_status as enum (
  'requested',
  'searching',
  'offered',
  'accepted',
  'travelling',
  'arrived',
  'quote_pending',
  'in_progress',
  'supplement_pending',
  'completed_pending_payment',
  'completed',
  'cancelled',
  'expired'
);
create type public.offer_status as enum ('pending', 'accepted', 'declined', 'expired');
create type public.quote_type as enum ('initial', 'supplement');
create type public.quote_status as enum ('pending', 'supplement_pending', 'accepted', 'declined', 'rejected');
create type public.quote_item_type as enum ('labor', 'part', 'service');
create type public.notification_status as enum ('pending', 'processing', 'sent', 'failed', 'cancelled');

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'customer',
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  phone text,
  avatar_url text,
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_phone_e164 check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$')
);

create unique index profiles_phone_unique_idx on public.profiles (phone) where phone is not null;
create index profiles_role_status_idx on public.profiles (role, status);

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (user_id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 80),
  address_text text not null check (char_length(trim(address_text)) between 1 and 500),
  latitude double precision,
  longitude double precision,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_addresses_coordinates_pair check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  )
);

create unique index customer_addresses_one_default_idx
  on public.customer_addresses (customer_id)
  where is_default;
create index customer_addresses_customer_idx on public.customer_addresses (customer_id, created_at desc);

create table public.provider_profiles (
  provider_id uuid primary key references public.profiles (user_id) on delete cascade,
  kyc_status public.kyc_status not null default 'pending',
  specialty text not null check (char_length(trim(specialty)) between 1 and 160),
  experience_years smallint not null default 0 check (experience_years between 0 and 80),
  service_radius_km numeric(6, 2) not null default 10 check (service_radius_km > 0 and service_radius_km <= 200),
  rating_average numeric(3, 2) not null default 0 check (rating_average between 0 and 5),
  review_count integer not null default 0 check (review_count >= 0),
  completed_jobs integer not null default 0 check (completed_jobs >= 0),
  reliability_score numeric(5, 2) not null default 0 check (reliability_score between 0 and 100),
  description text,
  languages text[] not null default array['vi']::text[],
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index provider_profiles_eligibility_idx
  on public.provider_profiles (active, kyc_status, rating_average desc);

create table public.provider_services (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_profiles (provider_id) on delete cascade,
  service_category text not null check (char_length(trim(service_category)) between 1 and 80),
  base_price bigint check (base_price is null or base_price >= 0),
  currency char(3) not null default 'VND' check (currency = upper(currency)),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, service_category)
);

create index provider_services_matching_idx
  on public.provider_services (service_category, enabled, provider_id);

-- current_mission_id is added after missions to avoid a circular creation dependency.
create table public.provider_status (
  provider_id uuid primary key references public.provider_profiles (provider_id) on delete cascade,
  online boolean not null default false,
  available boolean not null default false,
  current_mission_id uuid,
  last_latitude double precision,
  last_longitude double precision,
  last_location_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint provider_status_coordinates_pair check (
    (last_latitude is null and last_longitude is null)
    or (last_latitude between -90 and 90 and last_longitude between -180 and 180)
  ),
  constraint provider_status_location_timestamp check (
    (last_latitude is null and last_longitude is null and last_location_at is null)
    or (last_latitude is not null and last_longitude is not null and last_location_at is not null)
  ),
  constraint provider_status_availability_requires_online check (not available or online)
);

create index provider_status_matching_idx
  on public.provider_status (online, available, last_location_at desc);

create table public.missions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (user_id) on delete restrict,
  provider_id uuid references public.provider_profiles (provider_id) on delete restrict,
  service_category text not null check (char_length(trim(service_category)) between 1 and 80),
  problem_description text not null check (char_length(trim(problem_description)) between 1 and 2000),
  diagnostic_summary text,
  address_id uuid references public.customer_addresses (id) on delete set null,
  address_text text not null check (char_length(trim(address_text)) between 1 and 500),
  client_latitude double precision not null check (client_latitude between -90 and 90),
  client_longitude double precision not null check (client_longitude between -180 and 180),
  status public.mission_status not null default 'requested',
  version integer not null default 1 check (version > 0),
  final_authorized_amount bigint check (final_authorized_amount is null or final_authorized_amount >= 0),
  currency char(3) not null default 'VND' check (currency = upper(currency)),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid_external')),
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  travelling_at timestamptz,
  arrived_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint missions_provider_required_after_acceptance check (
    status in ('requested', 'searching', 'offered', 'cancelled', 'expired')
    or provider_id is not null
  )
);

create index missions_client_history_idx on public.missions (client_id, created_at desc);
create index missions_provider_work_idx on public.missions (provider_id, status, created_at desc);
create index missions_dispatch_idx on public.missions (status, service_category, requested_at);

alter table public.provider_status
  add constraint provider_status_current_mission_fk
  foreign key (current_mission_id) references public.missions (id) on delete set null;

create unique index provider_status_one_current_mission_idx
  on public.provider_status (current_mission_id)
  where current_mission_id is not null;

create table public.mission_offers (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  provider_id uuid not null references public.provider_profiles (provider_id) on delete cascade,
  status public.offer_status not null default 'pending',
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mission_id, provider_id),
  constraint mission_offers_expiry_after_offer check (expires_at > offered_at),
  constraint mission_offers_response_consistency check (
    (status = 'pending' and responded_at is null)
    or (status <> 'pending' and responded_at is not null)
  )
);

create unique index mission_offers_one_accepted_idx
  on public.mission_offers (mission_id)
  where status = 'accepted';
create index mission_offers_provider_pending_idx
  on public.mission_offers (provider_id, status, expires_at);

create table public.mission_events (
  id bigint generated always as identity primary key,
  mission_id uuid not null references public.missions (id) on delete cascade,
  event_type text not null check (char_length(trim(event_type)) between 1 and 120),
  actor_user_id uuid references public.profiles (user_id) on delete set null,
  actor_role public.app_role,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);

create index mission_events_mission_timeline_idx
  on public.mission_events (mission_id, created_at, id);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  version integer not null check (version > 0),
  parent_quote_id uuid,
  type public.quote_type not null,
  status public.quote_status not null,
  diagnosis text not null check (char_length(trim(diagnosis)) between 1 and 4000),
  total_amount bigint not null check (total_amount >= 0),
  currency char(3) not null default 'VND' check (currency = upper(currency)),
  warranty_days integer not null default 0 check (warranty_days between 0 and 3650),
  created_by uuid not null references public.profiles (user_id) on delete restrict,
  decided_by uuid references public.profiles (user_id) on delete restrict,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (mission_id, version),
  unique (id, mission_id),
  constraint quotes_parent_same_mission_fk
    foreign key (parent_quote_id, mission_id)
    references public.quotes (id, mission_id)
    on delete restrict,
  constraint quotes_type_version_parent check (
    (type = 'initial' and version = 1 and parent_quote_id is null)
    or (type = 'supplement' and version > 1 and parent_quote_id is not null)
  ),
  constraint quotes_status_by_type check (
    (type = 'initial' and status in ('pending', 'accepted', 'declined'))
    or (type = 'supplement' and status in ('supplement_pending', 'accepted', 'rejected'))
  ),
  constraint quotes_decision_consistency check (
    (status in ('pending', 'supplement_pending') and decided_by is null and decided_at is null)
    or (status in ('accepted', 'declined', 'rejected') and decided_by is not null and decided_at is not null)
  ),
  constraint quotes_not_self_parent check (parent_quote_id is null or parent_quote_id <> id)
);

create index quotes_mission_history_idx on public.quotes (mission_id, version);
create index quotes_pending_idx on public.quotes (mission_id, status);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  item_type public.quote_item_type not null,
  description text not null check (char_length(trim(description)) between 1 and 500),
  amount bigint not null check (amount >= 0),
  position smallint not null default 1 check (position > 0),
  created_at timestamptz not null default now(),
  unique (quote_id, position)
);

create index quote_items_quote_idx on public.quote_items (quote_id, position);

create table public.provider_locations (
  id bigint generated always as identity primary key,
  mission_id uuid not null references public.missions (id) on delete cascade,
  provider_id uuid not null references public.provider_profiles (provider_id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters numeric(8, 2) check (accuracy_meters is null or accuracy_meters >= 0),
  heading_degrees numeric(6, 2) check (heading_degrees is null or heading_degrees between 0 and 360),
  speed_kph numeric(7, 2) check (speed_kph is null or speed_kph >= 0),
  recorded_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index provider_locations_mission_time_idx
  on public.provider_locations (mission_id, recorded_at desc);
create index provider_locations_provider_time_idx
  on public.provider_locations (provider_id, recorded_at desc);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null unique references public.missions (id) on delete cascade,
  client_id uuid not null references public.profiles (user_id) on delete restrict,
  provider_id uuid not null references public.provider_profiles (provider_id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 2000),
  created_at timestamptz not null default now()
);

create index reviews_provider_time_idx on public.reviews (provider_id, created_at desc);

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  platform text not null check (platform in ('web', 'ios', 'android')),
  token text not null unique check (char_length(token) between 20 and 4096),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index device_tokens_user_active_idx on public.device_tokens (user_id, active);

create table public.notification_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  mission_id uuid references public.missions (id) on delete cascade,
  notification_type text not null check (char_length(trim(notification_type)) between 1 and 120),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status public.notification_status not null default 'pending',
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index notification_outbox_delivery_idx
  on public.notification_outbox (status, available_at, id)
  where status in ('pending', 'failed');
create index notification_outbox_user_idx
  on public.notification_outbox (user_id, created_at desc);

comment on table public.mission_events is 'Append-only audit log for mission state and business events.';
comment on table public.quotes is 'Immutable-after-acceptance versioned mission quotes.';
comment on table public.provider_locations is 'Persisted GPS snapshots; high-frequency movement should use Realtime Broadcast.';
comment on table public.notification_outbox is 'Server-owned transactional notification delivery queue.';
