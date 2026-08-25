# PostgreSQL şemasını kurma

## pgAdmin ile

1. PostgreSQL 16 ve pgAdmin'i kurun.
2. pgAdmin'de `Servers > PostgreSQL > Databases` üzerine sağ tıklayın.
3. `Create > Database` seçin ve adını `erdemir_5s` yapın.
4. `erdemir_5s` seçiliyken `Tools > Query Tool` açın.
5. Önce `schema.sql` dosyasının tamamını çalıştırın.
6. Ardından `seed.sql` dosyasını çalıştırın.
7. `Schemas > public > Tables` altında tabloları kontrol edin.

## psql ile

```powershell
createdb -U postgres erdemir_5s
psql -U postgres -d erdemir_5s -f postgres/schema.sql
psql -U postgres -d erdemir_5s -f postgres/seed.sql
```

Backend bağlantı değeri:

```env
DATABASE_URL=postgresql://postgres:PAROLANIZ@localhost:5432/erdemir_5s
```

Şema veritabanını hazırlar. `backend/src/server.js` içindeki API, bağlantı
bilgisini `backend/.env` dosyasındaki `DATABASE_URL` değerinden alır.
