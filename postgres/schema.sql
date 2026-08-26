CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'area_admin', 'auditor', 'area_owner');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE audit_status AS ENUM ('draft', 'in_progress', 'completed', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE criterion_status AS ENUM ('pending', 'conforming', 'nonconforming');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE nonconformity_status AS ENUM ('open', 'waiting_approval', 'closed', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(255) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name varchar(160) NOT NULL,
  role user_role NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES areas(id) ON DELETE SET NULL,
  area_code varchar(40) NOT NULL UNIQUE,
  name varchar(180) NOT NULL,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  qr_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS criterion_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_no varchar(30) NOT NULL UNIQUE,
  published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES criterion_versions(id) ON DELETE RESTRICT,
  area_id uuid REFERENCES areas(id) ON DELETE CASCADE,
  step varchar(80) NOT NULL,
  description text NOT NULL,
  weight numeric(5,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
  active boolean NOT NULL DEFAULT true,
  approval_status varchar(20) NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft', 'approved')),
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  audit_period varchar(7),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period varchar(30) NOT NULL,
  audit_date date NOT NULL,
  area_id uuid NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
  primary_auditor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  backup_auditor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period, area_id)
);

CREATE TABLE IF NOT EXISTS audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_no varchar(40) NOT NULL UNIQUE,
  plan_id uuid REFERENCES audit_plans(id) ON DELETE SET NULL,
  area_id uuid NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  criteria_version_id uuid NOT NULL REFERENCES criterion_versions(id) ON DELETE RESTRICT,
  status audit_status NOT NULL DEFAULT 'draft',
  score numeric(5,2) NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  criterion_id uuid NOT NULL REFERENCES criteria(id) ON DELETE RESTRICT,
  status criterion_status NOT NULL DEFAULT 'pending',
  note text,
  earned_score numeric(5,2) NOT NULL DEFAULT 0 CHECK (earned_score >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_id, criterion_id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  audit_result_id uuid REFERENCES audit_results(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  filename text NOT NULL,
  content_type varchar(120) NOT NULL,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nonconformities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_result_id uuid NOT NULL UNIQUE REFERENCES audit_results(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  status nonconformity_status NOT NULL DEFAULT 'open',
  resolution text,
  due_date date,
  resolved_at timestamptz,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS corrective_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  area_id uuid NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  criterion_key varchar(80) NOT NULL,
  criterion_text text NOT NULL,
  finding text,
  status varchar(30) NOT NULL DEFAULT 'open',
  due_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  resolution_text text,
  resolution_photo_url text,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_id, criterion_key)
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(180) NOT NULL,
  message text NOT NULL,
  target varchar(40) NOT NULL DEFAULT 'dashboard',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type varchar(80) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_areas_owner ON areas(owner_id);
CREATE INDEX IF NOT EXISTS idx_criteria_area_version ON criteria(area_id, version_id);
CREATE INDEX IF NOT EXISTS idx_audit_plans_auditor_date ON audit_plans(primary_auditor_id, audit_date);
CREATE INDEX IF NOT EXISTS idx_audits_owner_updated ON audits(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_audits_area_status ON audits(area_id, status);
CREATE INDEX IF NOT EXISTS idx_results_audit_status ON audit_results(audit_id, status);
CREATE INDEX IF NOT EXISTS idx_evidence_audit_result ON evidence(audit_id, audit_result_id);
CREATE INDEX IF NOT EXISTS idx_nonconformities_assignee_status ON nonconformities(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_workflow_audit_created ON workflow_events(audit_id, created_at);
