package tr.com.erdemir.tetkik;

import java.net.URI;
import javax.sql.DataSource;
import org.postgresql.ds.PGSimpleDataSource;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.core.env.Environment;

@SpringBootApplication
public class Dijital5sApplication {
  public static void main(String[] args) {
    SpringApplication.run(Dijital5sApplication.class, args);
  }

  @Bean
  DataSource dataSource(Environment environment) {
    String value = environment.getProperty("DATABASE_URL");
    if (value == null || value.isBlank()) {
      throw new IllegalStateException("DATABASE_URL backend-java/.env dosyasında tanımlanmalıdır.");
    }
    PGSimpleDataSource source = new PGSimpleDataSource();
    if (value.startsWith("jdbc:postgresql:")) {
      source.setUrl(value);
      return source;
    }
    URI uri = URI.create(value);
    String[] credentials = uri.getUserInfo().split(":", 2);
    source.setServerNames(new String[]{uri.getHost()});
    source.setPortNumbers(new int[]{uri.getPort() > 0 ? uri.getPort() : 5432});
    source.setDatabaseName(uri.getPath().replaceFirst("^/", ""));
    source.setUser(credentials[0]);
    source.setPassword(credentials.length > 1 ? credentials[1] : "");
    return source;
  }
}
