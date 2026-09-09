# Erdemir Dijital 5S Tetkik Sistemi

Erdemir 5S tetkik sürecini kullanıcı rolleri, görev atamaları, QR kodları,
100 puan üzerinden değerlendirme, fotoğraflı uygunsuzluk ve raporlama ile
yönetmek için geliştirilen web tabanlı sistemdir.

## Teknolojiler

- Arayüz: React 19, TypeScript, Vinext ve Vite
- Backend: Java 17 ve Spring Boot 3
- Veritabanı: PostgreSQL 18
- PostgreSQL erişimi: Spring JDBC ve PostgreSQL JDBC sürücüsü
- Kimlik doğrulama: JWT ve BCrypt
- Dosya yükleme: Spring Multipart

## Klasörler

- `app/`: React arayüzü
- `backend/`: Java/Spring Boot ile yazılmış PostgreSQL REST API'si
- `postgres/`: veritabanı şeması ve örnek kayıtlar
- `public/`: logo ve giriş ekranı görselleri

Backend yalnızca Java/Spring Boot ile çalışır. Kök dizindeki `package.json`,
`package-lock.json` ve Node.js bağımlılıkları React/Vinext arayüzünü çalıştırmak
ve derlemek için gereklidir; backend kodu değildir.

## İlk kurulum

PostgreSQL üzerinde `erdemir_5s` veritabanını oluşturun. pgAdmin Query Tool ile
önce `postgres/schema.sql`, ardından `postgres/seed.sql` dosyasını çalıştırın.

Backend ayarı:

```powershell
Copy-Item backend/.env.example backend/.env
```

`backend/.env` içindeki `DATABASE_URL` değerine PostgreSQL şifrenizi yazın.

Arayüz ayarı:

```powershell
Copy-Item .env.local.example .env.local
```

## Çalıştırma

Birinci terminal (Java backend):

```powershell
npm run backend:java
```

İkinci terminal:

```powershell
npm install
npm run dev
```

Arayüz: `http://localhost:3000`

API sağlık kontrolü: `http://localhost:4000/api/health`

Java backend testleri için:

```powershell
npm run backend:test
```

## Güvenlik

`.env` dosyalarını GitHub'a göndermeyin. Üretim ortamında güçlü parola,
HTTPS, güvenli kimlik doğrulama ve harici nesne depolama kullanın.
