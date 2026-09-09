package tr.com.erdemir.tetkik;

import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalDate;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/reports")
public class NonconformityReportController {
  private final JdbcTemplate db;
  public NonconformityReportController(JdbcTemplate db) { this.db=db; }
  @GetMapping("/nonconformities")
  Map<String,Object> report(HttpServletRequest request,@RequestParam(required=false) String from,
    @RequestParam(required=false) String to,@RequestParam(required=false) String status,@RequestParam(required=false) String areaId) {
    @SuppressWarnings("unchecked") var user=(Map<String,Object>)request.getAttribute(AuthInterceptor.USER);
    if(user==null)throw new ApiException(401,"Oturum açın");
    String role=String.valueOf(user.get("role"));
    if(!List.of("admin","area_admin").contains(role))throw new ApiException(403,"Rapor yetkiniz yok");
    List<Map<String,Object>> areas=role.equals("admin")?db.queryForList("SELECT id,area_code,name FROM areas ORDER BY area_code"):db.queryForList("SELECT id,area_code,name FROM areas WHERE manager_id=?::uuid ORDER BY area_code",user.get("id"));
    if(areaId!=null&&!areaId.isBlank()&&areas.stream().noneMatch(a->a.get("id").toString().equals(areaId)))throw new ApiException(403,"Bu alanın raporuna erişiminiz yok");
    String scope=role.equals("admin")?"Fabrika geneli":areas.stream().map(a->a.get("name").toString()).collect(java.util.stream.Collectors.joining(", "));
    List<Object> params=new ArrayList<>(); String where=" WHERE 1=1";
    if(!role.equals("admin")){where+=" AND a.manager_id=?::uuid";params.add(user.get("id"));}
    if(areaId!=null&&!areaId.isBlank()){where+=" AND a.id=?::uuid";params.add(areaId);scope=areas.stream().filter(a->a.get("id").toString().equals(areaId)).findFirst().get().get("name").toString();}
    LocalDate start=null,end=null;
    try {if(from!=null&&!from.isBlank())start=LocalDate.parse(from);if(to!=null&&!to.isBlank())end=LocalDate.parse(to);}catch(Exception e){throw new ApiException(400,"Tarih aralığı geçersiz");}
    if(start!=null&&end!=null&&start.isAfter(end))throw new ApiException(400,"Başlangıç tarihi bitişten sonra olamaz");
    if(start!=null){where+=" AND t.created_at>=?::date";params.add(start.toString());}
    if(end!=null){where+=" AND t.created_at<(?::date+interval '1 day')";params.add(end.toString());}
    if(status!=null&&!status.isBlank()){
      if(!List.of("open","waiting_approval","approved").contains(status))throw new ApiException(400,"Durum geçersiz");
      where+=" AND t.status=?";params.add(status);
    }
    var rows=db.queryForList("SELECT t.id,t.criterion_text,t.finding,t.status,t.created_at,t.due_at,t.resolved_at,t.approved_at,t.resolution_text,t.resolution_photo_url,a.area_code,a.name AS area_name,au.audit_no,p.period,p.audit_date,owner.full_name AS responsible_name,auditor.full_name AS auditor_name,approver.full_name AS approver_name FROM corrective_tasks t JOIN areas a ON a.id=t.area_id JOIN audits au ON au.id=t.audit_id LEFT JOIN audit_plans p ON p.id=au.plan_id LEFT JOIN users owner ON owner.id=t.assigned_to LEFT JOIN users auditor ON auditor.id=au.owner_id LEFT JOIN users approver ON approver.id=t.approved_by"+where+" ORDER BY t.created_at DESC,t.id",params.toArray());
    return Map.of("scope",scope.isBlank()?"Atanmış alan yok":scope,"areas",areas,"records",rows,"generatedAt",java.time.OffsetDateTime.now().toString());
  }
}
