# ATES — Local'de Admin + Oyuncu Tarafını Açma Rehberi

Bu prototipte **oyuncu sitesi** ve **operatör (admin) paneli** aynı web uygulamasında
ama **ayrı route + ayrı kimlik doğrulama** ile çalışır. Admin API'si ayrı bir modüldür
(`apps/server/src/admin`) ve **giriş + rol (RBAC)** ister. Aşağıda ikisini de kendi
makinende nasıl açıp test edeceğin adım adım yazılıdır.

> Prototip uyarıları: durum **bellekte** tutulur (sunucu yeniden başlarsa sıfırlanır),
> beacon **simüledir**, admin şifreleri demo içindir. Üretimde gerçek auth (hash'li şifre,
> 2FA, IP allowlist) + kalıcı veritabanı gerekir.

---

## 0. Çalıştırma

Node.js >= 20 ve pnpm gerekir.

```bash
pnpm install
pnpm build

# Terminal 1 — oyun sunucusu (REST + WebSocket + admin API) :4000
pnpm --filter @ates/server start

# Terminal 2 — web arayüzü (oyuncu + admin sayfaları) :3000
pnpm --filter @ates/web dev
```

Veya tek komutla (hot reload):

```bash
pnpm dev
```

| Ne | Adres |
|----|-------|
| **Oyuncu sitesi** | http://localhost:3000 |
| **Admin paneli** | http://localhost:3000/admin |
| Doğrulama (provably-fair) | http://localhost:3000/verify |
| Sunucu API (oyuncu) | http://localhost:4000/api/health |
| Sunucu API (admin) | http://localhost:4000/api/admin/* (auth ister) |

---

## 1. Oyuncu tarafı

1. Tarayıcıda **http://localhost:3000**.
2. Otomatik bir oyuncu profili oluşur; başlangıç bakiyesi **$1000.00 (USD)**, **Min bahis $0.50**.
   Sağ üstte **● Bağlı** görmelisin.
3. Para birimini USD/EUR/TRY/GBP seçebilir, "Yatır/Çek" (mock), bahis ve "Oto Doldur" kullanabilirsin.
4. **Birden fazla oyuncu denemek istersen:** ikinci bir oyuncuyu **farklı bir tarayıcı
   veya gizli (incognito) pencere** ile aç (her sekme kendi `playerId`'sini localStorage'da
   tutar). Aynı tura iki ayrı oyuncu olarak bahis koyabilirsin.

**DOĞRU:** Oyuncu sayfasında oyun var, ama hiçbir yerde admin istatistiği/oyuncu listesi
göremezsin.
**YANLIŞ:** Oyuncu sayfasında P&L, oyuncu listesi gibi operatör verisi görünüyorsa ayrım bozulmuş demektir.

---

## 2. Admin tarafı

1. Tarayıcıda **http://localhost:3000/admin** → **Operatör Girişi** ekranı çıkar.
2. Aşağıdaki demo hesaplarından biriyle gir:

| Kullanıcı | Şifre | Rol | Yetkiler |
|-----------|-------|-----|----------|
| `superadmin` | `superadmin123` | Süper Admin | istatistik + oyuncular + **bakiye düzenleme** |
| `finance` | `finance123` | Finans | istatistik + oyuncular + **bakiye düzenleme** |
| `support` | `support123` | Destek | istatistik + oyuncular (yazma yok) |
| `readonly` | `readonly123` | Salt-okunur | **sadece** istatistik |

> Şifreler ortam değişkeniyle ezilebilir: `ADMIN_SUPERADMIN_PASSWORD`, `ADMIN_FINANCE_PASSWORD`,
> `ADMIN_SUPPORT_PASSWORD`, `ADMIN_READONLY_PASSWORD`. Oturum süresi 1 saat.

3. Giriş sonrası panelde: Genel istatistik + **Ev kâr/zarar (P&L)**, **Jackpot havuzları**
   (Major/Grand + toplam jackpot ödemesi + havuz-kısıtlı ödeme sayısı), **Oyuncular** tablosu,
   **Son Turlar**. Sağ üstte rol rozeti ve **Çıkış**.

**Rol kısıtını gör:** `readonly` ile gir → istatistikleri görürsün ama bir oyuncunun
bakiyesini değiştirmeye çalışırsan sunucu **403** döner (salt-okunur yazamaz). `superadmin`
veya `finance` ile bakiye düzenleyebilirsin.

---

## 3. Ayrım kanıtı (oyuncu admin'e giremez)

Tarayıcıdan:
- Oyuncu olarak **/admin**'e gidersen **giriş ekranı** ile karşılaşırsın; veri görünmez.

Komut satırından (sunucu :4000 açıkken):

```bash
# Oyuncu API'si — çalışır
curl -s http://localhost:4000/api/health

# Admin verisi — tokensız => 401
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/api/admin/stats        # 401

# Sahte token => 401
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer sahte" \
  http://localhost:4000/api/admin/stats                                                # 401

# Doğru giriş => token al
TOKEN=$(curl -s -X POST http://localhost:4000/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"superadmin","password":"superadmin123"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')

# Token ile => 200 + veri
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/admin/stats                                                # 200

# Salt-okunur rol bakiye değiştiremez => 403
RO=$(curl -s -X POST http://localhost:4000/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"readonly","password":"readonly123"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $RO" \
  -H 'Content-Type: application/json' -d '{"delta":100}' \
  http://localhost:4000/api/admin/players/SOME_ID/adjust                               # 403
```

**DOĞRU:** 401 / 401 / 200 / 403 sırasını görürsün.
**YANLIŞ:** Tokensız istek 200 dönüp veri sızdırıyorsa izolasyon bozulmuş demektir.

---

## 4. Admin API uçları (özet)

| Uç | Yetki | Not |
|----|-------|-----|
| `POST /api/admin/login` | açık | `{username, password}` → `{token, role, permissions, expiresAt}` |
| `POST /api/admin/logout` | token | oturumu kapatır |
| `GET /api/admin/session` | token | mevcut oturum bilgisi |
| `GET /api/admin/stats` | `stats:read` | genel istatistik + jackpot muhasebesi |
| `GET /api/admin/players` | `players:read` | oyuncu listesi |
| `POST /api/admin/players/:id/adjust` | `balance:write` | `{delta}` ile bakiye düzeltme |
