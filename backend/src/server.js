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
  await pool.query("ALTER TABLE audits ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb");
  await pool.query("ALTER TABLE criteria ADD COLUMN IF NOT EXISTS approval_status varchar(20) NOT NULL DEFAULT 'draft'");
  await pool.query("ALTER TABLE criteria ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id) ON DELETE SET NULL");
  await pool.query("ALTER TABLE criteria ADD COLUMN IF NOT EXISTS approved_at timestamptz");
  await pool.query("UPDATE criteria SET approval_status='approved' WHERE active=true AND approval_status='draft'");
  const demoPassword = process.env.DEMO_PASSWORD || "12345678";
  const hash = await bcrypt.hash(demoPassword, 12);
  await pool.query("UPDATE users SET password_hash=$1 WHERE password_hash='DEMO_ONLY_REPLACE_WITH_BCRYPT_HASH'", [hash]);
  await pool.query("INSERT INTO users(email,password_hash,full_name,role) VALUES('sorumlu2@erdemir.com.tr',$1,'Çelikhane Alan Yöneticisi','area_owner') ON CONFLICT(email) DO NOTHING",[hash]);
  await pool.query("INSERT INTO areas(area_code,name,owner_id) SELECT 'A-02','Çelikhane',id FROM users WHERE email='sorumlu2@erdemir.com.tr' ON CONFLICT(area_code) DO NOTHING");
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
  if (user.role === "area_owner") return (await pool.query("SELECT id,area_code,name FROM areas WHERE active=true AND owner_id=$1 ORDER BY area_code", [user.id])).rows;
  return (await pool.query(`SELECT DISTINCT a.id,a.area_code,a.name FROM areas a JOIN audit_plans p ON p.area_id=a.id WHERE a.active=true AND (p.primary_auditor_id=$1 OR p.backup_auditor_id=$1) ORDER BY a.area_code`, [user.id])).rows;
}
async function canManageArea(user, areaId) {
  if (user.role === "admin") return true;
  if (user.role !== "area_owner") return false;
  return Boolean((await pool.query("SELECT 1 FROM areas WHERE id=$1 AND owner_id=$2 AND active=true", [areaId, user.id])).rowCount);
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

app.get("/api/criteria", auth, async (request, response, next) => {
  try {
    const areas = await accessibleAreas(request.user); const ids = areas.map(a=>a.id);
    if (!ids.length) return response.json({ criteria:[], areas });
    const requested = request.query.areaId ? String(request.query.areaId) : null;
    if (requested && !ids.includes(requested)) return response.status(403).json({error:"Bu alana erişiminiz yok"});
    const params = requested ? [requested] : [ids];
    const filter = requested ? "c.area_id=$1" : "c.area_id=ANY($1::uuid[])";
    const rows = await pool.query(`SELECT c.id,c.area_id,a.area_code,a.name AS area_name,c.step,c.description,c.weight,c.active,c.approval_status,v.version_no FROM criteria c JOIN areas a ON a.id=c.area_id JOIN criterion_versions v ON v.id=c.version_id WHERE ${filter} ORDER BY a.area_code,c.created_at`, params);
    response.json({ criteria:rows.rows, areas });
  } catch(e){next(e)}
});

app.post("/api/criteria", auth, async (request, response, next) => {
  try {
    const {areaId,step,description,weight}=request.body||{};
    if (!(await canManageArea(request.user,areaId))) return response.status(403).json({error:"Yalnızca sorumlu olduğunuz alana kriter ekleyebilirsiniz"});
    if (!String(step||"").trim()||!String(description||"").trim()||!Number.isFinite(Number(weight))||Number(weight)<=0||Number(weight)>100) return response.status(400).json({error:"Adım, kriter ve 1-100 arasında ağırlık zorunludur"});
    let version=await pool.query("SELECT id FROM criterion_versions WHERE published=false AND created_by=$1 ORDER BY created_at DESC LIMIT 1",[request.user.id]);
    if(!version.rows[0]) version=await pool.query("INSERT INTO criterion_versions(version_no,published,created_by) VALUES($1,false,$2) RETURNING id",[`taslak-${Date.now()}`,request.user.id]);
    const row=await pool.query("INSERT INTO criteria(version_id,area_id,step,description,weight,active,approval_status) VALUES($1,$2,$3,$4,$5,false,'draft') RETURNING *",[version.rows[0].id,areaId,String(step).trim(),String(description).trim(),Number(weight)]);
    response.status(201).json({criterion:row.rows[0]});
  } catch(e){next(e)}
});

app.patch("/api/criteria/:id", auth, async (request,response,next)=>{
  try { const found=await pool.query("SELECT area_id FROM criteria WHERE id=$1",[request.params.id]); if(!found.rows[0])return response.status(404).json({error:"Kriter bulunamadı"}); if(!(await canManageArea(request.user,found.rows[0].area_id)))return response.status(403).json({error:"Bu kriteri değiştirme yetkiniz yok"}); const {step,description,weight}=request.body||{}; const row=await pool.query("UPDATE criteria SET step=COALESCE($1,step),description=COALESCE($2,description),weight=COALESCE($3,weight),approval_status='draft',active=false,approved_by=NULL,approved_at=NULL WHERE id=$4 RETURNING *",[step||null,description||null,weight==null?null:Number(weight),request.params.id]); response.json({criterion:row.rows[0]}); } catch(e){next(e)}
});

app.post("/api/criteria/:id/approve", auth, async (request,response,next)=>{
  try { const found=await pool.query("SELECT area_id FROM criteria WHERE id=$1",[request.params.id]); if(!found.rows[0])return response.status(404).json({error:"Kriter bulunamadı"}); if(!(await canManageArea(request.user,found.rows[0].area_id)))return response.status(403).json({error:"Bu kriteri onaylama yetkiniz yok"}); const row=await pool.query("UPDATE criteria SET approval_status='approved',active=true,approved_by=$1,approved_at=now() WHERE id=$2 RETURNING *",[request.user.id,request.params.id]); response.json({criterion:row.rows[0]}); } catch(e){next(e)}
});

app.get("/api/audits/current", auth, async (request,response,next)=>{try{const q=await pool.query("SELECT audit_no,score,status,payload,updated_at FROM audits WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 1",[request.user.id]);response.json({audit:q.rows[0]||null})}catch(e){next(e)}});
app.post("/api/audits/current", auth, async (request,response,next)=>{const{rows,score,issueState,planPublished}=request.body||{};if(request.user.role!=="auditor")return response.status(403).json({error:"Yalnızca tetkikçi tetkik kaydedebilir"});if(!Array.isArray(rows)||!Number.isFinite(score)||score<0||score>100)return response.status(400).json({error:"Geçersiz tetkik verisi"});const areas=await accessibleAreas(request.user);if(!areas[0])return response.status(403).json({error:"Atanmış tetkik alanınız yok"});const version=await pool.query("SELECT id FROM criterion_versions WHERE published=true ORDER BY published_at DESC NULLS LAST LIMIT 1");if(!version.rows[0])return response.status(409).json({error:"Yayınlanmış kriter versiyonu yok"});try{const q=await pool.query(`INSERT INTO audits(audit_no,area_id,owner_id,criteria_version_id,status,score,payload,updated_at) VALUES($1,$2,$3,$4,'draft',$5,$6::jsonb,now()) ON CONFLICT(audit_no) DO UPDATE SET score=EXCLUDED.score,payload=EXCLUDED.payload,updated_at=now() RETURNING id,updated_at`,[`TTK-${new Date().getFullYear()}-${request.user.id.slice(0,8)}`,areas[0].id,request.user.id,version.rows[0].id,Math.round(score),JSON.stringify({rows,issueState,planPublished})]);await pool.query("INSERT INTO workflow_events(audit_id,actor_id,event_type,details)VALUES($1,$2,'draft_saved',$3::jsonb)",[q.rows[0].id,request.user.id,JSON.stringify({score})]);response.json({ok:true,updatedAt:q.rows[0].updated_at})}catch(e){next(e)}});

app.post("/api/evidence",auth,upload.single("file"),async(request,response,next)=>{try{if(request.user.role!=="auditor")return response.status(403).json({error:"Yalnızca tetkikçi kanıt yükleyebilir"});if(!request.file)return response.status(400).json({error:"10 MB altında görsel zorunludur"});const audit=await pool.query("SELECT id FROM audits WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 1",[request.user.id]);if(!audit.rows[0])return response.status(409).json({error:"Önce tetkiki kaydedin"});const id=crypto.randomUUID();await pool.query("INSERT INTO evidence(id,audit_id,object_key,filename,content_type,size_bytes,uploaded_by)VALUES($1,$2,$3,$4,$5,$6,$7)",[id,audit.rows[0].id,request.file.filename,request.file.originalname,request.file.mimetype,request.file.size,request.user.id]);response.json({ok:true,url:`http://localhost:${port}/uploads/${request.file.filename}`})}catch(e){next(e)}});

app.use((error,_request,response,_next)=>{console.error(error);response.status(500).json({error:error.message||"Sunucu hatası"})});
await ensureCompatibility(); await pool.query("SELECT 1"); app.listen(port,()=>console.log(`PostgreSQL API http://localhost:${port}`));
