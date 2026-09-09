# Erdemir Dijital 5S - Java Backend

Bu klasör, projenin Java 17 ve Spring Boot ile yazılmış REST API'sidir.
React frontend'in kullandığı mevcut `/api/...` adresleri korunmuştur.

## Teknolojiler

- Java 17
- Spring Boot 3.3
- Spring Web
- Spring JDBC (`JdbcTemplate`)
- PostgreSQL
- BCrypt parola doğrulama
- HMAC-SHA256 JWT
- Multipart fotoğraf yükleme

## Ayar

`.env.example` dosyasını `.env` olarak kopyalayın ve `DATABASE_URL` ile
`JWT_SECRET` değerlerini doldurun. Gerçek `.env` dosyası Git'e eklenmez.

## Çalıştırma

```powershell
./run.ps1
```

Maven kuruluysa doğrudan:

```powershell
mvn spring-boot:run
```

Sağlık kontrolü: `http://localhost:4000/api/health`
