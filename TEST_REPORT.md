# ATES — TXID Provably-Fair Betting MVP · Test Report

**Scope:** play-money prototype (PR #1). No real custody / KYC / fiat settlement.
**Method:** local run (server `:4000`, web `:3000`) tested at three levels:
deterministic **engine harness** (built `@ates/engine`), **WebSocket integration**
(scripted Socket.IO client against the live server), and **REST/curl** checks,
plus earlier UI screenshots. Every assertion is a real check; negative and
manipulation controls included. No fake PASS.

**Headline:** every *implemented* mechanic passed. The three previously missing
spec items — **random 20-coin pool, crypto→fiat conversion, Auto-Pick** — are now
**implemented and tested** (engine + live integration + negative controls).
Production-only concerns (admin auth, persistence, real beacon) remain flagged.

Toolchain gate (all green):
```
pnpm test       -> engine 39 passed, server 11 passed (50 total)
pnpm typecheck  -> 3/3 packages OK
pnpm lint       -> 3/3 packages, no warnings/errors
pnpm build      -> OK (dist emitted)
```
Live harness totals: engine adversarial 41/41 · WS integration 37/37 ·
new-features live 28/28 · exposure cap 2/2.

---

## 1. Summary table

| # | Mechanic | Result | Note |
|---|----------|--------|------|
| 1 | Bet cycle: debit → settle → payout (win & loss) | **PASS** | live WS: debit exact, winner = stake×mult, loser stake stays, no payout |
| 1b | Settlement idempotent / no double-pay | **PASS (with note)** | `settleRound` pure & deterministic; no re-settle path exposed. No explicit guard. |
| 2 | Streak: +1 on win, reset to 0 on loss; tiers 3/5/6/7 | **PASS** | live inc/reset observed; tier thresholds verified in engine |
| 3 | Chain-aware odds + 94% RTP | **PASS** | hex vs base58 differ; analytic RTP 0.94 (±0.0025), Monte-Carlo 0.9378/60k |
| 4 | Provably-fair verify + manipulation control | **PASS** | honest→true; tampered seed/txid/beacon/resultHash→false; 404 on bogus id |
| 5 | Random **20-coin pool** | **PASS** | 20/24 coins per round from commit+roundId; winner drawn from pool by beacon; verify re-derives pool; manipulations fail |
| 6 | Bet lock / race condition | **PASS** | post-lock bet rejected, balance unchanged; 2 parallel bets debit exactly, never negative |
| 7 | Jackpot: contribution, tiers, tail gate, reset | **PASS** | 4% (40/60) growth live; MINI 10× fired live; MINOR/MAJOR/GRAND + tail verified in engine |
| 8 | Currency & limits (min/max/exposure) | **PASS** | crypto→fiat FX (mock rates) live; dynamic min bet = 0.5 USD in player fiat; deposits/withdraws audited; exposure cap enforced |
| 9 | Auto-Pick | **PASS** | `autoPick(n)` server-side, identical odds tables; 10k-vs-10k RTP statistically equal; UI one-click |
| 10 | Operator/admin view (P&L) | **PASS (with risk)** | P&L = staked − paid correct; **admin is UNAUTHENTICATED** (prototype) |
| 11 | Resilience / edge cases | **PASS (with note)** | bad inputs rejected; **in-memory state — lost on restart** |

Counts: engine harness **41/41**, WS integration **37/37** (incl. concurrency &
lock), new-features live **28/28**, exposure cap **2/2**, REST/verify checks
**all green**.

---

## 2. Detail — per mechanic (step / expected / observed / result)

### 1. Bet cycle: debit → settle → payout
- **Win** (live WS): bet 4, balance `1005.06 → 1005.06−4`, after settle
  `+4.44` (stake×1.11) → matches. **PASS**
- **Loss** (live WS): bet 4 debited; result not a winner → payout 0, balance
  stays at debited value. **PASS**
- **House P&L** (engine): `housePnl = totalStaked − totalPaidOut` exact. **PASS**
- **Payout formula** (engine): winner payout `= round2(stake × multiplier)`,
  multiplier `= (1/p)(1−0.06)`. **PASS**

Evidence (WS):
```
PASS | debit exactly -4 (round 252) | bal 1009.06->1005.06
PASS | WIN: balance += payout (4.44) | bal 1005.06+4.44 -> 1009.5
PASS | LOSS: no payout, stake stays debited | bal=1051.54
```

### 1b. Idempotency / double-pay
- `settleRound` is a pure function; calling it twice on identical input yields a
  byte-identical result (`JSON.stringify` equal). **PASS**
- In the server, a round is settled exactly once (`revealRound` via single timer),
  after which a new round begins; **no exposed path re-settles a round**, so no
  double-credit is reachable. There is no explicit "already settled" guard, but
  no re-entry exists either. **PASS (note for production hardening).**

### 2. Streak & tier thresholds
- Live: streak `1→2→3` on consecutive wins, `→0` on a loss. **PASS**
- Engine `tierForStreak`: `<3 NONE`, `3 MINI`, `5 MINOR`, `6 MAJOR`, `7 GRAND`.
  Matches spec 3/5/6/7. **PASS**

### 3. Chain-aware odds + 94% RTP
- Probabilities: hex `LAST_CHAR_DIGIT`=0.625 / `LETTER`=0.375; Solana base58
  `DIGIT`=9/58≈0.155 / `LETTER`=49/58≈0.845. **PASS**
- Multipliers differ per chain (live `/api/bet-types`):
  `LAST_CHAR_DIGIT` BTC **1.50** vs SOL **6.06**; `LETTER` BTC **2.51** vs SOL **1.11**;
  `EXACT_LAST_CHAR` hex **15.04** vs SOL **54.52**. **PASS**
- RTP: analytic `p×multiplier ≈ 0.94` across all bet types/chains, max deviation
  **0.0025** (rounding only). Monte-Carlo (BTC digit, 60k rounds) RTP **0.9378**. **PASS**

### 4. Provably-fair verify + manipulation
- Honest round verifies **true**; re-derived winning TXID is **byte-identical**.
- **NEGATIVE/MANIPULATION** (all must reject):
  - tampered `winningTxid` → **false**
  - tampered `serverSeed` (commit mismatch) → **false**
  - tampered single beacon hash → **false**
  - tampered `resultHash` → **false**
  - `resultHash` provably depends on **all 4** beacon chains
  - bogus roundId via REST → **HTTP 404** "Round not found" (not a green pass)
- **PASS.** Evidence:
```
PASS | verifyRound true for honest round
PASS | MANIP: tampered winningTxid -> false
PASS | MANIP: tampered serverSeed -> false
PASS | MANIP: tampered beacon -> false
PASS | resultHash depends on all 4 beacon chains
== verify NEGATIVE (bogus id) == http_status=404
```

### 5. Random 20-coin pool — IMPLEMENTED, PASS
- Catalogue of **24 coins** (hex and base58 alphabets); every round selects
  **20** via a Fisher–Yates shuffle seeded by `commitHash + roundId`
  (`engine/src/pool.ts:selectCoinPool`) — fixed at commit time, publicly
  re-derivable, operator cannot swap coins mid-round.
- The **winner is drawn from the pool** from the post-lock `resultHash`
  (`selectWinningCoin`), so it is beacon-tied and front-run-proof.
- `verifyRound` now also re-derives the pool **and** the winning-coin draw.
- Evidence (live):
```
PASS | round state lists a 20-coin pool
PASS | pool re-derived from public commitHash+roundId matches byte-for-byte
PASS | pool changes between rounds (not constant)
PASS | winning coin NEAR is inside the round's pool
PASS | verify returns valid=true and includes the 20-coin pool
PASS | MANIP: tampered pool order -> verify fails
PASS | MANIP: forged roundId -> verify fails
```
- Engine tests: deterministic re-derivation, per-round variation, tampered
  pool / replaced coin / forged roundId / wrong winner → all verify **false**.
- Odds engine stays chain-aware per the winning coin's alphabet (RTP 94%
  preserved — multiplier *ranges* shown during betting, exact multiplier fixed
  by the winning coin at settle). Exposure cap now uses the **worst-case
  multiplier across the whole pool** (conservative).

### 6. Bet lock / race condition
- Bet attempted during `locking`/`result` → rejected ("Betting is closed"),
  balance unchanged. **PASS**
- Two parallel `bet:place` for the same player both succeed and debit **exactly**
  the combined amount; balance never goes negative; settle credits exactly the
  sum of payouts. **PASS** (Node single-threaded event loop serializes the two
  handlers, so balance stays consistent.)
```
PASS | NEG bet during lock/result rejected | phase=locking
PASS | concurrency: two parallel bets both debited exactly | bal 1000->994
PASS | concurrency: balance never negative | bal=994
```

### 7. Jackpot
- Config: `contributionRate 0.04`, `majorShare 0.4` (40% Major / 60% Grand),
  `majorSeed 250`, `grandSeed 1000`, `mini 10×`, `minor 20×`, `grandStreak 7`,
  `grandTailLength 5`. **PASS**
- Contribution math (engine): bet 100 → Major +1.6, Grand +2.4. **PASS**
- **Live pool growth** via `/api/admin/stats`: across three 50-bets the pools
  moved `Δmajor=+2.40`, `Δgrand=+3.60` (= 3×50×0.04 split 40/60). **PASS**
- **MINI live**: a 3-win streak with stake 4 paid an extra **+40** (= stake×10)
  on top of the normal payout (observed in WS run, balance `1005.5 +10.04 +40 =
  1055.54`). **PASS**
- Tail gate `hasIdenticalTail`: last-5 identical → true; 4-identical → false. **PASS**
- MINOR (20×) / MAJOR (pool→reset to 250) / GRAND (pool→reset to 1000, streak
  reset) verified in engine harness (a 5–7 win streak is too rare to force live
  in reasonable time). **PASS (engine-level for the higher tiers).**

### 8. Currency & limits — crypto→fiat IMPLEMENTED, PASS
- **FX service** (`apps/server/src/fx.ts`): mock spot rates behind a
  `getRate(from, to)` interface (swap in a real source later). All conversions
  pivot through USD.
- **Deposit (mock):** `POST /api/wallet/:id/deposit {coin, amount}` → coin→fiat
  at the current rate, credited to the player's fiat balance, with a full audit
  record (coin, coinAmount, rate, fiatAmount, currency).
- **Withdraw (mock):** fiat→coin reverse conversion, balance debited.
- **Dynamic min/max bet:** thresholds are `0.5 / 500 USD × rate(USD→fiat)` —
  e.g. TRY: min 20.50 ₺, max 20 500 ₺.
- Round totals / exposure / jackpot contributions are **normalized to USD**, so
  multi-currency players cannot distort risk accounting.
- Evidence (live):
```
PASS | dynamic min bet for TRY = 20.50 (0.5 USD × 41)
PASS | deposit 100 USDT -> 4100 TRY (rate 41)
PASS | balance credited exactly | bal 1000 -> 5100
PASS | withdraw 820 TRY -> 0.1 SOL exact
PASS | audit trail: 2 transactions with coin/rate/fiat recorded
PASS | NEG: unsupported coin rejected | Unsupported coin: SHIB
PASS | NEG: negative deposit rejected | Amount must be > 0
PASS | NEG: withdraw over balance rejected | Insufficient balance
PASS | NEG: 1 TRY bet rejected by dynamic min (20.5 TRY)
PASS | bet at exactly 20.5 TRY accepted
PASS | SOL: 2nd bet rejected by exposure cap (>50k)
```

### 9. Auto-Pick — IMPLEMENTED, PASS
- `autoPick(n)` (engine) draws n picks uniformly from **exactly the manual bet
  space** (`AUTO_PICK_SPACE`), so odds are identical by construction; bets then
  flow through the normal `placeBet` path (same debit/lock/settle/limits).
- Fairness test: 10 000 auto picks vs 10 000 manual picks over the same TXIDs →
  both RTPs sit at the 94% target within Monte-Carlo noise; per-pick multiplier
  equality asserted against the manual table.
- UI: "Oto Doldur" button + 3/5/10 count selector on the game page.
- Evidence (live):
```
PASS | autopick(5 × $2) places 5 bets | ["LAST_CHAR_DIGIT","FIRST_CHAR_RANGE",...]
PASS | autopick debits exactly 5×2=10 | bal 1000 -> 990
PASS | NEG: autopick count=0 rejected
PASS | NEG: autopick below min bet rejected
```

### 10. Operator / admin view
- `/api/admin/stats` returns players, roundsPlayed, recent staked/paid, P&L,
  jackpot pools. P&L = `recentTotalStaked − recentTotalPaidOut` (e.g.
  `196 − 159.48 = 36.52`). **PASS**
- **SECURITY:** the admin endpoint is **unauthenticated** (no RBAC/2FA/IP
  allowlist). Acceptable for a local play-money prototype, **must not ship**.
  Flagged as **P0 for production** (code comments already note this).

### 11. Resilience / edge cases
- Bad inputs (unknown player, unknown bet type, negative amount) → clean error
  responses, no state corruption. **PASS**
- **State is in-memory** (`Map`s in `GameService`): a server restart **wipes**
  players, balances, history, jackpot pools. Expected for the prototype but a
  **P1 for production**.
- **Beacon is simulated** (random 32-byte values at lock time), not real chain
  block hashes — by design for the prototype.

---

## 3. Negative / manipulation controls (summary)

| Control | Input | Expected | Observed |
|---|---|---|---|
| Verify tampered coin pool | swap 2 pool coins | invalid | **false** ✔ |
| Verify forged roundId vs pool | other round id | invalid | **false** ✔ |
| Deposit unsupported coin | SHIB | reject | **reject** ✔ |
| Deposit negative amount | −5 BTC | reject | **reject** ✔ |
| Withdraw over balance | 10⁹ | reject | **reject** ✔ |
| Bet below dynamic min (TRY) | 1 ₺ (< 20.5 ₺) | reject | **reject** ✔ |
| Auto-pick count 0 / 21 | 0 | reject | **reject** ✔ |
| Auto-pick below min | 0.1 | reject | **reject** ✔ |
| Verify bogus round | all-zero UUID | 404 / not found | **404** ✔ |
| Verify tampered txid | flip last char | invalid | **false** ✔ |
| Verify tampered seed | random seed | invalid (commit mismatch) | **false** ✔ |
| Verify tampered beacon | replace 1 chain | invalid | **false** ✔ |
| Bet below min | 0.25 | reject | **reject** ✔ |
| Bet above max | 501 | reject | **reject** ✔ |
| Negative amount | −10 | reject | **reject** ✔ |
| Bet after lock | during locking | reject, no debit | **reject, bal unchanged** ✔ |
| Exposure cap | 2× 500 on SOL | 2nd reject | **reject** ✔ |
| Unknown player | ghost id | reject | **reject** ✔ |
| Invalid bet type | "NONSENSE" | reject | **reject** ✔ |

---

## 4. Out of scope / not implemented

- Real crypto custody, on-chain deposits/withdrawals, KYC/AML — intentionally
  excluded (play-money MVP; FX deposits/withdrawals are mock conversions).
- Real FX feed — rates are mocked behind the `getRate` interface.
- Persistence (DB) — in-memory only.
- Admin authentication (RBAC/2FA) — not implemented in prototype.

---

## 5. Findings & recommendations

**P0 (must fix before any real-money / public deployment)**
- Admin/operator endpoints (`/api/admin/stats`) are **unauthenticated**. Add
  RBAC + 2FA + IP allowlist (already called out in code comments).

**P1 (important for a usable product)**
- **No persistence** — all state in memory; restart loses balances, history,
  jackpot pools. Move to a datastore before multi-instance/real use.
- Add an explicit **"already settled" idempotency guard** on the round before
  any external settle trigger is introduced.
- Pool selection derives from `commitHash + roundId`; a malicious operator could
  grind server seeds to bias which coins enter the pool (not the winner — that
  stays beacon-tied). For production, mix a previous-round beacon value into the
  pool seed.

**P2 (feature completeness / polish)**
- Replace mock FX rates with a real feed behind the existing `getRate` interface.
- Consider exposing per-player and global exposure caps in admin config.

---

## 6. How to reproduce

```bash
pnpm install && pnpm build
pnpm --filter @ates/server start   # :4000
pnpm --filter @ates/web dev        # :3000
# engine + integration harnesses used in this report were run as standalone
# Node scripts importing the built engine / a scripted socket.io-client.
```

---

## 7. Canlı Test Rehberi (tarayıcıdan, teknik olmayan dille)

Bu bölüm, üç özelliği ve çekirdeğin bozulmadığını kendi gözünle tarayıcıdan test
edebilmen için adım adım yazılmıştır. Her madde "şunu yap → şunu görmelisin"
biçimindedir.

### 0. Başlatma
1. Terminalde sırayla çalıştır:
   ```bash
   pnpm install && pnpm build
   pnpm --filter @ates/server start   # 1. terminal — sunucu :4000
   pnpm --filter @ates/web dev        # 2. terminal — web :3000
   ```
2. Tarayıcıda **http://localhost:3000** adresine git.
3. Başlangıçta görmelisin: sağ üstte **● Bağlı**, bakiye **$1000.00 (USD)**,
   **Min bahis: $0.50**, ortada geri sayımlı bir tur (BAHİS AÇIK), altında "Bu
   turun coin havuzu", "Bahis Yap" kartı ve "Oto Doldur" düğmesi.
   - **YANLIŞ varsa:** "○ Bağlanıyor" takılı kalırsa sunucu (:4000) çalışmıyordur.

### 1. 20-coin havuzunu görmek
- **Yap:** Ana sayfada "Bu turun coin havuzu" yazısının altına bak.
  - **DOĞRU:** Tam **20 adet** coin rozeti listelenir (BTC, ETH, SOL, ADA, …).
    Başlıkta "(20 coin · commit + tur id'den türetilir, doğrulanabilir)" yazar.
  - **YANLIŞ:** 4 coin veya sabit aynı liste görürsen havuz özelliği çalışmıyordur.
- **Yap:** 2–3 tur bekle (her tur ~29 sn). Her yeni turda havuza tekrar bak.
  - **DOĞRU:** Coin listesi ve sırası **her turda değişir** (önceden tahmin edilemez).
  - **YANLIŞ:** Liste hiç değişmiyorsa seçim deterministik/tahmin edilebilir demektir.
- **Yap:** Bir tur bitince sonuç ekranında "Kazanan coin" rozeti havuzda
  **vurgulanır** (yeşil çerçeve). Ardından "Doğrula: bu turun adaletini kontrol
  et" bağlantısına tıkla.
  - **DOĞRU:** Doğrulama sayfasında üstte yeşil **"✓ Doğrulandı — sonuç açıklanan
    girdilerle birebir yeniden üretildi."** çıkar; tabloda **Coin Havuzu (20)**,
    **Kazanan Coin (havuzdan)** ve **Kazanan TXID** birlikte gösterilir. Yani
    "bu 20 coin neden seçildi" de kanıtlanır.
  - **YANLIŞ:** Kırmızı "✗ Doğrulama başarısız" çıkarsa girdiler sonuçla
    eşleşmiyordur.
- **Manipülasyon (bozma) kontrolü:** Doğrulama sayfası girdileri sunucudan dürüst
  çeker, bu yüzden ekrandan elle bozamazsın. Bozma testi motor testleriyle
  otomatik koşar: tohum/tur id/havuz/TXID'den biri değiştirilirse doğrulama
  **false** döner (`pnpm test` → `pool.test.ts` ve `fairness.test.ts`).

### 2. Fiat dönüşümünü görmek
- **Yap:** Sağ üstteki **"Para birimi"** açılır menüsünden **TRY** seç.
  - **DOĞRU:** Sayfa yenilenir; bakiye **₺1000.00**, **Min bahis: ₺20.50** olur
    (= 0,50 USD'nin TRY karşılığı). Para birimi değişince o para biriminde yeni
    bir oyuncu profili açılır. EUR/GBP/USD için de eşik kura göre değişir.
- **Yap (mock yatırım):** "Cüzdan (mock)" satırında coin **USDT**, tutar **100**
  iken **"Yatır (coin → TRY)"** düğmesine bas.
  - **DOĞRU:** Üstte yeşil mesaj: **"Yatırım: 100 USDT → 4100.00 TRY (kur
    41.0000)"**; bakiye **₺1000 → ₺5100** olur. Hemen altında "Son işlem:
    yatırım · 100 USDT ↔ 4100 TRY · kur 41.0000" (orijinal coin + kur + sonuç
    fiat kaydı).
- **Yap (min bahis eşiği — negatif kontrol):** TRY profilindeyken bahis tutarını
  **5** bırak ve herhangi bir bahis düğmesine bas.
  - **DOĞRU:** Kırmızı uyarı: **"Minimum bet is 20.5 TRY (0.5 USD)"**, bakiye
    **değişmez**. Tutarı 20.50 veya üzeri yapınca bahis kabul edilir.
- **Yap (mock çekim):** Bir coin seç, tutar gir, **"Çek (TRY → coin)"** bas.
  - **DOĞRU:** Yeşil mesaj fiat→coin dönüşümünü ve kuru gösterir; bakiyeden
    düşülür. Bakiyeden fazlasını çekmeye çalışırsan "Insufficient balance" reddi gelir.

### 3. Oto-doldur'u görmek
- **Yap:** "Bahis Yap" kartının altındaki **"Oto Doldur"** satırında hane sayısını
  (**3 / 5 / 10**) seç, tutarı belirle, **"Oto Doldur (n × tutar)"** düğmesine bas.
  - **DOĞRU:** Yeşil mesaj **"Oto doldur: 3 bahis alındı (her biri 5 …)"**; bakiye
    tam **n × tutar** kadar düşer (örn. 3×5 = 15), canlı havuzdaki bahis sayısı artar.
  - **YANLIŞ:** Hiç bahis girilmez veya bakiye yanlış düşerse sorun var demektir.
- **Adalet (avantaj yok):** Oto-doldur, elle seçimle **birebir aynı** bahis havuzunu
  ve oran tablosunu kullanır (kod: `engine/src/autopick.ts` → `AUTO_PICK_SPACE`).
  İstatistik testi 10.000 oto vs 10.000 elle seçimin aynı RTP'yi (≈%94) verdiğini
  doğrular (`pnpm test` → `autopick.test.ts`). UI'da da oran düğmelerinin çarpanları
  elle ve oto için aynıdır.

### 4. Çekirdeğin bozulmadığını görmek (regresyon)
- **Normal bahis:** USD profiline dön, bir bahis türü seç, tutar gir, "Bahis Yap".
  - **DOĞRU:** Bakiye anında **tutar kadar düşer** ("Bahis alındı" mesajı). Tur
    bitince **kazandıysan** "Kazandın! +X" yeşil mesajı çıkar, bakiye ödeme kadar
    artar, **Streak** +1 olur; **kaybettiysen** "Bu tur kaybettin", stake geri gelmez.
- **Jackpot:** Sağdaki "Jackpot" kartında **Major/Grand** havuzları görünür; aynısı
  **http://localhost:3000/admin** sayfasında "Jackpot Havuzları" altında ve oyun
  oynandıkça büyür. Admin'de ayrıca oyuncu sayısı, oynanan tur, toplam bahis/ödeme
  ve **Ev kâr/zarar (P&L)** görürsün.
- **Geri sayım biterken bahis (kilit testi):** Geri sayım 0'a yaklaşırken / "SONUÇ
  HESAPLANIYOR" anında bahis koymayı dene.
  - **DOĞRU:** Düğme **"Bahis Kapalı"** olur ve bahis **reddedilir**, bakiye değişmez.

> Not (prototip sınırları): Admin paneli kimlik doğrulamasızdır, durum bellekte
> tutulur (sunucu yeniden başlarsa sıfırlanır) ve beacon simüledir. Bunlar
> üretimde kapatılması gereken, README ve bu raporda işaretli kalemlerdir.
