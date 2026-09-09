package tr.com.erdemir.tetkik;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.lang.reflect.Proxy;
import java.nio.file.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.mock.env.MockEnvironment;

/** Real PostgreSQL regression test. Synthetic data and notifications are rolled back. */
public class PlanningWorkflowCheck {
  static void check(boolean v,String label){if(!v)throw new AssertionError(label);System.out.println("PASS: "+label);}
  interface Action {void run() throws Exception;}
  static void denied(Action action,String label)throws Exception{try{action.run();throw new AssertionError(label);}catch(ApiException expected){System.out.println("PASS: "+label);}}
  static HttpServletRequest request(Map<String,Object> user){return (HttpServletRequest)Proxy.newProxyInstance(HttpServletRequest.class.getClassLoader(),new Class<?>[]{HttpServletRequest.class},(p,m,a)->m.getName().equals("getAttribute")?user:null);}
  static String uuid(){return UUID.randomUUID().toString();}
  public static void main(String[] args)throws Exception{
    Properties settings=new Properties();try(var reader=Files.newBufferedReader(Path.of(".env"))){settings.load(reader);}
    var source=new Dijital5sApplication().dataSource(new MockEnvironment().withProperty("DATABASE_URL",settings.getProperty("DATABASE_URL")));
    new PlanningMigration(source).run(null);
    try(var connection=source.getConnection()){
      connection.setAutoCommit(false);
      var db=new JdbcTemplate(new SingleConnectionDataSource(connection,true));var mapper=new ObjectMapper();
      var upload=Files.createTempDirectory("planning-check-");
      try{
        String admin=uuid(),unit=uuid(),auditor=uuid(),owner=uuid(),otherOwner=uuid(),area=uuid(),otherArea=uuid(),version=uuid(),criterion=uuid();
        for(var entry:Map.of(admin,"admin",unit,"area_admin",auditor,"auditor",owner,"area_owner",otherOwner,"area_owner").entrySet())db.update("INSERT INTO users(id,email,password_hash,full_name,role) VALUES(?::uuid,?,'unused','Regression fixture',?::user_role)",entry.getKey(),entry.getKey()+"@example.invalid",entry.getValue());
        db.update("INSERT INTO areas(id,area_code,name,manager_id,owner_id) VALUES(?::uuid,?,'Test unit',?::uuid,?::uuid)",area,"TEST-"+area.substring(0,8),unit,owner);
        db.update("INSERT INTO areas(id,area_code,name,owner_id) VALUES(?::uuid,?,'Other test unit',?::uuid)",otherArea,"TEST-"+otherArea.substring(0,8),otherOwner);
        db.update("INSERT INTO area_user_memberships(area_id,user_id) VALUES(?::uuid,?::uuid),(?::uuid,?::uuid)",area,auditor,area,owner);
        db.update("INSERT INTO criterion_versions(id,version_no,created_by) VALUES(?::uuid,?,?::uuid)",version,"test-"+version.substring(0,20),unit);
        db.update("INSERT INTO criteria(id,version_id,area_id,step,description,weight,active,approval_status,audit_period) VALUES(?::uuid,?::uuid,?::uuid,'Temizlik','Original criterion',100,false,'draft','2099-01')",criterion,version,area);
        Map<String,Object> manager=Map.of("id",unit,"role","area_admin"),root=Map.of("id",admin,"role","admin"),inspector=Map.of("id",auditor,"role","auditor");
        var service=new PlanningService(db,mapper);var api=new ApiController(db,null,mapper,upload.toString(),"http://localhost:4000");
        Map<String,Object> body=new LinkedHashMap<>(Map.of("areaId",area,"auditDate","2099-01-15","auditorEmail",auditor+"@example.invalid","ownerEmail",owner+"@example.invalid"));
        denied(()->service.submit(inspector,body),"Auditor cannot assign a responsible person");
        var foreign=new LinkedHashMap<>(body);foreign.put("ownerEmail",otherOwner+"@example.invalid");denied(()->service.submit(manager,foreign),"Unit cannot assign a foreign owner");
        var saved=service.submit(manager,body);String plan=saved.get("id").toString();
        check(db.queryForObject("SELECT count(*) FROM notifications WHERE user_id IN (?::uuid,?::uuid)",Integer.class,auditor,owner)==0,"No assignee notifications before approval");
        denied(()->api.auditorCriteria(request(inspector),plan),"Pending plan cannot be opened");
        denied(()->service.decide(manager,plan,Map.of("revision",1),true),"Unit cannot self-approve");
        denied(()->service.decide(root,plan,Map.of("revision",99),true),"Stale revision rejected");
        service.decide(root,plan,Map.of("revision",1),true);
        check(db.queryForObject("SELECT count(*) FROM notifications WHERE user_id IN (?::uuid,?::uuid)",Integer.class,auditor,owner)==2,"Approval notifies both assignees exactly once");
        denied(()->service.decide(root,plan,Map.of("revision",1),true),"Duplicate approval rejected");
        db.update("UPDATE criteria SET description='Edited draft' WHERE id=?::uuid",criterion);
        var visible=(List<?>)api.auditorCriteria(request(inspector),plan).get("criteria");
        check(((Map<?,?>)visible.get(0)).get("description").equals("Original criterion"),"Approved snapshot unaffected by later criterion edits");
        var auditBody=Map.<String,Object>of("planId",plan,"score",0,"submit",true,"rows",List.of(Map.of("id",criterion,"item","forged text","weight",1,"status","Uygun Değil","photos",List.of("/uploads/test.png"),"assigneeEmail",otherOwner+"@example.invalid")));
        api.saveAudit(request(inspector),auditBody);
        check(db.queryForObject("SELECT count(*) FROM corrective_tasks WHERE assigned_to=?::uuid AND criterion_text='Original criterion'",Integer.class,owner)==1,"Task uses approved owner and approved criterion, not client edits");
        denied(()->service.submit(manager,body),"Started plan cannot be overwritten");
        denied(()->service.remove(root,plan,1),"Started plan cannot be deleted even by admin");
        db.update("INSERT INTO criteria(version_id,area_id,step,description,weight,active,approval_status,audit_period) VALUES(?::uuid,?::uuid,'Temizlik','Deletion fixture',100,false,'draft','2099-02')",version,area);
        var deletable=new LinkedHashMap<>(body);deletable.put("auditDate","2099-02-15");
        String disposable=service.submit(manager,deletable).get("id").toString();
        denied(()->service.remove(inspector,disposable,1),"Auditor cannot delete plan");
        denied(()->service.remove(Map.of("id",otherOwner,"role","area_admin"),disposable,1),"Foreign unit cannot delete plan");
        denied(()->service.remove(manager,disposable,99),"Stale delete rejected");
        service.decide(root,disposable,Map.of("revision",1),true);
        service.remove(manager,disposable,1);
        check(db.queryForObject("SELECT count(*) FROM audit_plans WHERE id=?::uuid AND published=false AND approval_status='deleted'",Integer.class,disposable)==1,"Approved unstarted plan removed safely");
        denied(()->api.auditorCriteria(request(inspector),disposable),"Deleted plan cannot be opened");
        check(((List<Map<String,Object>>)service.list(root).get("plans")).stream().noneMatch(p->p.get("id").toString().equals(disposable)),"Deleted plan hidden from lists");
        check(service.submit(manager,deletable).get("revision").equals(3),"Same month can be replanned after deletion with fresh approval");
        var report=new NonconformityReportController(db);
        check(((List<?>)report.report(request(manager),null,null,null,null).get("records")).size()==1,"Unit report returns its own finding");
        denied(()->report.report(request(manager),null,null,null,otherArea),"Foreign report area rejected");
        denied(()->report.report(request(inspector),null,null,null,null),"Auditor cannot access management reports");
        check(!((List<?>)report.report(request(root),null,null,null,null).get("records")).isEmpty(),"Admin can report all units");
        System.out.println("ALL PLANNING CHECKS PASSED; fixtures will be rolled back.");
      }finally{connection.rollback();Files.delete(upload);}
    }
  }
}
