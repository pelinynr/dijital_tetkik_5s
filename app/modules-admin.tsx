"use client";
import { useEffect, useState } from "react";
type Screen = "dashboard" | "areas" | "criteria" | "plans" | "audit" | "issues" | "approvals" | "reports";
type Area = {
    id: string;
    area_code: string;
    name: string;
};
type User = {
    id: string;
    email: string;
    fullName: string;
    role: "admin" | "area_admin" | "auditor" | "area_owner";
    areas: Area[];
};
type Criterion = {
    id: string;
    area_id: string;
    area_code: string;
    area_name: string;
    step: string;
    description: string;
    weight: string;
    active: boolean;
    approval_status: string;
    version_no: string;
    created_at: string;
    audit_period: string;
};
const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";
function Title({ tag, title, text, action }: {
    tag: string;
    title: string;
    text: string;
    action?: React.ReactNode;
}) { return <div className="module-title"><div>{!tag.startsWith("MODÜL") && <span className="eyebrow">{tag}</span>}<h1>{title}</h1><p>{text}</p></div>{action}</div>; }
type DashboardData = {
    scope: string;
    metrics: {
        score: number;
        activeAudits: number;
        openIssues: number;
        waitingApproval: number;
    };
    performance: {
        id: string;
        area_code: string;
        name: string;
        score: string | number;
    }[];
};
export function Dashboard({ go, token, user }: {
    go: (s: Screen) => void;
    token: string;
    user: User;
}) { const [data, setData] = useState<DashboardData | null>(null), [error, setError] = useState(""); useEffect(() => { fetch(`${API}/api/dashboard`, { headers: { Authorization: `Bearer ${token}` } }).then(async (r) => { const d = await r.json(); if (!r.ok)
    throw new Error(d.error); setData(d); }).catch(e => setError(e.message)); }, [token]); const m = data?.metrics; return <><Title tag={user.role === "area_admin" ? "ÜNİTE PANELİ" : "5S YÖNETİM"} title={data?.scope || "Yetkili çalışma alanınız"} text={user.role === "area_admin" ? "Yalnızca sorumlu olduğunuz müdürlüğün güncel puanları ve işlemleri." : "Tüm yetkili alanların güncel durumu."} action={<button className="primary" onClick={() => go("plans")}>＋ Yeni tetkik planı</button>}/>{error && <p className="danger-text">{error}</p>}<div className="kpis"><article><small>{user.role === "area_admin" ? "ÜNİTE 5S PUANI" : "GENEL 5S PUANI"}</small><b>{m?.score?.toLocaleString("tr-TR") ?? "—"}</b></article><article><small>AKTİF TETKİK</small><b>{m?.activeAudits ?? "—"}</b></article><article><small>AÇIK UYGUNSUZLUK</small><b>{m?.openIssues ?? "—"}</b></article><article><small>ONAY BEKLEYEN</small><b>{m?.waitingApproval ?? "—"}</b></article></div><div className="dashboard-grid"><section className="panel"><div className="panel-head"><div><h3>{user.role === "area_admin" ? "Ünite performansı" : "Alan performansı"}</h3><p>Son kaydedilen tetkik puanları</p></div><button onClick={() => go("reports")}>Raporlar →</button></div>{data?.performance.map(a => <div className="bar-row" key={a.id}><span>{a.area_code} · {a.name}</span><div><i style={{ width: `${Math.max(0, Math.min(100, Number(a.score)))}%` }}/></div><b>{Math.round(Number(a.score))}</b></div>)}</section><section className="panel activity"><button onClick={() => go("approvals")}><i>✓</i><span><b>{m?.waitingApproval ?? 0} düzeltme onay bekliyor</b><small>{data?.scope}</small></span><em>İncele →</em></button><button onClick={() => go("plans")}><i>◷</i><span><b>Tetkik planlama</b><small>Yetkili alan için tetkikçi seçin</small></span><em>Planla →</em></button><button onClick={() => go("criteria")}><i>☷</i><span><b>Kriter yönetimi</b><small>Yetkili alanın kriterlerini yönetin</small></span><em>Aç →</em></button></section></div></>; }
type AreaConfig = {
    id: string;
    area_code: string;
    name: string;
    qr_token: string;
    owner_name?: string;
    owner_email?: string;
};
type Owner = {
    id: string;
    full_name: string;
    email: string;
};
export function Areas({ openQr, token }: {
    openQr: (area: {
        name: string;
        code: string;
        token: string;
    }) => void;
    token: string;
}) { const [areas, setAreas] = useState<AreaConfig[]>([]), [users, setUsers] = useState<Owner[]>([]), [areaId, setAreaId] = useState(""), [email, setEmail] = useState(""), [fullName, setFullName] = useState(""), [message, setMessage] = useState(""); const headers = { Authorization: `Bearer ${token}` }; const load = () => fetch(`${API}/api/admin/area-config`, { headers }).then(async (r) => { const d = await r.json(); if (!r.ok)
    throw new Error(d.error); setAreas(d.areas); setUsers(d.users); if (!areaId && d.areas[0])
    setAreaId(d.areas[0].id); }).catch(e => setMessage(e.message)); useEffect(() => { load(); }, [token]); const choose = (mail: string) => { setEmail(mail); const u = users.find(x => x.email === mail); setFullName(u?.full_name || ""); }; const assign = async () => { setMessage(""); const r = await fetch(`${API}/api/admin/assign-area`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ areaId, email, fullName }) }); const d = await r.json(); if (!r.ok)
    return setMessage(d.error); setMessage(`${d.owner.full_name} alan sorumlusu olarak atandı ve bildirim oluşturuldu.`); load(); }; return <><Title tag="" title="Alan, QR ve sorumlu yönetimi" text="Her müdürlük için ayrı QR kodunu görüntüleyin ve alan sorumlusunu atayın."/><p>Görevli atamalarını Tetkik Planlama bölümünden admin onayına gönderin.</p><section className="panel no-pad"><div className="management-table"><div className="th"><span>MÜDÜRLÜK / ALAN</span><span>SORUMLU</span><span>E-POSTA</span><span>ALANA ÖZEL QR</span><span>DURUM</span></div>{areas.map(a => <div className="tr" key={a.id}><b>{a.area_code} · {a.name}</b><span>{a.owner_name || "Atanmadı"}</span><span>{a.owner_email || "—"}</span><button className="qr-button" onClick={() => openQr({ name: a.name, code: a.area_code, token: a.qr_token })}>▦ {a.name} QR</button><span className="state aktif">Aktif</span></div>)}</div></section></>; }
export function Criteria({ token, user }: { token: string; user: User }) {
    const [list, setList] = useState<Criterion[]>([]);
    const [areas, setAreas] = useState<Area[]>(user.areas);
    const [areaId, setAreaId] = useState(user.areas[0]?.id || "");
    const [step, setStep] = useState("Ayıklama");
    const [description, setDescription] = useState("");
    const [weight, setWeight] = useState(20);
    const [auditPeriod, setAuditPeriod] = useState(new Date().toISOString().slice(0, 7));
    const [message, setMessage] = useState("");
    const headers = { Authorization: `Bearer ${token}` };
    const periodLabel = (value: string) => new Date(`${value}-01T00:00:00`).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
    const load = async () => {
        const params = new URLSearchParams({ auditPeriod });
        if (areaId) params.set("areaId", areaId);
        const r = await fetch(`${API}/api/criteria?${params}`, { headers });
        const d = await r.json();
        if (!r.ok) return setMessage(d.error);
        setList(d.criteria);
        setAreas(d.areas);
        if (!areaId && d.areas[0]) setAreaId(d.areas[0].id);
    };
    useEffect(() => { load(); }, [areaId, auditPeriod]);
    const add = async () => {
        setMessage("");
        const r = await fetch(`${API}/api/criteria`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ areaId, step, description, weight, auditPeriod }) });
        const d = await r.json();
        if (!r.ok) return setMessage(d.error);
        setDescription("");
        setMessage(`${periodLabel(auditPeriod)} tetkiği için kriter taslak olarak eklendi.`);
        load();
    };
        const remove = async (c: Criterion) => { if (!window.confirm(`“${c.description}” kriterini yalnızca ${periodLabel(c.audit_period)} döneminden kaldırmak istediğinize emin misiniz?`)) return; const r = await fetch(`${API}/api/criteria/${c.id}`, { method: "DELETE", headers }); const d = await r.json(); setMessage(r.ok ? `${periodLabel(c.audit_period)} kriteri kaldırıldı.` : d.error); if (r.ok) load(); };
    return <><Title tag="KRİTER YÖNETİMİ" title="Dönem ve alan bazlı kriter yönetimi" text="Her ayın kriter tablosu bağımsızdır; bir dönemdeki ekleme veya kaldırma diğer ayları değiştirmez."/><div className="criteria-head"><div><span>YETKİLİ ALAN / DÖNEM</span><h3>{areas.find(a => a.id === areaId)?.name || "Atanmış alan yok"}</h3><p>{periodLabel(auditPeriod)} · {list.length} kriter</p></div><div className="criteria-filters"><input aria-label="Görüntülenecek tetkik ayı" type="month" value={auditPeriod} onChange={e => setAuditPeriod(e.target.value)}/><select value={areaId} onChange={e => setAreaId(e.target.value)}>{areas.map(a => <option key={a.id} value={a.id}>{a.area_code} · {a.name}</option>)}</select></div></div>{areas.length > 0 && <section className="planner"><h3>{periodLabel(auditPeriod)} için yeni kriter ekle</h3><div className="plan-form"><label>5S adımı<select value={step} onChange={e => setStep(e.target.value)}><option>Ayıklama</option><option>Düzenleme</option><option>Temizlik</option><option>Standartlaştırma</option><option>Disiplin</option></select></label><label>Ağırlık (puan)<input type="number" min="1" max="100" value={weight} onChange={e => setWeight(Number(e.target.value))}/></label></div><label className="field">Kriter açıklaması<textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Kontrol edilecek kriteri yazın..."/></label><button className="primary" onClick={add}>＋ Bu döneme kriter ekle</button>{message && <p>{message}</p>}</section>}<section className="panel no-pad"><div className="management-table criteria-table"><div className="th"><span>NO</span><span>5S ADIMI / KRİTER</span><span>TETKİK AYI</span><span>EKLENME TARİHİ</span><span>ALAN</span><span>AĞIRLIK</span><span>DURUM / İŞLEM</span></div>{list.map((c, i) => <div className="tr" key={c.id}><b>K-{String(i + 1).padStart(2, "0")}</b><span><small>{c.step}</small><b>{c.description}</b></span><span>{periodLabel(c.audit_period)}</span><span>{new Date(c.created_at).toLocaleDateString("tr-TR")}</span><span>{c.area_code}</span><span>{c.weight} puan</span><span className="criterion-actions"><span className="state aktif">Planlamada onaya gönderilir</span><button className="remove-criterion" onClick={() => remove(c)}>Kaldır</button></span></div>)}</div>{!list.length && <p style={{ padding: 24 }}>{periodLabel(auditPeriod)} için henüz kriter bulunmuyor.</p>}</section></>;
}
export { Plans } from "./planning";
