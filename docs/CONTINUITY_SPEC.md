# Continuity & Freeze Token Specification (Devamlılık ve Dondurma Jetonları Mantığı)

## 1. Genel Bakış
Bu doküman, Exam App içerisindeki **Günlük Çalışma Serisi (Streak)** ve **Dondurma Jetonları (Freeze Tokens)** sisteminin iş kurallarını, başarı oranları matematiksel formüllerini ve kullanıcı haklarını tanımlar.

---

## 2. Günlük Seri Koruma Kuralı (Daily Streak Maintenance)

Kullanıcının o günkü çalışma serisini (streak) kırmayıp koruması için sağlaması gereken minimum şarttır.

### Günlük Gereksinim ($Req$) Formülü
Her günün ilk açılışında veya kart yüklendiğinde, FSRS aralıklı tekrar algoritmasına göre hatırlanabilirlik oranı $R \le 0.90$ olan soru sayısı anlık görüntü ($N_{overdue}$) olarak sabitlenir.

- **Durum A ($N_{overdue} \ge 15$):** Günlük seri eşik barajı **15 soru**dur. Kullanıcı o gün en az 15 soru çözdüğünde serisini korur (`studied = true`).
- **Durum B ($0 < N_{overdue} < 15$):** Kullanıcı FSRS önerisi olan **tüm $N_{overdue}$ soruları** çözdüğünde serisini korur.
- **Durum C ($N_{overdue} == 0$):** FSRS sisteminde hiç tekrar bekleyen soru yoksa, kullanıcı herhangi bir kaynaktan en az **15 soru** çözdüğünde serisini korur.

---

## 3. Dondurma Jetonu Kazanım Kuralları (Freeze Tokens Mechanics)

Dondurma jetonları haftalık otomatik yenilenmez; emeğe dayalı bir başarı ödülüdür.

### A. Hoş Geldin Jetonu (Initial Welcome Token)
- Yeni kullanıcı ilk başladığında **1 adet hediye dondurma jetonuna** sahiptir (`remaining: 1, total: 1`).
- Bu jeton kullanıldığında harcanır (`remaining: 0`). Yeniden jeton kazanmak aşağıdaki kurallara bağlıdır.

### B. 1. Dondurma Jetonu (7 Günlük Başarı - Tier 1)
- **Şart 1 (Kesintisiz Seri):** Geriye dönük son 7 gün boyunca gün serisi hiç bozulmamış olmalıdır (Dondurma jetonu kullanılmış günler seriyi bozmaz).
- **Şart 2 (%70 FSRS Oranı):** Son 7 gün boyunca önerilen toplam FSRS sorularının en az **%70'i** çözülmüş olmalıdır.
- **Sonuç:** Kullanıcı 1. dondurma hakkını kazanır (Maksimum 1 jetona ulaşır).

### C. 2. Dondurma Jetonu (14 Günlük Üst Düzey Başarı - Tier 2)
- **Şart 1 (Kesintisiz Seri):** Geriye dönük son 14 gün boyunca gün serisi hiç bozulmamış olmalıdır.
- **Şart 2 (%80 FSRS Oranı):** Son 14 gün boyunca önerilen toplam FSRS sorularının en az **%80'i** çözülmüş olmalıdır.
- **Sonuç:** Kullanıcı 2. dondurma hakkını kazanır (Maksimum 2 jeton kapasitesi).

---

## 4. Matematiksel Formüller

### FSRS Tamamlama Oranı (Rolling FSRS Rate)
Son $D$ gün için ($D = 7$ veya $D = 14$):

$$\text{FSRS Oranı (\%)} = \frac{\sum_{i=1}^{D} \min(\text{ChosekSoruCount}_i, \text{OverdueSnapshot}_i)}{\sum_{i=1}^{D} \max(1, \text{OverdueSnapshot}_i)} \times 100$$

- Eğer bir günde $\text{OverdueSnapshot}_i = 0$ ise ve kullanıcı en az 15 soru çözmüşse, o gün %100 başarılı kabul edilir.

---

## 5. Dondurma Jetonunun Harcanması
Kullanıcı herhangi bir gün soru çözmeyi unuttuğunda:
1. Son 2 günde çözülmemiş gün varsa ve `remaining > 0` ise, en eski gün `frozen: true` yapılır.
2. `remaining` 1 eksiltilir.
3. Seri kırılmaz ve kaldığı yerden devam eder.
