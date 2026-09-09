"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Areas, Criteria, Dashboard as ManagerDashboard, Plans } from "./modules-admin";
import { ApprovalTasks, AreaOwnerHistory, AreaOwnerIssues, Audit, AuditHistory, AuditorPlan, Issues, Reports } from "./modules-workflow";
import { Help, Training } from "./training-help";
type Screen = "dashboard" | "areas" | "criteria" | "plans" | "audit" | "history" | "issues" | "resolutions" | "approvals" | "reports" | "training" | "help";
type Status = "Uygun" | "Uygun Değil" | "Bekliyor";
type Row = {
    id: string | number;
    category: string;
    item: string;
    weight: number;
    status: Status;
    note: string;
    photos: string[];
    assigneeEmail?: string;
};
type Area = {
    id: string;
    area_code: string;
    name: string;
};
type Assignee = {
    id: string;
    full_name: string;
    email: string;
    area_code: string;
    area_name: string;
};
type User = {
    id: string;
    email: string;
    fullName: string;
    role: "admin" | "area_admin" | "auditor" | "area_owner";
    areas: Area[];
};
const menu: [
    Screen,
    string,
    string
][] = [["dashboard", "Genel Bakış", "⌂"], ["areas", "Alan & QR Yönetimi", "▦"], ["criteria", "Kriter Yönetimi", "☷"], ["plans", "Tetkik Planlama", "◷"], ["audit", "QR ile Tetkik", "✓"], ["history", "Geçmiş Tetkiklerim", "▥"], ["issues", "Bana Atanan Görevler", "!"], ["resolutions", "Geçmiş Belgelemelerim", "▥"], ["approvals", "Düzeltme Onayları", "✓"], ["reports", "Raporlar", "▥"], ["training", "Eğitim / Bilgilendirme", "◇"], ["help", "Yardım", "?"]];
const seedRows: Row[] = [
    { id: 1, category: "Ayıklama", item: "Gereksiz malzeme ve ekipman çalışma alanından uzaklaştırılmıştır.", weight: 15, status: "Uygun", note: "", photos: [] },
    { id: 2, category: "Düzenleme", item: "Malzemelerin tanımlı yerleri ve görsel işaretlemeleri mevcuttur.", weight: 15, status: "Uygun Değil", note: "Yedek merdane alanında zemin işaretleri silinmiş.", photos: [] },
    { id: 3, category: "Temizlik", item: "Zemin, makine ve ekipmanlar temiz durumdadır.", weight: 20, status: "Uygun", note: "", photos: [] },
    { id: 4, category: "Standartlaştırma", item: "5S standartları ve kontrol listeleri günceldir.", weight: 20, status: "Uygun Değil", note: "Panoda kriter tablosunun eski sürümü bulunuyor.", photos: [] },
    { id: 5, category: "Disiplin", item: "Tanımlı 5S kuralları çalışanlar tarafından uygulanmaktadır.", weight: 20, status: "Uygun", note: "", photos: [] },
    { id: 6, category: "İSG", item: "Yürüyüş yolları ve acil çıkışlar açık durumdadır.", weight: 10, status: "Bekliyor", note: "", photos: [] },
];
const factor: Record<Status, number> = { Uygun: 1, "Uygun Değil": 0, Bekliyor: 0 };
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";
const areaSections: Record<string, string> = { "CELIKHANE": "Konverter Bölgesi", "YUKSEK-FIRIN": "Dökümhane Bölgesi", "SICAK-HAD": "Merdane Hazırlama", "SOGUK-HAD": "Paketleme Hattı", "KOK-FAB": "Kok Bataryaları Bölgesi", "OKSIJEN-FAB": "Hava Ayrıştırma Ünitesi", "SINTER-FAB": "Harmanlama Bölgesi", "KIREC-FAB": "Fırınlar Bölgesi", "A-01": "Merdane Hazırlama", "A-02": "Konverter Bölgesi", "ERP-OFIS": "Açık Ofis Alanı", "ERP-MUDUR": "Müdürlük İdari Alanı" };
const areaQrName = (area?: Area) => area ? `${area.name} / ${areaSections[area.area_code] || "Ana Üretim Alanı"}` : "Atanmış alan";
function QrScannerModal({ expectedArea, close, scanned }: {
    expectedArea?: string;
    close: () => void;
    scanned: () => void;
}) { const video = useRef<HTMLVideoElement>(null), [message, setMessage] = useState("Kamera başlatılıyor…"); useEffect(() => { let stream: MediaStream | undefined, stopped = false, frame = 0; const start = async () => { try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
    if (!video.current)
        return;
    video.current.srcObject = stream;
    await video.current.play();
    const Detector = (window as typeof window & {
        BarcodeDetector?: new (options: {
            formats: string[];
        }) => {
            detect: (source: HTMLVideoElement) => Promise<Array<{
                rawValue: string;
            }>>;
        };
    }).BarcodeDetector;
    if (!Detector) {
        setMessage("Bu tarayıcı otomatik QR okumayı desteklemiyor. Mobil Chrome veya Edge kullanın.");
        return;
    }
    const detector = new Detector({ formats: ["qr_code"] });
    setMessage("QR kodu çerçevenin içine getirin.");
    const scan = async () => { if (stopped || !video.current)
        return; try {
        const codes = await detector.detect(video.current);
        if (codes[0]?.rawValue) {
            const url = new URL(codes[0].rawValue, window.location.origin), area = url.searchParams.get("area");
            if (expectedArea && area && area !== expectedArea)
                setMessage(`Bu QR ${area} alanına ait. Kendi alanınızın kodunu okutun.`);
            else {
                setMessage("QR kodu okundu. Tetkik açılıyor…");
                setTimeout(scanned, 450);
                return;
            }
        }
    }
    catch { } frame = requestAnimationFrame(scan); };
    frame = requestAnimationFrame(scan);
}
catch {
    setMessage("Kamera açılamadı. Tarayıcı kamera iznini etkinleştirip yeniden deneyin.");
} }; start(); return () => { stopped = true; cancelAnimationFrame(frame); stream?.getTracks().forEach(track => track.stop()); }; }, [expectedArea, scanned]); return <div className="overlay modal-wrap" onMouseDown={close}><div className="modal qr-scanner" onMouseDown={e => e.stopPropagation()}><button className="x" onClick={close}>×</button><span className="eyebrow">TETKİKÇİ QR OKUYUCU</span><h2>Alan QR kodunu okutun</h2><p>{message}</p><div className="scanner-frame"><video ref={video} playsInline muted aria-label="QR kod kamera görüntüsü"/><i /><i /><i /><i /></div><button className="outline wide" onClick={close}>Vazgeç</button></div></div>; }
function Logo() { return <div className="logo"><img src="/erdemir-logo.png" alt="Erdemir"/><span>Dijital 5S Tetkik Sistemi</span></div>; }
export default function Home() {
    const [user, setUser] = useState<User | null>(null), [token, setToken] = useState(""), [screen, setScreen] = useState<Screen>("dashboard"), [rows, setRows] = useState(seedRows), [assignees, setAssignees] = useState<Assignee[]>([]), [badges, setBadges] = useState({ issues: 0, approvals: 0 }), [active, setActive] = useState<string | number | null>(null), [qr, setQr] = useState(false), [scanner, setScanner] = useState(false), [qrInfo, setQrInfo] = useState({ name: "Atanmış alan", code: "ALAN", token: "ALAN" }), [qrDataUrl, setQrDataUrl] = useState(""), [search, setSearch] = useState(""), [notice, setNotice] = useState(0), [noticeOpen, setNoticeOpen] = useState(false), [planPublished, setPlanPublished] = useState(false), [issueState, setIssueState] = useState("Düzeltme Bekliyor"), [saveState, setSaveState] = useState("Kaydet");
    const [selectedPlanId, setSelectedPlanId] = useState("");
    const [criteriaMessage, setCriteriaMessage] = useState("");
    const startPlan = (plan: { id: string; area_name: string; area_code: string; area_id: string }) => {
        setSelectedPlanId(plan.id);
        setRows([]);
        setCriteriaMessage("Seçilen planın kriterleri yükleniyor…");
        setQrInfo({ name: `${plan.area_name} / ${areaSections[plan.area_code] || "Ana Üretim Alanı"}`, code: plan.area_code, token: plan.area_id });
        setScreen("audit");
    };
    const totalWeight = rows.reduce((sum, row) => sum + Number(row.weight), 0);
    const file = useRef<HTMLInputElement>(null), score = totalWeight ? Math.round(rows.reduce((a, r) => a + r.weight * factor[r.status], 0) / totalWeight * 100) : 0, done = rows.filter(r => r.status !== "Bekliyor").length, selected = rows.find(r => r.id === active);
    const authHeaders = { Authorization: `Bearer ${token}` };
    const update = (id: string | number, p: Partial<Row>) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...p } : r));
    const addPhotos = async (f: FileList | null) => { if (!f || active === null)
        return; const urls: string[] = []; for (const photo of Array.from(f)) {
        const form = new FormData();
        form.set("file", photo);
        form.set("criterionId", String(active));
        form.set("planId", selectedPlanId);
        const response = await fetch(`${API_BASE}/api/evidence`, { method: "POST", headers: authHeaders, body: form });
        if (response.ok)
            urls.push((await response.json()).url);
    } update(active, { photos: [...(selected?.photos || []), ...urls] }); };
    const persist = async (submit = false) => { setSaveState(submit ? "Tetkik tamamlanıyor..." : "Kaydediliyor..."); try {
        const response = await fetch(`${API_BASE}/api/audits/current`, { method: "POST", headers: { ...authHeaders, "content-type": "application/json" }, body: JSON.stringify({ rows, score, issueState, planPublished, submit, planId: selectedPlanId }) });
        const data = await response.json();
        if (!response.ok)
            throw new Error(data.error || "Kayıt başarısız");
        setSaveState(submit ? "✓ Tetkik tamamlandı ve görevler gönderildi" : "✓ Kaydedildi");
    }
    catch (error) {
        setSaveState(error instanceof Error ? error.message : "Kayıt başarısız");
    } setTimeout(() => setSaveState("Kaydet"), 4000); };
    useEffect(() => {
        if (!user || user.role !== "auditor") return;
        const controller = new AbortController();
        const query = selectedPlanId ? `?planId=${encodeURIComponent(selectedPlanId)}` : "";
        setCriteriaMessage("Kriterler yükleniyor…");
        Promise.all([
            fetch(`${API_BASE}/api/audit/criteria${query}`, { headers: authHeaders, signal: controller.signal }),
            fetch(`${API_BASE}/api/audits/current${query}`, { headers: authHeaders, signal: controller.signal })
        ]).then(async ([cr, ar]) => {
            const criteriaData = await cr.json();
            if (!cr.ok) throw new Error(criteriaData.error || "Kriterler yüklenemedi");
            const auditData = ar.ok ? await ar.json() : null;
            if (controller.signal.aborted) return;
            if (!selectedPlanId && criteriaData.planId) setSelectedPlanId(criteriaData.planId);
            const savedRows: Row[] = auditData?.audit?.payload?.rows || [];
            setRows(criteriaData.criteria.map((c: {id:string;step:string;description:string;weight:number}) => {
                const previous = savedRows.find(r => String(r.id) === c.id);
                return { id:c.id, category:c.step, item:c.description, weight:Number(c.weight), status:previous?.status || "Bekliyor", note:previous?.note || "", photos:previous?.photos || [], assigneeEmail:criteriaData.assignedOwnerEmail || "" };
            }));
            const area = criteriaData.area;
            if (area) setQrInfo({ name:areaQrName(area), code:area.area_code, token:area.id });
            setCriteriaMessage(criteriaData.criteria.length
                ? `${criteriaData.auditPeriod} · ${area?.name || ""} · ${criteriaData.criteria.length} onaylı kriter`
                : `${criteriaData.auditPeriod || "Seçilen dönem"} için onaylı kriter bulunmuyor. Ünite sorumlusu planı hazırlamalı ve admin onaylamalıdır.`);
        }).catch(error => {
            if (controller.signal.aborted) return;
            setRows([]);
            setCriteriaMessage(error instanceof Error ? error.message : "Kriterler yüklenemedi");
        });
        return () => controller.abort();
    }, [user, token, selectedPlanId, screen]);
    useEffect(() => { if (!user || !token)
        return; const refresh = () => fetch(`${API_BASE}/api/task-counts`, { headers: authHeaders }).then(r => r.json()).then(d => setBadges({ issues: d.issues || 0, approvals: d.approvals || 0 })).catch(() => undefined); refresh(); const timer = setInterval(refresh, 2000); return () => clearInterval(timer); }, [user, token]);
    useEffect(() => { if (!user || !token)
        return; const refresh = () => fetch(`${API_BASE}/api/notifications`, { headers: authHeaders }).then(r => r.json()).then(d => setNotice((d.notifications || []).filter((n: {
        read_at?: string;
    }) => !n.read_at).length)).catch(() => undefined); refresh(); const timer = setInterval(refresh, 3000); return () => clearInterval(timer); }, [user, token]);
    useEffect(() => { if (!qr)
        return; const target = `${window.location.origin}/?area=${encodeURIComponent(qrInfo.code)}&qr=${encodeURIComponent(qrInfo.token)}`; QRCode.toDataURL(target, { width: 320, margin: 2, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#ffffff" } }).then(setQrDataUrl).catch(() => setQrDataUrl("")); }, [qr, qrInfo]);
    if (!user)
        return <Login enter={(u, t) => { sessionStorage.setItem("erdemir_token", t); setSelectedPlanId(""); setUser(u); setToken(t); setScreen(u.role === "auditor" ? "audit" : u.role === "area_owner" ? "issues" : "dashboard"); }}/>;
    const roleLabel = user.role === "admin" ? "Global Sistem Yöneticisi" : user.role === "area_admin" ? "Ünite Sorumlusu" : user.role === "area_owner" ? "Alan Sorumlusu" : "Tetkikçi";
    const common: Screen[] = ["training", "help"];
    const allowed = user.role === "admin" ? menu.filter(([id]) => !["history", "resolutions"].includes(id)) : menu.filter(([id]) => common.includes(id) || (user.role === "area_admin" ? ["dashboard", "criteria", "plans", "approvals", "reports"] : user.role === "auditor" ? ["plans", "audit", "history"] : ["issues", "resolutions"]).includes(id));
    return <main className="system-shell"><Sidebar allowed={allowed} screen={screen} user={user} role={roleLabel} badges={badges} go={setScreen} logout={() => { setUser(null); setToken(""); }}/><section className="content"><header className="system-top"><span>{menu.find(m => m[0] === screen)?.[1]}</span><div className="top-actions">{user.role === "auditor" && <button className="db-save" onClick={() => persist()}>{saveState}</button>}<button className="bell" aria-label="Bildirimler" onClick={() => setNoticeOpen(v => !v)}>♢{notice > 0 && <b>{notice}</b>}</button>{noticeOpen && <NotificationPanel role={user.role} area={user.areas[0]?.name} close={() => setNoticeOpen(false)} readAll={() => setNotice(0)} go={s => { setScreen(s); setNoticeOpen(false); }}/>}</div></header><div className="module">{screen === "dashboard" && <ManagerDashboard go={setScreen} token={token} user={user}/>} {screen === "areas" && <Areas token={token} openQr={area => { setQrInfo(area); setQr(true); }}/>} {screen === "criteria" && <Criteria token={token} user={user}/>} {screen === "plans" && (user.role === "auditor" ? <AuditorPlan api={API_BASE} token={token} onStart={startPlan}/> : <Plans token={token} role={user.role}/>)} {screen === "audit" && <p role="status">{criteriaMessage}</p>} {screen === "audit" && <Audit rows={rows} score={score} done={done} search={search} setSearch={setSearch} update={update} openEvidence={setActive} openQr={() => { const area = user.areas[0]; setQrInfo({ name: areaQrName(area), code: area?.area_code || "ALAN", token: area?.id || "ALAN" }); setQr(true); }} save={() => persist()} complete={() => persist(true)} saveState={saveState}/>} {screen === "history" && <AuditHistory api={API_BASE} token={token}/>} {screen === "issues" && (user.role === "area_owner" ? <AreaOwnerIssues api={API_BASE} token={token}/> : <Issues state={issueState} setState={setIssueState}/>)} {screen === "resolutions" && <AreaOwnerHistory api={API_BASE} token={token}/>} {screen === "approvals" && <ApprovalTasks api={API_BASE} token={token}/>} {screen === "reports" && <Reports api={API_BASE} token={token}/>} {screen === "training" && <Training/>} {screen === "help" && <Help role={user.role}/>}</div></section>
 {user.role === "auditor" && screen === "audit" && <button className="floating-qr-scan" onClick={() => setScanner(true)} aria-label="QR kod okuyucuyu aç"><b>▦</b><span>QR Kod Oku<small>Kamerayı aç</small></span></button>}<Evidence selected={selected} assignees={assignees} file={file} update={update} addPhotos={addPhotos} close={() => setActive(null)}/>{qr && <QrModal area={qrInfo} dataUrl={qrDataUrl} close={() => setQr(false)}/>} {scanner && <QrScannerModal expectedArea={user.areas[0]?.area_code} close={() => setScanner(false)} scanned={() => { setScanner(false); setScreen("audit"); }}/>}</main>;
}
type NotificationItem = {
    id: string;
    title: string;
    message: string;
    target: string;
    read_at?: string;
    created_at: string;
};
function NotificationPanel({ close, readAll, go }: {
    role: User["role"];
    area?: string;
    close: () => void;
    readAll: () => void;
    go: (s: Screen) => void;
}) { const [items, setItems] = useState<NotificationItem[]>([]); const auth = { Authorization: `Bearer ${sessionStorage.getItem("erdemir_token") || ""}` }; useEffect(() => { fetch(`${API_BASE}/api/notifications`, { headers: auth }).then(r => r.json()).then(d => setItems(d.notifications || [])).catch(() => setItems([])); }, []); const destination = (target: string): Screen => (["dashboard", "plans", "audit", "issues", "resolutions", "approvals", "criteria"].includes(target) ? target : "dashboard") as Screen; const markAll = async () => { await fetch(`${API_BASE}/api/notifications/read-all`, { method: "POST", headers: auth }); setItems(current => current.map(item => ({ ...item, read_at: item.read_at || new Date().toISOString() }))); readAll(); }; return <aside className="notification-panel"><div className="notification-head"><div><span>BİLDİRİMLER</span><h3>Bana atanan görevler</h3></div><button onClick={close}>×</button></div><div className="notification-list">{items.map(n => <button key={n.id} className={n.read_at ? "" : "unread"} onClick={() => go(destination(n.target))}><i>{n.target === "issues" ? "!" : n.target === "approvals" ? "✓" : "◷"}</i><span><b>{n.title}</b><small>{n.message}</small><em>{new Date(n.created_at).toLocaleString("tr-TR")}</em></span></button>)}{!items.length && <p style={{ padding: 18 }}>Henüz bildiriminiz bulunmuyor.</p>}</div><button className="read-all" onClick={markAll}>Tümünü okundu işaretle</button></aside>; }
function Login({ enter }: {
    enter: (u: User, t: string) => void;
}) { const [email, setEmail] = useState("admin@erdemir.com.tr"), [password, setPassword] = useState("12345678"), [error, setError] = useState(""), [busy, setBusy] = useState(false); const submit = async () => { setBusy(true); setError(""); try {
    const r = await fetch(`${API_BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    const d = await r.json();
    if (!r.ok)
        throw new Error(d.error);
    enter(d.user, d.token);
}
catch (e) {
    setError(e instanceof Error ? e.message : "Giriş başarısız");
}
finally {
    setBusy(false);
} }; return <main className="login"><section className="login-visual"><div className="login-copy"><span>ERDEMİR · DİJİTAL OPERASYON</span><h1>5S’i sahada yönet,<br />sonucu anında gör.</h1><p>Planlamadan düzeltici faaliyet onayına kadar tüm 5S tetkik süreci tek merkezde.</p></div></section><section className="login-panel"><Logo /><div className="login-box"><span className="eyebrow">GÜVENLİ KURUMSAL ERİŞİM</span><h2>Tekrar hoş geldiniz</h2><p>Rolünüz ve erişebileceğiniz alanlar hesabınızdan belirlenir.</p><label>Kullanıcı adı veya e-posta<input value={email} onChange={e => setEmail(e.target.value)}/></label><label>Şifre<input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()}/></label>{error && <p className="danger-text">{error}</p>}<button className="primary wide" disabled={busy} onClick={submit}>{busy ? "Giriş yapılıyor..." : "Giriş yap"}<b>→</b></button><small className="secure">▣ Rol ve alan bazlı güvenli erişim</small></div></section></main>; }
function Sidebar({ allowed, screen, user, role, badges, go, logout }: {
    allowed: [
        Screen,
        string,
        string
    ][];
    screen: Screen;
    user: User;
    role: string;
    badges: {
        issues: number;
        approvals: number;
    };
    go: (s: Screen) => void;
    logout: () => void;
}) { const initials = user.fullName.split(" ").map(x => x[0]).join("").slice(0, 2); return <aside className="sidebar"><Logo /><div className="role"><span>{initials}</span><div><b>{user.role === "area_admin" ? user.fullName.replace(/Müdürlük Yöneticisi|Müdürlüğü Yöneticisi|Yöneticisi/g, "Ünite Sorumlusu") : user.fullName}</b><small>{role}</small></div></div><nav>{allowed.map(([id, label, icon]) => { const count = id === "issues" ? badges.issues : id === "approvals" ? badges.approvals : 0; return <button key={id} className={screen === id ? "active" : ""} onClick={() => go(id)}><i>{icon}</i>{label}{count > 0 && <em>{count}</em>}</button>; })}</nav><div className="side-bottom"><button onClick={logout}>↪ Çıkış yap</button><small>5S Sistem · v1.0</small></div></aside>; }
function Evidence({ selected, assignees, file, update, addPhotos, close }: {
    selected: Row | undefined;
    assignees: Assignee[];
    file: React.RefObject<HTMLInputElement | null>;
    update: (id: string | number, p: Partial<Row>) => void;
    addPhotos: (f: FileList | null) => void;
    close: () => void;
}) { if (!selected)
    return null; return <div className="overlay" onMouseDown={close}><aside onMouseDown={e => e.stopPropagation()}><div className="side-head"><div><span className="eyebrow">KRİTER {String(selected.id).padStart(2, "0")}</span><h2>Uygunsuzluk ve kanıt</h2></div><button onClick={close}>×</button></div><p className="criterion">{selected.item}</p><label className="field">Değerlendirme<select value={selected.status} onChange={e => update(selected.id, { status: e.target.value as Status })}><option>Bekliyor</option><option>Uygun</option><option>Uygun Değil</option></select></label>{selected.status === "Uygun Değil" && <label className="field">Alan sorumlusu<input readOnly value={selected.assigneeEmail || "Planda alan sorumlusu atanmamış"} aria-label="Admin onaylı alan sorumlusu"/></label>}<label className="field">Uygunsuzluk açıklaması<textarea value={selected.note} onChange={e => update(selected.id, { note: e.target.value })}/></label><label className="field">Zorunlu fotoğraf kanıtı<button className="camera" onClick={() => file.current?.click()}><b>📷</b><strong>Fotoğraf çek veya yükle</strong><small>Mobil kamera desteklenir · JPG, PNG</small></button><input ref={file} hidden type="file" accept="image/*" capture="environment" multiple onChange={e => addPhotos(e.target.files)}/></label><div className="side-actions"><button className="outline" onClick={close}>Vazgeç</button><button className="primary" disabled={selected.status === "Uygun Değil" && (!selected.photos.length || !selected.assigneeEmail)} onClick={close}>Kanıtı kaydet</button></div></aside></div>; }
function QrModal({ area, dataUrl, close }: {
    area: {
        name: string;
        code: string;
        token: string;
    };
    dataUrl: string;
    close: () => void;
}) { const download = () => { if (!dataUrl)
    return; const a = document.createElement("a"); a.href = dataUrl; a.download = `${area.code.toLowerCase()}-5s-qr.png`; a.click(); }; return <div className="overlay modal-wrap" onMouseDown={close}><div className="modal" onMouseDown={e => e.stopPropagation()}><button className="x" onClick={close}>×</button><span className="eyebrow">MÜDÜRLÜĞE ÖZEL QR KODU</span><h2>{area.name}</h2><p>Bu kod yalnızca {area.name} aktif kriter tablosunu tanımlar.</p>{dataUrl ? <img src={dataUrl} alt={`${area.name} QR kodu`} style={{ width: 280, height: 280, margin: "10px auto", display: "block" }}/> : <p>QR kodu hazırlanıyor…</p>}<b>ERD-5S-{area.code}</b><div className="modal-actions"><button className="outline" onClick={() => window.print()}>Yazdır</button><button className="primary" disabled={!dataUrl} onClick={download}>Cihaza indir</button></div></div></div>; }
