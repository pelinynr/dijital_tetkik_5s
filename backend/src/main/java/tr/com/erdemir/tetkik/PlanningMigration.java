package tr.com.erdemir.tetkik;

import javax.sql.DataSource;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.stereotype.Component;

@Component
public class PlanningMigration implements ApplicationRunner {
  private final DataSource source;
  public PlanningMigration(DataSource source) { this.source = source; }
  public void run(ApplicationArguments args) throws Exception {
    try (var c = source.getConnection()) {
      c.setAutoCommit(false);
      try (var s = c.createStatement()) {
        s.execute("SELECT pg_advisory_xact_lock(5192026)");
        s.execute("CREATE TABLE IF NOT EXISTS app_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
        try (var rows = s.executeQuery("SELECT 1 FROM app_migrations WHERE name='unit-planning-v1'")) {
          if (rows.next()) { c.commit(); return; }
        }
        ScriptUtils.executeSqlScript(c, new ClassPathResource("db/unit-planning.sql"));
        s.execute("INSERT INTO app_migrations(name) VALUES('unit-planning-v1')");
        c.commit();
      } catch (Exception e) { c.rollback(); throw e; }
    }
  }
}
