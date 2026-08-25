# Erdemir Dijital 5S Tetkik Sistemi

Erdemir 5S tetkik sürecini kullanıcı rolleri, görev atamaları, QR kodları,
100 puan üzerinden değerlendirme, fotoğraflı uygunsuzluk ve raporlama ile
yönetmek için geliştirilen web tabanlı sistemdir.

## Teknolojiler

- Arayüz: React 19, TypeScript, Vinext ve Vite
- Backend: Node.js ve Express
- Veritabanı: PostgreSQL 18
- PostgreSQL istemcisi: node-postgres (`pg`)
- Dosya yükleme: Multer

## Klasörler

- `app/`: React arayüzü
- `backend/`: PostgreSQL'e bağlanan REST API
- `postgres/`: veritabanı şeması ve örnek kayıtlar
- `public/`: logo ve giriş ekranı görselleri

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

Birinci terminal:

```powershell
cd backend
npm install
npm start
```

İkinci terminal:

```powershell
npm install
npm run dev
```

Arayüz: `http://localhost:3000`

API sağlık kontrolü: `http://localhost:4000/api/health`

## Güvenlik

`.env` dosyalarını GitHub'a göndermeyin. Üretim ortamında güçlü parola,
HTTPS, güvenli kimlik doğrulama ve harici nesne depolama kullanın.
