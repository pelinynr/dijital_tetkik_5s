package tr.com.erdemir.tetkik;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api")
public class ApiController {
  private final JdbcTemplate jdbc;
  private final JwtService jwt;
  private final ObjectMapper mapper;
  private final BCryptPasswordEncoder passwords = new BCryptPasswordEncoder();
  private final Path uploadDir;
  private final String publicUrl;

  public ApiController(JdbcTemplate jdbc, JwtService jwt, ObjectMapper mapper,
                       @Value("${app.upload-dir}") String uploadDir,
                       @Value("${app.public-url}") String publicUrl) throws IOException {
    this.jdbc = jdbc;
    this.jwt = jwt;
    this.mapper = mapper;
    this.uploadDir = Path.of(uploadDir).toAbsolutePath().normalize();
    this.publicUrl = publicUrl.replaceAll("/$", "");
    Files.createDirectories(this.uploadDir);
  }

  @GetMapping("/health")
  Map<String, Object> health() {
    Map<String, Object> row = one("SELECT current_database() AS database,now() AS time");
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("ok", true);
    result.putAll(row);
    return result;
  }

  @PostMapping("/auth/login")
  Map<String, Object> login(@RequestBody Map<String, Object> body) {
    String email = text(body.get("email")).trim().toLowerCase(Locale.ROOT);
    if (!email.contains("@")) email += "@erdemir.com.tr";
    Map<String, Object> found = maybeOne("SELECT id,email,password_hash,full_name,role::text AS role,active FROM users WHERE email=?", email);
    if (found == null || !Boolean.TRUE.equals(found.get("active")) || !passwords.matches(text(body.get("password")), text(found.get("password_hash")))) {
      throw new ApiException(401, "Kullanıcı adı veya şifre hatalı");
    }
    Map<String, Object> safe = userResponse(found);
    safe.put("areas", accessibleAreas(found));
    return Map.of("token", jwt.create(text(found.get("id")), text(found.get("role"))), "user", safe);
  }

  @GetMapping("/me")
  Map<String, Object> me(HttpServletRequest request) {
    Map<String, Object> current = user(request);
    Map<String, Object> safe = userResponse(current);
    safe.put("areas", accessibleAreas(current));
    return Map.of("user", safe);
  }

  @GetMapping("/areas")
  Map<String, Object> areas(HttpServletRequest request) {
    return Map.of("areas", accessibleAreas(user(request)));
  }

  @GetMapping("/admin/area-config")
  Map<String, Object> areaConfig(HttpServletRequest request) {
    Map<String, Object> current = user(request);
    requireRole(current, "admin", "area_admin");
    String filter = role(current).equals("area_admin") ? " AND a.manager_id=?::uuid" : "";
    List<Map<String, Object>> areas = role(current).equals("area_admin")
        ? list("SELECT a.id,a.area_code,a.name,a.qr_token,u.id AS owner_id,u.full_name AS owner_name,u.email AS owner_email FROM areas a LEFT JOIN users u ON u.id=a.owner_id WHERE a.active=true" + filter + " ORDER BY a.area_code", id(current))
        : list("SELECT a.id,a.area_code,a.name,a.qr_token,u.id AS owner_id,u.full_name AS owner_name,u.email AS owner_email FROM areas a LEFT JOIN users u ON u.id=a.owner_id WHERE a.active=true ORDER BY a.area_code");
    return Map.of("areas", areas, "users", list("SELECT id,full_name,email FROM users WHERE role='area_owner' AND active=true ORDER BY full_name"));
  }

  @PostMapping("/admin/assign-area")
  Map<String,Object> assignArea(HttpServletRequest request,@RequestBody Map<String,Object> body) {
    new PlanningService(jdbc,mapper).manager(user(request));
    throw new ApiException(409,"Atamaları tetkik planlama ekranından admin onayına gönderin");
  }

  @GetMapping("/notifications")
  Map<String, Object> notifications(HttpServletRequest request) {
    return Map.of("notifications", list("SELECT id,title,message,target,read_at,created_at FROM notifications WHERE user_id=?::uuid ORDER BY created_at DESC LIMIT 20", id(user(request))));
  }

  @PostMapping("/notifications/read-all")
  Map<String, Object> notificationsReadAll(HttpServletRequest request) {
    jdbc.update("UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE user_id=?::uuid", id(user(request)));
    return Map.of("ok", true);
  }

  @GetMapping("/audit/assignees")
  Map<String, Object> auditAssignees(HttpServletRequest request) {
    Map<String, Object> current = user(request);
    requireRole(current, "auditor");
    List<Map<String, Object>> areas = accessibleAreas(current);
    if (areas.isEmpty()) return Map.of("assignees", List.of());
    String in = placeholders(areas.size());
    List<Object> args = areas.stream().map(a -> a.get("id")).collect(Collectors.toList());
    return Map.of("assignees", list("SELECT DISTINCT u.id,u.full_name,u.email,a.area_code,a.name AS area_name FROM areas a JOIN users u ON u.id=a.owner_id WHERE a.id IN (" + in + ") AND u.active=true", args.toArray()));
  }

  @GetMapping("/task-counts")
  Map<String, Object> taskCounts(HttpServletRequest request) {
    Map<String, Object> current = user(request);
    int issues = 0;
    int approvals = 0;
    if (role(current).equals("area_owner")) issues = count("SELECT count(*) FROM corrective_tasks WHERE assigned_to=?::uuid AND status='open'", id(current));
    if (role(current).equals("area_admin")) approvals = count("SELECT count(*) FROM corrective_tasks t JOIN areas a ON a.id=t.area_id WHERE a.manager_id=?::uuid AND t.status='waiting_approval'", id(current));
    if (role(current).equals("admin")) approvals = count("SELECT count(*) FROM corrective_tasks WHERE status='waiting_approval'");
    return Map.of("issues", issues, "approvals", approvals);
  }

  @GetMapping("/dashboard")
  Map<String, Object> dashboard(HttpServletRequest request) {
    Map<String, Object> current = user(request);
    requireRole(current, "admin", "area_admin");
    List<Map<String, Object>> areas = accessibleAreas(current);
    if (areas.isEmpty()) return Map.of("scope", "Atanmış alan yok", "metrics", Map.of("score", 0, "activeAudits", 0, "openIssues", 0, "waitingApproval", 0), "performance", List.of());
    List<Object> ids = areas.stream().map(a -> a.get("id")).collect(Collectors.toList());
    String in = placeholders(ids.size());
    Map<String, Object> metrics = one("SELECT COALESCE((SELECT round(avg(score)::numeric,1) FROM audits WHERE area_id IN ("+in+")),0) AS score,(SELECT count(*)::int FROM audits WHERE area_id IN ("+in+") AND status IN ('draft','in_progress')) AS active_audits,(SELECT count(*)::int FROM corrective_tasks WHERE area_id IN ("+in+") AND status='open') AS open_issues,(SELECT count(*)::int FROM corrective_tasks WHERE area_id IN ("+in+") AND status='waiting_approval') AS waiting_approval", repeated(ids, 4));
    List<Map<String, Object>> performance = list("SELECT a.id,a.area_code,a.name,COALESCE((SELECT au.score FROM audits au WHERE au.area_id=a.id ORDER BY au.updated_at DESC LIMIT 1),0) AS score FROM areas a WHERE a.id IN ("+in+") ORDER BY a.area_code", ids.toArray());
    Map<String, Object> converted = Map.of("score", number(metrics.get("score")), "activeAudits", number(metrics.get("active_audits")), "openIssues", number(metrics.get("open_issues")), "waitingApproval", number(metrics.get("waiting_approval")));
    String scope = role(current).equals("area_admin") ? areas.stream().map(a -> text(a.get("name"))).collect(Collectors.joining(", ")) : "Fabrika geneli";
    return Map.of("scope", scope, "metrics", converted, "performance", performance);
  }

  @GetMapping("/reports")
  Map<String, Object> reports(HttpServletRequest request) {
    Map<String, Object> current = user(request);
    requireRole(current, "admin", "area_admin");
    List<Map<String, Object>> areas = accessibleAreas(current);
    if (areas.isEmpty()) return Map.of("scope", "Atanmış alan yok", "metrics", Map.of("score", 0, "completed", 0, "nonconforming", 0, "averageCloseDays", 0), "areas", List.of());
    List<Object> ids = areas.stream().map(a -> a.get("id")).collect(Collectors.toList());
    String in = placeholders(ids.size());
    Map<String, Object> metrics = one("SELECT COALESCE((SELECT round(avg(score)::numeric,1) FROM audits WHERE area_id IN ("+in+") AND status='completed'),0) AS score,(SELECT count(*)::int FROM audits WHERE area_id IN ("+in+") AND status='completed') AS completed,(SELECT count(*)::int FROM corrective_tasks WHERE area_id IN ("+in+")) AS nonconforming,(SELECT COALESCE(round(avg(EXTRACT(EPOCH FROM (approved_at-created_at))/86400)::numeric,1),0) FROM corrective_tasks WHERE area_id IN ("+in+") AND approved_at IS NOT NULL) AS average_close_days", repeated(ids, 4));
    List<Map<String, Object>> areaRows = list("SELECT a.id,a.area_code,a.name,COALESCE(round(avg(au.score)::numeric,1),0) AS score,count(au.id) FILTER (WHERE au.status='completed')::int AS completed,(SELECT count(*)::int FROM corrective_tasks t WHERE t.area_id=a.id AND t.status IN ('open','waiting_approval')) AS open_issues FROM areas a LEFT JOIN audits au ON au.area_id=a.id WHERE a.id IN ("+in+") GROUP BY a.id,a.area_code,a.name ORDER BY a.area_code", ids.toArray());
    String scope = role(current).equals("area_admin") ? areas.stream().map(a -> text(a.get("name"))).collect(Collectors.joining(", ")) : "Fabrika geneli";
    return Map.of("scope", scope, "metrics", Map.of("score", number(metrics.get("score")), "completed", number(metrics.get("completed")), "nonconforming", number(metrics.get("nonconforming")), "averageCloseDays", number(metrics.get("average_close_days"))), "areas", areaRows);
  }

  @GetMapping("/plans")
  Map<String,Object> plans(HttpServletRequest request) {
    return new PlanningService(jdbc,mapper).list(user(request));
  }

  @GetMapping("/planning/candidates")
  Map<String,Object> planningCandidates(HttpServletRequest request,@RequestParam String areaId) {
    return new PlanningService(jdbc,mapper).candidates(user(request),areaId);
  }

  @PostMapping("/plans")
  @Transactional
  Map<String,Object> createPlan(HttpServletRequest request,@RequestBody Map<String,Object> body) throws Exception {
    return new PlanningService(jdbc,mapper).submit(user(request),body);
  }

  @DeleteMapping("/plans/{planId}")
  @Transactional(rollbackFor = Exception.class)
  Map<String,Object> deletePlan(HttpServletRequest request,@PathVariable String planId,@RequestParam int revision) throws Exception {
    return new PlanningService(jdbc,mapper).remove(user(request),planId,revision);
  }

  @PostMapping("/plans/{planId}/approve")
  @Transactional
  Map<String,Object> approvePlan(HttpServletRequest request,@PathVariable String planId,@RequestBody Map<String,Object> body) throws Exception {
    return new PlanningService(jdbc,mapper).decide(user(request),planId,body,true);
  }

  @PostMapping("/plans/{planId}/reject")
  @Transactional
  Map<String,Object> rejectPlan(HttpServletRequest request,@PathVariable String planId,@RequestBody Map<String,Object> body) throws Exception {
    return new PlanningService(jdbc,mapper).decide(user(request),planId,body,false);
  }

  @PostMapping("/plans/{planId}/assign-owner")
  Map<String,Object> assignPlanOwner(HttpServletRequest request,@PathVariable String planId,@RequestBody Map<String,Object> body) {
    new PlanningService(jdbc,mapper).manager(user(request));
    throw new ApiException(409,"Alan sorumlusu, planlama ekranında kriterler ve tetkikçiyle birlikte admin onayına gönderilmelidir");
  }

  @GetMapping("/admin/auditors")
  Map<String, Object> auditors(HttpServletRequest request) {
    Map<String, Object> current = user(request);
    requireRole(current, "admin", "area_admin");
    List<Map<String, Object>> rows = role(current).equals("admin")
        ? list("SELECT id,full_name,email FROM users WHERE role='auditor' AND active=true ORDER BY full_name")
        : list("SELECT DISTINCT u.id,u.full_name,u.email FROM users u JOIN audit_plans p ON p.primary_auditor_id=u.id JOIN areas a ON a.id=p.area_id WHERE a.manager_id=?::uuid ORDER BY u.full_name", id(current));
    return Map.of("auditors", rows);
  }

  @GetMapping("/criteria")
  Map<String, Object> criteria(HttpServletRequest request, @RequestParam(required = false) String areaId, @RequestParam(required = false) String auditPeriod) {
    Map<String, Object> current = user(request);
    requireRole(current,"admin","area_admin");
    if (role(current).equals("area_owner")) throw new ApiException(403, "Alan sorumlusu kriterlere erişemez");
    List<Map<String, Object>> areas = accessibleAreas(current);
    if (areas.isEmpty()) return Map.of("criteria", List.of(), "areas", areas);
    List<String> ids = areas.stream().map(a -> text(a.get("id"))).toList();
    if (areaId != null && !ids.contains(areaId)) throw new ApiException(403, "Bu alana erişiminiz yok");
    List<Map<String, Object>> rows;
    String select = "SELECT c.id,c.area_id,a.area_code,a.name AS area_name,c.step,c.description,c.weight,c.active,c.approval_status,c.created_at,COALESCE(c.audit_period,to_char(c.created_at,'YYYY-MM')) AS audit_period,v.version_no FROM criteria c JOIN areas a ON a.id=c.area_id JOIN criterion_versions v ON v.id=c.version_id WHERE c.approval_status<>'removed' AND ";
    boolean hasPeriod = auditPeriod != null && auditPeriod.matches("^\\d{4}-(0[1-9]|1[0-2])$");
    if (areaId != null && hasPeriod) rows = list(select + "c.area_id=?::uuid AND c.audit_period=? ORDER BY a.area_code,c.created_at", areaId, auditPeriod);
    else if (areaId != null) rows = list(select + "c.area_id=?::uuid ORDER BY a.area_code,c.audit_period,c.created_at", areaId);
    else if (hasPeriod) rows = list(select + "c.area_id IN (" + placeholders(ids.size()) + ") AND c.audit_period=? ORDER BY a.area_code,c.created_at", append(ids, auditPeriod));
    else rows = list(select + "c.area_id IN (" + placeholders(ids.size()) + ") ORDER BY a.area_code,c.audit_period,c.created_at", ids.toArray());
    return Map.of("criteria", rows, "areas", areas);
  }

  @PostMapping("/criteria")
  @Transactional
  ResponseEntity<Map<String, Object>> createCriterion(HttpServletRequest request, @RequestBody Map<String, Object> body) {
    Map<String, Object> current = user(request);
    if (!canManageArea(current, body.get("areaId"))) throw new ApiException(403, "Kriterleri yalnızca sistem yöneticisi yönetebilir");
    String step = text(body.get("step")).trim();
    String description = text(body.get("description")).trim();
    double weight = doubleValue(body.get("weight"));
    if (step.isBlank() || description.isBlank() || weight <= 0 || weight > 100) throw new ApiException(400, "Adım, kriter ve 1-100 arasında ağırlık zorunludur");
    String period = text(body.get("auditPeriod"));
    if (!period.matches("^\\d{4}-(0[1-9]|1[0-2])$")) period = LocalDate.now().toString().substring(0, 7);
    Map<String, Object> version = maybeOne("SELECT v.id FROM criterion_versions v JOIN criteria c ON c.version_id=v.id WHERE v.published=false AND v.created_by=?::uuid AND c.area_id=?::uuid AND c.audit_period=? ORDER BY v.created_at DESC LIMIT 1", id(current), body.get("areaId"), period);
    if (version == null) version = one("INSERT INTO criterion_versions(version_no,published,created_by) VALUES(?,false,?::uuid) RETURNING id", "donem-" + period + "-" + System.currentTimeMillis(), id(current));
    Map<String, Object> row = one("INSERT INTO criteria(version_id,area_id,step,description,weight,audit_period,active,approval_status) VALUES(?::uuid,?::uuid,?,?,?,?,false,'draft') RETURNING *", version.get("id"), body.get("areaId"), step, description, weight, period);
    return ResponseEntity.status(201).body(Map.of("criterion", row));
  }

  @PatchMapping("/criteria/{criterionId}")
  Map<String, Object> updateCriterion(HttpServletRequest request, @PathVariable String criterionId, @RequestBody Map<String, Object> body) {
    Map<String, Object> current = user(request);
    Map<String, Object> found = maybeOne("SELECT area_id FROM criteria WHERE id=?::uuid", criterionId);
    if (found == null) throw new ApiException(404, "Kriter bulunamadı");
    if (!canManageArea(current, found.get("area_id"))) throw new ApiException(403, "Bu kriteri değiştirme yetkiniz yok");
    Object weight = body.containsKey("weight") ? doubleValue(body.get("weight")) : null;
    Map<String, Object> row = one("UPDATE criteria SET step=COALESCE(?,step),description=COALESCE(?,description),weight=COALESCE(?::numeric,weight),approval_status='draft',active=false,approved_by=NULL,approved_at=NULL WHERE id=?::uuid RETURNING *", blankToNull(body.get("step")), blankToNull(body.get("description")), weight, criterionId);
    return Map.of("criterion", row);
  }

  @PostMapping("/criteria/{criterionId}/approve")
  @Transactional
  Map<String, Object> approveCriterion(HttpServletRequest request, @PathVariable String criterionId) {
    Map<String, Object> current = user(request);
    requireRole(current, "admin");
    Map<String, Object> found = maybeOne("SELECT area_id,version_id FROM criteria WHERE id=?::uuid", criterionId);
    if (found == null) throw new ApiException(404, "Kriter bulunamadı");
    if (!canManageArea(current, found.get("area_id"))) throw new ApiException(403, "Bu kriteri onaylama yetkiniz yok");
    Map<String, Object> row = one("UPDATE criteria SET approval_status='approved',active=true,approved_by=?::uuid,approved_at=now() WHERE id=?::uuid RETURNING *", id(current), criterionId);
    jdbc.update("UPDATE criterion_versions SET published=true,published_at=COALESCE(published_at,now()) WHERE id=?::uuid", found.get("version_id"));
    return Map.of("criterion", row);
  }

  @DeleteMapping("/criteria/{criterionId}")
  @Transactional
  Map<String, Object> removeCriterion(HttpServletRequest request, @PathVariable String criterionId) {
    Map<String, Object> current = user(request);
    requireRole(current, "admin", "area_admin");
    Map<String, Object> found = maybeOne("SELECT area_id FROM criteria WHERE id=?::uuid AND approval_status<>'removed'", criterionId);
    if (found == null) throw new ApiException(404, "Kriter bulunamadı");
    if (!canManageArea(current, found.get("area_id"))) throw new ApiException(403, "Bu kriteri kaldırma yetkiniz yok");
    jdbc.update("UPDATE criteria SET active=false,approval_status='removed',approved_by=NULL,approved_at=NULL WHERE id=?::uuid", criterionId);
    return Map.of("ok", true);
  }

  @GetMapping("/audit/criteria")
  Map<String,Object> auditorCriteria(HttpServletRequest request,@RequestParam(required=false) String planId) {
    Map<String,Object> current=user(request); requireRole(current,"auditor");
    var plan=assignedPlan(current,planId);
    if(plan==null)return Map.of("criteria",List.of(),"planId","","auditPeriod","");
    var owner=maybeOne("SELECT email,full_name FROM users WHERE id=?::uuid",plan.get("assigned_owner_id"));
    return Map.of("area",Map.of("id",plan.get("area_id"),"area_code",plan.get("area_code"),"name",plan.get("name")),
      "planId",plan.get("id"),"auditPeriod",plan.get("audit_period"),
      "assignedOwnerEmail",owner==null?"":text(owner.get("email")),
      "assignedOwnerName",owner==null?"Atanmadı":text(owner.get("full_name")),
      "criteria",new PlanningService(jdbc,mapper).snapshot(plan.get("criteria_snapshot")));
  }

  @GetMapping("/audits/current")
  Map<String, Object> currentAudit(HttpServletRequest request, @RequestParam(required = false) String planId) throws IOException {
    Map<String, Object> current = user(request);
    requireRole(current, "auditor");
    Map<String, Object> plan = assignedPlan(current, planId);
    var audit = plan == null ? null : maybeOne("SELECT audit_no,score,status::text AS status,payload,updated_at FROM audits WHERE owner_id=?::uuid AND plan_id=?::uuid ORDER BY updated_at DESC LIMIT 1", id(current), plan.get("id"));
    if(audit!=null) audit.put("payload",mapper.readTree(text(audit.get("payload"))));
    return mapAllowNull("audit",audit);
  }

  @GetMapping("/audits/history")
  Map<String, Object> auditHistory(HttpServletRequest request) {
    Map<String, Object> current = user(request);
    requireRole(current, "auditor");
    return Map.of("audits", list("SELECT au.audit_no,au.score,au.status::text AS status,au.updated_at,a.area_code,a.name AS area_name FROM audits au JOIN areas a ON a.id=au.area_id WHERE au.owner_id=?::uuid ORDER BY au.updated_at DESC", id(current)));
  }

  @PostMapping("/audits/current")
  @Transactional
  Map<String, Object> saveAudit(HttpServletRequest request, @RequestBody Map<String, Object> body) throws Exception {
    Map<String, Object> current = user(request);
    requireRole(current, "auditor");
    if (!(body.get("rows") instanceof List<?> rows) || doubleValue(body.get("score")) < 0 || doubleValue(body.get("score")) > 100) throw new ApiException(400, "Geçersiz tetkik verisi");
    List<Map<String, Object>> areas = accessibleAreas(current);
    if (areas.isEmpty()) throw new ApiException(403, "Atanmış tetkik alanınız yok");
    Map<String, Object> plan = assignedPlan(current, text(body.get("planId")));
    if (plan == null) throw new ApiException(409, "Önce size atanmış bir tetkik planı seçin");
    // Lock the approved plan so assignments cannot change during a save.
    one("SELECT id FROM audit_plans WHERE id=?::uuid FOR UPDATE",plan.get("id"));
    List<Map<String,Object>> criteria = new PlanningService(jdbc,mapper).snapshot(plan.get("criteria_snapshot"));
    if(criteria.isEmpty() || rows.isEmpty()) throw new ApiException(400,"Onaylı kriterler yüklenmeden tetkik kaydedilemez");
    var byId=criteria.stream().collect(Collectors.toMap(c->text(c.get("id")),c->c));
    var seen=new java.util.HashSet<String>();
    List<Map<String,Object>> safeRows=new ArrayList<>();
    boolean submit=Boolean.TRUE.equals(body.get("submit"));
    double earned=0,total=criteria.stream().mapToDouble(c->doubleValue(c.get("weight"))).sum();
    for(Object raw:rows) {
      if(!(raw instanceof Map<?,?> source))throw new ApiException(400,"Geçersiz kriter");
      String key=text(source.get("id")); var criterion=byId.get(key);
      if(criterion==null || !seen.add(key))throw new ApiException(400,"Kriter onaylanan plana ait değil veya tekrar ediyor");
      String state=text(source.get("status"));
      if(!List.of("Uygun","Uygun Değil","Bekliyor").contains(state))throw new ApiException(400,"Geçersiz değerlendirme");
      if(submit && ("Bekliyor".equals(state) || ("Uygun Değil".equals(state) && (!(source.get("photos") instanceof List<?> photos) || photos.isEmpty()))))throw new ApiException(400,"Tüm kriterleri değerlendirin ve uygunsuzluklara fotoğraf ekleyin");
      Map<String,Object> row=new LinkedHashMap<>();
      row.put("id",key); row.put("category",criterion.get("step")); row.put("item",criterion.get("description"));
      row.put("weight",criterion.get("weight")); row.put("status",state); row.put("note",text(source.get("note")));
      row.put("photos",source.get("photos") instanceof List<?> photos?photos:List.of());
      safeRows.add(row);
      if("Uygun".equals(state))earned+=doubleValue(criterion.get("weight"));
    }
    if(seen.size()!=criteria.size())throw new ApiException(400,"Onaylı kriterlerin tamamı kaydedilmelidir");
    if(plan.get("assigned_owner_id")==null)throw new ApiException(409,"Planın onaylanmış alan sorumlusu yok");
    Map<String,Object> version=Map.of("id",criteria.get(0).get("version_id"));
    Map<String,Object> area=Map.of("id",plan.get("area_id"));
    int score=total>0?(int)Math.round(earned/total*100):0;
    String auditNo = "TTK-" + UUID.nameUUIDFromBytes((text(plan.get("id")) + ":" + id(current)).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    if(count("SELECT count(*) FROM audits au WHERE au.audit_no=? AND (au.status='completed' OR EXISTS(SELECT 1 FROM corrective_tasks t WHERE t.audit_id=au.id))",auditNo)>0)throw new ApiException(409,"Gönderilmiş tetkik değiştirilemez; geçmiş tetkiklerden görüntüleyin");
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("rows", safeRows);
    payload.put("issueState", body.get("issueState"));
    payload.put("planPublished", body.get("planPublished"));
    payload.put("planId", plan.get("id"));
    Map<String, Object> audit = one("INSERT INTO audits(audit_no,plan_id,area_id,owner_id,criteria_version_id,status,score,payload,updated_at) VALUES(?,?::uuid,?::uuid,?::uuid,?::uuid,'in_progress',?,?::jsonb,now()) ON CONFLICT(audit_no) DO UPDATE SET score=EXCLUDED.score,payload=EXCLUDED.payload,status='in_progress',updated_at=now() RETURNING id,updated_at", auditNo, plan.get("id"), area.get("id"), id(current), version.get("id"), score, mapper.writeValueAsString(payload));
    for (Object raw : safeRows) {
      if (!submit || !(raw instanceof Map<?, ?> source) || !"Uygun Değil".equals(text(source.get("status")))) continue;
      Object assignee=plan.get("assigned_owner_id");
      String item = text(source.get("item")).isBlank() ? "Kriter" : text(source.get("item"));
      if (assignee == null) throw new ApiException(400, item + " için alan sorumlusu atanmalıdır");
      jdbc.update("INSERT INTO corrective_tasks(audit_id,area_id,criterion_key,criterion_text,finding,assigned_to,status) VALUES(?::uuid,?::uuid,?,?,?,?, 'open') ON CONFLICT(audit_id,criterion_key) DO UPDATE SET criterion_text=EXCLUDED.criterion_text,finding=EXCLUDED.finding,assigned_to=EXCLUDED.assigned_to,status='open',resolution_text=NULL,resolution_photo_url=NULL,resolved_by=NULL,resolved_at=NULL,approved_by=NULL,approved_at=NULL", audit.get("id"), area.get("id"), text(source.get("id")), item, text(source.get("note")), assignee);
      notify(assignee, "Yeni uygunsuzluk görevi", item, "issues");
    }
    if(submit) {
      jdbc.update("INSERT INTO workflow_events(audit_id,actor_id,event_type,details) VALUES(?::uuid,?::uuid,'audit_submitted',?::jsonb)", audit.get("id"), id(current), mapper.writeValueAsString(Map.of("score", score)));
      if(safeRows.stream().noneMatch(r->"Uygun Değil".equals(r.get("status"))))jdbc.update("UPDATE audits SET status='completed',completed_at=now() WHERE id=?::uuid",audit.get("id"));
    }
    return Map.of("ok", true, "updatedAt", audit.get("updated_at"));
  }

  @GetMapping("/corrective-tasks")
  Map<String, Object> correctiveTasks(HttpServletRequest request, @RequestParam(required = false) String view) throws IOException {
    Map<String, Object> current = user(request);
    requireRole(current, "area_owner");
    boolean history = "history".equals(view);
    String status = history ? "t.status IN ('waiting_approval','approved')" : "t.status='open'";
    // Match both the audit and criterion; never expose another finding's evidence.
    List<Map<String, Object>> tasks = list("SELECT t.id,t.criterion_text,t.finding,CASE WHEN t.status IN ('waiting_approval','approved') THEN 'resolved' ELSE t.status END AS status,t.due_at,t.resolution_text,t.resolution_photo_url,t.created_at,a.area_code,a.name AS area_name,COALESCE((SELECT r->'photos' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(au.payload->'rows')='array' THEN au.payload->'rows' ELSE '[]'::jsonb END) r WHERE r->>'id'=t.criterion_key LIMIT 1),'[]'::jsonb)::text AS finding_photos_json FROM corrective_tasks t JOIN areas a ON a.id=t.area_id LEFT JOIN audits au ON au.id=t.audit_id WHERE t.assigned_to=?::uuid AND " + status + " ORDER BY t.due_at", id(current));
    for (Map<String, Object> task : tasks) {
      var photos = mapper.readTree(text(task.remove("finding_photos_json")));
      List<String> urls = new ArrayList<>();
      if (photos != null && photos.isArray()) {
        for (var photo : photos) if (photo.isTextual() && !photo.asText().isBlank()) urls.add(photo.asText());
      }
      task.put("finding_photos", urls);
    }
    return Map.of("tasks", tasks);
  }

  @PostMapping("/corrective-tasks/{taskId}/resolve")
  @Transactional
  Map<String, Object> resolveTask(HttpServletRequest request, @PathVariable String taskId,
                                  @RequestParam("description") String description,
                                  @RequestParam("file") MultipartFile file) throws IOException {
    Map<String, Object> current = user(request);
    requireRole(current, "area_owner");
    if (description == null || description.trim().isEmpty() || file.isEmpty()) throw new ApiException(400, "Giderme açıklaması ve sonrası fotoğrafı zorunludur");
    validateImage(file);
    Map<String, Object> found = maybeOne("SELECT t.id,a.manager_id FROM corrective_tasks t JOIN areas a ON a.id=t.area_id WHERE t.id=?::uuid AND t.assigned_to=?::uuid", taskId, id(current));
    if (found == null) throw new ApiException(404, "Görev bulunamadı veya size atanmadı");
    String stored = store(file);
    String url = publicUrl + "/uploads/" + stored;
    Map<String, Object> task = one("UPDATE corrective_tasks SET status='waiting_approval',resolution_text=?,resolution_photo_url=?,resolved_by=?::uuid,resolved_at=now() WHERE id=?::uuid RETURNING *", description.trim(), url, id(current), taskId);
    if (found.get("manager_id") != null) notify(found.get("manager_id"), "Düzeltme onayı bekliyor", "Alan sorumlusu açıklama ve fotoğraf ekledi.", "approvals");
    for (var admin : list("SELECT id FROM users WHERE role='admin' AND active=true")) {
      if (!Objects.equals(admin.get("id"), found.get("manager_id")))
        notify(admin.get("id"), "Düzeltme onayı bekliyor", "Alan sorumlusu açıklama ve fotoğraf ekledi. Düzeltme Onayları bölümünden inceleyebilirsiniz.", "approvals");
    }
    return Map.of("task", task);
  }

  @GetMapping("/approvals")
  Map<String, Object> approvals(HttpServletRequest request) {
    Map<String, Object> current = user(request);
    requireRole(current, "area_admin", "admin");
    String sql = "SELECT t.id,t.audit_id,t.criterion_text,t.finding,t.status,t.resolution_text,t.resolution_photo_url,t.resolved_at,a.area_code,a.name AS area_name,u.full_name AS responsible_name FROM corrective_tasks t JOIN areas a ON a.id=t.area_id LEFT JOIN users u ON u.id=t.resolved_by WHERE t.status='waiting_approval' ";
    List<Map<String, Object>> tasks = role(current).equals("area_admin") ? list(sql + "AND a.manager_id=?::uuid ORDER BY t.resolved_at", id(current)) : list(sql + "ORDER BY t.resolved_at");
    return Map.of("tasks", tasks);
  }

  @PostMapping("/approvals/{taskId}/approve")
  @Transactional
  Map<String, Object> approveTask(HttpServletRequest request, @PathVariable String taskId) {
    Map<String, Object> current = user(request);
    requireRole(current, "area_admin", "admin");
    String sql = "SELECT t.audit_id,t.resolved_by FROM corrective_tasks t JOIN areas a ON a.id=t.area_id WHERE t.id=?::uuid AND t.status='waiting_approval' ";
    Map<String, Object> found = role(current).equals("area_admin") ? maybeOne(sql + "AND a.manager_id=?::uuid", taskId, id(current)) : maybeOne(sql, taskId);
    if (found == null) throw new ApiException(404, "Onay kaydı bulunamadı veya yetkiniz yok");
    jdbc.update("UPDATE corrective_tasks SET status='approved',approved_by=?::uuid,approved_at=now() WHERE id=?::uuid", id(current), taskId);
    boolean completed = count("SELECT count(*) FROM corrective_tasks WHERE audit_id=?::uuid AND status<>'approved'", found.get("audit_id")) == 0;
    if (completed) jdbc.update("UPDATE audits SET status='completed',completed_at=now(),updated_at=now() WHERE id=?::uuid", found.get("audit_id"));
    if (found.get("resolved_by") != null) notify(found.get("resolved_by"), "Düzeltme onaylandı", "Sorun giderildi ve tetkik tamamlanma kontrolüne geçti.", "resolutions");
    return Map.of("ok", true, "auditCompleted", completed);
  }

  @PostMapping("/approvals/{taskId}/reject")
  @Transactional
  Map<String, Object> rejectTask(HttpServletRequest request, @PathVariable String taskId, @RequestBody Map<String, Object> body) {
    Map<String, Object> current = user(request);
    requireRole(current, "area_admin", "admin");
    String reason = text(body.get("reason")).trim();
    if (reason.isBlank()) throw new ApiException(400, "Ret açıklaması zorunludur");
    String sql = "SELECT t.assigned_to FROM corrective_tasks t JOIN areas a ON a.id=t.area_id WHERE t.id=?::uuid AND t.status='waiting_approval' ";
    Map<String, Object> found = role(current).equals("area_admin") ? maybeOne(sql + "AND a.manager_id=?::uuid", taskId, id(current)) : maybeOne(sql, taskId);
    if (found == null) throw new ApiException(404, "Onay kaydı bulunamadı veya yetkiniz yok");
    jdbc.update("UPDATE corrective_tasks SET status='open',approved_by=NULL,approved_at=NULL WHERE id=?::uuid", taskId);
    if (found.get("assigned_to") != null) notify(found.get("assigned_to"), "Düzeltme reddedildi", reason, "issues");
    return Map.of("ok", true);
  }

  @PostMapping("/evidence")
  @Transactional
  Map<String,Object> evidence(HttpServletRequest request,@RequestParam("file") MultipartFile file,
      @RequestParam String planId,@RequestParam String criterionId) throws IOException {
    var current=user(request);requireRole(current,"auditor");
    var plan=assignedPlan(current,planId);
    if(plan==null)throw new ApiException(409,"Onaylı plan seçin");
    var criteria=new PlanningService(jdbc,mapper).snapshot(plan.get("criteria_snapshot"));
    var criterion=criteria.stream().filter(c->criterionId.equals(text(c.get("id")))).findFirst().orElseThrow(()->new ApiException(403,"Kriter bu onaylı plana ait değil"));
    if(file.isEmpty())throw new ApiException(400,"Fotoğraf seçin");
    validateImage(file);
    String auditNo="TTK-"+UUID.nameUUIDFromBytes((text(plan.get("id"))+":"+id(current)).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    var audit=maybeOne("SELECT id,status::text FROM audits WHERE audit_no=?",auditNo);
    if(audit!=null && ("completed".equals(audit.get("status")) || count("SELECT count(*) FROM corrective_tasks WHERE audit_id=?::uuid",audit.get("id"))>0))throw new ApiException(409,"Gönderilmiş tetkike yeni kanıt eklenemez");
    if(audit==null)audit=one("INSERT INTO audits(audit_no,plan_id,area_id,owner_id,criteria_version_id,status,score,payload) VALUES(?,?::uuid,?::uuid,?::uuid,?::uuid,'draft',0,'{}'::jsonb) RETURNING id",auditNo,plan.get("id"),plan.get("area_id"),id(current),criterion.get("version_id"));
    String stored=store(file);
    jdbc.update("INSERT INTO evidence(id,audit_id,object_key,filename,content_type,size_bytes,uploaded_by) VALUES(?::uuid,?::uuid,?,?,?,?,?::uuid)",UUID.randomUUID(),audit.get("id"),stored,file.getOriginalFilename(),file.getContentType(),file.getSize(),id(current));
    return Map.of("ok",true,"url",publicUrl+"/uploads/"+stored);
  }

  private Map<String, Object> user(HttpServletRequest request) {
    @SuppressWarnings("unchecked")
    Map<String, Object> current = (Map<String, Object>) request.getAttribute(AuthInterceptor.USER);
    if (current == null) throw new ApiException(401, "Oturum açmanız gerekiyor");
    return current;
  }

  private Map<String, Object> userResponse(Map<String, Object> source) {
    Map<String, Object> safe = new LinkedHashMap<>();
    safe.put("id", source.get("id"));
    safe.put("email", source.get("email"));
    safe.put("fullName", source.get("full_name"));
    safe.put("role", source.get("role"));
    return safe;
  }

  private Map<String, Object> assignedPlan(Map<String, Object> current, String planId) {
    String sql = "SELECT p.id,p.area_id,p.assigned_owner_id,p.criteria_snapshot,to_char(p.audit_date,'YYYY-MM') AS audit_period,a.area_code,a.name FROM audit_plans p JOIN areas a ON a.id=p.area_id WHERE p.published=true AND p.approval_status='approved' AND a.active=true AND (p.primary_auditor_id=?::uuid OR p.backup_auditor_id=?::uuid)";
    if (planId != null && !planId.isBlank()) {
      try { UUID.fromString(planId); } catch (IllegalArgumentException error) { throw new ApiException(400, "Geçersiz plan kimliği"); }
      Map<String, Object> plan = maybeOne(sql + " AND p.id=?::uuid FOR SHARE OF p", id(current), id(current), planId);
      if (plan == null) throw new ApiException(403, "Bu tetkik planı size atanmadı veya yayınlanmadı");
      return plan;
    }
    return maybeOne(sql + " ORDER BY CASE WHEN date_trunc('month',p.audit_date)=date_trunc('month',CURRENT_DATE) THEN 0 WHEN p.audit_date>CURRENT_DATE THEN 1 ELSE 2 END,abs(p.audit_date-CURRENT_DATE),p.id LIMIT 1 FOR SHARE OF p", id(current), id(current));
  }

  private List<Map<String, Object>> accessibleAreas(Map<String, Object> current) {
    return switch (role(current)) {
      case "admin" -> list("SELECT id,area_code,name FROM areas WHERE active=true ORDER BY area_code");
      case "area_admin" -> list("SELECT id,area_code,name FROM areas WHERE active=true AND manager_id=?::uuid ORDER BY area_code", id(current));
      case "area_owner" -> list("SELECT id,area_code,name FROM areas WHERE active=true AND owner_id=?::uuid ORDER BY area_code", id(current));
      default -> list("SELECT DISTINCT a.id,a.area_code,a.name FROM areas a JOIN audit_plans p ON p.area_id=a.id WHERE a.active=true AND (p.primary_auditor_id=?::uuid OR p.backup_auditor_id=?::uuid) ORDER BY a.area_code", id(current), id(current));
    };
  }

  private boolean canManageArea(Map<String, Object> current, Object areaId) {
    if (role(current).equals("admin")) return true;
    return role(current).equals("area_admin") && count("SELECT count(*) FROM areas WHERE id=?::uuid AND manager_id=?::uuid AND active=true", areaId, id(current)) > 0;
  }

  private void notify(Object userId, String title, String message, String target) {
    jdbc.update("INSERT INTO notifications(user_id,title,message,target) VALUES(?::uuid,?,?,?)", userId, title, message, target);
  }

  private void requireRole(Map<String, Object> current, String... roles) {
    for (String allowed : roles) if (allowed.equals(role(current))) return;
    throw new ApiException(403, "Bu işlem için yetkiniz yok");
  }

  private String role(Map<String, Object> current) { return text(current.get("role")); }
  private String id(Map<String, Object> current) { return text(current.get("id")); }
  private String text(Object value) { return value == null ? "" : String.valueOf(value); }
  private Object blankToNull(Object value) { return text(value).isBlank() ? null : value; }
  private double doubleValue(Object value) { try { return Double.parseDouble(text(value)); } catch (Exception ignored) { return Double.NaN; } }
  private Number number(Object value) { return value instanceof Number n ? n : 0; }
  private Map<String, Object> mapAllowNull(String key, Object value) {
    Map<String, Object> result = new LinkedHashMap<>();
    result.put(key, value);
    return result;
  }

  private Map<String, Object> one(String sql, Object... args) {
    Map<String, Object> result = maybeOne(sql, args);
    if (result == null) throw new ApiException(404, "Kayıt bulunamadı");
    return result;
  }

  private Map<String, Object> maybeOne(String sql, Object... args) {
    List<Map<String, Object>> rows = jdbc.queryForList(sql, args);
    return rows.isEmpty() ? null : rows.get(0);
  }

  private List<Map<String, Object>> list(String sql, Object... args) { return jdbc.queryForList(sql, args); }
  private int count(String sql, Object... args) { return jdbc.queryForObject(sql, Integer.class, args); }
  private String placeholders(int count) { return String.join(",", java.util.Collections.nCopies(count, "?::uuid")); }

  private Object[] repeated(List<Object> values, int times) {
    List<Object> all = new ArrayList<>();
    for (int i = 0; i < times; i++) all.addAll(values);
    return all.toArray();
  }

  private Object[] append(List<?> values, Object last) {
    List<Object> all = new ArrayList<>(values);
    all.add(last);
    return all.toArray();
  }

  private void validateImage(MultipartFile file) {
    if (file.getSize() > 10L * 1024 * 1024 || file.getContentType() == null || !file.getContentType().startsWith("image/")) {
      throw new ApiException(400, "10 MB altında geçerli bir görsel zorunludur");
    }
  }

  private String store(MultipartFile file) throws IOException {
    String original = file.getOriginalFilename() == null ? "image" : file.getOriginalFilename();
    String extension = original.contains(".") ? original.substring(original.lastIndexOf('.')).replaceAll("[^A-Za-z0-9.]", "") : "";
    String stored = UUID.randomUUID() + extension;
    file.transferTo(uploadDir.resolve(stored));
    return stored;
  }
}
