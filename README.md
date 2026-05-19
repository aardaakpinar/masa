# MASA

MASA, Firebase tabanlı basit bir sosyal paylaşım uygulamasıdır. Kullanıcılar e-posta/şifre ile kayıt olabilir, giriş yapabilir, post paylaşabilir ve kendi hesap ayarlarını yönetebilir.

## Özellikler

- E-posta/şifre ile kayıt ve giriş
- Oturum durumuna göre dinamik arayüz
- Post oluşturma, listeleme ve silme
- Post beğenme
- Profil adı ve avatar rengi yönetimi
- Şifre değiştirme ve hesap silme
- Basit istemci tarafı rate-limit ve doğrulama kontrolleri

## Proje Yapısı

- `index.html`: Ana akış ekranı
- `login.html`: Giriş/kayıt ekranı
- `assets/script/`: Uygulama JavaScript modülleri
- `assets/style/`: Stil dosyaları
- `env.js`: Firebase config

## Gereksinimler

- Modern bir tarayıcı (ES Modules desteği)
- Firebase projesi (Authentication + Realtime Database)
- Lokal sunucu (Live Server, `python -m http.server` vb.)

## Kurulum

1. Depoyu indir.
2. `env.js` dosyasındaki Firebase bilgilerini kendi projenle güncelle.
3. Firebase Console'da:
   - Authentication > Sign-in method: Email/Password etkinleştir.
   - Realtime Database oluştur.
4. Projeyi lokal bir sunucu ile çalıştır.

Örnek:

```bash
python -m http.server 5500
```

Sonra tarayıcıdan `http://localhost:5500/login.html` aç.

## Firebase Kuralları (Önerilen Başlangıç)

Aşağıdaki kurallar, yalnızca giriş yapan kullanıcıların veri erişimini sağlar ve profil üzerinde kullanıcı sahipliğini korur:

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "posts": {
      ".read": "auth != null",
      "$postId": {
        ".write": "auth != null",
        "authorId": {
          ".validate": "newData.val() === auth.uid"
        },
        "text": {
          ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 280"
        }
      }
    }
  }
}
```

Not: Hesap silme sırasında kullanıcının kendi postlarını silme ihtiyacı olduğu için `posts` altında yazma kurallarını ürün ihtiyaçlarına göre daha da daraltmak isteyebilirsin.

## Güvenlik Notları

- Güçlü şifre kontrolü kayıt ve şifre değiştirme akışında zorunludur.
- Kullanıcı görünen adı normalize edilir ve uzunluğu sınırlandırılır.
- İstemci tarafı kontroller tek başına yeterli değildir; asıl güvenlik Firebase Rules ile sağlanır.

## Geliştirme Notları

- Uygulama modüler JS yapısı kullanır (`type="module"`).
- Firebase scriptleri doğrudan CDN üzerinden yüklenir.
- `localStorage` yalnızca hatırla seçeneği için e-posta saklar.

## Lisans

Bu proje depo içindeki `LICENSE` dosyasındaki koşullarla lisanslanmıştır.
