# Continuity & Freeze Token Specification (Devamlılık ve Dondurma Jetonları Mantığı)

## 1. Genel Bakış
Bu doküman, Exam App içerisindeki **İki Kulvarlı Devamlılık Sistemi**'ni tanımlar:
1. **Genel FSRS Serisi (Global FSRS Streak):** Kütüphanedeki **arşivlenmemiş tüm kaynaklarda** aralıklı tekrar (FSRS) algoritmasına göre hatırlanması gereken soruların genel takibi. Kaynağın "aktif" olup olmaması bu kulvarı etkilemez: aktiflik yalnızca elle test kurmayı sınırlar, FSRS takvimini değil.
2. **Özel Odak Serisi (Custom Focus Streak):** Kullanıcının doğrudan seçtiği maksimum 3 JSON kaynağındaki (`source.id`) sorulara odaklanan özel seri takibi.

Her sorunun kimliği `sourceId_questionId` bileşik anahtarıdır ve istatistikler (`AppState.stats`) baştan beri bu anahtarla tutulur. Bir soruyu kaynağından bağımsız ele almak bu yüzden mümkündür: soru asıl kaynağından koparılmaz, yalnızca tekil olarak ele alınır — test sonuçları bitişte yine `q.sourceId`'ye göre ilgili kaynağın kendi geçmişine dağıtılır.

---

## 2. Günlük Seri Koruma Kuralları

### A. Genel FSRS Serisi ($Req_{global}$)
- Günün başında retrievability $R \le 0.90$ olan soru sayısı $N_{overdue}$ sabitlenir.
- **Eşik:** $Req_{global} = \min(N_{overdue}, 15)$ (Eğer $N_{overdue} == 0$ ise $Req_{global} = 15$).

### B. Özel Odak Serisi ($Req_{focus}$)
Kullanıcı maksimum 3 JSON kaynağı seçer (`AppState.continuityConfig.focusSources`).
- **Dağıtım Oranları (Hedef: 15 Soru):**
  - **3 Kaynak:** Her birinden 5, 5, 5 soru.
  - **2 Kaynak:** 8 ve 7 soru (Soru sayısı çok olan kaynağa 8 soru verilir).
  - **1 Kaynak:** 15 soru.
  - **İstisna (Kısıtlı Kaynak):** Seçili kaynaklardaki unutturulmamış/öğrenilmemiş toplam soru sayısı $< 15$ ise (ör. 9 soru varsa), $Req_{focus} = 9$ olur.
- **Soru Seçim Sırası (FSRS Öncelikli):**
  1. Seçili kaynaklardaki hatırlanabilirlik $R$ en düşük (gecikmiş) sorular.
  2. Henüz hiç çözülmemiş (yeni) sorular.
  3. Kaynaktaki tüm sorular öğrenilmişse, pekiştirme için $R$ değeri en düşük öğrenilmiş sorular.

---

## 3. Günün Tekrarı — Seri Koşusu (Streak Run)

Her iki seri kartında da bir aksiyon butonu bulunur (`#globalStreakRunBtn`, `#focusStreakRunBtn`). Amaç, kullanıcının önce kaynaklar arasında dolaşıp hangi soruları çalışacağını aramasını ortadan kaldırmaktır: tek tık, FSRS'in o gün önerdiği soruları doğrudan getirir.

Motor `src/features/stats/streak-run.js` içindedir ve DOM'dan bağımsız, saf bir fonksiyondur (`buildStreakRun`).

### A. Havuz
- `buildQuestionPool({ scope: 'all' })` ile **arşivlenmemiş tüm kaynaklar** taranır; `active` bayrağı gözetilmez.
- `learned` işaretli sorular elle kurulan testlerdeki davranışla tutarlı olacak şekilde havuz dışıdır (yanlış cevap bu bayrağı düşürüp soruyu tekrar dolaşıma sokar).
- `scope: 'focus'` seçildiğinde havuz `focusSources` ile sınırlanır; hiç kaynak seçilmemişse koşu boş döner ve buton pasifleşir.

### B. Üç Kova ve Öncelik
1. **Gecikmiş** ($0 < R \le 0.9$) — $R$ artan sırada. Asıl kaynak budur.
2. **Yeni** (hiç çözülmemiş, dolayısıyla $R = 0$) — seansın **%20**'si bu kovaya ayrılır.
3. **Yaklaşan** ($R > 0.9$) — yalnızca dolgu; vadesi en yakın olan önce.

> **Neden yeni sorulara ayrı kota var?** Hiç çözülmemiş soruların hepsinde $R = 0$ ve varsayılan zorluk aynıdır; hiçbir sıralama ölçütü onları ayıramaz. Kota ve **gün bazlı tohumlu karıştırma** (`shuffleArraySeeded`, tohum = `YYYY-MM-DD`) olmasaydı, her gün aynı ilk N soru gelir ve kütüphanenin geri kalanı hiç yüzeye çıkmazdı. Tohum güne bağlı olduğu için seans yarıda bırakılıp geri dönüldüğünde liste birebir aynı kurulur, ertesi gün ise değişir.

### C. Sıralama Modları
Kullanıcı ilk kullanımda modal ile seçer; tercih `continuityConfig.streakRunOrder` içinde saklanır ve sonraki tıklamalar doğrudan başlar. Mod değiştirmek için buton yanındaki ok kullanılır.

- **`mixed` — Saf FSRS sırası:** Kaynak ve klasörden tamamen bağımsız. Kova 1 → kova 2 → kova 3.
- **`grouped` — Kaynak/klasör bazlı:** Yine en acil sorudan başlar; ardından o sorunun kaynağı, sonra aynı klasördeki diğer kaynaklar gelir. Klasörler ve kaynaklar **en acil üyelerine göre** sıralanır, bir kaynağın soruları bölünmez. Böylece ilişkili konular bağlam içinde çalışılır.
  - **Kaynak başına tavan:** $\lceil hedef / 3 \rceil$. Tavan olmasaydı büyük bir kaynak seansın tamamını yutar ve klasör katmanı hiç görünmezdi. Başka kaynak seansı dolduramıyorsa tavan kalkar — kısa bir koşu, tavanı aşmaktan kötüdür.

Her katmanda eşitlik bozucu: $R$ → `difficulty` azalan → id. Bu olmasaydı eşit $R$'li sorular kütüphane dizisi sırasına düşerdi.

### D. Soru Sayısı
`max(15, kullanıcının "Soru Sayısı" tercihi)`. Günlük hedef 15'in altında hesaplansa bile taban 15'tir. Havuzda daha az soru varsa ne varsa o gelir; buton etiketi gerçek koşu uzunluğunu gösterir (`Seriyi Koru (12)`).

Günlük seri sağlandıktan sonra buton kapanmaz, yalnızca etiketi değişir (`FSRS ile Çalış (N)`) — kullanıcı çalışmaya devam edebilir.

### E. Koşunun Test Akışındaki Ayrıcalıkları
- **Karıştırılmaz.** Sıra özelliğin kendisidir.
- **Focus pool enjeksiyonu uygulanmaz** (sırayı ve soru sayısını bozardı).
- **Hızlı Erişim oturumlarına yazılmaz ve onları silmez.** Koşu tüm kütüphaneden çekildiği için hiçbir preset'e ait değildir; `testTracking.mode === 'streak'` bayrağı bunu sağlar.
- Aynı bayrak, yarıda bırakılan bir koşu "Devam Et" ile açıldığında geniş `questionMap`'in kurulmasını 
sağlar.
- Geçmiş kaydının başlığı, aktif kaynaklardan değil **gerçekten çözülen soruların kaynaklarından** türetilir (3'ten fazlaysa `A + B + C +N`).

---

## 4. Arşiv ve FSRS Saati (Dondurma)

Arşivlenen bir kaynak dolaşımdan çıkar; soruları gösterilemediği için **FSRS saati de durur**.

- Arşive alınırken `source.archivedAt` damgası yazılır.
- Geri yüklenirken kaynağın her sorusunun `lastReview` değeri, arşivde geçen süre kadar **ileri kaydırılır** (`thawStatsOnRestore`, `archive.js`).

**Sonuç:** Tekrarına 5 gün kala arşivlenen bir soru, arşivden çıktıktan 5 gün sonra tekrara girer. Arşive alınırken zaten 10 gün gecikmiş bir soru ise geri döndüğünde yine tam 10 gün gecikmiştir — daha fazlası değil. Böylece uzun süre bekletilmiş büyük bir kaynak geri alındığında bütün borcu bir anda üstüne yıkılmaz.

**Neden "kalan gün" değil de `lastReview` kaydırılıyor?** Uygulamada saklanan bir "sonraki tekrar tarihi" yoktur; FSRS burada sürekli bir eğridir ($R = 0.9^{geçen/stability}$) ve seri koşusu soruları bu $R$ değerine göre sıralar. Yalnızca vade anını korumak eğriyi kaydırır ve aciliyet sıralamasını bozardı; `lastReview`'ı kaydırmak eğrinin tamamını korur.

**Uygulama notları:**
- Sorular arşivdeyken çözülemediği için tek kaydırma yeterlidir; arka arkaya arşiv döngülerinde her geri yükleme yalnızca kendi epizodunu geri verir.
- Kaydırma, klasör geri yüklemesinde `members.forEach` bloğunun **içinde** yapılır. Ayrı bir ön geçiş, yarıda kesilen bir restore'da kaynakları "kaydırılmış ama hâlâ arşivde" bırakır ve sonraki deneme ikinci kez kaydırırdı.
- `archivedAt` yoksa, `lastReview` boşsa veya tarih bozuksa hiçbir şey yapılmaz. Bozuk bir tarihe dokunmak `NaN` üretir ve soruyu FSRS'ten tamamen düşürür.
- **Senkron:** `pickLastReview` iki tarafın **maksimumunu** alır, toplamını değil. İki cihaz aynı epizodu ayrı ayrı kaydırsa bile çift kaydırma oluşmaz.

---

## 5. Dondurma Jetonu Kazanım Kuralları ve Çapraz Kullanım (Cross-Streak Mechanics)

Hem Genel Seri hem de Özel Odak Serisi için bağımsız dondurma jeton kümeleri tutulur:
- `freezeTokens`: Genel Seri jetonları
- `focusFreezeTokens`: Özel Odak Serisi jetonları

### Kapasite ve sayım
Kapasite (`total`) başlangıçta 1'dir, 2. seviye kazanılınca 2 olur. **`remaining` saklanan
bir sayaç değil, iki defterden türetilen bir görünümdür** — `spentOn` (harcamalar) ve
`grants` (kazanımlar). Nedeni ve merge kuralları `src/core/freeze-tokens.js` başlığında.

### Jeton Seviyeleri:
1. **1. Seviye Jeton (7 Günlük Başarı - Tier 1):**
   - **Genel Seri:** 7 gün seri + %70 FSRS oranı $\rightarrow$ 1. Genel Jeton.
   - **Özel Seri:** 7 gün kesintisiz Odak hedefi $\rightarrow$ 1. Odak Jetonu.
   - *Kural:* 1. Seviye jetonlar **sadece ait olduğu seride** harcanabilir.
2. **2. Seviye Jeton (14 Günlük Üst Düzey Başarı - Tier 2 / Joker Jeton):**
   - **Genel Seri:** 14 gün seri + %80 FSRS oranı $\rightarrow$ 2. Genel Jeton.
   - **Özel Seri:** 14 gün kesintisiz Odak hedefi $\rightarrow$ 2. Odak Jetonu.
   - **Çapraz Kullanım (Cross-Use):** 2. Seviye jetonlar **Evrensel/Joker** jetondur. Özel
     Seri dondurma jetonu bittiğinde Genel Seri'de kazanılmış 2. Seviye jeton otomatik olarak
     Özel Seri'yi korumak için kullanılır (veya tam tersi). Kullanıcıya sorulmaz.

İlk jeton **hediyedir**: kapasite 1 ve defterler boş olarak başlanır, yani kullanıcı 7 gün
beklemeden bir dondurma hakkına sahiptir. 1. seviyeyi kazanmak, harcanmış bir hakkı geri verir.

### Kazanım penceresi: donmuş günler sayılmaz
Donmuş bir gün **seriyi** sürdürür (jetonun satın aldığı şey budur) ama içinde iş yoktur.
Kazanım penceresinde de sayılsaydı ikisi birbirini beslerdi: bir günü dondur, yerine jeton
kazan, bir gün daha dondur. `earnedBy()` bu yüzden `frozenDays === 0` şartını koşuyor —
"7 gün **kesintisiz** seri" ifadesinin karşılığı budur.

### Harcama kararı (`freezeMissedDaysIfPossible`)
Dün ve evvelsi gün taranır; bugün hiç dondurulmaz (henüz bitmemiştir).

- **Odak izi, seçili canlı kaynak yoksa hiç dondurulmaz.** Seçim olmadan Odak hedefi
  hiçbir gün karşılanamaz, yani her gün "kaçırılmış" okunur. Kapı olmadan, Odak'ı hiç
  açmamış bir kullanıcı iki gün içinde **üç jetonunu birden** kaybediyordu — ikisi
  `focus:` günlerine harcanan Genel joker'lardı — ve Genel Seri korumasız kalıyordu.
  Seçili kaynakların tamamı arşivliyse de aynı kapı kapanır.
- **İki geçiş, ve sıra kuralın kendisidir.** Önce her iz **kendi** jetonuyla denenir;
  ancak ondan sonra kalan ihtiyaçlar için çapraz kullanım devreye girer. Tek geçişte
  Genel iz, Odak'ın elindeki son jetonu joker olarak alıp Odak'ın tam da o jetonun
  beklediği günü kaybetmesine yol açıyordu.
- Harcama, satın aldığı **günün ve izin adını** taşır (`global:2026-08-01`), bu da onu
  cihazlar arası idempotent yapar.

`tests/freeze-decision.test.mjs` bu kararların tamamını kilitler; defterin kendi
aritmetiği `tests/freeze-tokens.test.mjs`'te.

---

## 6. Arayüz Görünümü (Dual Carousel)
- `#continuityCarousel` kapsayıcısı Genel Seri Kartı (`#continuityCard`) ve Özel Odak Kartı (`#focusContinuityCard`) arasında her **5 saniyede bir** otomatik kayar (`CAROUSEL_INTERVAL_MS`).
- Kullanıcı kartın üzerine geldiğinde (`mouseenter`) veya dokunduğunda (`touchstart`) kayma durur, ayrıldığında devam eder.
- Kartın altında 2 adet navigasyon noktası (`#continuityCarouselDots`) yer alır.
- Her kartın alt satırında solda seri koşusu butonu ve mod oku, sağda ayar/bilgi ikonları bulunur.
- İki slayt aynı CSS grid hücresini paylaşır; aktif olmayan slayt `visibility: hidden; pointer-events: none` taşır. Otomatik test yazarken karusel dönüşü hesaba katılmalıdır — bekleyen bir tıklama yanlış kartın üzerine düşer.
