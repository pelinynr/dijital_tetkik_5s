import "dotenv/config";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import pg from "pg";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 4000);
const jwtSecret = process.env.JWT_SECRET || "local-development-change-me";
const uploadDir = path.resolve("uploads");
await mkdir(uploadDir, { recursive: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL backend/.env dosyasında tanımlanmalıdır.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const upload = multer({ dest: uploadDir, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (_r, f, cb) => cb(null, f.mimetype.startsWith("image/")) });

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "http://localhost:3000" }));
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(uploadDir));

async function ensureCompatibility() {
  await pool.query("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'area_admin'");
  await pool.query("ALTER TABLE areas ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES users(id) ON DELETE SET NULL");
  await pool.query("ALTER TABLE audits ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb");
  await pool.query("ALTER TABLE criteria ADD COLUMN IF NOT EXISTS approval_status varchar(20) NOT NULL DEFAULT 'draft'");
  await pool.query("ALTER TABLE criteria ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id) ON DELETE SET NULL");
  await pool.query("ALTER TABLE criteria ADD COLUMN IF NOT EXISTS approved_at timestamptz");
  await pool.query("ALTER TABLE criteria ADD COLUMN IF NOT EXISTS audit_period varchar(7)");
  await pool.query(`CREATE TABLE IF NOT EXISTS corrective_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    area_id uuid NOT NULL REFERENCES areas(id) ON DELETE CASCADE, criterion_key varchar(80) NOT NULL,
    criterion_text text NOT NULL, finding text, status varchar(30) NOT NULL DEFAULT 'open',
    due_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'), resolution_text text,
    resolution_photo_url text, resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
    resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(audit_id,criterion_key)
  )`);
  await pool.query("ALTER TABLE corrective_tasks ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES users(id) ON DELETE SET NULL");
  await pool.query("ALTER TABLE corrective_tasks ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id) ON DELETE SET NULL");
  await pool.query("ALTER TABLE corrective_tasks ADD COLUMN IF NOT EXISTS approved_at timestamptz");
  await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title varchar(180) NOT NULL, message text NOT NULL, target varchar(40) NOT NULL DEFAULT 'dashboard',
    read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query("UPDATE criteria SET approval_status='approved' WHERE active=true AND approval_status='draft'");
  const demoPassword = process.env.DEMO_PASSWORD || "12345678";
  const hash = await bcrypt.hash(demoPassword, 12);
  await pool.query("UPDATE users SET password_hash=$1 WHERE password_hash='DEMO_ONLY_REPLACE_WITH_BCRYPT_HASH'", [hash]);
  await pool.query("INSERT INTO users(email,password_hash,full_name,role) VALUES('sorumlu2@erdemir.com.tr',$1,'Çelikhane Alan Yöneticisi','area_owner') ON CONFLICT(email) DO NOTHING",[hash]);
  await pool.query("INSERT INTO areas(area_code,name,owner_id) SELECT 'A-02','Çelikhane',id FROM users WHERE email='sorumlu2@erdemir.com.tr' ON CONFLICT(area_code) DO NOTHING");
  const people=[['pelin.yener@erdemir.com.tr','Pelin Yener'],['nazar.uludag@erdemir.com.tr','Nazar Uludağ'],['ceyda.ankara@erdemir.com.tr','Ceyda Ankara'],['ozan.turkekul@erdemir.com.tr','Ozan Türkekul'],['hayati.can.aydin@erdemir.com.tr','Hayati Can Aydın'],['ozcan.kesici@erdemir.com.tr','Özcan Kesici']];
  for(const [email,name] of people) await pool.query("INSERT INTO users(email,password_hash,full_name,role) VALUES($1,$2,$3,'area_owner') ON CONFLICT(email) DO UPDATE SET full_name=EXCLUDED.full_name",[email,hash,name]);
  const auditors=[['asli.kara@erdemir.com.tr','Aslı Kara'],['yigithan.yucesan@erdemir.com.tr','Yiğithan Yücesan'],['gulsum.kucuk@erdemir.com.tr','Gülsüm Küçük'],['poyraz.zengi@erdemir.com.tr','Poyraz Zengi'],['atakan.gunduz@erdemir.com.tr','Atakan Gündüz'],['nuray.ocal@erdemir.com.tr','Nuray Öcal'],['burak.eruz@erdemir.com.tr','Burak Eruz'],['koray.sezgin@erdemir.com.tr','Koray Sezgin']];
  for(const [email,name] of auditors) await pool.query("INSERT INTO users(email,password_hash,full_name,role) VALUES($1,$2,$3,'auditor') ON CONFLICT(email) DO UPDATE SET full_name=EXCLUDED.full_name",[email,hash,name]);
  await pool.query("INSERT INTO areas(area_code,name) VALUES('ERP-OFIS','Ofis'),('ERP-MUDUR','Müdür Odası') ON CONFLICT(area_code) DO NOTHING");
  const factoryAreas=[['CELIK-MD','Çelikhane Müdürlüğü'],['YF-MD','Yüksek Fırın Müdürlüğü'],['SH-MD','Sıcak Haddehane Müdürlüğü'],['SGH-MD','Soğuk Haddehaneler Müdürlüğü'],['KOK-FAB','Kok Fabrikası Müdürlüğü'],['OKS-FAB','Oksijen Fabrikası'],['SINTER-FAB','Sinter Fabrikası'],['KIREC-FAB','Kireç Fabrikası']];
  for(const [code,name] of factoryAreas) await pool.query("INSERT INTO areas(area_code,name) VALUES($1,$2) ON CONFLICT(area_code) DO UPDATE SET name=EXCLUDED.name",[code,name]);
  for(const [code,name] of factoryAreas){const slug=code.toLowerCase();const accounts=[[`${slug}-tetkikci@erdemir.com.tr`,`${name} Tetkikçisi`,'auditor'],[`${slug}-sorumlu@erdemir.com.tr`,`${name} Alan Sorumlusu`,'area_owner'],[`${slug}-yonetici@erdemir.com.tr`,`${name} Yöneticisi`,'area_admin']];for(const[email,fullName,role]of accounts)await pool.query("INSERT INTO users(email,password_hash,full_name,role) VALUES($1,$2,$3,$4::user_role) ON CONFLICT(email) DO UPDATE SET full_name=EXCLUDED.full_name,role=EXCLUDED.role",[email,hash,fullName,role]);await pool.query(`UPDATE areas SET owner_id=(SELECT id FROM users WHERE email=$1),manager_id=(SELECT id FROM users WHERE email=$2) WHERE area_code=$3`,[`${slug}-sorumlu@erdemir.com.tr`,`${slug}-yonetici@erdemir.com.tr`,code]);await pool.query(`INSERT INTO audit_plans(period,audit_date,area_id,primary_auditor_id,published) SELECT '2026 Yıllık Plan',CURRENT_DATE,a.id,u.id,true FROM areas a JOIN users u ON u.email=$1 WHERE a.area_code=$2 ON CONFLICT(period,area_id) DO UPDATE SET primary_auditor_id=EXCLUDED.primary_auditor_id,published=true`,[`${slug}-tetkikci@erdemir.com.tr`,code])}
  await pool.query(`INSERT INTO audit_plans(period,audit_date,area_id,primary_auditor_id,published) SELECT 'Demo Dönem',CURRENT_DATE,a.id,u.id,true FROM areas a JOIN users u ON u.email='tetkikci@erdemir.com.tr' WHERE a.area_code='A-01' ON CONFLICT(period,area_id) DO NOTHING`);
}

function tokenFor(user) { return jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: "8h" }); }
async function auth(request, response, next) {
  try {
    const raw = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!raw) return response.status(401).json({ error: "Oturum açmanız gerekiyor" });
    const payload = jwt.verify(raw, jwtSecret);
    const result = await pool.query("SELECT id,email,full_name,role,active FROM users WHERE id=$1", [payload.sub]);
    if (!result.rows[0]?.active) return response.status(401).json({ error: "Kullanıcı aktif değil" });
    request.user = result.rows[0]; next();
  } catch { response.status(401).json({ error: "Oturum geçersiz veya süresi dolmuş" }); }
}
async function accessibleAreas(user) {
  if (user.role === "admin") return (await pool.query("SELECT id,area_code,name FROM areas WHERE active=true ORDER BY area_code")).rows;
  if (user.role === "area_admin") return (await pool.query("SELECT id,area_code,name FROM areas WHERE active=true AND manager_id=$1 ORDER BY area_code", [user.id])).rows;
  if (user.role === "area_owner") return (await pool.query("SELECT id,area_code,name FROM areas WHERE active=true AND owner_id=$1 ORDER BY area_code", [user.id])).rows;
  return (await pool.query(`SELECT DISTINCT a.id,a.area_code,a.name FROM areas a JOIN audit_plans p ON p.area_id=a.id WHERE a.active=true AND (p.primary_auditor_id=$1 OR p.backup_auditor_id=$1) ORDER BY a.area_code`, [user.id])).rows;
}
async function canManageArea(user, areaId) {
  if(user.role==="admin")return true;
  if(user.role!=="area_admin")return false;
  return Boolean((await pool.query("SELECT 1 FROM areas WHERE id=$1 AND manager_id=$2 AND active=true",[areaId,user.id])).rowCount);
}

app.get("/api/health", async (_r, res, next) => { try { const q=await pool.query("SELECT current_database() AS database,now() AS time"); res.json({ok:true,...q.rows[0]}); } catch(e){next(e)} });

app.post("/api/auth/login", async (request, response, next) => {
  try {
    let { email, password } = request.body || {};
    email = String(email || "").trim().toLowerCase();
    if (!email.includes("@")) email += "@erdemir.com.tr";
    const result = await pool.query("SELECT id,email,password_hash,full_name,role,active FROM users WHERE email=$1", [email]);
    const user = result.rows[0];
    if (!user?.active || !(await bcrypt.compare(String(password || ""), user.password_hash))) return response.status(401).json({ error: "Kullanıcı adı veya şifre hatalı" });
    const areas = await accessibleAreas(user);
    response.json({ token: tokenFor(user), user: { id:user.id,email:user.email,fullName:user.full_name,role:user.role,areas } });
  } catch (error) { next(error); }
});

app.get("/api/me", auth, async (request, response, next) => { try { response.json({ user:{id:request.user.id,email:request.user.email,fullName:request.user.full_name,role:request.user.role,areas:await accessibleAreas(request.user)} }); } catch(e){next(e)} });
app.get("/api/areas", auth, async (request, response, next) => { try { response.json({areas:await accessibleAreas(request.user)}); } catch(e){next(e)} });

app.get("/api/admin/area-config",auth,async(request,response,next)=>{if(!["admin","area_admin"].includes(request.user.role))return response.status(403).json({error:"Yalnızca yönetici erişebilir"});try{const params=request.user.role==="area_admin"?[request.user.id]:[];const filter=request.user.role==="area_admin"?"AND a.manager_id=$1":"";const areas=await pool.query(`SELECT a.id,a.area_code,a.name,a.qr_token,u.id AS owner_id,u.full_name AS owner_name,u.email AS owner_email FROM areas a LEFT JOIN users u ON u.id=a.owner_id WHERE a.active=true ${filter} ORDER BY a.area_code`,params);const users=await pool.query("SELECT id,full_name,email FROM users WHERE role='area_owner' AND active=true ORDER BY full_name");response.json({areas:areas.rows,users:users.rows})}catch(e){next(e)}});
app.post("/api/admin/assign-area",auth,async(request,response,next)=>{if(request.user.role!=="admin")return response.status(403).json({error:"Yalnızca sistem yöneticisi atama yapabilir"});try{const {areaId,email,fullName}=request.body||{};const user=await pool.query("SELECT id,email,full_name FROM users WHERE lower(email)=lower($1) AND active=true",[String(email||"").trim()]);if(!user.rows[0])return response.status(404).json({error:"Bu e-posta ile kayıtlı aktif kullanıcı bulunamadı"});if(String(fullName||"").trim()&&user.rows[0].full_name.toLocaleLowerCase('tr-TR')!==String(fullName).trim().toLocaleLowerCase('tr-TR'))return response.status(400).json({error:"İsim ve kayıtlı e-posta birbiriyle eşleşmiyor"});const area=await pool.query("UPDATE areas SET owner_id=$1,updated_at=now() WHERE id=$2 RETURNING id,area_code,name",[user.rows[0].id,areaId]);if(!area.rows[0])return response.status(404).json({error:"Alan bulunamadı"});await pool.query("UPDATE users SET role='area_owner' WHERE id=$1",[user.rows[0].id]);await pool.query("INSERT INTO notifications(user_id,title,message,target) VALUES($1,'Yeni alan sorumluluğu atandı',$2,'issues')",[user.rows[0].id,`${area.rows[0].area_code} · ${area.rows[0].name} alanının sorumlusu olarak atandınız.`]);response.json({ok:true,area:area.rows[0],owner:user.rows[0]})}catch(e){next(e)}});
app.get("/api/notifications",auth,async(request,response,next)=>{try{const q=await pool.query("SELECT id,title,message,target,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20",[request.user.id]);response.json({notifications:q.rows})}catch(e){next(e)}});
app.get("/api/audit/assignees",auth,async(request,response,next)=>{if(request.user.role!=="auditor")return response.status(403).json({error:"Yalnızca tetkikçi erişebilir"});try{const areas=await accessibleAreas(request.user);if(!areas.length)return response.json({assignees:[]});const q=await pool.query("SELECT DISTINCT u.id,u.full_name,u.email,a.area_code,a.name AS area_name FROM areas a JOIN users u ON u.id=a.owner_id WHERE a.id=ANY($1::uuid[]) AND u.active=true",[areas.map(a=>a.id)]);response.json({assignees:q.rows})}catch(e){next(e)}});
app.get("/api/task-counts",auth,async(request,response,next)=>{try{let issues=0,approvals=0;if(request.user.role==="area_owner")issues=Number((await pool.query("SELECT count(*)::int AS count FROM corrective_tasks WHERE assigned_to=$1 AND status='open'",[request.user.id])).rows[0].count);if(request.user.role==="area_admin")approvals=Number((await pool.query("SELECT count(*)::int AS count FROM corrective_tasks t JOIN areas a ON a.id=t.area_id WHERE a.manager_id=$1 AND t.status='waiting_approval'",[request.user.id])).rows[0].count);if(request.user.role==="admin")approvals=Number((await pool.query("SELECT count(*)::int AS count FROM corrective_tasks WHERE status='waiting_approval'")).rows[0].count);response.json({issues,approvals})}catch(e){next(e)}});
app.get("/api/dashboard",auth,async(request,response,next)=>{try{if(!["admin","area_admin"].includes(request.user.role))return response.status(403).json({error:"Yalnızca yöneticiler erişebilir"});const areas=await accessibleAreas(request.user);const ids=areas.map(a=>a.id);if(!ids.length)return response.json({scope:"Atanmış alan yok",metrics:{score:0,activeAudits:0,openIssues:0,waitingApproval:0},performance:[]});const metrics=(await pool.query(`SELECT COALESCE((SELECT round(avg(score)::numeric,1) FROM audits WHERE area_id=ANY($1::uuid[])),0) AS score,(SELECT count(*)::int FROM audits WHERE area_id=ANY($1::uuid[]) AND status IN ('draft','in_progress')) AS active_audits,(SELECT count(*)::int FROM corrective_tasks WHERE area_id=ANY($1::uuid[]) AND status='open') AS open_issues,(SELECT count(*)::int FROM corrective_tasks WHERE area_id=ANY($1::uuid[]) AND status='waiting_approval') AS waiting_approval`,[ids])).rows[0];const performance=(await pool.query(`SELECT a.id,a.area_code,a.name,COALESCE((SELECT au.score FROM audits au WHERE au.area_id=a.id ORDER BY au.updated_at DESC LIMIT 1),0) AS score FROM areas a WHERE a.id=ANY($1::uuid[]) ORDER BY a.area_code`,[ids])).rows;response.json({scope:request.user.role==="area_admin"?areas.map(a=>a.name).join(", "):"Fabrika geneli",metrics:{score:Number(metrics.score),activeAudits:Number(metrics.active_audits),openIssues:Number(metrics.open_issues),waitingApproval:Number(metrics.waiting_approval)},performance})}catch(e){next(e)}});

app.get("/api/plans",auth,async(request,response,next)=>{try{let where="";const params=[];if(request.user.role==="auditor"){where="WHERE p.primary_auditor_id=$1 OR p.backup_auditor_id=$1";params.push(request.user.id)}else if(request.user.role==="area_admin"){where="WHERE a.manager_id=$1";params.push(request.user.id)}else if(request.user.role!=="admin")return response.status(403).json({error:"Tetkik planını yalnızca yetkili yönetici ve planda adı bulunan tetkikçi görebilir"});const q=await pool.query(`SELECT p.id,p.period,p.audit_date,p.published,a.id AS area_id,a.area_code,a.name AS area_name,u.full_name AS auditor_name,u.email AS auditor_email FROM audit_plans p JOIN areas a ON a.id=p.area_id JOIN users u ON u.id=p.primary_auditor_id ${where} ORDER BY p.audit_date,a.area_code`,params);response.json({plans:q.rows})}catch(e){next(e)}});
app.post("/api/plans",auth,async(request,response,next)=>{if(!["admin","area_admin"].includes(request.user.role))return response.status(403).json({error:"Planı yalnızca yetkili yönetici düzenleyebilir"});try{const {period,auditDate,areaId,auditorEmail}=request.body||{};if(!(await canManageArea(request.user,areaId)))return response.status(403).json({error:"Bu müdürlük için tetkikçi atama yetkiniz yok"});const auditor=await pool.query("SELECT id,full_name,email FROM users WHERE lower(email)=lower($1) AND role='auditor' AND active=true",[String(auditorEmail||"").trim()]);if(!auditor.rows[0])return response.status(404).json({error:"Kayıtlı tetkikçi e-postası bulunamadı"});const allowed=await pool.query("SELECT 1 FROM audit_plans p WHERE p.area_id=$1 AND p.primary_auditor_id=$2 UNION SELECT 1 FROM areas a WHERE a.id=$1 AND $3='admin' LIMIT 1",[areaId,auditor.rows[0].id,request.user.role]);if(request.user.role==="area_admin"&&!allowed.rowCount)return response.status(403).json({error:"Yalnızca müdürlüğünüze tanımlı tetkikçiyi seçebilirsiniz"});const q=await pool.query(`INSERT INTO audit_plans(period,audit_date,area_id,primary_auditor_id,published) VALUES($1,$2,$3,$4,true) ON CONFLICT(period,area_id) DO UPDATE SET audit_date=EXCLUDED.audit_date,primary_auditor_id=EXCLUDED.primary_auditor_id,published=true RETURNING id`,[period,auditDate,areaId,auditor.rows[0].id]);const area=await pool.query("SELECT area_code,name FROM areas WHERE id=$1",[areaId]);await pool.query("INSERT INTO notifications(user_id,title,message,target) VALUES($1,'Yeni tetkik görevi',$2,'audit')",[auditor.rows[0].id,`${period} · ${area.rows[0]?.area_code} ${area.rows[0]?.name} · ${auditDate}`]);response.json({ok:true,id:q.rows[0].id})}catch(e){next(e)}});
app.get("/api/admin/auditors",auth,async(request,response,next)=>{if(!["admin","area_admin"].includes(request.user.role))return response.status(403).json({error:"Yetkisiz"});try{const q=request.user.role==="admin"?await pool.query("SELECT id,full_name,email FROM users WHERE role='auditor' AND active=true ORDER BY full_name"):await pool.query("SELECT DISTINCT u.id,u.full_name,u.email FROM users u JOIN audit_plans p ON p.primary_auditor_id=u.id JOIN areas a ON a.id=p.area_id WHERE a.manager_id=$1 ORDER BY u.full_name",[request.user.id]);response.json({auditors:q.rows})}catch(e){next(e)}});

app.get("/api/criteria", auth, async (request, response, next) => {
  try {
    if (request.user.role === "area_owner") return response.status(403).json({error:"Alan sorumlusu kriterlere erişemez"});
    const areas = await accessibleAreas(request.user); const ids = areas.map(a=>a.id);
    if (!ids.length) return response.json({ criteria:[], areas });
    const requested = request.query.areaId ? String(request.query.areaId) : null;
    if (requested && !ids.includes(requested)) return response.status(403).json({error:"Bu alana erişiminiz yok"});
    const params = requested ? [requested] : [ids];
    const filter = requested ? "c.area_id=$1" : "c.area_id=ANY($1::uuid[])";
    const rows = await pool.query(`SELECT c.id,c.area_id,a.area_code,a.name AS area_name,c.step,c.description,c.weight,c.active,c.approval_status,c.created_at,COALESCE(c.audit_period,to_char(c.created_at,'YYYY-MM')) AS audit_period,v.version_no FROM criteria c JOIN areas a ON a.id=c.area_id JOIN criterion_versions v ON v.id=c.version_id WHERE ${filter} ORDER BY a.area_code,c.created_at`, params);
    response.json({ criteria:rows.rows, areas });
  } catch(e){next(e)}
});

app.post("/api/criteria", auth, async (request, response, next) => {
  try {
    const {areaId,step,description,weight,auditPeriod}=request.body||{};
    if (!(await canManageArea(request.user,areaId))) return response.status(403).json({error:"Kriterleri yalnızca sistem yöneticisi yönetebilir"});
    if (!String(step||"").trim()||!String(description||"").trim()||!Number.isFinite(Number(weight))||Number(weight)<=0||Number(weight)>100) return response.status(400).json({error:"Adım, kriter ve 1-100 arasında ağırlık zorunludur"});
    let version=await pool.query("SELECT id FROM criterion_versions WHERE published=false AND created_by=$1 ORDER BY created_at DESC LIMIT 1",[request.user.id]);
    if(!version.rows[0]) version=await pool.query("INSERT INTO criterion_versions(version_no,published,created_by) VALUES($1,false,$2) RETURNING id",[`taslak-${Date.now()}`,request.user.id]);
    const period=/^\d{4}-(0[1-9]|1[0-2])$/.test(String(auditPeriod||""))?String(auditPeriod):new Date().toISOString().slice(0,7);
    const row=await pool.query("INSERT INTO criteria(version_id,area_id,step,description,weight,audit_period,active,approval_status) VALUES($1,$2,$3,$4,$5,$6,false,'draft') RETURNING *",[version.rows[0].id,areaId,String(step).trim(),String(description).trim(),Number(weight),period]);
    response.status(201).json({criterion:row.rows[0]});
  } catch(e){next(e)}
});

app.patch("/api/criteria/:id", auth, async (request,response,next)=>{
  try { const found=await pool.query("SELECT area_id FROM criteria WHERE id=$1",[request.params.id]); if(!found.rows[0])return response.status(404).json({error:"Kriter bulunamadı"}); if(!(await canManageArea(request.user,found.rows[0].area_id)))return response.status(403).json({error:"Bu kriteri değiştirme yetkiniz yok"}); const {step,description,weight}=request.body||{}; const row=await pool.query("UPDATE criteria SET step=COALESCE($1,step),description=COALESCE($2,description),weight=COALESCE($3,weight),approval_status='draft',active=false,approved_by=NULL,approved_at=NULL WHERE id=$4 RETURNING *",[step||null,description||null,weight==null?null:Number(weight),request.params.id]); response.json({criterion:row.rows[0]}); } catch(e){next(e)}
});

app.post("/api/criteria/:id/approve", auth, async (request,response,next)=>{
  try { const found=await pool.query("SELECT area_id,version_id FROM criteria WHERE id=$1",[request.params.id]); if(!found.rows[0])return response.status(404).json({error:"Kriter bulunamadı"}); if(!(await canManageArea(request.user,found.rows[0].area_id)))return response.status(403).json({error:"Bu kriteri onaylama yetkiniz yok"}); const row=await pool.query("UPDATE criteria SET approval_status='approved',active=true,approved_by=$1,approved_at=now() WHERE id=$2 RETURNING *",[request.user.id,request.params.id]);await pool.query("UPDATE criterion_versions SET published=true,published_at=COALESCE(published_at,now()) WHERE id=$1",[found.rows[0].version_id]); response.json({criterion:row.rows[0]}); } catch(e){next(e)}
});

app.get("/api/audit/criteria",auth,async(request,response,next)=>{if(request.user.role!=="auditor")return response.status(403).json({error:"Yalnızca tetkikçi erişebilir"});try{const areas=await accessibleAreas(request.user);if(!areas[0])return response.json({area:null,criteria:[]});const q=await pool.query("SELECT c.id,c.step,c.description,c.weight,c.version_id,a.area_code,a.name AS area_name FROM criteria c JOIN areas a ON a.id=c.area_id WHERE c.area_id=$1 AND c.active=true AND c.approval_status='approved' ORDER BY c.created_at",[areas[0].id]);response.json({area:areas[0],criteria:q.rows})}catch(e){next(e)}});

app.get("/api/audits/current", auth, async (request,response,next)=>{if(request.user.role!=="auditor")return response.status(403).json({error:"Yalnızca tetkikçi erişebilir"});try{const q=await pool.query("SELECT audit_no,score,status,payload,updated_at FROM audits WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 1",[request.user.id]);response.json({audit:q.rows[0]||null})}catch(e){next(e)}});
app.get("/api/audits/history",auth,async(request,response,next)=>{if(request.user.role!=="auditor")return response.status(403).json({error:"Yalnızca tetkikçi kendi geçmişini görebilir"});try{const q=await pool.query("SELECT au.audit_no,au.score,au.status,au.updated_at,a.area_code,a.name AS area_name FROM audits au JOIN areas a ON a.id=au.area_id WHERE au.owner_id=$1 ORDER BY au.updated_at DESC",[request.user.id]);response.json({audits:q.rows})}catch(e){next(e)}});
app.post("/api/audits/current",auth,async(request,response,next)=>{const{rows,score,issueState,planPublished}=request.body||{};if(request.user.role!=="auditor")return response.status(403).json({error:"Yalnızca tetkikçi tetkik kaydedebilir"});if(!Array.isArray(rows)||!Number.isFinite(score)||score<0||score>100)return response.status(400).json({error:"Geçersiz tetkik verisi"});const areas=await accessibleAreas(request.user);if(!areas[0])return response.status(403).json({error:"Atanmış tetkik alanınız yok"});const version=await pool.query("SELECT id FROM criterion_versions WHERE published=true ORDER BY published_at DESC NULLS LAST LIMIT 1");if(!version.rows[0])return response.status(409).json({error:"Yayınlanmış kriter versiyonu yok"});try{const q=await pool.query(`INSERT INTO audits(audit_no,area_id,owner_id,criteria_version_id,status,score,payload,updated_at) VALUES($1,$2,$3,$4,'in_progress',$5,$6::jsonb,now()) ON CONFLICT(audit_no) DO UPDATE SET score=EXCLUDED.score,payload=EXCLUDED.payload,status='in_progress',updated_at=now() RETURNING id,updated_at`,[`TTK-${new Date().getFullYear()}-${request.user.id.slice(0,8)}`,areas[0].id,request.user.id,version.rows[0].id,Math.round(score),JSON.stringify({rows,issueState,planPublished})]);for(const row of rows.filter(r=>r.status==="Uygun Değil")){let assignee;if(row.assigneeEmail)assignee=(await pool.query("SELECT u.id FROM users u JOIN areas a ON a.owner_id=u.id WHERE lower(u.email)=lower($1) AND a.id=$2 AND u.role='area_owner'",[row.assigneeEmail,areas[0].id])).rows[0];if(!assignee)assignee=(await pool.query("SELECT owner_id AS id FROM areas WHERE id=$1",[areas[0].id])).rows[0];if(!assignee?.id)return response.status(400).json({error:`${row.item||'Kriter'} için alan sorumlusu atanmalıdır`});await pool.query(`INSERT INTO corrective_tasks(audit_id,area_id,criterion_key,criterion_text,finding,assigned_to,status) VALUES($1,$2,$3,$4,$5,$6,'open') ON CONFLICT(audit_id,criterion_key) DO UPDATE SET criterion_text=EXCLUDED.criterion_text,finding=EXCLUDED.finding,assigned_to=EXCLUDED.assigned_to,status='open',resolution_text=NULL,resolution_photo_url=NULL,resolved_by=NULL,resolved_at=NULL,approved_by=NULL,approved_at=NULL`,[q.rows[0].id,areas[0].id,String(row.id),String(row.item||"Kriter"),String(row.note||""),assignee.id]);await pool.query("INSERT INTO notifications(user_id,title,message,target) VALUES($1,'Yeni uygunsuzluk görevi',$2,'issues')",[assignee.id,String(row.item||"Kriter")])}await pool.query("INSERT INTO workflow_events(audit_id,actor_id,event_type,details)VALUES($1,$2,'audit_submitted',$3::jsonb)",[q.rows[0].id,request.user.id,JSON.stringify({score})]);response.json({ok:true,updatedAt:q.rows[0].updated_at})}catch(e){next(e)}});

app.get("/api/corrective-tasks",auth,async(request,response,next)=>{if(request.user.role!=="area_owner")return response.status(403).json({error:"Yalnızca alan sorumlusu erişebilir"});try{const history=request.query.view==="history";const q=await pool.query(`SELECT t.id,t.criterion_text,t.finding,CASE WHEN t.status IN ('waiting_approval','approved') THEN 'resolved' ELSE t.status END AS status,t.due_at,t.resolution_text,t.resolution_photo_url,t.created_at,a.area_code,a.name AS area_name FROM corrective_tasks t JOIN areas a ON a.id=t.area_id WHERE t.assigned_to=$1 AND ${history?"t.status IN ('waiting_approval','approved')":"t.status='open'"} ORDER BY t.due_at`,[request.user.id]);response.json({tasks:q.rows})}catch(e){next(e)}});
app.post("/api/corrective-tasks/:id/resolve",auth,upload.single("file"),async(request,response,next)=>{if(request.user.role!=="area_owner")return response.status(403).json({error:"Yalnızca alan sorumlusu düzeltme kaydedebilir"});try{const text=String(request.body.description||"").trim();if(!text||!request.file)return response.status(400).json({error:"Giderme açıklaması ve sonrası fotoğrafı zorunludur"});const found=await pool.query("SELECT t.id,a.manager_id FROM corrective_tasks t JOIN areas a ON a.id=t.area_id WHERE t.id=$1 AND t.assigned_to=$2",[request.params.id,request.user.id]);if(!found.rows[0])return response.status(404).json({error:"Görev bulunamadı veya size atanmadı"});const url=`http://localhost:${port}/uploads/${request.file.filename}`;const q=await pool.query("UPDATE corrective_tasks SET status='waiting_approval',resolution_text=$1,resolution_photo_url=$2,resolved_by=$3,resolved_at=now() WHERE id=$4 RETURNING *",[text,url,request.user.id,request.params.id]);if(found.rows[0].manager_id)await pool.query("INSERT INTO notifications(user_id,title,message,target) VALUES($1,'Düzeltme onayı bekliyor',$2,'approvals')",[found.rows[0].manager_id,'Alan sorumlusu açıklama ve fotoğraf ekledi.']);response.json({task:q.rows[0]})}catch(e){next(e)}});

app.get("/api/approvals",auth,async(request,response,next)=>{if(!["area_admin","admin"].includes(request.user.role))return response.status(403).json({error:"Yalnızca yönetici onaylayabilir"});try{const params=request.user.role==="area_admin"?[request.user.id]:[];const filter=request.user.role==="area_admin"?"AND a.manager_id=$1":"";const q=await pool.query(`SELECT t.id,t.audit_id,t.criterion_text,t.finding,t.status,t.resolution_text,t.resolution_photo_url,t.resolved_at,a.area_code,a.name AS area_name,u.full_name AS responsible_name FROM corrective_tasks t JOIN areas a ON a.id=t.area_id LEFT JOIN users u ON u.id=t.resolved_by WHERE t.status='waiting_approval' ${filter} ORDER BY t.resolved_at`,params);response.json({tasks:q.rows})}catch(e){next(e)}});
app.post("/api/approvals/:id/approve",auth,async(request,response,next)=>{if(!["area_admin","admin"].includes(request.user.role))return response.status(403).json({error:"Yalnızca yönetici onaylayabilir"});try{const params=request.user.role==="area_admin"?[request.params.id,request.user.id]:[request.params.id];const filter=request.user.role==="area_admin"?"AND a.manager_id=$2":"";const found=await pool.query(`SELECT t.audit_id,t.resolved_by FROM corrective_tasks t JOIN areas a ON a.id=t.area_id WHERE t.id=$1 AND t.status='waiting_approval' ${filter}`,params);if(!found.rows[0])return response.status(404).json({error:"Onay kaydı bulunamadı veya yetkiniz yok"});await pool.query("UPDATE corrective_tasks SET status='approved',approved_by=$1,approved_at=now() WHERE id=$2",[request.user.id,request.params.id]);const pending=await pool.query("SELECT 1 FROM corrective_tasks WHERE audit_id=$1 AND status<>'approved' LIMIT 1",[found.rows[0].audit_id]);if(!pending.rowCount)await pool.query("UPDATE audits SET status='completed',completed_at=now(),updated_at=now() WHERE id=$1",[found.rows[0].audit_id]);if(found.rows[0].resolved_by)await pool.query("INSERT INTO notifications(user_id,title,message,target) VALUES($1,'Düzeltme onaylandı','Sorun giderildi ve tetkik tamamlanma kontrolüne geçti.','resolutions')",[found.rows[0].resolved_by]);response.json({ok:true,auditCompleted:!pending.rowCount})}catch(e){next(e)}});
app.post("/api/approvals/:id/reject",auth,async(request,response,next)=>{if(!["area_admin","admin"].includes(request.user.role))return response.status(403).json({error:"Yalnızca yönetici reddedebilir"});try{const reason=String(request.body?.reason||"").trim();if(!reason)return response.status(400).json({error:"Ret açıklaması zorunludur"});const params=request.user.role==="area_admin"?[request.params.id,request.user.id]:[request.params.id];const filter=request.user.role==="area_admin"?"AND a.manager_id=$2":"";const found=await pool.query(`SELECT t.assigned_to FROM corrective_tasks t JOIN areas a ON a.id=t.area_id WHERE t.id=$1 AND t.status='waiting_approval' ${filter}`,params);if(!found.rows[0])return response.status(404).json({error:"Onay kaydı bulunamadı veya yetkiniz yok"});await pool.query("UPDATE corrective_tasks SET status='open',approved_by=NULL,approved_at=NULL WHERE id=$1",[request.params.id]);if(found.rows[0].assigned_to)await pool.query("INSERT INTO notifications(user_id,title,message,target) VALUES($1,'Düzeltme reddedildi',$2,'issues')",[found.rows[0].assigned_to,reason]);response.json({ok:true})}catch(e){next(e)}});

app.post("/api/evidence",auth,upload.single("file"),async(request,response,next)=>{try{if(request.user.role!=="auditor")return response.status(403).json({error:"Yalnızca tetkikçi kanıt yükleyebilir"});if(!request.file)return response.status(400).json({error:"10 MB altında görsel zorunludur"});let audit=await pool.query("SELECT id FROM audits WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 1",[request.user.id]);if(!audit.rows[0]){const areas=await accessibleAreas(request.user);const version=await pool.query("SELECT id FROM criterion_versions WHERE published=true ORDER BY published_at DESC NULLS LAST LIMIT 1");if(!areas[0]||!version.rows[0])return response.status(409).json({error:"Atanmış alan veya yayınlanmış kriter bulunamadı"});audit=await pool.query("INSERT INTO audits(audit_no,area_id,owner_id,criteria_version_id,status,score,payload) VALUES($1,$2,$3,$4,'draft',0,'{}'::jsonb) RETURNING id",[`TTK-${new Date().getFullYear()}-${request.user.id.slice(0,8)}`,areas[0].id,request.user.id,version.rows[0].id])}const id=crypto.randomUUID();await pool.query("INSERT INTO evidence(id,audit_id,object_key,filename,content_type,size_bytes,uploaded_by)VALUES($1,$2,$3,$4,$5,$6,$7)",[id,audit.rows[0].id,request.file.filename,request.file.originalname,request.file.mimetype,request.file.size,request.user.id]);response.json({ok:true,url:`http://localhost:${port}/uploads/${request.file.filename}`})}catch(e){next(e)}});

app.use((error,_request,response,_next)=>{console.error(error);response.status(500).json({error:error.message||"Sunucu hatası"})});
await ensureCompatibility(); await pool.query("SELECT 1"); app.listen(port,()=>console.log(`PostgreSQL API http://localhost:${port}`));
