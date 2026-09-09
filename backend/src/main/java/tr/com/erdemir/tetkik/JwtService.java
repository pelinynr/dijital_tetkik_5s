package tr.com.erdemir.tetkik;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class JwtService {
  private final ObjectMapper mapper;
  private final byte[] secret;
  private final Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
  private final Base64.Decoder decoder = Base64.getUrlDecoder();

  public JwtService(ObjectMapper mapper, @Value("${app.jwt-secret}") String secret) {
    this.mapper = mapper;
    this.secret = secret.getBytes(StandardCharsets.UTF_8);
  }

  public String create(String userId, String role) {
    try {
      String header = encoder.encodeToString(mapper.writeValueAsBytes(Map.of("alg", "HS256", "typ", "JWT")));
      Map<String, Object> payload = new LinkedHashMap<>();
      payload.put("sub", userId);
      payload.put("role", role);
      payload.put("exp", Instant.now().plusSeconds(8 * 60 * 60).getEpochSecond());
      String body = encoder.encodeToString(mapper.writeValueAsBytes(payload));
      String content = header + "." + body;
      return content + "." + encoder.encodeToString(sign(content));
    } catch (Exception exception) {
      throw new IllegalStateException("Token üretilemedi", exception);
    }
  }

  public Map<String, Object> verify(String token) {
    try {
      String[] parts = token.split("\\.");
      if (parts.length != 3) throw new IllegalArgumentException();
      String content = parts[0] + "." + parts[1];
      if (!java.security.MessageDigest.isEqual(sign(content), decoder.decode(parts[2]))) throw new IllegalArgumentException();
      Map<String, Object> payload = mapper.readValue(decoder.decode(parts[1]), new TypeReference<>() {});
      if (((Number) payload.get("exp")).longValue() < Instant.now().getEpochSecond()) throw new IllegalArgumentException();
      return payload;
    } catch (Exception exception) {
      throw new ApiException(401, "Oturum geçersiz veya süresi dolmuş");
    }
  }

  private byte[] sign(String value) throws Exception {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret, "HmacSHA256"));
    return mac.doFinal(value.getBytes(StandardCharsets.UTF_8));
  }
}
