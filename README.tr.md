# 🎓 Exam App

[![Live Demo](https://img.shields.io/badge/Demo-Online-brightgreen.svg)](https://exam.rifatarslan.dev/)
[![Build & Deploy](https://github.com/tafirnat/exam-app/actions/workflows/deploy.yml/badge.svg)](https://github.com/tafirnat/exam-app/actions/workflows/deploy.yml)
![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Tech Stack](https://img.shields.io/badge/Tech-HTML5%20%7C%20CSS3%20%7C%20JS-orange)

**Çevrimdışı öncelikli (Offline-First), cihazlar arası senkronizasyon destekli kişisel sınav & bilgi kartı uygulaması — hesap yok, abonelik yok, üçüncü taraf takip sunucusu yok.**

Exam App, herhangi bir çalışma materyalini etkileşimli sınavlara ve bilgi kartlarına dönüştürmenizi sağlar. Hangi sorularda zorlandığınızı hatırlayarak tekrarları bilim temelli FSRS algoritmasıyla doğru zamanda planlar. Varsayılan olarak tüm verileriniz yerel cihazınızda kalır; dilerseniz kendi özel GitHub Gist'iniz üzerinden farklı cihazlar (bilgisayar, telefon, tablet) arasında verilerinizi tamamen kendi kontrolünüzde senkronize edebilirsiniz.

> 💡 Hemen denemek ister misiniz? **<a href="https://exam.rifatarslan.dev/" target="_blank" rel="noopener noreferrer">Canlı demoya git →</a>**

---

## 🌐 Diller / Languages / Sprachen

> ℹ️ **Not**: **İngilizce** sürüm ([`README.md`](./README.md)) her zaman **ana ve orijinal kaynaktır**.
>
> 🌐 **Diğer dillerde oku:**
> - 🇬🇧 **[English README](./README.md)** *(Orijinal Kaynak)*
> - 🇩🇪 **[Deutsch README](./README.de.md)**

---

## 🤔 Bu Uygulama Kime Göre?

Exam App, kendi materyallerinden öğrenen herkes için tasarlanmıştır:

- 📚 Üniversite, meslek veya dil sınavlarına hazırlanan **öğrenciler**
- 🧠 Obsidian gibi Markdown araçlarında not tutan ve bu notları pratik testlere dönüştürmek isteyen **bireysel öğreniciler**
- 🔁 Anki, Quizlet veya benzeri uygulamalara abonelik ve bulut bağımlılığı olmadan **gizlilik odaklı bir alternatif** arayanlar

---

## ✨ Neler Yapabilir?

### 📋 7 Soru Tipi — Tek Uygulamada

- **Tekli Seçim** — tek doğru seçenekli standart çoktan seçmeli format
- **Çoklu Seçim** — iki veya daha fazla doğru seçim gerektiren sorular
- **Doğru / Yanlış** — ikili ifade doğrulaması
- **Kısa Yanıt** — tam cevabı yazın; birden fazla kabul edilen varyant ve isteğe bağlı büyük/küçük harf duyarlılığı desteklenir
- **Boşluk Doldurma** — `{{boşluk}}` veya `{{temel|alternatif}}` ile satır içi gömülü anahtar kelimeler
- **Bilgi Kartı (Flashcard)** — kendi hatırlama seviyenizi değerlendirdiğiniz klasik çevir-kart formatı
- **Okuma Materyali** — not baskısı olmadan zengin Markdown çalışma notları *(eski adı: `topic_review`)*

### 🧠 Akıllı Aralıklı Tekrar (FSRS v4.5)

Zorlandığınız sorular daha sık gelir. İyi bildiğiniz sorular daha seyrek tekrar eder. Anki'nin de kullandığı FSRS v4.5 algoritması, tekrar aralıklarını sabit bir takvime değil, gerçek hafıza performansınıza göre ayarlar.

### ⚡ Tek Tıkla Günlük Tekrar

Ana ekrandaki seri kartı, FSRS takviminize göre bugün kaç sorunun hazır olduğunu gösterir. Tek tıkla başlayın — kaynak aramaya gerek yok. **Saf FSRS sırası** (en acil soru başta) veya **kaynak/klasör bazlı gruplama** (bağlam içinde çalışmak için) arasında seçim yapın.

### 🔥 Seri ve Devamlılık Takibi

Global bir çalışma serisi ardışık aktif günleri sayar. Otomatik **dondurma tamponu**, haftada 2 güne kadar kaçırılan günleri sessizce affeder — yoğun bir gün serinizi kırmaz.

### 📌 Odak Havuzları

Günlük odak havuzu olarak en fazla 3 kaynak veya klasör sabitleyin (havuz başına 1–5, toplamda en fazla 15 soru). Bu sorular, FSRS günlük seansınıza zaten dahil değilse sessizce eklenir — zorla kota yok, suçlama yok.

### 📁 Klasör ve Arşiv Yönetimi

Kaynakları renkli klasör hiyerarşilerinde düzenleyin. Tekil kaynakları veya tüm klasörleri arşivleyerek duraklatın — **arşivde FSRS saati donar**, dolayısıyla büyük bir arşivi geri almak günlük kuyruğu gecikmiş kartlarla asla tıkamaz.

### 📊 İlerleme Analitiği

- **Aktivite Isı Haritası** — baskın klasöre göre renklendirilen GitHub tarzı günlük aktivite ızgarası
- **Haftalık ve Aylık Trend Grafikleri** — zaman içindeki çalışma hacmini gösteren çubuk grafikler
- **Soru Başına Analitik** — her soru için tam geçmiş, hatırlanabilirlik skoru ve zorluk
- **Detaylı Kaynak Dökümü** — aktif ve arşivlenmiş kaynakları soru sayısıyla birlikte tek bakışta görün

### 🔔 Akıllı Push Bildirimleri

Günde bir kez, hazır kart olduğunda çalışan opt-in hatırlatıcılar. İzin yalnızca başarılı bir çalışma seansının ardından istenir — hiçbir zaman ilk açılışta. Yapılandırılabilir sessiz saatler (varsayılan: 22:00–08:00).

### 🚀 Tanıtım Rehberi (Onboarding)

İlk açılışta (veya ayarlar menüsünden istediğiniz zaman) uygulamanın temel özelliklerini adım adım anlatan etkileşimli tur.

### 🌐 Çok Dilli Arayüz

**İngilizce**, **Türkçe** ve **Almanca** dillerinde tam yerel kullanıcı arayüzü. Soru içeriklerini 10'dan fazla dile çevirmek için tümleşik Google Translate desteği.

### 🤖 Yapay Zeka Entegrasyonu

- **Soru seti oluşturma**: [AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md) içindeki promptu ChatGPT, Claude veya Gemini ile kullanarak herhangi bir metni Exam App JSON'una dönüştürün.
- **Klasör Hedefli Üretim**: Soru kaynağı JSON root alanına `"folderId": "folder_..."` ekleyerek kaynağın doğrudan belirlenen klasör altında açılmasını sağlayın (Klasör ID'sini düzenleme modalındaki `id: ... 📋` butonundan kopyalayabilirsiniz).
- **Sıralı Düzen (`keepOrder`)**: Sırasıyla takip edilmesi gereken okuma materyallerinde soruların karıştırılmasını önlemek için JSON root veya `exam_metadata` alanına `"keepOrder": true` (veya `"preserveOrder": true`) ekleyebilirsiniz. Kaynak ayarlarındaki **Sıralı** toggle butonu ile de dilediğiniz zaman değiştirebilirsiniz.
- **Soru hakkında AI'ya sor**: Herhangi bir sorunun bağlamını ChatGPT, Claude, Gemini, DeepSeek, Kimi vb. servislere aktif UI dilinizde tek tıkla gönderin.

### 🔊 Metin Okuma (TTS)

Soruları ve okuma kartlarını yerel tarayıcı konuşma sentezi ile sesli okur. Ayarlanabilir hız (×0.7–×1.3), gezinmede otomatik oynatma, yüzen oynatma kontrolleri.

### 🔒 Tam Veri Mülkiyeti & Gizlilik Odaklı Mimari

Üçüncü taraf takip sunucusu veya merkezi veritabanı yok. Zorunlu hesap oluşturma ve abonelik ücretleri yok. Çalışma verileriniz varsayılan olarak yerel cihazınızda tutulur. Farklı cihazlar arası veri eşitlemesi ise doğrudan kendi özel GitHub Gist'iniz üzerinden uçtan uca kontrolünüzde gerçekleşir.

---

## 📸 Ekran Görüntüleri

<div align="center">

### 🏠 Ana Panel ve Günlük Tekrar

| Açık Tema | Koyu Tema |
| :---: | :---: |
| ![Dashboard Light](./docs/screenshots/dashboard-light.png) | ![Dashboard Dark](./docs/screenshots/dashboard-dark.png) |

### 📝 Sınav Arayüzü ve Sonuçlar

| Aktif Sınav Oturumu | Test Sonuçları & Analiz |
| :---: | :---: |
| ![Quiz Interface](./docs/screenshots/quiz-interface.png) | ![Test Results](./docs/screenshots/test-results.png) |

### 📂 Kaynak Yönetimi ve Gezinme

| Kayıtlı Kaynaklar & Klasörler | Yan Menü ve Hızlı Erişim |
| :---: | :---: |
| ![Saved Sources](./docs/screenshots/saved-sources.png) | ![Sidebar Menu](./docs/screenshots/sidebar-menu.png) |

### 📊 Detaylı Soru Analitiği

| Soru Detayları & Geçmiş |
| :---: |
| ![Question Details](./docs/screenshots/question-details.png) |

</div>

---

## ☁️ Cihazlar Arası Senkronizasyon (GitHub Gist)

Tüm soru bankalarınızı, ilerlemenizi, istatistiklerinizi, notlarınızı ve tercihlerinizi üçüncü taraf sunucu olmadan cihazlar arasında senkronize edin:

1. **GitHub Token Oluşturun**
   - [GitHub Token Ayarları](https://github.com/settings/tokens?type=beta) sayfasına gidin
   - **Gists: Read and Write** izinlerine sahip İnce Taneli (Fine-grained) token oluşturun
2. **Uygulamada Bağlanın**
   - Üst bilgideki **GitHub ↗** simgesine tıklayın, tokenınızı yapıştırın ve **Bağlan & Senkronize Et** butonuna tıklayın
3. **Otomatik Arka Plan Senkronizasyonu**
   - Uygulama otomatik olarak gizli bir Gist (`exam_app_backup.json`) oluşturur ve arka planda senkronize eder
   - Arşivlenen ögeler ayrı olarak senkronize edilir (`exam_app_archive.json`) — günlük senkronizasyonu hafif tutar

### 🔗 Yoldaş Obsidian Eklentisi

Obsidian'da soru hazırlıyorsanız **[Obsidian ExamApp Gist Sync](https://github.com/tafirnat/Obsidian-ExamApp-Sync)** eklentisi, Obsidian kasanızı doğrudan Gist üzerinden Exam App ile senkronize eder.

---

## 📥 Kullanmaya Başlama (Son Kullanıcılar İçin)

Exam App'i kullanmanın en kolay yolu **<a href="https://exam.rifatarslan.dev/" target="_blank" rel="noopener noreferrer">canlı demo</a>** — kurulum gerekmez. Uygulama tamamen statik ve çevrimdışı çalışabilen bir PWA olup tarayıcıdan doğrudan telefonunuza veya masaüstünüze yüklenebilir.

Kendi sorularınızı yüklemek için ana ekrandaki **Kaynak Ekle** butonunu kullanarak JSON dosyanızı içe aktarın. Veri formatı için [JSON şema rehberi](./public/examples/schema-guide.md)'ne, otomatik soru seti oluşturmak için ise [AI promptuna](./AI_AGENT_PROMPT.md) başvurun.

---

## 🤖 AI ile Soru Seti Oluşturma

Herhangi bir ders kitabını, makaleyi veya ders notunu Exam App JSON'una dönüştürün:

1. **[AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md)** dosyasını açın ve talimatları kopyalayın
2. Promptu çalışma materyalinizle birlikte ChatGPT, Claude, Gemini veya DeepSeek'e yapıştırın
3. Oluşturulan JSON'u doğrudan Exam App'e aktarın

---

## 📊 Veri Yapısı & JSON Şeması

Exam App, `exam_metadata` ve `questions` dizisinden oluşan temiz, insan tarafından okunabilir bir JSON şeması kullanır.

```json
{
  "exam_metadata": {
    "title": "Bilgisayar Ağları 101",
    "id": "exam_net_101",
    "category": "Bilgisayar Bilimleri",
    "description": "Temel ağ protokolleri ve kavramları."
  },
  "questions": [
    {
      "id": "q1",
      "type": "single_choice",
      "difficulty": 2.0,
      "tags": ["web", "protokoller"],
      "content": { "text": "Hangi HTTP durum kodu **Bulunamadı (Not Found)** anlamına gelir?" },
      "options": [
        { "id": 1, "text": "200 OK" },
        { "id": 2, "text": "404 Not Found" },
        { "id": 3, "text": "500 Internal Server Error" }
      ],
      "answer": {
        "correct_ids": [2],
        "explanation": "`404 Not Found` durum kodu, sunucunun istenen kaynağı bulamadığını belirtir."
      }
    }
  ]
}
```

*Tam şema özellikleri ve AI model talimatları için **[AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md)** ve **[schema-guide.md](./public/examples/schema-guide.md)** dosyalarına bakın.*

---

## ⚙️ Teknik Mimari

### 🛠️ Teknoloji Yığını

- **Vanilla JS (ES Modülleri) & HTML5** — Framework yükü yok; tree-shakeable import yapısıyla modüler mimari
- **Özel CSS** — Glassmorfik koyu/açık tema için CSS özel özellikleri kullanan Tailwind'siz tasarım sistemi
- **Vite + `vite-plugin-singlefile`** — Tüm JS, CSS ve varlıkları içeren tek bağımsız `index.html` üretir
- **Tarayıcı `localStorage`** — Tüm durum istemci tarafında saklanır; arka plan gerekmez
- **GitHub Gist REST API** — Kullanıcının kendi özel Gist'i üzerinden isteğe bağlı cihazlar arası senkronizasyon
- **Service Worker (PWA)** — Çevrimdışı destek ve push bildirim zamanlaması

### 🧠 Temel Algoritmalar

- **FSRS v4.5** — Hafızaya uyarlanmış tekrar aralıkları için Free Spaced Repetition Scheduler
- **Arşiv FSRS Dondurma** — Arşivde geçen süre sorunun takvimine işlenmez; büyük arşivi geri almak günlük kuyruğu asla taşırmaz

---

## 📥 Yerel Geliştirme

### Gereksinimler

- Node.js (v18 veya üzeri)
- npm

### Kurulum

```bash
git clone https://github.com/tafirnat/exam-app.git
cd exam-app
npm install
```

### Geliştirme Sunucusu

```bash
npm run dev
```

### Tek Dosyalı Canlı Yayın Derlemesi

```bash
npm run build
```

Derlenen bağımsız dosya `dist/index.html` konumunda oluşturulur.

---

## 🚀 CI/CD & Otomatik Dağıtım

`main` dalına gönderilen her commit, bir GitHub Actions iş akışını ([deploy.yml](.github/workflows/deploy.yml)) tetikler; Vite tek dosya derlemesi çalışır ve `dist/index.html` otomatik olarak **GitHub Pages** (`gh-pages` dalı) üzerine dağıtılır.

---

## 🤖 Geliştirme Şeffaflığı & Teşekkürler

Bu uygulama, AI kodlama araçlarının (**Antigravity** & **Claude**) yardımıyla tasarlanmış ve geliştirilmiştir. Geri bildirimler ve hata bildirimleri her zaman memnuniyetle karşılanır!

---

## 📄 Lisans

**MIT Lisansı** altında dağıtılmaktadır. Detaylar için [LICENSE](LICENSE) dosyasına bakın.

---
[tafirnat](https://github.com/tafirnat) tarafından ❤️ ile geliştirilmiştir.
