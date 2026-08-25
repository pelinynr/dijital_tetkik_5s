# Angular + PostgreSQL geçiş planı

Mevcut çalışan uygulama React 19, TypeScript, Vinext, Node.js API ve PostgreSQL kullanır.
Angular'a geçiş istenirse arayüz ayrıca yeniden geliştirilebilir.

## Önerilen yapı

- Frontend: Angular 20, TypeScript, Angular Router, HttpClient
- Backend: Node.js, NestJS veya Express, REST API
- Veritabanı: PostgreSQL 16
- ORM: Prisma
- Fotoğraflar: geliştirmede yerel disk; üretimde S3/MinIO
- Kimlik doğrulama: JWT ve rol bazlı yetkilendirme

## Gerekli kurulumlar

1. PostgreSQL 16 ve pgAdmin 4 kurun.
2. PostgreSQL içinde `erdemir_5s` adlı veritabanı oluşturun.
3. Angular CLI kurun:

```powershell
npm install -g @angular/cli@20
```

4. API projesinde bağlantı bilgisini `.env` dosyasına yazın:

```env
DATABASE_URL="postgresql://postgres:SIFRENIZ@localhost:5432/erdemir_5s?schema=public"
JWT_SECRET="uzun-ve-rastgele-bir-deger"
```

5. Prisma şemasını veritabanına uygulayın:

```powershell
npx prisma migrate dev --name initial
npx prisma db seed
```

6. Backend ve frontend'i ayrı terminallerde çalıştırın:

```powershell
npm run start:dev
ng serve --open
```

## PostgreSQL tabloları

- `users`: kullanıcı ve roller
- `areas`: alan, alt alan, sorumlu ve QR anahtarı
- `criteria`: versiyonlanmış 5S kriterleri
- `audit_plans`: dönemsel görev atamaları
- `audits`: tetkik durumu ve 100 üzerinden puan
- `audit_results`: kriter bazlı değerlendirmeler
- `evidence`: fotoğraf kanıtlarının metaverisi
- `nonconformities`: uygunsuzluk ve düzeltici faaliyetler
- `workflow_events`: işlem geçmişi

## Önemli dağıtım notu

PostgreSQL backend ayrı bir Node.js süreci olarak çalışır. Üretimde arayüz bu
backend'e HTTPS üzerinden bağlanmalıdır.
