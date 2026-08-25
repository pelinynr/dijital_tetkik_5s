INSERT INTO users (email, password_hash, full_name, role)
VALUES
  ('admin@erdemir.com.tr', 'DEMO_ONLY_REPLACE_WITH_BCRYPT_HASH', 'Sistem Yöneticisi', 'admin'),
  ('tetkikci@erdemir.com.tr', 'DEMO_ONLY_REPLACE_WITH_BCRYPT_HASH', 'Demo Tetkikçi', 'auditor'),
  ('sorumlu@erdemir.com.tr', 'DEMO_ONLY_REPLACE_WITH_BCRYPT_HASH', 'Sıcak Haddehane Alan Yöneticisi', 'area_owner'),
  ('sorumlu2@erdemir.com.tr', 'DEMO_ONLY_REPLACE_WITH_BCRYPT_HASH', 'Çelikhane Alan Yöneticisi', 'area_owner')
ON CONFLICT (email) DO NOTHING;

INSERT INTO users (email, password_hash, full_name, role) VALUES
  ('pelin.yener@erdemir.com.tr', 'DEMO_ONLY_REPLACE_WITH_BCRYPT_HASH', 'Pelin Yener', 'area_owner'),
  ('nazar.uludag@erdemir.com.tr', 'DEMO_ONLY_REPLACE_WITH_BCRYPT_HASH', 'Nazar Uludağ', 'area_owner'),
  ('ceyda.ankara@erdemir.com.tr', 'DEMO_ONLY_REPLACE_WITH_BCRYPT_HASH', 'Ceyda Ankara', 'area_owner'),
  ('ozan.turkekul@erdemir.com.tr', 'DEMO_ONLY_REPLACE_WITH_BCRYPT_HASH', 'Ozan Türkekul', 'area_owner'),
  ('hayati.can.aydin@erdemir.com.tr', 'DEMO_ONLY_REPLACE_WITH_BCRYPT_HASH', 'Hayati Can Aydın', 'area_owner'),
  ('ozcan.kesici@erdemir.com.tr', 'DEMO_ONLY_REPLACE_WITH_BCRYPT_HASH', 'Özcan Kesici', 'area_owner')
ON CONFLICT (email) DO NOTHING;

INSERT INTO areas (area_code, name, owner_id)
SELECT 'A-01', 'Sıcak Haddehane', id FROM users WHERE email = 'sorumlu@erdemir.com.tr'
ON CONFLICT (area_code) DO NOTHING;

INSERT INTO areas (area_code, name, owner_id)
SELECT 'A-02', 'Çelikhane', id FROM users WHERE email = 'sorumlu2@erdemir.com.tr'
ON CONFLICT (area_code) DO NOTHING;

INSERT INTO areas (area_code, name) VALUES
  ('CELIK-MD', 'Çelikhane Müdürlüğü'),
  ('YF-MD', 'Yüksek Fırın Müdürlüğü'),
  ('SH-MD', 'Sıcak Haddehane Müdürlüğü'),
  ('SGH-MD', 'Soğuk Haddehaneler Müdürlüğü'),
  ('KOK-FAB', 'Kok Fabrikası Müdürlüğü'),
  ('OKS-FAB', 'Oksijen Fabrikası'),
  ('SINTER-FAB', 'Sinter Fabrikası'),
  ('KIREC-FAB', 'Kireç Fabrikası')
ON CONFLICT (area_code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO criterion_versions (version_no, published, published_at, created_by)
SELECT 'v1.0', true, now(), id FROM users WHERE email = 'admin@erdemir.com.tr'
ON CONFLICT (version_no) DO NOTHING;

INSERT INTO criteria (version_id, area_id, step, description, weight)
SELECT v.id, a.id, x.step, x.description, x.weight
FROM criterion_versions v
JOIN areas a ON a.area_code = 'A-01'
CROSS JOIN (VALUES
  ('Ayıklama', 'Gereksiz malzemeler çalışma alanından uzaklaştırılmıştır.', 20),
  ('Düzenleme', 'Malzemelerin tanımlı yerleri ve işaretlemeleri vardır.', 20),
  ('Temizlik', 'Zemin, makine ve ekipmanlar temizdir.', 20),
  ('Standartlaştırma', '5S standartları ve kontrol listeleri günceldir.', 20),
  ('Disiplin', 'Tanımlı 5S kuralları uygulanmaktadır.', 20)
) AS x(step, description, weight)
WHERE v.version_no = 'v1.0'
  AND NOT EXISTS (SELECT 1 FROM criteria c WHERE c.version_id = v.id AND c.area_id = a.id);

INSERT INTO audit_plans (period, audit_date, area_id, primary_auditor_id, published)
SELECT '2026-08', CURRENT_DATE, a.id, u.id, true
FROM areas a
JOIN users u ON u.email = 'tetkikci@erdemir.com.tr'
WHERE a.area_code = 'A-01'
ON CONFLICT (period, area_id) DO NOTHING;
