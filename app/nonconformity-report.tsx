"use client";
import { useEffect, useState } from "react";
type RecordRow = { id: string; area_code: string; area_name: string; criterion_text: string; finding: string; status: string; audit_no: string; period?: string; auditor_name?: string; responsible_name?: string; approver_name?: string; created_at: string; due_at: string; resolved_at?: string; approved_at?: string; resolution_text?: string; resolution_photo_url?: string };
type Report = { scope: string; generatedAt: string; areas: { id:string;area_code:string;name:string }[]; records: RecordRow[] };
const labels: Record<string,string> = { open:"Düzeltme bekliyor",waiting_approval:"Onay bekliyor",approved:"Giderildi / Onaylandı" };
const date=(v?:string)=>v?new Date(v).toLocaleDateString("tr-TR"):"—";
export function NonconformityReport({ api, token }: {api:string;token:string}) {
    const [data,setData]=useState<Report|null>(null),[from,setFrom]=useState(""),[to,setTo]=useState(""),[status,setStatus]=useState(""),[area,setArea]=useState(""),[error,setError]=useState(""),[loading,setLoading]=useState(false);
    const [applied,setApplied]=useState({from:"",to:"",status:"",area:""});
    useEffect(()=>{
        const abort=new AbortController();setLoading(true);setError("");setData(null);
        const q=new URLSearchParams({from:applied.from,to:applied.to,status:applied.status,areaId:applied.area});
        fetch(`${api}/api/reports/nonconformities?${q}`,{headers:{Authorization:`Bearer ${token}`},signal:abort.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||"Rapor alınamadı");setData(d);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
        return()=>abort.abort();
    },[api,token,applied]);
    return <section className="nonconformity-report">
        <div className="panel report-controls"><h2>Geçmiş uygunsuzluk raporu</h2><p>Yetkili olduğunuz alanların kayıtlarını tarih ve duruma göre inceleyin.</p>
            <div className="plan-form"><label>Başlangıç tarihi<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Bitiş tarihi<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
            <div className="plan-form"><label>Alan<select value={area} onChange={e=>setArea(e.target.value)}><option value="">Yetkili tüm alanlar</option>{data?.areas.map(a=><option key={a.id} value={a.id}>{a.area_code} · {a.name}</option>)}</select></label><label>Durum<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Tüm durumlar</option>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
            <div className="action-row"><button className="primary" disabled={loading} onClick={()=>setApplied({from,to,status,area})}>Raporu getir</button><button className="outline" disabled={loading||!data} onClick={()=>window.print()}>PDF / Yazdır</button></div>
            <p>PDF için açılan yazdırma ekranında hedefi “PDF olarak kaydet” seçin. Çıktı, son getirilen raporu içerir.</p>
            {loading&&<p role="status">Rapor hazırlanıyor…</p>}{error&&<p role="alert" className="danger-text">{error}</p>}
        </div>
        {data&&<section className="panel report-print"><h2>5S Uygunsuzluk Raporu</h2><h3>{data.scope}</h3><p>Kayıt tarihi: {applied.from?date(applied.from):"Başlangıçtan"} — {applied.to?date(applied.to):"Bugüne"} · Durum: {labels[applied.status]||"Tümü"}</p><p>Oluşturulma: {new Date(data.generatedAt).toLocaleString("tr-TR")}</p>
            <p><b>Toplam: {data.records.length}</b> · Düzeltme bekleyen: {data.records.filter(r=>r.status==="open").length} · Onay bekleyen: {data.records.filter(r=>r.status==="waiting_approval").length} · Giderilen: {data.records.filter(r=>r.status==="approved").length}</p>
            <div className="report-table-scroll"><table className="report-table"><thead><tr><th>Tarih / Dönem</th><th>Alan</th><th>Uygunsuzluk</th><th>Sorumlular</th><th>Durum / Sonuç</th></tr></thead><tbody>{data.records.map(r=><tr key={r.id}>
                <td>{date(r.created_at)}<small>{r.period||"Eski kayıt"}</small><small>{r.audit_no}</small></td>
                <td>{r.area_code}<small>{r.area_name}</small></td><td><b>{r.criterion_text}</b><p>{r.finding||"Tetkikçi açıklaması yok"}</p></td>
                <td>Tetkikçi: {r.auditor_name||"—"}<small>Alan sorumlusu: {r.responsible_name||"—"}</small></td>
                <td><b>{labels[r.status]||r.status}</b><p>{r.resolution_text||"Henüz düzeltme açıklaması yok"}</p><small>Son tarih: {date(r.due_at)}</small><small>Düzeltme: {date(r.resolved_at)}</small><small>Onay: {date(r.approved_at)} · {r.approver_name||"—"}</small></td>
            </tr>)}</tbody></table></div>{!data.records.length&&<p>Bu filtrelere uygun uygunsuzluk bulunmuyor.</p>}
        </section>}
    </section>;
}
