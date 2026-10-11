# MASA

MASA, Firebase Realtime Database kullanan, Vite tabanlı basit bir sosyal paylaşım uygulamasıdır.

## Özellikler

- E-posta/şifre ile kayıt ve giriş
- Post paylaşma, listeleme, silme
- Post beğenme
- Postlara yorum ekleme ve kendi yorumunu silme
- Sonsuz kaydırma ile eski postları yükleme
- Profil avatar rengini güncelleme
- Topluluk/grup oluşturma ve listeleme
- Şifre değiştirme
- Hesap ve kullanıcıya ait verileri silme
- İstemci tarafında temel doğrulama ve giriş deneme sınırlama

## Teknolojiler

- Vite
- Vanilla JavaScript (ES Modules)
- Firebase Auth
- Firebase Realtime Database
- Lucide Icons

## Kurulum

1. Bağımlılıkları kur:

```bash
npm install
```

2. `.env` dosyası oluştur ve Firebase değişkenlerini ekle:

```bash
cp .env.example src/.env
```

3. Firebase Console ayarları:

- Authentication > Sign-in method > Email/Password etkin olsun.
- Realtime Database oluşturulmuş ve kuralları girilmiş olsun.

4. Geliştirme sunucusunu başlat:

```bash
npm run dev
```

5. Tarayıcıda aç:

- Giriş / kayıt: akıştaki "Giriş" kolonu (sekmeli)
- Uygulama: `/`

## Build

```bash
npm run build
```

Build çıktısı `dist/` klasörüne yazılır.

## Lisans

Bu proje depo içindeki [LICENSE](LICENSE) dosyasındaki koşullarla lisanslanmıştır.
