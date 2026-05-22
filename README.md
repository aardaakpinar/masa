# MASA

MASA, Firebase Realtime Database kullanan, Vite tabanlı basit bir sosyal paylaşım uygulamasıdır.

## Özellikler

- E-posta/şifre ile kayıt ve giriş
- `Beni hatırla` desteği (e-posta localStorage'da saklanır)
- Post paylaşma, listeleme, silme
- Post beğenme
- Postlara yorum ekleme ve kendi yorumunu silme
- Sonsuz kaydırma ile eski postları yükleme
- Profil avatar rengini güncelleme
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

2. Kök dizinde `.env` dosyası oluştur ve Firebase değişkenlerini ekle:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_DATABASE_URL=...
VITE_FIREBASE_PROJECT_ID=...
```

3. Firebase Console ayarları:
- Authentication > Sign-in method > Email/Password etkin olsun.
- Realtime Database oluşturulmuş olsun.

4. Geliştirme sunucusunu başlat:

```bash
npm run dev
```

5. Tarayıcıda aç:
- Giriş ekranı: `/login.html`
- Uygulama: `/index.html`

## Build

```bash
npm run build
```

Build çıktısı `dist/` klasörüne yazılır.

## Scriptler

- `npm run dev`: Vite geliştirme sunucusu
- `npm run build`: Prod build
- `npm run preview`: Build önizleme

## Güvenlik Notu

İstemci tarafı kontroller tek başına yeterli değildir. Üretimde mutlaka Firebase Database Rules ve Auth kurallarını sıkılaştırın.

## Lisans

Bu proje depo içindeki [LICENSE](LICENSE) dosyasındaki koşullarla lisanslanmıştır.
