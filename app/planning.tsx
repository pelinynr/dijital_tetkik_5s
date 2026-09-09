"use client";
import { useEffect, useState } from "react";
const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";
type Area = { id: string; area_code: string; name: string };
type Candidate = { id: string; full_name: string; email: string; role: string };
type Criterion = { id: string; step: string; description: string; weight: number };
type Plan = { id: string; revision: number; can_delete: boolean; period: string; audit_date: string; area_id: string; area_code: string; area_name: string; auditor_name: string; auditor_email: string; assigned_owner_name: string; assigned_owner_email: string; requester_name: string; approval_status: string; rejection_reason?: string; criteria_snapshot: Criterion[] };
const stateLabel: Record<string,string> = { pending: "Admin onayı bekliyor", approved: "Onaylandı", rejected: "Reddedildi" };
export function Plans({ token, role }: { token: string; role: string }) {
    const [plans, setPlans] = useState<Plan[]>([]), [areas, setAreas] = useState<Area[]>([]), [candidates, setCandidates] = useState<Candidate[]>([]);
    const [areaId, setAreaId] = useState(""), [date, setDate] = useState(new Date().toLocaleDateString("sv-SE"));
    const [auditor, setAuditor] = useState(""), [owner, setOwner] = useState(""), [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false), [reasons, setReasons] = useState<Record<string,string>>({}), [filter, setFilter] = useState("all");
    const [preview, setPreview] = useState<Criterion[]>([]), [previewLoading, setPreviewLoading] = useState(false);
    const headers = { Authorization: `Bearer ${token}` };
    const load = async () => {
        const responses = await Promise.all([fetch(`${API}/api/plans`, { headers }), fetch(`${API}/api/areas`, { headers })]);
        const [p,a] = await Promise.all(responses.map(r=>r.json()));
        if(!responses[0].ok || !responses[1].ok) throw new Error(p.error || a.error || "Planlar yüklenemedi");
        setPlans(p.plans); setAreas(a.areas); setAreaId(current=>current || a.areas[0]?.id || "");
    };
    useEffect(()=>{
        const refresh=()=>load().catch(e=>setMessage(e.message));
        refresh();const timer=setInterval(refresh,5000);
        window.addEventListener("focus",refresh);
        return()=>{clearInterval(timer);window.removeEventListener("focus",refresh);};
    },[token]);
    useEffect(()=>{
        setCandidates([]); setAuditor(""); setOwner("");
        if(!areaId) return;
        const abort=new AbortController();
        fetch(`${API}/api/planning/candidates?areaId=${encodeURIComponent(areaId)}`,{headers,signal:abort.signal}).then(async r=>{
            const d=await r.json(); if(!r.ok)throw new Error(d.error);setCandidates(d.users);
        }).catch(e=>{if(!abort.signal.aborted)setMessage(e.message);});
        return ()=>abort.abort();
    },[areaId,token]);
    useEffect(()=>{
        setPreview([]); if(!areaId||!date)return;
        const abort=new AbortController(); setPreviewLoading(true);
        fetch(`${API}/api/criteria?areaId=${encodeURIComponent(areaId)}&auditPeriod=${date.slice(0,7)}`,{headers,signal:abort.signal}).then(async r=>{
            const d=await r.json();if(!r.ok)throw new Error(d.error);setPreview(d.criteria);
        }).catch(e=>{if(!abort.signal.aborted)setMessage(e.message);}).finally(()=>{if(!abort.signal.aborted)setPreviewLoading(false);});
        return ()=>abort.abort();
    },[areaId,date,token]);
    const save=async()=>{
        setBusy(true);setMessage("");
        try {
            const r=await fetch(`${API}/api/plans`,{method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify({areaId,auditDate:date,auditorEmail:auditor,ownerEmail:owner})});
            const d=await r.json();if(!r.ok)throw new Error(d.error);setMessage(d.message);await load();
        }catch(e){setMessage(e instanceof Error?e.message:"Plan kaydedilemedi");}finally{setBusy(false);}
    };
    const remove=async(p:Plan)=>{
        if(!window.confirm(`${p.area_name} · ${p.period} planını silmek istiyor musunuz? Görevlendirme iptal edilir, kriterleriniz korunur.`))return;
        setBusy(true);setMessage("");
        try{
            const r=await fetch(`${API}/api/plans/${p.id}?revision=${p.revision}`,{method:"DELETE",headers});
            const d=await r.json();if(!r.ok)throw new Error(d.error||"Plan silinemedi");
            setMessage(d.message);await load();
        }catch(e){setMessage(e instanceof Error?e.message:"Plan silinemedi");await load().catch(()=>{});}finally{setBusy(false);}
    };
    const decide=async(p:Plan,approve:boolean)=>{
        if(!approve&&!reasons[p.id]?.trim()){setMessage("Ret gerekçesi yazın.");return;}
        setBusy(true);setMessage("");
        try{
            const r=await fetch(`${API}/api/plans/${p.id}/${approve?"approve":"reject"}`,{method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify({revision:p.revision,reason:reasons[p.id]||""})});
            const d=await r.json();if(!r.ok)throw new Error(d.error);
            setMessage(approve?"Plan onaylandı; tetkikçi ve alan sorumlusuna bildirim gönderildi.":"Plan reddedildi; ünite sorumlusuna geri gönderildi.");await load();
        }catch(e){setMessage(e instanceof Error?e.message:"İşlem başarısız");await load().catch(()=>{});}finally{setBusy(false);}
    };
    return <>
        <div className="module-title"><div><span className="eyebrow">PLANLAMA VE ADMIN ONAYI</span><h1>Tetkik planlama</h1><p>Ünite sorumlusu kriterleri ve iki görevliyi belirler. Admin onayından sonra plan açılır ve bildirimler gönderilir.</p></div></div>
        <section className="planner"><h3>Planı ve atamaları onaya gönder</h3>
            <div className="plan-form"><label>Ünite / alan<select value={areaId} onChange={e=>setAreaId(e.target.value)}>{areas.map(a=><option key={a.id} value={a.id}>{a.area_code} · {a.name}</option>)}</select></label><label>Tetkik tarihi<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label></div>
            <div className="plan-form"><label>Tetkikçi<select value={auditor} onChange={e=>setAuditor(e.target.value)}><option value="">Tetkikçi seçin</option>{candidates.filter(c=>c.role==="auditor").map(c=><option key={c.id} value={c.email}>{c.full_name} · {c.email}</option>)}</select></label><label>Alan sorumlusu<select value={owner} onChange={e=>setOwner(e.target.value)}><option value="">Alan sorumlusu seçin</option>{candidates.filter(c=>c.role==="area_owner").map(c=><option key={c.id} value={c.email}>{c.full_name} · {c.email}</option>)}</select></label></div>
            <details><summary>{date.slice(0,7)} · {previewLoading?"Kriterler yükleniyor…":`${preview.length} kriter onaya eklenecek`}</summary><ol>{preview.map(c=><li key={c.id}>{c.step} · {c.description} ({c.weight} puan)</li>)}</ol></details>
            {!previewLoading&&!preview.length&&<p>Önce Kriter Yönetimi bölümünden bu ayın kriterlerini belirleyin.</p>}
            <button className="primary" disabled={busy||previewLoading||!preview.length||!areaId||!date||!auditor||!owner} onClick={save}>{busy?"İşleniyor…":"Planı ve atamaları admin onayına gönder"}</button>
            <p>Aynı ayın henüz başlatılmamış planını yeniden gönderirseniz yeni onay gerekir. Gönderilen kriter paketi sonradan otomatik değişmez.</p>
        </section>
        {message&&<p role="status" className="planning-message">{message}</p>}
        <section className="panel"><div className="panel-head"><h3>{role==="admin"?"Planlama onayları ve geçmiş planlar":"Ünitemin planları"}</h3><label>Durum<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Tümü</option>{Object.entries(stateLabel).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><button className="outline" onClick={()=>load().catch(e=>setMessage(e.message))}>Yenile</button></div>
            {plans.filter(p=>filter==="all"||p.approval_status===filter).map(p=><article className="planning-card" key={p.id}>
                <h3>{p.area_code} · {p.area_name} — {p.period}</h3><p><b>{stateLabel[p.approval_status]||p.approval_status}</b> · Sürüm {p.revision} · {new Date(p.audit_date).toLocaleDateString("tr-TR")}</p>
                <p>Tetkikçi: <b>{p.auditor_name}</b> ({p.auditor_email})</p><p>Alan sorumlusu: <b>{p.assigned_owner_name||"Atanmadı"}</b> ({p.assigned_owner_email||"—"})</p>
                {p.requester_name&&<p>Hazırlayan: {p.requester_name}</p>}
                <details><summary>Onaya gönderilen kriterler ({p.criteria_snapshot?.length||0})</summary><ol>{p.criteria_snapshot?.map(c=><li key={c.id}><b>{c.step}:</b> {c.description} — {c.weight} puan</li>)}</ol></details>
                {p.rejection_reason&&<p className="danger-text">Ret gerekçesi: {p.rejection_reason}</p>}
                <div className="action-row"><button className="outline" disabled={busy||!p.can_delete} onClick={()=>remove(p)}>Planı sil</button>{!p.can_delete&&<small>Tetkik kaydı bulunduğu için silinemez.</small>}</div>
                {role==="admin"&&p.approval_status==="pending"&&<div><label className="field">Ret gerekçesi<textarea value={reasons[p.id]||""} onChange={e=>setReasons({...reasons,[p.id]:e.target.value})}/></label><div className="action-row"><button className="outline" disabled={busy} onClick={()=>decide(p,false)}>Gerekçeyle reddet</button><button className="primary" disabled={busy} onClick={()=>decide(p,true)}>Kriterleri ve atamaları onayla</button></div></div>}
            </article>)}
            {!plans.length&&<p>Henüz plan bulunmuyor.</p>}
        </section>
    </>;
}
