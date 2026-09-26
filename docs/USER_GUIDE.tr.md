# Kullanım Rehberi

> Bu dosya `src/features/help/guide-content.js` dosyasindan uretilmistir. Elle duzenlemeyin; `npm run build:guide` calistirin.

Uygulamanın her bölümü: ne işe yaradığı ve nasıl kullanıldığı. Aradığınız başlığa dokunun.

## Icindekiler

1. [Başlarken](#başlarken)
2. [Kaynak ekleme](#kaynak-ekleme)
3. [Kaynakları yönetme, birleştirme, dışa aktarma](#kaynakları-yönetme-birleştirme-dışa-aktarma)
4. [Test başlatma ve hızlı test grupları](#test-başlatma-ve-hızlı-test-grupları)
5. [Soru tipleri](#soru-tipleri)
6. [Test sırasında](#test-sırasında)
7. [Sonuç ekranı ve yeniden çözme](#sonuç-ekranı-ve-yeniden-çözme)
8. [Soru detayları ve düzenleme](#soru-detayları-ve-düzenleme)
9. [İstatistikler neyi gösterir](#istatistikler-neyi-gösterir)
10. [Grafikler ve ilerleme paneli](#grafikler-ve-ilerleme-paneli)
11. [Seriler ve dondurma jetonları](#seriler-ve-dondurma-jetonları)
12. [Tekrar algoritması nasıl karar verir](#tekrar-algoritması-nasıl-karar-verir)
13. [Senkronizasyon ve yedekleme](#senkronizasyon-ve-yedekleme)
14. [Yapay zekâ ile kullanım](#yapay-zekâ-ile-kullanım)
15. [Menü ve ayarlar](#menü-ve-ayarlar)
16. [e-Reader ve Kitaplar](#e-reader-ve-kitaplar)
17. [Sık karşılaşılan durumlar](#sık-karşılaşılan-durumlar)
18. [Sürüm ve iletişim](#sürüm-ve-iletişim)

---

## Başlarken

Bu uygulama, **kendi sorularınızla** çalışmanız için yapılmış bir tekrar ve sınav uygulamasıdır. Üç şey onu çoğu alternatiften ayırır:

- **Hesap yok.** Kayıt olmazsınız, giriş yapmazsınız. Bütün verileriniz tarayıcınızın kendi deposunda durur.
- **Çevrimdışı çalışır.** İnternet yalnızca senkronizasyon, çeviri ve sesli okuma için gerekir.
- **Kendi içeriğiniz.** Hazır bir soru kütüphanesi yoktur; soruları siz eklersiniz (çoğu kişi bir yapay zekâya ürettirir).

**İlk beş dakika**

1. Menüden veya ana ekrandan **Kaynaklar**'a gidin ve bir JSON dosyası ekleyin. Elinizde yoksa örnek kaynağı yükleyin.
2. Ana ekrana dönün, çalışmak istediğiniz kaynağı açık duruma getirin.
3. Soru sayısını seçin ve teste başlayın.
4. Test bitince sonuç ekranı çıkar; oradan yanlışlarınızı hemen bir kez daha görebilirsiniz.

Gerisi kendiliğinden işler: hangi soruyu ne zaman tekrar göreceğinize uygulama karar verir.

---

## Kaynak ekleme

Bir **kaynak**, bir konuya ait soru kümesidir: bir ders, bir kitap bölümü, bir sınav başlığı. Kaynağı dar ve tutarlı tutun — istatistikler kaynak başına hesaplanır, yani "Anatomi" tek kaynakken işe yarar, "Her şey" anlamsız bir ortalama üretir.

**Üç ekleme yolu** (Kaynaklar ekranı):

- **Dosyadan** — cihazınızdaki bir `.json` dosyasını seçin.
- **URL'den** — JSON'un doğrudan adresini yapıştırın (örneğin bir GitHub raw bağlantısı).
- **Yapıştırarak** — JSON metnini doğrudan kutuya yapıştırın. Yapay zekâdan aldığınız çıktıyı en hızlı buradan alırsınız.

**Beklenen biçim**

```json
{
  "examTitle": "Anatomi - Bölüm 1",
  "questions": [
    {
      "id": "q1",
      "type": "single_choice",
      "text": "Kalbin kaç odacığı vardır?",
      "options": [
        { "id": "a", "text": "2" },
        { "id": "b", "text": "4" }
      ],
      "correctOptionIds": ["b"],
      "explanation": "İki kulakçık, iki karıncık.",
      "difficulty": 2,
      "tags": ["kalp"]
    }
  ]
}
```

`difficulty` 1–5 arasıdır ve yalnızca sorunun **ilk** zorluk tahminini besler; sonrasını sizin cevaplarınız belirler. `tags` isteğe bağlıdır, aramada ve etikete göre test başlatmada kullanılır.

**Yükleme raporu.** İçe aktarma bittiğinde eksik bulunan sorular (cevabı olmayan, şıksız, boş metinli) bir raporla gösterilir. Oradan düzeltir, işaretler ya da silersiniz — sessizce içeri alınmazlar.

**Güvenlik.** Soru metinleri Markdown olarak çizilir; içindeki ham HTML **çalıştırılmaz**, olduğu gibi yazı olarak görünür. Güvenmediğiniz bir JSON'u açmak sizi bir betiğe maruz bırakmaz.

---

## Kaynakları yönetme, birleştirme, dışa aktarma

**Açık / kapalı.** Bir kaynağın anahtarı, o kaynağın testlere girip girmeyeceğini belirler. Birden fazla kaynağı aynı anda açabilirsiniz; test hepsinden soru çeker.

**Klasörler.** Kaynakları klasörlere koyabilir, klasöre renk verebilirsiniz. Klasörsüz kalan her şey "Kategorisiz" klasöründe toplanır — bu klasör silinemez, hep vardır. Boş kalan bir klasör 10 dakika sonra kendiliğinden kaldırılır; uygulamayı kapattıysanız bir sonraki açılışta. Arşivde kaynağı olan klasör boş sayılmaz.

**Klasör bildirimi.** Bir veri seti `exam_metadata.folder` alanında klasör adı verebilir. Set, içe aktarılırken ya da senkronla (örneğin Obsidian'dan) ilk geldiğinde o ada sahip klasöre konur; büyük/küçük harf, aksan ve noktalama önemsizdir. O adda klasör yoksa oluşturulur; sonradan adını değiştirdiğiniz klasör de bulunur. Bildirim yoksa set "Kategorisiz"e gider. Her set için bir kez uygulanır: sonradan taşıdığınız set yerinde kalır. Sildiğiniz bir seti aynı dosyayla yeniden içe aktarmak onu bütün cihazlarda geri getirir.

**Kaynak menüsü** (bir kaynağa uzun basın ya da üç noktaya dokunun):

- **Yeniden adlandır / bilgileri düzenle** — başlık ve kategori.
- **Klasöre taşı**.
- **Dışa aktar** — yalnızca o kaynağı JSON olarak indirir. Bu dosyayı başka bir cihaza ya da başka birine verebilirsiniz.
- **Arşivle** — kaynağı kütüphaneden kaldırır ama sorularını saklar. Arşivlenmiş kaynak testlere girmez ve sorularının tekrar saati **durur**: üç ay sonra geri getirdiğinizde hepsi birden "gecikmiş" olmaz.
- **Sil** — kaynağı ve istatistiklerini kaldırır. Geri alınamaz; önce dışa aktarın.

**Birleştirme.** Kaynaklar ekranındaki birleştirme seçeneği, seçtiğiniz kaynakların sorularını tek bir yeni kaynakta toplar; iki kaynakta birden bulunan sorular ayıklanır. Birleştirme de geri alınamaz, o yüzden önce dışa aktarmak iyi bir alışkanlıktır.

**Arşivleme yer açar mı?** Yalnızca GitHub senkronizasyonu bağlıysa: arşivlenen kaynağın soruları Gist'e taşınır ve cihazdan silinir. Bağlantı yoksa sorular cihazda kalır, yani arşivleme yer açmaz — o durumda uygulama size "İndir ve Sil"i önerir.

**Depolama uyarısı.** Tarayıcı deposu dolmaya yaklaşınca uyarı çıkar. Uyarı yüzde göstermez, çünkü tarayıcılar tavanı bildirmez; onun yerine kaç soru daha sığacağını tahmin eder.

---

## Test başlatma ve hızlı test grupları

Ana ekranda açık kaynaklarınızı, soru sayısını ve sırayı seçip teste başlarsınız.

**Soru sayısı.** 10, 20, 40 gibi hazır değerler ya da **Tüm Sorular**. Hangi soruların seçileceğine uygulama karar verir: en çok unutmaya yakın olanlar önce gelir.

**Sıralı mod.** Kaynak "sıralı" olarak işaretlenmişse sorular JSON'daki sırayla gelir, karıştırılmaz. Bu modda ayrıca bir **aralık seçici** çıkar: 40 soruluk bir kitapta ilk 10'u çözüp sonraki sefer 11–20'ye geçebilirsiniz. Test bitince aralık kendiliğinden bir blok ilerler ve uygulama size bunu söyler.

**Hızlı test grupları** (ana ekrandaki şimşek düğmesi). Sık kullandığınız kaynak kombinasyonlarını kaydedersiniz: "Sınav haftası" = Anatomi + Fizyoloji + Biyokimya. Gruba dokunmak o kaynakları açar ve sizi teste hazır bırakır.

Grubu düzenlemek için listedeki kalem düğmesine dokunun. Açılan pencerede hem **adını** değiştirebilir, hem de **hangi kaynakların içinde olduğunu** doğrudan seçip çıkarabilirsiniz. Çalışma ortamınızı bu tek ekrandan kurarsınız.

**Etiketten test.** İstatistikler ekranında bir etikete dokunduğunuzda o etiketi taşıyan sorular listelenir; oradan doğrudan test başlatabilirsiniz. Aynı şey arama sonuçları ve filtreler için de geçerli: ekranda gördüğünüz liste neyse, test onunla başlar.

---

## Soru tipleri

Yedi tip vardır ve bu küme kapalıdır — yenisi eklenmez.

| Tip | Ne yapar |
|---|---|
| `single_choice` | Tek doğru şık. |
| `multiple_choice` | Birden fazla doğru şık; hepsini işaretlemeniz gerekir. |
| `true_false` | Doğru / Yanlış. |
| `short_answer` | Kısa metin yazarsınız. Birden fazla kabul edilebilir cevap tanımlanabilir. |
| `fill_in_the_blank` | Cümle içinde boşluk(lar). Metinde `{{blank}}` ya da `{{doğru|eşdeğer}}` yazarsınız; her boşluk ayrı değerlendirilir. |
| `flashcard` | Ön yüz / arka yüz. Kendi kendinizi değerlendirirsiniz. |
| `reading` | Soru değil, okuma parçası. Bölüm bölüm okunur; ilerleme sayılır ama doğru/yanlış yoktur. |

**Eski adlar.** `text`, `text_input` ve `open_ended` otomatik olarak `short_answer`'a, `topic_review` ise `reading`'e çevrilir. Eski dosyalarınız çalışmaya devam eder.

**Markdown her yerde.** Soru metni, şıklar ve açıklamalar Markdown destekler: kalın, italik, başlık, liste, kod bloğu, tablo, `==vurgu==`. Resim eklemek için soru düzenleyicisindeki medya alanını kullanın.

---

## Test sırasında

**Cevaplama.** Şıkkı seçin ve kontrol edin. Cevap işaretlendikten sonra doğru cevap ve varsa açıklama görünür. Yanlış cevaplar test içinde tekrar sorulmaz — sorular baştan seçilir.

**Zor / Kolay.** Kontrolden sonra çıkan bu iki düğme, sorunun tekrar aralığını kısaltır ya da uzatır. Zorlandığınızda **Zor**'a basmak o soruyu daha erken geri getirir. İsteğe bağlıdır; basmazsanız normal bir sonuç kaydedilir.

**Üst çubuktaki işaretler:**

- **Yıldız** — sonra dönmek istedikleriniz.
- **Bayrak** — sorunun kendisinde bir sorun olduğunu düşündükleriniz.
- **Not** — soruya kendi notunuzu yazarsınız. Not senkronize olur ve ilerleme sıfırlansa bile silinmez.

Üçü de işaretleri **kaldırmayı** da taşır: bir cihazda yıldızı kaldırırsanız diğerinde de kalkar.

**Menü düğmeleri:**

- **Çevir** — sorunun tamamını seçtiğiniz dile çevirir (internet gerekir).
- **Yapay Zekâ** — iki düğme. Kopyala düğmesi soruyu ve doğru cevabı panoya alır; paylaş düğmesi seçtiğiniz promptu tam haliyle dışarı verir (telefonda sistem paylaşım penceresi, masaüstünde pano).
- **Sesli oku** — sorunun ya da okuma bölümünün sesli okunması.

**Sayaç.** Menü → Sayaç bölümünden iki ayrı şey açabilirsiniz: soru başına **geri sayım** (süre dolunca uyarır) ve bir **kronometre**. İkisi de varsayılan olarak kapalıdır.

**Test nasıl biter?** Cevapsız soru kalmadığında test kendini bitirir — ama hemen değil: Zor/Kolay'a basmanız için 1,5 saniye bekler ve o arada herhangi bir şeye dokunmanız beklemeyi iptal eder. Son soruda düğme zaten "Testi Bitir" der. Kasten yarım bıraktığınız test ana ekranda "Devam Et" olarak sizi bekler.

---

## Sonuç ekranı ve yeniden çözme

Test bitince doğru / yanlış / boş sayıları, başarı oranı ve süre görünür. Altında testin bütün soruları listelenir; herhangi birine dokunup cevabı ve açıklamayı yeniden okuyabilirsiniz.

**Yeniden Çöz** düğmesi testin sorularını bir kez daha sorar — özellikle çok hata yaptığınızda, açıklamalar hâlâ aklınızdayken.

Yeniden çözerken, ilk seferde **yanlış** yaptığınız bir soruyu şimdi doğru bilmeniz **tam başarı sayılmaz**. Az önce kaçırdığınız bir soruyu bilmek bir *toparlanma*dır, ilk seferde bilmekle aynı şey değil; uygulama bunu "Zor" olarak kaydeder. Böyle olmasaydı bir soruyu yanlış yapıp hemen ardından doğru yapmak, o soruyu ilk seferde doğru yapmaktan **daha iyi** bir kayıt bırakırdı. İlk seferde doğru bildiğiniz ya da boş bıraktığınız sorular normal değerlendirilir.

---

## Soru detayları ve düzenleme

İstatistikler listesinden bir soruya dokunduğunuzda **önizleme** ekranı açılır: sorunun tam hali, doğru cevabı, açıklaması, etiketleri, sizin notunuz ve o soruya dair sayılar.

**Oklar.** Önizlemedeki sağ/sol oklar sizi listedeki **bir sonraki** soruya götürür — filtre, arama ve sıralama uygulanmış haliyle. Yani "yıldızlılar arasında gezinmek" tam olarak budur. Ortadaki `12 / 30` kaçıncı sırada olduğunuzu söyler.

**Düzenleme.** Kalem düğmesi soru düzenleyicisini açar. Metin, şıklar, doğru cevap, açıklama, zorluk, etiketler ve medya — hepsi buradan değişir.

- **Hızlı biçimlendirme çubuğu**: kalın, italik, başlık, liste, vurgu, kod.
- **Canlı önizleme**: Markdown'ın nasıl görüneceğini yazarken gösterir.
- **Odak modu**: bir metin alanına dokunduğunuzda diğer her şey gizlenir ve alan büyür. Telefonda uzun metin yazmak için. Çıkmak için dışarı dokunun ya da çıkış düğmesini kullanın.
- **Kaydedilmemiş değişiklik**: kaydetmeden çıkmaya kalkarsanız uygulama sorar — Kaydet / Kaydetmeden çık / Vazgeç.
- **Alt taraftaki oklar** düzenleyiciyi kapatmadan bir sonraki soruya geçirir.

Kaydettiğinizde önizleme anında yenilenir; listeye çıkıp geri girmeniz gerekmez.

---

## İstatistikler neyi gösterir

İstatistikler ekranı sorularınızın listesidir; her satır bir soru ve o sorunun durumudur.

**Satırda ne var:**

- **✓ / ✗ ve yüzde** — o soruyu kaç kez doğru, kaç kez yanlış yaptınız.
- **Zorluk** — uygulamanın o soru için tuttuğu zorluk (1–5). Sizin cevaplarınızla değişir.
- **🧠 yüzde** — *hatırlanabilirlik*: şu anda sorulsa bilme ihtimaliniz. %90'ın altına düşen soru "gecikmiş" sayılır ve önceliklenir.
- **🔥 / ❄️ sayı** — üst üste kaç doğru ya da kaç yanlış.
- **🎓** — öğrenilmiş sayılan soru.
- Yıldız, bayrak, not ve **askıda** rozetleri.

**Filtreler (üstteki şerit):**

| Filtre | Ne listeler |
|---|---|
| Tümü | Kapsamdaki bütün sorular |
| Son Cevaplananlar | Geçmiş test oturumları |
| Yanlış Yapılanlar | En az bir kez yanlış yaptıklarınız |
| Yıldızlı / Bayraklı / Notlu | İşaretlediğiniz sorular |
| **Takılanlar** | Takılıp kalmış sorular — aşağıda |

**Takılanlar.** Bir soruyu üst üste yanlış yapmak tekrar aralığını en düşük değere indirir; soru her gün yeniden karşınıza çıkar ve günlük hakkınızdan bir yer kaplar, ama hiçbir zaman öğrenilmiş olmaz. **8 kez** yanlış yaptığınız ve hâlâ üst üste doğru gitmeyen sorular bu filtrede toplanır.

Bu filtrede her satırda iki düğme vardır:

- **Düzenle** — çoğu zaman kusur sorudadır: belirsiz ifade, iki savunulabilir doğru ya da cevap anahtarındaki bir hata. Önce buraya bakın.
- **Askıya Al** — soru testlerde çıkmaz. **Hiçbir istatistiği silinmez**, listede durmaya devam eder, istediğiniz an geri alırsınız. Askıya almak bir cezalandırma değil, "bununla şimdi uğraşmayacağım" demektir.

**Kapsam.** Alttaki çubuk hangi kaynaklara baktığınızı söyler. Başlıktaki **Tüm Kaynaklar** anahtarı kapalıyken kapsam açık kaynaklarınızdır; açtığınızda bütün kütüphanedir. Arama kutusuna `$KaynakAdı` yazarak kapsamı doğrudan da adlandırabilirsiniz.

**Arama.** Düz metin soruda arar, `#etiket` etikette arar, `$Kaynak` kaynağa daraltır.

**Sıralama.** Orijinal sıra, zorluk, başarı yüzdesi ya da hatırlanabilirlik.

---

## Grafikler ve ilerleme paneli

**Ana ekran kartları** kütüphanenizi anlatır — arşivlenmemiş her kaynağı.

- **Zorluk dağılımı** — sorularınızın kolay/orta/zor dağılımı.
- **Trend** — son 7 günün günlük soru sayısı. Kartı çevirirseniz aylık görünüme geçer.
- **Isı haritası** — bir yılın çalışma günleri. Koyu gün, çok çalışılmış gün.
- **Sınav hazırlığı** — kaynak başına ortalama hazırlık yüzdesi.

**İlerleme paneli** (kartın üzerindeki büyütme düğmesi) ise **testinizi** anlatır — yalnızca açık kaynakları. Üç grafik vardır ve üçü de aynı kümeyi okur:

- **Genel bakış** — doğru/yanlış/boş dağılımı.
- **Zorluk barı** — soruların zorluğa göre dağılımı.
- **İş yükü** — asıl okunması gereken grafik. Soldan sağa zaman:

  `−6g … dün │ Gecikmiş · Başlanmamış │ Bugün │ +1g … +6g`

  **Dolu** = o an geride kaldı (verdiğiniz cevap ya da sizsiz geçip giden tekrar günü). **İçi boş** = hâlâ önünüzde. Renk borcun türünü söyler: kırmızı gecikmiş, mavi hiç başlanmamış, sarı bugün, gri plan.

  Sağ taraftaki gri sütunlar **borç değil plandır** — önümüzdeki günlerde sizi bekleyen normal tekrarlar.

Her grafiğin yanındaki **i** düğmesi o grafiğin ne anlattığını açıklar.

**İncele** düğmesi paneldeki kaynakların sorularını istatistikler ekranında açar.

---

## Seriler ve dondurma jetonları

İki seri vardır ve birbirinden bağımsız çalışırlar.

**Genel Seri.** Kütüphanenizin tamamı için. Bir günü kazanmak için o gün **en az 15 soru** çözmeniz gerekir. Bu sayı sabittir ve ayarlanamaz: hareket eden bir taban taban değildir. 15'ten fazlası sizi ilgilendirir — uygulama fazlasını ne ödüllendirir ne cezalandırır.

**Odak Seri.** Seçtiğiniz **en fazla 3 kaynak** için ayrı bir seri. Kaynakları seçmek için Odak kartındaki dişli düğmesini kullanın; yanındaki "Kaynak Seç" yazısı oraya işaret eder. Odak serisi yalnızca seçtiğiniz kaynaklarda **seçim tarihinden sonra** çözdüğünüz soruları sayar.

**Gün sınırı.** Gün, cihazınızın saatine göre değil, sabit olarak **Europe/Berlin** gecesine göre döner. Sebebi basit: aksi halde farklı saat dilimlerindeki iki cihazınız aynı çalışmayı iki ayrı güne yazar ve bunu hiçbir birleştirme kuralı onaramaz.

**Dondurma jetonları (❄️).** Bir gün kaçırdığınızda seriniz kırılmasın diye harcanan jetonlar.

- Düzenli çalışarak kazanılır; iki kademe vardır.
- Kaçırılan bir gün, siz bir şey yapmadan, açılışta otomatik dondurulur.
- **Donmuş bir gün yeni jeton kazandırmaz** — yoksa dondur/kazan/dondur diye kendini besleyen bir döngü olurdu.
- Genel ve Odak serilerinin kendi jetonları vardır. Biri bitince diğerininkinden ödünç alınabilir, ama önce herkes kendi jetonunu kullanır.
- Odak serisinde **hiç kaynak seçmemişseniz jeton harcanmaz**. Seçilmemiş bir hedef her gün "kaçırılmış" okunur ve bütün jetonlarınızı sessizce yakardı.

**Seriyi Koru** düğmesi o gün için gereken soruları doğrudan bir teste dönüştürür: gecikmişler, birkaç yeni soru ve yaklaşanlar karışık gelir.

---

## Tekrar algoritması nasıl karar verir

Uygulama **FSRS** adlı bir aralıklı tekrar algoritması kullanır (Anki'nin de kullandığı ailenin modern üyesi). Her soru için iki sayı tutar:

- **Kararlılık** — o bilgiyi ne kadar süre hatırlayacağınızın gün cinsinden tahmini.
- **Zorluk** — sorunun sizin için ne kadar zor olduğu.

Bu ikisinden **hatırlanabilirlik** çıkar: `R = 0.9 ^ (geçen gün / kararlılık)`. `R` %90'ın altına düştüğünde soru "gecikmiş" olur — yani vadesi tam olarak **son tekrar + kararlılık** günüdür.

**Ne değiştirir:**

- **Doğru cevap** kararlılığı artırır; aralık uzar.
- **Yanlış cevap** kararlılığı düşürür; soru yakında geri gelir.
- **Zor** düğmesi aralığı kısar, **Kolay** uzatır.
- JSON'daki `difficulty` yalnızca **başlangıç** tahminini verir.

**Öğrenilmiş** işareti (🎓) üst üste 5 doğru ya da 30 günü aşan bir kararlılık demektir. Bir yanlış cevap bu işareti kaldırır.

Bunların hiçbirini elle ayarlamanız gerekmez ve bir ayar da yoktur. Tek müdahaleniz Zor/Kolay düğmeleri ve — gerçekten takılan sorular için — askıya almadır.

---

## Senkronizasyon ve yedekleme

İki ayrı şey vardır: **senkronizasyon** (cihazlar arası, sürekli) ve **yedek** (tek dosya, elle).

### GitHub senkronizasyonu

Verileriniz sizin GitHub hesabınızdaki gizli bir **Gist**'te tutulur. Bizim sunucumuz yoktur; veriniz bize hiç uğramaz.

**Kurulum:**

1. GitHub'da bir **Personal Access Token** oluşturun. Tek gereken yetki `gist`.
2. Menü → Yedekleme bölümünden tokeni girin.
3. İlk bağlanmada uygulama Gist'i kendisi oluşturur.

**Nasıl çalışır:**

- Her cevaptan sonra değişiklikler yukarı gönderilir.
- Uygulama öne geldiğinde (sekmeye döndüğünüzde, telefonu açtığınızda) aşağı çekilir — 30 saniyede bir defadan sık değil.
- **Test sırasında aşağı çekme ertelenir**, yoksa çözdüğünüz sorular altınızdan değişirdi.
- Yarım kalan testler de senkronize olur: telefonda başlayıp bilgisayarda devam edebilirsiniz.
- Çakışma olduğunda uygulama ezmek yerine birleştirir. Aynı günü iki cihazda çalışırsanız ikisi **toplanır**.

**Menüdeki senkron rozeti** durumu gösterir: başarılı, ağ hatası ya da token sorunu. Üst üste hata varsa rozet bunu söyler.

### Elle yedek

Menü → Yedekleme → **Dışa Aktar** tek bir JSON dosyası indirir. İçinde kaynaklarınız, klasörleriniz, bütün istatistikleriniz, **günlük çalışma geçmişiniz**, seri ayarlarınız, jetonlarınız ve hızlı test gruplarınız vardır.

**İçe Aktar** aynı dosyayı geri yükler. Mevcut verinin üzerine yazar ve sayfayı yeniler, o yüzden önce onay ister.

Yeni bir cihaza geçerken ya da riskli bir şey yapmadan önce (kaynak silme, birleştirme, sıfırlama) bir yedek alın. Yedek dosyası hiçbir yere gönderilmez; sizde kalır.

---

## Yapay zekâ ile kullanım

Uygulamanın içinde yapay zekâ **çalışmaz**. Bunun yerine dışarıdaki bir yapay zekâya göndereceğiniz metni hazırlar. Anahtar vermezsiniz, ücret ödemezsiniz, arka planda hiçbir yere veri gitmez — ne gönderdiğinize siz karar verirsiniz.

**Soru üretme.** Çoğu kişi kaynaklarını böyle oluşturur: bir yapay zekâya ders notlarınızı verip yukarıdaki JSON biçiminde soru üretmesini istersiniz, çıkan metni Kaynaklar ekranına yapıştırırsınız. `difficulty` alanını doldurmasını istemek işe yarar — algoritmanın başlangıç tahminini iyileştirir.

**Prompt kütüphanesi.** Menü → Yapay Zekâ bölümünden kendi promptlarınızı yazıp saklarsınız. Üç hazır prompt gelir: soruyu denetlet, konuyu anlattır, kendi cevabını değerlendirt.

Promptlarda kullanabileceğiniz değişkenler:

| Değişken | Yerine geçen |
|---|---|
| `{question}` | Sorunun metni |
| `{options}` | Şıklar |
| `{correct}` | Doğru cevap |
| `{answer}` | Sizin verdiğiniz cevap |
| `{source}` | Kaynağın adı |
| `{explanation}` | Açıklama |

**Karşılığı olmayan değişken satırı düşürür.** Şıksız bir soruda `{options}` içeren satır hiç yazılmaz — yapay zekâya hiçbir şey söylemeyen boş bir "Şıklar:" satırı göndermenin anlamı yok.

**Sağlayıcı listesi.** Sık kullandığınız yapay zekâların adreslerini `{PROMPT}` yer tutucusuyla kaydedebilirsiniz; tek dokunuşla prompt doldurulmuş olarak açılır. Bu liste cihaza özeldir, senkronize edilmez.

**AI Bağla (isteğe bağlı).** Menü → Yapay Zekâ → **AI Bağla** ile bu bilgisayarda çalışan bir modeli (Ollama, LM Studio veya yerel bir proxy üzerinden OpenAI uyumlu bir adres) doğrudan bağlayabilirsiniz; e-Reader'daki öz ve kavram düğmeleri o zaman cevabı uygulama içinde gösterir. Adres ve model girilir, **Bağlantıyı test et** ile denenir. Tarayıcının erişebilmesi için sunucunun CORS izni olmalıdır (Ollama: `OLLAMA_ORIGINS`) ya da araya yerel bir proxy konur. Bağlantı yalnızca bu cihazda saklanır. Bulut AI bağlantısı yakında.

**Bu rehber de bir referanstır.** Uygulamanın kullanımına dair bir yapay zekâya soru soracaksanız, rehberin tamamı depoda `docs/USER_GUIDE.md` olarak durur; ona verip sorularınızı sorabilirsiniz.

---

## Menü ve ayarlar

Menü (sağ üstteki düğme) bölüm bölüm açılır.

- **Yedekleme** — dışa/içe aktarma ve GitHub senkronizasyonu.
- **Yapay Zekâ** — prompt kütüphanesi ve sağlayıcı listesi.
- **Sayaç** — soru başına geri sayım ve kronometre; ikisi de isteğe bağlı.
- **Çeviri** — çeviriyi açıp kapatma ve hedef dili seçme (10 dil).
- **Sesli Okuma** — ses, hız ve otomatik okuma.
- **Ana Ekran** — hangi kartların görüneceği.
- **Bildirimler** — iki ayrı kanal: genel seri hatırlatması (sabah) ve odak seri hatırlatması (akşam). Sessiz saatler tanımlayabilirsiniz. Bildirimler cihazınızda üretilir; sunucu yoktur.
- **Dil** — arayüz dili: Türkçe, İngilizce, Almanca.
- **Tema** — açık / koyu.

**Sayfa içi işaret düğmeleri** (yıldız, bayrak, not, tümünü çevir, yapay zekâ komutunu kopyala) test ve önizleme ekranlarında menüde görünür.

**Kaynakları Sil** menünün en altındadır ve geri alınamaz. İki kademesi vardır: yalnızca ilerlemeyi sıfırlamak (kaynaklar kalır) ve her şeyi silmek. İkisinde de promptlarınız ve hızlı test gruplarınız korunur — onlar çalıştığınız bir şeyin kaydı değil, sizin yazdığınız aletlerdir.

**Hangi ayarlar senkronize olur?** Dil, çeviri hedefi, sesli okuma ayarları, sayaç ayarları ve prompt seçiminiz cihazlar arasında taşınır. **Yapay zekâ sağlayıcı listesi** ve **tema** cihaza özeldir.

---

## e-Reader ve Kitaplar

e-Reader, uzun çalışma metinlerini, PDF'leri, EPUB kitapları ve dokümantasyonları dikkat dağıtıcı unsurlardan arınmış biçimde, tek bir akış hâlinde kaydırarak okumanızı sağlar. Üst başlık her zaman **e-Reader** yazar.

**Kitap ekleme ve AI promptu.** Bir kaynağı e-Reader'a dönüştürmek için harici AI modellerine (ChatGPT, Claude, Gemini vb.) `EREADER_AI_PROMPT.md` yönergesi verilir. Elde edilen standart JSON verisi panodan yapıştırılarak veya dosya seçilerek kütüphaneye eklenir. Kitap eklendikten sonra doğrudan tarayıcının IndexedDB alanında saklanır.

**Parçalı üretim ve birleştirme.** Büyük kitaplar AI bağlam sınırlarına takılmadan parça parça üretilebilir (`part: { from: 1, to: 20, ... }`). Aynı kitap anahtarına (`book_key`) sahip parçalar otomatik olarak tespit edilir veya kütüphane başlığındaki **Parçaları birleştir** düğmesiyle tek bir kitapta birleştirilebilir. Parçalar arasında eksik sayfa/bölüm varsa içindekiler tablosunda boşluk uyarısı gösterilir ve kitap menüsünden sonraki parçanın promptu tek tıkla panoya kopyalanabilir.

**Görsel desteği ve bağlantı ekleme.** Kitap metinlerinde güvenli `https://` bağlantılı Markdown görselleri görüntülenir. `placeholder:id` veya dosya ekleri yer tutucu kartı olarak çizilir; yer tutucuya dokunarak gerçek bir `https://` görsel bağlantısı tanımlayabilirsiniz. Güvenlik ve veri tasarrufu nedeniyle ham görsel verisi cihazda depolanmaz veya senkronlanmaz.

**Okuma.** Kitap sayfalara bölünmez; baştan sona tek bir akışta kaydırılır. Çok uzun kitaplarda da akıcı kalması için yalnızca ekranın çevresindeki bölümler yüklenir, uzaklaşanlar boşaltılır — okuduğunuz satır kaymaz. Sağ alttaki **yukarı** düğmesi okuduğunuz bölümün başlığına, oradaysanız bir önceki başlığa gider; **Ctrl+tık** (mobilde uzun basış) kitabın başına götürür. Okuma konumu kendiliğinden kaydedilir; üstteki **yer imi** düğmesi konumu anında kaydeder. Kitaptayken üstteki ev düğmesi kütüphaneye döner.

**Üst araçlar.** **Aa+** düğmesi her basışta yazı boyutunu küçük → normal → büyük arasında değiştirir; yalnızca okuma alanı değişir. **Ara** düğmesi (veya Ctrl+K, Ctrl+F, "/") ekranı karartıp odaklı bir arama açar: ↑/↓ ile sonuç seçilir, Enter ile gidilir, Esc ile kapanır. Tam ekran düğmesi masaüstündedir.

**Yan menü.** Yalnızca **İçindekiler** ve **Ayarlar** vardır; menü her açıldığında İçindekiler açık gelir. İçindekilerde önce ana başlıklar görünür; bir başlığa dokunmak alt başlıklarını açar ve oraya kaydırır, menü açık kalır (okuma alanına dokununca kapanır). Ayarlar'da yazdırma/PDF ve tüm kitapları etkileyen **e-Reader'ı Sıfırla** bulunur.

**Paragraf araçları.** Her paragrafın sonunda (masaüstünde üzerine gelince, mobilde paragrafa dokununca) dört küçük düğme belirir: **dinle** (kitabın dilinde), **öz & temel mantık**, **kavram & terimler** (B1) ve **çevir**. Sonuç, paragrafın hemen altındaki tek bir kutuda açılır; kutuda Kopyala, Yeniden dene ve Gizle vardır. Öz ve kavramlar bir yapay zekâ ister: bağlı bir AI varsa cevap kutuda gelir, yoksa kutu promptu kopyalamayı, bir AI sayfasında açmayı veya **AI Bağla**'yı önerir.

**Kütüphane.** Kitaplar klasörlere ayrılabilir, tutamacından sürüklenerek sıralanabilir veya bir klasör başlığına bırakılarak taşınabilir. Klasör menüsündeki **Kitapları seç** ile birden çok kitap seçilip birlikte taşınabilir, arşivlenebilir, sıfırlanabilir veya silinebilir. Her kitabın işlem menüsünde klasöre taşıma, meta verileri düzenleme, indirme, paylaşma, yazdırma, arşivleme, silme ve okuma konumunu sıfırlama vardır. Arşivlenen kitaplar kütüphaneden çıkar, arşiv düğmesiyle görülür.

**Senkronizasyon.** GitHub Gist senkronizasyonunuz etkinse kitaplarınız, okuma konumunuz ve kütüphane düzeniniz (klasörler, sıra, arşiv) cihazlarınız arasında arka planda senkronize edilir. Kitapları taşımak veya sıralamak kitapların kendisini yeniden yüklemez.

**e-Reader'ı sıfırlama.** Yan menüde **Ayarlar → e-Reader'ı Sıfırla** ile okuma ilerlemenizi sıfırlayabilir veya tüm kitapları silebilirsiniz; tek bir kitabın konumu kendi işlem menüsünden sıfırlanır. Bu işlem sınav/test verilerinize, FSRS istatistiklerinize veya kaynaklarınıza kesinlikle dokunmaz.

---

## Sık karşılaşılan durumlar

**"Bir soru sürekli karşıma çıkıyor."** Muhtemelen takılmış bir sorudur. İstatistikler → **Takılanlar** filtresine bakın; düzeltin ya da askıya alın.

**"Serim kırıldı ama çalışmıştım."** Gün sınırı **Europe/Berlin** gecesidir; gece yarısından sonra başka bir saat diliminde çözdüğünüz sorular bir sonraki güne yazılmış olabilir. Ayrıca bir günü kazanmak için 15 soru gerekir.

**"İki cihazda farklı sayılar görüyorum."** Uygulamayı ikisinde de öne getirip birkaç saniye bekleyin — aşağı çekme uygulama öne geldiğinde olur. Test ekranındaysanız ertelenir.

**"Senkron rozeti kırmızı."** Token'ınızın süresi dolmuş ya da yetkisi yetersiz olabilir (`gist` yetkisi gerekir). Rozete dokunarak durumu okuyun; geçici bir ağ hatası ile token sorunu ayrı ayrı gösterilir.

**"Yer kalmadı uyarısı alıyorum."** Kullanmadığınız kaynakları dışa aktarıp silin, ya da GitHub bağlıysa arşivleyin. Arşivleme yalnızca GitHub bağlıyken cihazda yer açar.

**"Sorularım kayboldu."** Tarayıcı verisini temizlemek uygulamanın verisini de siler. GitHub senkronizasyonu bağlıysa yeniden bağlanmak geri getirir; değilse elinizdeki yedek dosyasını içe aktarın. Düzenli yedek almanın sebebi budur.

**"Cevabım doğru ama yanlış saydı."** Kısa cevap ve boşluk doldurmada kabul edilen cevapları soru düzenleyicisinden genişletebilirsiniz; birden fazla eşdeğer cevap tanımlanabilir.

**"Uygulama telefonda takıldı."** Sayfayı yenileyin. Yarım kalan testiniz kaybolmaz; ana ekranda "Devam Et" olarak durur.

---

## Sürüm ve iletişim

**Sürüm:** 1.1.0

**İletişim:** tafirnat@gmail.com

Bir hata bulduysanız, bir şey anlaşılmadıysa ya da bir öneriniz varsa yazın. Hata bildirirken hangi ekranda olduğunuzu ve ne yapmaya çalıştığınızı belirtmek çok yardımcı olur.

**Kaynak kodu:** https://github.com/tafirnat/exam-app

**Verileriniz kimde?** Sizde. Uygulamanın sunucusu yoktur. Veriler tarayıcınızın deposunda durur; senkronizasyonu açarsanız kendi GitHub hesabınızdaki gizli bir Gist'te tutulur. Çeviri ve sesli okuma dışında hiçbir istek cihazdan çıkmaz, o ikisini de kapatabilirsiniz.

---

<https://github.com/tafirnat/exam-app> · tafirnat@gmail.com
