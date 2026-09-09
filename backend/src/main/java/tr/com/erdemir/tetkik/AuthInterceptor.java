package tr.com.erdemir.tetkik;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class AuthInterceptor implements HandlerInterceptor {
  public static final String USER = "authenticatedUser";
  private final JwtService jwt;
  private final JdbcTemplate jdbc;

  public AuthInterceptor(JwtService jwt, JdbcTemplate jdbc) {
    this.jwt = jwt;
    this.jdbc = jdbc;
  }

  @Override
  public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
    if ("OPTIONS".equalsIgnoreCase(request.getMethod())) return true;
    String authorization = request.getHeader("Authorization");
    if (authorization == null || !authorization.matches("(?i)^Bearer\\s+.+")) {
      throw new ApiException(401, "Oturum açmanız gerekiyor");
    }
    Map<String, Object> payload = jwt.verify(authorization.replaceFirst("(?i)^Bearer\\s+", ""));
    var users = jdbc.queryForList("SELECT id,email,full_name,role::text AS role,active FROM users WHERE id=?::uuid", payload.get("sub"));
    if (users.isEmpty() || !Boolean.TRUE.equals(users.get(0).get("active"))) {
      throw new ApiException(401, "Kullanıcı aktif değil");
    }
    request.setAttribute(USER, users.get(0));
    return true;
  }
}
