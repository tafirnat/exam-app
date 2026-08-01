# 🎓 Exam App - Minimalist Öğrenme & Etkin Anımsama Platformu

[![Live Demo](https://img.shields.io/badge/Demo-Online-brightgreen.svg)](https://exam.rifatarslan.dev/)
[![Deploy to GitHub Pages](https://github.com/tafirnat/exam-app/actions/workflows/deploy.yml/badge.svg)](https://github.com/tafirnat/exam-app/actions/workflows/deploy.yml)
![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Tech Stack](https://img.shields.io/badge/Tech-HTML5%20%7C%20CSS3%20%7C%20JS-orange)

Etkin anımsama (active recall), aralıklı tekrar (spaced repetition) ve Markdown tabanlı çalışma için tasarlanmış profesyonel, modüler, gizlilik odaklı ve yüksek performanslı bir sınav web uygulaması.

---

## 🌐 Diller / Languages / Sprachen

> ℹ️ **Not**: **İngilizce** sürüm ([`README.md`](./README.md)) her zaman **ana ve orijinal kaynaktır**.
>
> 🌐 **Diğer dillerde oku:**
> - 🇬🇧 **[English README](./README.md)** *(Orijinal Kaynak)*
> - 🇩🇪 **[Deutsch README](./README.de.md)**

---

## 🌐 Canlı Demo

Uygulamayı canlı olarak deneyimleyin: **[https://exam.rifatarslan.dev/](https://exam.rifatarslan.dev/)**

---

## 📸 Ekran Görüntüleri ve Arayüz Önizlemesi

<div align="center">

### 🏠 Ana Kontrol Paneli (Dashboard) & Çalışma Merkezi

| Açık Tema (Light Mode) | Koyu Tema (Dark Mode) |
| :---: | :---: |
| ![Dashboard Light](./docs/screenshots/dashboard-light.png) | ![Dashboard Dark](./docs/screenshots/dashboard-dark.png) |

### 📝 Sınav Arayüzü ve Test Sonuçları

| Aktif Sınav Oturumu | Test Sonuçları & Analiz |
| :---: | :---: |
| ![Quiz Interface](./docs/screenshots/quiz-interface.png) | ![Test Results](./docs/screenshots/test-results.png) |

### 📂 Kaynak Yönetimi ve Detaylı Soru İstatistikleri

| Kayıtlı Soru Kaynakları | Soru Detayları & İstatistikler |
| :---: | :---: |
| ![Saved Sources](./docs/screenshots/saved-sources.png) | ![Question Details](./docs/screenshots/question-details.png) |

</div>

---

## 📌 Exam App Nedir ve Neden Geliştirildi?

### Problem
Geleneksel sınav hazırlık ve bilgi kartı (flashcard) uygulamaları genellikle çalışma verilerinizi özel sunuculara kilitler, aylık abonelikler talep eder, yerel Markdown desteğinden yoksundur (veya biçimlendirmeyi bozar) ve sürekli internet bağlantısı zorunlu kılar. Bilgilerini [Obsidian](https://obsidian.md/) gibi araçlarda yöneten öğrenciler ve bağımsız öğreniciler, kişisel notlarını ve soru bankalarını gizlilikten ödün vermeden etkileşimli ve dikkat dağıtıcı ögelerden arındırılmış bir çalışma aracına dönüştürmekte zorlanırlar.

### Amaç
**Exam App**, bu sorunları çözmek amacıyla geliştirilmiştir. Kullanıcıların zengin **Obsidian Markdown** ile biçimlendirilmiş standart JSON veri setlerini kullanarak özel sınavlar ve bilgi kartları oluşturmasına, pratik yapmasına ve takibini yapmasına olanak tanıyan tamamen ücretsiz, açık kaynaklı, sunucusuz ve öncelikli olarak çevrimdışı (offline-first) çalışan bir web uygulamasıdır.

### Temel Felsefe
- 🔒 **%100 Veri Gizliliği & Sıfır Arka Plan / Sunucu Maliyeti ($0)**: Merkezi sunucular veya kayıt olunması gereken kullanıcı hesapları yoktur. Çalışma ilerlemeniz ve veri setleriniz cihazınızda yerel olarak kalır veya özel GitHub Gist hesabınıza güvenle senkronize edilir.
- 🧠 **Bilimsel Öğrenme Motoru**: Hafıza kalıcılığını ve hatırlanabilirliği optimize etmek için **FSRS v4.5 (Free Spaced Repetition Scheduler)** algoritmasını kullanır.
- 📝 **Obsidian Uyumlu İçerik**: Obsidian kasanızdan notları doğrudan soru kartlarına yapıştırın—başlıklar, vurgu kutuları (`> [!tip]`), kod blokları, tablolar, görev listeleri ve renkli vurgular eksiksiz işlenir.
- 📱 **Öncelikli Çevrimdışı & Mobil Uyumlu**: İnternet bağlantısı olmadan tam işlevseldir. Akıllı telefonlara ve masaüstü bilgisayarlara PWA (Progressive Web App) olarak yüklenebilir.

---

## 🧩 Desteklenen Soru Tipleri & Çalışma Modları

Exam App, tüm çalışma materyallerine uyum sağlamak üzere 4 aile yapısı altında kategorize edilmiş **7 temel soru tipini** destekler:

### 1. 🔘 Tekli Seçim (`single_choice`)
Tam olarak tek bir doğru seçeneği olan standart çoktan seçmeli format. Hedef odaklı kavram testleri için idealdir.

### 2. ☑️ Çoklu Seçim (`multiple_choice`)
İki veya daha fazla doğru seçimin yapılmasını gerektiren sorular. Karmaşık konuların derinlemesine kavranmasını sağlar.

### 3. ☯️ Doğru / Yanlış (`true_false`)
Önceden tanımlanmış Doğru/Yanlış seçenekleriyle ikili ifade doğrulaması. Hızlı hatırlama kontrolleri için harikadır.

### 4. ✍️ Kısa Yanıt (`short_answer` / `text_input`)
Öğrenicilerin yanıtı doğrudan yazdığı serbest metin girişi. Birden fazla kabul edilen yanıt varyasyonunu ve isteğe bağlı büyük/küçük harf duyarlılığını destekler.

### 5. 📝 Boşluk Doldurma (`fill_in_the_blank`)
Çift süslü parantezler (`{{boşluk}}` veya `{{temel|alternatif}}`) ile metin içine gömülmüş eksik kelimeler içeren cümleler. Öğreniciler boşlukları doğrudan ana metin içinde doldurur.

### 6. 🎴 Bilgi Kartı / Flashcard (`flashcard`)
Etkin anımsama için klasik ön/arka yüzlü bilgi kartları. Öğreniciler kartı çevirerek cevabı görür ve kendi hatırlama seviyelerini değerlendirir.

### 7. 📖 Okuma / Çalışma Materyali (`reading`)
Sınav öncesinde veya sırasında otomatik puanlama baskısı olmadan temel kavramları gözden geçirmek için zengin markdown düzyazı blokları ve özet kartları. *(Eski adı: `topic_review`)*.

---

## 🔥 Temel Özellikler & Yetenekler

- 🧠 **FSRS v4.5 Aralıklı Tekrar**: "Süresi Geçmiş" ($R < 0.9$) soruları bilimsel olarak önceliklendirir. Öğrenici geri bildirimlerine göre (*Zor* vs *Kolay*) tekrar aralıklarını adaptif olarak hesaplar.
- ⚡ **Tek Tıkla Günün Tekrarı**: Günün seansı, önce kaynaklar arasında arama yapmadan doğrudan seri kartından başlatılır. Havuz soru bazında kurulur ve hangi kaynağın açık olduğundan bağımsızdır — bir soru, geldiği dosyaya göre değil, FSRS'in *o soru* hakkında bildiğine göre sıraya girer. İki düzenden birini seçersiniz: **saf FSRS sırası** (en acil soru başta, kaynak gözetilmez) veya **kaynak/klasör bazlı gruplama** (yine en acil sorudan başlar, ama o sorunun kaynağını ve aynı klasördeki kaynakları bir arada tutarak ilişkili konuları bağlam içinde çalıştırır).
- 📁 **Klasör & Arşiv Yönetimi**: Soru kaynaklarını özel klasör hiyerarşilerinde düzenleyin. Test geçmişinizi kaybetmeden tekil kaynakları veya klasörlerin tamamını aktif çalışma setlerinden arşivleyin. Arşivlenen ögeler, günlük senkronizasyonu hafif tutmak için ayrı olarak senkronize edilir (`exam_app_archive.json`).
- ❄️ **Arşiv FSRS Saatini Dondurur**: Arşivde geçen süre, sorunun tekrar takviminden düşülmez. Tekrarına üç gün kala arşivlenen bir kaynak, o üç gün hâlâ dururken geri döner; birikmiş tekrarların tamamı bir anda süresi geçmiş olarak üstünüze yıkılmaz — böylece büyük bir arşivi geri almak günlük hedefi asla boğmaz.
- 🔊 **Gelişmiş Metin Okuma (TTS)**: Yerel konuşma sentezini kullanarak soruları ve okuma kartlarını sesli okur. Ayarlanabilir oynatma hızını (x0.7 - x1.3), gezinmede otomatik oynatmayı ve yüzen oynatma kontrollerini destekler.
- 🌐 **Çok Dilli Arayüz & Yapay Zeka Çevirisi**: **İngilizce**, **Türkçe** ve **Almanca** dillerinde tam yerel kullanıcı arayüzü. İçeriği 10'dan fazla dile çevirmek için tümleşik Google Translate desteği içerir.
- 🤖 **Özel AI Sağlayıcı Merkezi**: Soru bağlamlarını veya özel komut taslaklarını aktif UI dilinizde AI servislerine (ChatGPT, Claude, Gemini, DeepSeek, Kimi vb.) tek tıkla gönderme olanağı.
- 📤 **Esnek Veri Paylaşımı**: Ham JSON veri setlerini panoya kopyalama, Web Share / Dosya dışa aktarımı ile yerel olarak paylaşma ve büyük dosyalar için bağlama duyarlı uzunluk rehberliği.
- 🎨 **Görsel Mükemmellik**: Şık karanlık mod, cam efekti (glassmorphism) UI bileşenleri, yumuşak mikro animasyonlar ve kontrast garantili klasör renk paletleri.

---

## ⚙️ Nasıl Geliştirildi? Teknik Mimari

Exam App'in **ne** yaptığını ve **neden** var olduğunu öğrendikten sonra, işte arka planda **nasıl** geliştirildiği:

### 🛠️ Teknolojik Yapı & Felsefe
- **Vanilla Modern JS & HTML5**: Çekirdek mantık, ultra hızlı başlangıç ve çalışma süresi için modüler ES Modülleri ile inşa edilmiştir.
- **Tailwind İçermeyen Özel CSS**: Framework yükü olmadan hassas cam efekti görselleri sunan CSS özel özelliklerine (değişkenler) sahip özel tasarım sistemi.
- **Vite & Tek Dosyalı Derleyici**: Tüm JavaScript, CSS ve varlıkları içeren %100 bağımsız, tek bir `index.html` çıktısı üretmek için `vite-plugin-singlefile` kullanır.
- **İstemci Tarafı Depolama & Senkronizasyon**: Çevrimdışı durum için tarayıcı `localStorage`'ına ve cihazlar arası senkronizasyon için GitHub Gist REST API'sine dayanır.

---

## ☁️ Cihazlar Arası Senkronizasyon (GitHub Gist)

Tüm soru bankalarınızı, test ilerlemenizi, istatistiklerinizi, yıldızlarınızı, notlarınızı ve tercihlerinizi üçüncü taraf sunucular olmadan cihazlar arasında senkronize edin:

1. **GitHub Token Oluşturma:**
   - [GitHub Token Ayarları](https://github.com/settings/tokens?type=beta) sayfasına gidin.
   - **Gists: Read and Write** izinlerine sahip İnce Taneli (Fine-grained) bir token oluşturun.
2. **Uygulamada Bağlanma:**
   - Exam App'i açın, üst bilgideki **GitHub ↗** simgesine tıklayın, token'ınızı yapıştırın ve **Bağlan & Senkronize Et** butonuna tıklayın.
3. **Otomatik Arka Plan Senkronizasyonu:**
   - Uygulama otomatik olarak gizli bir Gist (`exam_app_backup.json`) oluşturur ve ilerlemeyi arka planda senkronize eder.
   - Arşivlenen ögeler, aynı Gist içindeki ikincil bir dosyaya (`exam_app_archive.json`) aktarılır.

### 🔗 Yoldaş Obsidian Eklentisi
Obsidian'da soru hazırlıyorsanız, Obsidian Kasanızı Gist aracılığıyla doğrudan Exam App ile senkronize etmek için yoldaş eklenti **[Obsidian ExamApp Gist Sync](https://github.com/tafirnat/Obsidian-ExamApp-Sync)** eklentisini kullanabilirsiniz.

---

## 📊 Veri Yapısı & JSON Şeması

Exam App, sınavları `exam_metadata` ve bir `questions` dizisinden oluşan temiz, insan tarafından okunabilir bir JSON şeması kullanarak işler.

### Örnek JSON
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

*Tam şema özellikleri ve harici Yapay Zeka modelleri için komut talimatları için **[AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md)** ve **[schema-guide.md](./public/examples/schema-guide.md)** dosyalarına bakın.*

---

## 🤖 AI ile Soru Setleri Oluşturma

Yapay Zeka kullanarak herhangi bir ders kitabını, makaleyi veya ders notunu Exam App JSON veri setlerine dönüştürebilirsiniz:
1. **[AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md)** dosyasını açın ve talimatları kopyalayın.
2. Komutu çalışma materyalinizle birlikte ChatGPT, Claude, Gemini veya DeepSeek'e yapıştırın.
3. Oluşturulan JSON'u doğrudan Exam App'e aktarın.

---

## 📥 Başlarken & Geliştirme

### Gereksinimler
- Node.js (v18 veya üzeri)
- npm

### Kurulum
```bash
git clone https://github.com/tafirnat/exam-app.git
cd exam-app
npm install
```

### Yerel Geliştirme
```bash
npm run dev
```

### Tek Dosyalı Canlı Yayın Derlemesi (Production Build)
```bash
npm run build
```
Derlenmiş, bağımsız statik dosya `dist/index.html` konumunda oluşturulacaktır.

---

## 🚀 CI/CD & Otomatik Dağıtım

Bu depo, otomatik derleme ve dağıtım için **GitHub Actions** kullanır:
- **İş Akışı**: [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
- **Davranış**: `main` dalına gönderilen her commit, bir Vite tek dosya derlemesini tetikler ve oluşan `dist/index.html` dosyasını otomatik olarak **GitHub Pages** (`gh-pages` dalı) üzerine dağıtır.

---

## 🤖 Geliştirme Şeffaflığı & Teşekkürler

Bu uygulama, gelişmiş yapay zeka kodlama asistanlarından (**Antigravity** & **Claude**) yararlanılarak tasarlanmış ve geliştirilmiştir. Tüm bileşenlerde titiz testler ve optimizasyonlar yapılmış olsa da, geri bildirimler ve hata bildirimleri her zaman memnuniyetle karşılanır!

---

## 📄 Lisans

**MIT Lisansı** altında dağıtılmaktadır. Detaylar için [LICENSE](LICENSE) dosyasına bakın.

---
[tafirnat](https://github.com/tafirnat) tarafından ❤️ ile geliştirilmiştir.
