package tr.com.erdemir.tetkik;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDate;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

/** Called inside the controller transaction for every planning mutation. */
public class PlanningService {
  private final JdbcTemplate db;
  private final ObjectMapper json;
  public PlanningService(JdbcTemplate db, ObjectMapper json) { this.db=db; this.json=json; }
  private String str(Object value) { return value == null ? "" : value.toString(); }
  private boolean admin(Map<String,Object> user) { return "admin".equals(str(user.get("role"))); }
  void manager(Map<String,Object> user) {
    if (!admin(user) && !"area_admin".equals(str(user.get("role")))) throw new ApiException(403,"Bu işlem yalnızca ünite sorumlusu ve admin içindir");
  }
  private Map<String,Object> one(String sql,Object... args) {
    var rows=db.queryForList(sql,args); if(rows.isEmpty()) throw new ApiException(404,"Kayıt bulunamadı"); return rows.get(0);
  }
  private void areaAccess(Map<String,Object> user,Object area) {
    manager(user);
    if (!admin(user) && db.queryForObject("SELECT count(*) FROM areas WHERE id=?::uuid AND manager_id=?::uuid AND active=true",Integer.class,area,user.get("id"))==0) throw new ApiException(403,"Yalnızca kendi ünitenizi yönetebilirsiniz");
  }
  private Map<String,Object> candidate(Map<String,Object> user,Object area,String email,String role) {
    var u=one("SELECT id,full_name,email FROM users WHERE lower(email)=lower(?) AND role::text=? AND active=true",email,role);
    if(!admin(user) && db.queryForObject("SELECT count(*) FROM area_user_memberships WHERE area_id=?::uuid AND user_id=?::uuid",Integer.class,area,u.get("id"))==0) throw new ApiException(403,"Seçilen kullanıcı bu üniteye kayıtlı değil");
    return u;
  }
  Map<String,Object> candidates(Map<String,Object> user,String areaId) {
    areaAccess(user,areaId);
    String sql="SELECT u.id,u.full_name,u.email,u.role::text AS role FROM users u WHERE u.active=true AND u.role IN ('auditor','area_owner')";
    var users=admin(user)?db.queryForList(sql+" ORDER BY u.full_name"):db.queryForList(sql+" AND EXISTS(SELECT 1 FROM area_user_memberships m WHERE m.user_id=u.id AND m.area_id=?::uuid) ORDER BY u.full_name",areaId);
    return Map.of("users",users);
  }
  List<Map<String,Object>> snapshot(Object value) {
    try { return json.readValue(str(value),new TypeReference<List<Map<String,Object>>>(){}); }
    catch(Exception e) { throw new ApiException(409,"Planın kriter kaydı okunamadı; plan yeniden hazırlanmalıdır"); }
  }
  Map<String,Object> list(Map<String,Object> user) {
    String sql="SELECT p.*,a.area_code,a.name AS area_name,u.full_name AS auditor_name,u.email AS auditor_email,ao.full_name AS assigned_owner_name,ao.email AS assigned_owner_email,req.full_name AS requester_name FROM audit_plans p JOIN areas a ON a.id=p.area_id JOIN users u ON u.id=p.primary_auditor_id LEFT JOIN users ao ON ao.id=p.assigned_owner_id LEFT JOIN users req ON req.id=p.requested_by";
    String role=str(user.get("role")); List<Map<String,Object>> rows;
    if(admin(user)) rows=db.queryForList(sql+" WHERE p.approval_status<>'deleted' ORDER BY p.created_at DESC");
    else if(role.equals("area_admin")) rows=db.queryForList(sql+" WHERE p.approval_status<>'deleted' AND a.manager_id=?::uuid ORDER BY p.audit_date DESC",user.get("id"));
    else if(role.equals("auditor")) rows=db.queryForList(sql+" WHERE p.published=true AND p.approval_status='approved' AND (p.primary_auditor_id=?::uuid OR p.backup_auditor_id=?::uuid) ORDER BY p.audit_date",user.get("id"),user.get("id"));
    else throw new ApiException(403,"Planlara erişim yetkiniz yok");
    for(var r:rows){
      r.put("criteria_snapshot",snapshot(r.get("criteria_snapshot")));
      r.put("can_delete", !role.equals("auditor") && db.queryForObject("SELECT count(*) FROM audits WHERE plan_id=?::uuid",Integer.class,r.get("id"))==0);
    }
    return Map.of("plans",rows);
  }
  private void event(Object plan,int revision,Object actor,String type,Map<String,Object> details)throws Exception {
    db.update("INSERT INTO plan_approval_events(plan_id,revision,actor_id,event_type,details) VALUES(?::uuid,?,?::uuid,?,?::jsonb)",plan,revision,actor,type,json.writeValueAsString(details));
  }
  private void notify(Object user,String title,String text,String target){db.update("INSERT INTO notifications(user_id,title,message,target) VALUES(?::uuid,?,?,?)",user,title,text,target);}
  Map<String,Object> submit(Map<String,Object> user,Map<String,Object> body)throws Exception {
    Object area=body.get("areaId"); areaAccess(user,area);
    // Serialize submissions for this area, including first-time plan creation.
    one("SELECT id FROM areas WHERE id=?::uuid AND active=true FOR UPDATE",area);
    LocalDate date;try{date=LocalDate.parse(str(body.get("auditDate")));}catch(Exception e){throw new ApiException(400,"Geçerli tetkik tarihi girin");}
    String month=date.toString().substring(0,7);
    var auditor=candidate(user,area,str(body.get("auditorEmail")),"auditor");
    var owner=candidate(user,area,str(body.get("ownerEmail")),"area_owner");
    var criteria=db.queryForList("SELECT id,step,description,weight,version_id FROM criteria WHERE area_id=?::uuid AND audit_period=? AND approval_status<>'removed' ORDER BY created_at",area,month);
    if(criteria.isEmpty())throw new ApiException(400,"Önce bu ay için kriter belirleyin");
    var existing=db.queryForList("SELECT id,revision FROM audit_plans WHERE area_id=?::uuid AND approval_status<>'deleted' AND to_char(audit_date,'YYYY-MM')=? ORDER BY created_at DESC FOR UPDATE",area,month);
    // Reuse the archived monthly slot as a new revision: the database keeps period/area unique.
    if(existing.isEmpty())existing=db.queryForList("SELECT id,revision FROM audit_plans WHERE area_id=?::uuid AND period=? AND approval_status='deleted' FOR UPDATE",area,month);
    Object planId; int revision=1;
    if(!existing.isEmpty()) {
      if(existing.size()>1)throw new ApiException(409,"Bu ayda birden fazla eski plan var; admin ile plan kayıtlarını kontrol edin");
      planId=existing.get(0).get("id"); revision=((Number)existing.get(0).get("revision")).intValue()+1;
      if(db.queryForObject("SELECT count(*) FROM audits WHERE plan_id=?::uuid",Integer.class,planId)>0)throw new ApiException(409,"Başlatılmış/geçmiş tetkikin planı değiştirilemez. Yeni dönem seçin");
      db.update("UPDATE audit_plans SET audit_date=?::date,primary_auditor_id=?::uuid,backup_auditor_id=NULL,assigned_owner_id=?::uuid,published=false,approval_status='pending',revision=?,criteria_snapshot=?::jsonb,requested_by=?::uuid,approved_by=NULL,approved_at=NULL,rejection_reason=NULL WHERE id=?::uuid",date.toString(),auditor.get("id"),owner.get("id"),revision,json.writeValueAsString(criteria),user.get("id"),planId);
    }else{
      planId=one("INSERT INTO audit_plans(period,audit_date,area_id,primary_auditor_id,assigned_owner_id,published,approval_status,criteria_snapshot,requested_by) VALUES(?,?::date,?::uuid,?::uuid,?::uuid,false,'pending',?::jsonb,?::uuid) RETURNING id",month,date.toString(),area,auditor.get("id"),owner.get("id"),json.writeValueAsString(criteria),user.get("id")).get("id");
    }
    event(planId,revision,user.get("id"),"submitted",Map.of("criteria",criteria,"auditor",auditor,"owner",owner,"date",date.toString()));
    for(var a:db.queryForList("SELECT id FROM users WHERE role='admin' AND active=true"))notify(a.get("id"),"Planlama onayı bekliyor",month+" dönemi: kriter ve görevli atamalarını inceleyin.","plans");
    return Map.of("ok",true,"id",planId,"revision",revision,"message","Plan, kriterler ve atamalar admin onayına gönderildi. Görevlilere henüz bildirim gönderilmedi.");
  }
  Map<String,Object> remove(Map<String,Object> user,String id,int revision)throws Exception {
    manager(user);
    var plan=one("SELECT * FROM audit_plans WHERE id=?::uuid FOR UPDATE",id);
    areaAccess(user,plan.get("area_id"));
    if("deleted".equals(plan.get("approval_status")) || ((Number)plan.get("revision")).intValue()!=revision)
      throw new ApiException(409,"Plan değişmiş veya silinmiş. Listeyi yenileyin");
    if(db.queryForObject("SELECT count(*) FROM audits WHERE plan_id=?::uuid",Integer.class,id)>0)
      throw new ApiException(409,"Bu plana bağlı tetkik kaydı var; geçmiş kayıtları korumak için silinemez");
    // Keep approval history for traceability; remove the plan from operational lists.
    db.update("UPDATE audit_plans SET approval_status='deleted',published=false,revision=revision+1 WHERE id=?::uuid",id);
    event(id,revision+1,user.get("id"),"deleted",Map.of("previousStatus",str(plan.get("approval_status"))));
    if(Boolean.TRUE.equals(plan.get("published"))){
      String message=plan.get("period")+" dönemi tetkik planı kaldırıldı; bu plana ait görevlendirme iptal edildi.";
      if(plan.get("primary_auditor_id")!=null)notify(plan.get("primary_auditor_id"),"Tetkik planı kaldırıldı",message,"plans");
      if(plan.get("assigned_owner_id")!=null)notify(plan.get("assigned_owner_id"),"Görevlendirme iptal edildi",message,"issues");
    }
    return Map.of("ok",true,"message","Plan silindi. Kriterleriniz korunuyor.");
  }
  Map<String,Object> decide(Map<String,Object> user,String id,Map<String,Object> body,boolean approve)throws Exception {
    if(!admin(user))throw new ApiException(403,"Planı yalnızca admin onaylayabilir");
    var plan=one("SELECT p.*,a.area_code FROM audit_plans p JOIN areas a ON a.id=p.area_id WHERE p.id=?::uuid FOR UPDATE OF p",id);
    if(!"pending".equals(plan.get("approval_status")) || !str(plan.get("revision")).equals(str(body.get("revision"))))throw new ApiException(409,"Plan değişmiş veya daha önce değerlendirilmiş. Listeyi yenileyin");
    String reason=str(body.get("reason")).trim();
    if(!approve && reason.isBlank())throw new ApiException(400,"Ret gerekçesi zorunludur");
    if(approve){
      if(snapshot(plan.get("criteria_snapshot")).isEmpty())throw new ApiException(400,"Kritersiz plan onaylanamaz");
      if(db.queryForObject("SELECT count(*) FROM users WHERE active=true AND ((id=?::uuid AND role='auditor') OR (id=?::uuid AND role='area_owner'))",Integer.class,plan.get("primary_auditor_id"),plan.get("assigned_owner_id"))!=2)throw new ApiException(409,"Atanan kullanıcıların rol veya aktiflik durumu değişmiş");
      db.update("UPDATE audit_plans SET approval_status='approved',published=true,approved_by=?::uuid,approved_at=now(),rejection_reason=NULL WHERE id=?::uuid",user.get("id"),id);
      String message=plan.get("period")+" · "+plan.get("area_code")+" · "+plan.get("audit_date");
      notify(plan.get("primary_auditor_id"),"Tetkik planınız admin tarafından onaylandı",message,"plans");
      notify(plan.get("assigned_owner_id"),"Alan sorumluluğu atamanız onaylandı",message,"issues");
    }else db.update("UPDATE audit_plans SET approval_status='rejected',published=false,rejection_reason=? WHERE id=?::uuid",reason,id);
    if(plan.get("requested_by")!=null)notify(plan.get("requested_by"),approve?"Planlama onaylandı":"Planlama reddedildi",approve?"Atanan kişilere bildirim gönderildi.":reason,"plans");
    event(id,((Number)plan.get("revision")).intValue(),user.get("id"),approve?"approved":"rejected",Map.of("reason",reason));
    return Map.of("ok",true);
  }
}
