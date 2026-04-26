-- 0008_ocr_jobs.sql
-- Async OCR job queue.
-- RLS: users read/insert only their own jobs; service role handles updates.

create type ocr_job_status as enum ('queued', 'processing', 'completed', 'failed');

create table ocr_jobs (
  id            uuid             primary key default gen_random_uuid(),
  user_id       uuid             not null references auth.users(id) on delete cascade,
  status        ocr_job_status   not null default 'queued',
  image_url     text             not null,
  result        jsonb,
  error_code    text,
  attempt_count int              not null default 0,
  created_at    timestamptz      not null default now(),
  started_at    timestamptz,
  completed_at  timestamptz
);

create index ocr_jobs_status_idx   on ocr_jobs (status) where status = 'queued';
create index ocr_jobs_user_id_idx  on ocr_jobs (user_id);

alter table ocr_jobs enable row level security;

-- Users read only their own jobs
create policy "ocr_jobs_select_own"
  on ocr_jobs for select
  using (auth.uid() = user_id);

-- Users create their own job records (route handler inserts on their behalf)
create policy "ocr_jobs_insert_own"
  on ocr_jobs for insert
  with check (auth.uid() = user_id);
