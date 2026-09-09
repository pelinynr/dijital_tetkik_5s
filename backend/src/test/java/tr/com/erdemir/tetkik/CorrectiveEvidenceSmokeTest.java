package tr.com.erdemir.tetkik;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;

/** Offline regression check: run main with the application's cached dependencies. */
public class CorrectiveEvidenceSmokeTest {
  public static void main(String[] args) throws Exception {
    JdbcTemplate db = new JdbcTemplate() {
      @Override public List<Map<String, Object>> queryForList(String sql, Object... params) {
        check(sql.contains("au.id=t.audit_id") && sql.contains("r->>'id'=t.criterion_key"), "Evidence must match audit and criterion");
        check(sql.contains("t.assigned_to=?::uuid") && params[0].equals("owner-1"), "Only assigned tasks may be returned");
        List<Map<String, Object>> rows = new ArrayList<>();
        for (String json : List.of("[\"/uploads/a.png\",\"/uploads/b.png\"]", "[]", "null", "{}", "[null,42,\"\",\"/uploads/c.png\"]")) {
          Map<String, Object> row = new LinkedHashMap<>();
          row.put("finding_photos_json", json);
          rows.add(row);
        }
        return rows;
      }
    };
    var upload = Files.createTempDirectory("corrective-evidence-test-");
    try {
      var api = new ApiController(db, null, new ObjectMapper(), upload.toString(), "http://localhost:4000");
      HttpServletRequest owner = request("area_owner");
      for (String view : new String[] { null, "history" }) {
        var result = (List<?>) api.correctiveTasks(owner, view).get("tasks");
        check(((Map<?, ?>) result.get(0)).get("finding_photos").equals(List.of("/uploads/a.png", "/uploads/b.png")), "Multiple photos retained");
        for (int i = 1; i <= 3; i++) check(((Map<?, ?>) result.get(i)).get("finding_photos").equals(List.of()), "Legacy empty/malformed photo collections handled");
        check(((Map<?, ?>) result.get(4)).get("finding_photos").equals(List.of("/uploads/c.png")), "Non-string entries filtered");
        check(!((Map<?, ?>) result.get(0)).containsKey("finding_photos_json"), "Internal JSON field removed");
      }
      try { api.correctiveTasks(request("auditor"), null); throw new AssertionError("Auditor must be rejected"); }
      catch (ApiException expected) { /* existing role boundary retained */ }
      System.out.println("PASS: corrective evidence serialization, legacy rows, query scoping and role boundary");
    } finally { Files.delete(upload); }
  }

  private static HttpServletRequest request(String role) {
    return (HttpServletRequest) Proxy.newProxyInstance(HttpServletRequest.class.getClassLoader(), new Class<?>[] { HttpServletRequest.class },
        (proxy, method, args) -> method.getName().equals("getAttribute") ? Map.of("id", "owner-1", "role", role) : null);
  }

  private static void check(boolean value, String message) {
    if (!value) throw new AssertionError(message);
  }
}
