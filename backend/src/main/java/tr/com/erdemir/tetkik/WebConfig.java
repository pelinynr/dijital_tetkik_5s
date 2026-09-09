package tr.com.erdemir.tetkik;

import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {
  private final AuthInterceptor auth;
  private final String frontendOrigin;
  private final Path uploadDir;

  public WebConfig(AuthInterceptor auth,
                   @Value("${app.frontend-origin}") String frontendOrigin,
                   @Value("${app.upload-dir}") String uploadDir) {
    this.auth = auth;
    this.frontendOrigin = frontendOrigin;
    this.uploadDir = Path.of(uploadDir).toAbsolutePath().normalize();
  }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(auth).addPathPatterns("/api/**")
        .excludePathPatterns("/api/health", "/api/auth/login");
  }

  @Override
  public void addCorsMappings(CorsRegistry registry) {
    registry.addMapping("/**").allowedOrigins(frontendOrigin).allowedMethods("GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS").allowedHeaders("*");
  }

  @Override
  public void addResourceHandlers(ResourceHandlerRegistry registry) {
    registry.addResourceHandler("/uploads/**").addResourceLocations(uploadDir.toUri().toString());
  }
}
