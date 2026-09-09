ALTER TABLE audit_plans ADD COLUMN IF NOT EXISTS approval_status varchar(20) NOT NULL DEFAULT 'pending';
ALTER TABLE audit_plans ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE audit_plans ADD COLUMN IF NOT EXISTS criteria_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE audit_plans ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES users(id);
ALTER TABLE audit_plans ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id);
ALTER TABLE audit_plans ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE audit_plans ADD COLUMN IF NOT EXISTS rejection_reason text;
CREATE TABLE IF NOT EXISTS plan_approval_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid NOT NULL REFERENCES audit_plans(id),
 revision integer NOT NULL, actor_id uuid REFERENCES users(id), event_type varchar(30) NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS area_user_memberships (
 area_id uuid NOT NULL REFERENCES areas(id), user_id uuid NOT NULL REFERENCES users(id), PRIMARY KEY(area_id,user_id)
);
INSERT INTO area_user_memberships SELECT id,owner_id FROM areas WHERE owner_id IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO area_user_memberships SELECT area_id,primary_auditor_id FROM audit_plans ON CONFLICT DO NOTHING;
INSERT INTO area_user_memberships SELECT area_id,backup_auditor_id FROM audit_plans WHERE backup_auditor_id IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO area_user_memberships SELECT area_id,assigned_owner_id FROM audit_plans WHERE assigned_owner_id IS NOT NULL ON CONFLICT DO NOTHING;
-- Preserve existing published plans without sending duplicate notifications.
UPDATE audit_plans p SET approval_status=CASE WHEN p.published THEN 'approved' ELSE 'pending' END,
 assigned_owner_id=COALESCE(p.assigned_owner_id,a.owner_id),
 criteria_snapshot=COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'step',c.step,'description',c.description,'weight',c.weight,'version_id',c.version_id) ORDER BY c.created_at) FROM criteria c WHERE c.area_id=p.area_id AND c.audit_period=to_char(p.audit_date,'YYYY-MM') AND c.approval_status='approved'),'[]'::jsonb)
 FROM areas a WHERE a.id=p.area_id;
UPDATE users SET full_name=replace(replace(replace(full_name,'Müdürlük Yöneticisi','Ünite Sorumlusu'),'Müdürlüğü Yöneticisi','Ünite Sorumlusu'),'Yöneticisi','Ünite Sorumlusu') WHERE role='area_admin';
