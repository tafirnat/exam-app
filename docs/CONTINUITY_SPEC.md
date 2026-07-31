# Continuity & Freeze Token Specification (Devamlılık ve Dondurma Jetonları Mantığı)

## 1. Genel Bakış
Bu doküman, Exam App içerisindeki **İki Kulvarlı Devamlılık Sistemi**'ni tanımlar:
1. **Genel FSRS Serisi (Global FSRS Streak):** Uygulamadaki tüm aktif kaynaklarda aralıklı tekrar (FSRS) algoritmasına göre hatırlanması gereken soruların genel takibi.
2. **Özel Odak Serisi (Custom Focus Streak):** Kullanıcının doğrudan seçtiği maksimum 3 JSON kaynağındaki (`source.id`) sorulara odaklanan özel seri takibi.

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

## 3. Dondurma Jetonu Kazanım Kuralları ve Çapraz Kullanım (Cross-Streak Mechanics)

Hem Genel Seri hem de Özel Odak Serisi için bağımsız dondurma jeton kümeleri tutulur:
- `freezeTokens`: Genel Seri jetonları
- `focusFreezeTokens`: Özel Odak Serisi jetonları

### Jeton Seviyeleri:
1. **1. Seviye Jeton (7 Günlük Başarı - Tier 1):**
   - **Genel Seri:** 7 gün seri + %70 FSRS oranı $\rightarrow$ 1. Genel Jeton.
   - **Özel Seri:** 7 gün kesintisiz 15 soru çözümü $\rightarrow$ 1. Odak Jetonu.
   - *Kural:* 1. Seviye jetonlar **sadece ait olduğu seride** harcanabilir.
2. **2. Seviye Jeton (14 Günlük Üst Düzey Başarı - Tier 2 / Joker Jeton):**
   - **Genel Seri:** 14 gün seri + %80 FSRS oranı $\rightarrow$ 2. Genel Jeton.
   - **Özel Seri:** 14 gün kesintisiz 15 soru çözümü $\rightarrow$ 2. Odak Jetonu.
   - **Çapraz Kullanım (Cross-Use):** 2. Seviye jetonlar **Evrensel/Joker** jetondur. Örneğin Özel Seri dondurma jetonu bittiğinde, Genel Seri'de kazanılmış 2. Seviye (Joker) jeton otomatik olarak Özel Seri'yi korumak için transfer edilebilir (veya tam tersi).

---

## 4. Arayüz Görünümü (Dual Carousel)
- `#continuityCarousel` kapsayıcısı Genel Seri Kartı (`#continuityCard`) ve Özel Odak Kartı (`#focusContinuityCard`) arasında her **4 saniyede bir** otomatik kayar.
- Kullanıcı kartın üzerine geldiğinde (`mouseenter`) veya dokunduğunda (`touchstart`) kayma durur, ayrıldığında devam eder.
- Kartın altında 2 adet navigasyon noktası (`#continuityCarouselDots`) yer alır.
