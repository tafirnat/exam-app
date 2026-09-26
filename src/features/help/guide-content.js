import { APP_VERSION } from '../../core/version.js';

/**
 * The user guide, in three languages.
 *
 * Kept out of i18n.js on purpose. That file is already 2400 lines of short UI
 * strings and this is long prose - mixing them makes both harder to search,
 * and every pass over the interface copy would have to scroll through a manual.
 *
 * Bodies are Markdown, rendered with the app's own renderMarkdown(), so the
 * guide uses exactly the renderer the questions do: one implementation, and
 * anything that breaks it is already covered by the markdown tests.
 *
 * docs/USER_GUIDE*.md is GENERATED from this file - `npm run build:guide`.
 * Those files are what an AI asked "how does this app work" reads, and
 * tests/user-guide.test.mjs fails if they have drifted, so the two cannot
 * come apart.
 */

export const CONTACT_EMAIL = 'tafirnat@gmail.com';
export const SOURCE_URL = 'https://github.com/tafirnat/exam-app';

export const GUIDE_LANGUAGES = Object.freeze(['tr', 'en', 'de']);

/** Falls back to English for any language the guide has not been written in. */
export function guideLang(lang) {
    return GUIDE_LANGUAGES.includes(lang) ? lang : 'en';
}

export const GUIDE_TITLE = {
    tr: 'Kullanım Rehberi',
    en: 'User Guide',
    de: 'Benutzerhandbuch'
};

export const GUIDE_INTRO = {
    tr: 'Uygulamanın her bölümü: ne işe yaradığı ve nasıl kullanıldığı. Aradığınız başlığa dokunun.',
    en: 'Every part of the app: what it is for and how to use it. Tap the heading you need.',
    de: 'Jeder Teil der App: wofür er da ist und wie man ihn benutzt. Tippen Sie auf die gesuchte Überschrift.'
};

export const GUIDE_SECTIONS = [
{
    id: 'start',
    title: { tr: 'Başlarken', en: 'Getting started', de: 'Erste Schritte' },
    body: {
tr: `Bu uygulama, **kendi sorularınızla** çalışmanız için yapılmış bir tekrar ve sınav uygulamasıdır. Üç şey onu çoğu alternatiften ayırır:

- **Hesap yok.** Kayıt olmazsınız, giriş yapmazsınız. Bütün verileriniz tarayıcınızın kendi deposunda durur.
- **Çevrimdışı çalışır.** İnternet yalnızca senkronizasyon, çeviri ve sesli okuma için gerekir.
- **Kendi içeriğiniz.** Hazır bir soru kütüphanesi yoktur; soruları siz eklersiniz (çoğu kişi bir yapay zekâya ürettirir).

**İlk beş dakika**

1. Menüden veya ana ekrandan **Kaynaklar**'a gidin ve bir JSON dosyası ekleyin. Elinizde yoksa örnek kaynağı yükleyin.
2. Ana ekrana dönün, çalışmak istediğiniz kaynağı açık duruma getirin.
3. Soru sayısını seçin ve teste başlayın.
4. Test bitince sonuç ekranı çıkar; oradan yanlışlarınızı hemen bir kez daha görebilirsiniz.

Gerisi kendiliğinden işler: hangi soruyu ne zaman tekrar göreceğinize uygulama karar verir.`,
en: `This is a spaced-repetition and exam app built around **your own** questions. Three things set it apart from most alternatives:

- **No account.** Nothing to register, nothing to log into. All your data lives in your browser's own storage.
- **Works offline.** The internet is only needed for syncing, translation and text-to-speech.
- **Your content.** There is no ready-made question library; you add the questions (most people have an AI generate them).

**The first five minutes**

1. Open **Sources** from the menu or the home screen and add a JSON file. If you have none, load the sample source.
2. Go back to the home screen and switch on the source you want to study.
3. Choose how many questions you want and start the test.
4. When the test ends you get a results screen, and from there you can see the ones you missed one more time straight away.

The rest takes care of itself: the app decides when you see each question again.`,
de: `Dies ist eine App für verteiltes Wiederholen und Prüfungsvorbereitung, gebaut um **Ihre eigenen** Fragen. Drei Dinge unterscheiden sie von den meisten Alternativen:

- **Kein Konto.** Keine Registrierung, keine Anmeldung. Alle Ihre Daten liegen im Speicher Ihres eigenen Browsers.
- **Funktioniert offline.** Das Internet wird nur für Synchronisierung, Übersetzung und Vorlesen gebraucht.
- **Ihre Inhalte.** Es gibt keine fertige Fragenbibliothek; Sie fügen die Fragen hinzu (die meisten lassen sie von einer KI erzeugen).

**Die ersten fünf Minuten**

1. Öffnen Sie **Quellen** über das Menü oder die Startseite und fügen Sie eine JSON-Datei hinzu. Wenn Sie keine haben, laden Sie die Beispielquelle.
2. Gehen Sie zurück zur Startseite und schalten Sie die Quelle ein, mit der Sie lernen wollen.
3. Wählen Sie die Anzahl der Fragen und starten Sie den Test.
4. Am Ende erscheint die Ergebnisseite; von dort aus können Sie die falsch beantworteten Fragen sofort noch einmal ansehen.

Um den Rest kümmert sich die App: Sie entscheidet, wann Sie jede Frage wiedersehen.`
    }
},
{
    id: 'add-sources',
    title: { tr: 'Kaynak ekleme', en: 'Adding sources', de: 'Quellen hinzufügen' },
    body: {
tr: `Bir **kaynak**, bir konuya ait soru kümesidir: bir ders, bir kitap bölümü, bir sınav başlığı. Kaynağı dar ve tutarlı tutun — istatistikler kaynak başına hesaplanır, yani "Anatomi" tek kaynakken işe yarar, "Her şey" anlamsız bir ortalama üretir.

**Üç ekleme yolu** (Kaynaklar ekranı):

- **Dosyadan** — cihazınızdaki bir \`.json\` dosyasını seçin.
- **URL'den** — JSON'un doğrudan adresini yapıştırın (örneğin bir GitHub raw bağlantısı).
- **Yapıştırarak** — JSON metnini doğrudan kutuya yapıştırın. Yapay zekâdan aldığınız çıktıyı en hızlı buradan alırsınız.

**Beklenen biçim**

\`\`\`json
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
\`\`\`

\`difficulty\` 1–5 arasıdır ve yalnızca sorunun **ilk** zorluk tahminini besler; sonrasını sizin cevaplarınız belirler. \`tags\` isteğe bağlıdır, aramada ve etikete göre test başlatmada kullanılır.

**Yükleme raporu.** İçe aktarma bittiğinde eksik bulunan sorular (cevabı olmayan, şıksız, boş metinli) bir raporla gösterilir. Oradan düzeltir, işaretler ya da silersiniz — sessizce içeri alınmazlar.

**Güvenlik.** Soru metinleri Markdown olarak çizilir; içindeki ham HTML **çalıştırılmaz**, olduğu gibi yazı olarak görünür. Güvenmediğiniz bir JSON'u açmak sizi bir betiğe maruz bırakmaz.`,
en: `A **source** is a set of questions about one subject: a course, a chapter, an exam topic. Keep a source narrow and coherent - statistics are computed per source, so "Anatomy" as one source is useful while "Everything" produces a meaningless average.

**Three ways to add one** (Sources screen):

- **From a file** - pick a \`.json\` file from your device.
- **From a URL** - paste the direct address of the JSON (a GitHub raw link, for instance).
- **By pasting** - paste the JSON text straight into the box. This is the quickest route for output you got from an AI.

**The expected format**

\`\`\`json
{
  "examTitle": "Anatomy - Chapter 1",
  "questions": [
    {
      "id": "q1",
      "type": "single_choice",
      "text": "How many chambers does the heart have?",
      "options": [
        { "id": "a", "text": "2" },
        { "id": "b", "text": "4" }
      ],
      "correctOptionIds": ["b"],
      "explanation": "Two atria, two ventricles.",
      "difficulty": 2,
      "tags": ["heart"]
    }
  ]
}
\`\`\`

\`difficulty\` runs 1-5 and only seeds the question's **initial** difficulty estimate; from then on your answers decide. \`tags\` are optional and are used by search and by starting a test from a tag.

**The import report.** When an import finishes, questions found to be incomplete (no answer, no options, empty text) are listed in a report. From there you fix them, flag them, or delete them - they are never taken in silently.

**Safety.** Question text is drawn as Markdown, and any raw HTML inside it is **never executed** - it appears as literal text. Opening a JSON you do not trust does not expose you to a script.`,
de: `Eine **Quelle** ist eine Menge von Fragen zu einem Thema: ein Kurs, ein Kapitel, ein Prüfungsgebiet. Halten Sie eine Quelle eng und zusammenhängend - Statistiken werden pro Quelle berechnet, also ist "Anatomie" als eine Quelle nützlich, während "Alles" einen nichtssagenden Durchschnitt ergibt.

**Drei Wege, eine hinzuzufügen** (Quellen-Bildschirm):

- **Aus einer Datei** - wählen Sie eine \`.json\`-Datei von Ihrem Gerät.
- **Von einer URL** - fügen Sie die direkte Adresse der JSON ein (etwa einen GitHub-Raw-Link).
- **Durch Einfügen** - fügen Sie den JSON-Text direkt in das Feld ein. Das ist der schnellste Weg für Ausgaben einer KI.

**Das erwartete Format**

\`\`\`json
{
  "examTitle": "Anatomie - Kapitel 1",
  "questions": [
    {
      "id": "q1",
      "type": "single_choice",
      "text": "Wie viele Kammern hat das Herz?",
      "options": [
        { "id": "a", "text": "2" },
        { "id": "b", "text": "4" }
      ],
      "correctOptionIds": ["b"],
      "explanation": "Zwei Vorhöfe, zwei Kammern.",
      "difficulty": 2,
      "tags": ["herz"]
    }
  ]
}
\`\`\`

\`difficulty\` reicht von 1 bis 5 und liefert nur die **anfängliche** Schwierigkeitsschätzung; danach entscheiden Ihre Antworten. \`tags\` sind optional und werden von der Suche und vom Teststart nach Schlagwort genutzt.

**Der Importbericht.** Nach einem Import werden unvollständige Fragen (ohne Antwort, ohne Optionen, mit leerem Text) in einem Bericht aufgeführt. Von dort korrigieren, markieren oder löschen Sie sie - stillschweigend übernommen wird nichts.

**Sicherheit.** Fragetexte werden als Markdown gezeichnet, und rohes HTML darin wird **nie ausgeführt** - es erscheint als Text. Eine JSON zu öffnen, der Sie nicht trauen, setzt Sie keinem Skript aus.`
    }
},
{
    id: 'manage-sources',
    title: { tr: 'Kaynakları yönetme, birleştirme, dışa aktarma', en: 'Managing, merging and exporting sources', de: 'Quellen verwalten, zusammenführen, exportieren' },
    body: {
tr: `**Açık / kapalı.** Bir kaynağın anahtarı, o kaynağın testlere girip girmeyeceğini belirler. Birden fazla kaynağı aynı anda açabilirsiniz; test hepsinden soru çeker.

**Klasörler.** Kaynakları klasörlere koyabilir, klasöre renk verebilirsiniz. Klasörsüz kalan her şey "Kategorisiz" klasöründe toplanır — bu klasör silinemez, hep vardır. Boş kalan bir klasör 10 dakika sonra kendiliğinden kaldırılır; uygulamayı kapattıysanız bir sonraki açılışta. Arşivde kaynağı olan klasör boş sayılmaz.

**Klasör bildirimi.** Bir veri seti \`exam_metadata.folder\` alanında klasör adı verebilir. Set, içe aktarılırken ya da senkronla (örneğin Obsidian'dan) ilk geldiğinde o ada sahip klasöre konur; büyük/küçük harf, aksan ve noktalama önemsizdir. O adda klasör yoksa oluşturulur; sonradan adını değiştirdiğiniz klasör de bulunur. Bildirim yoksa set "Kategorisiz"e gider. Her set için bir kez uygulanır: sonradan taşıdığınız set yerinde kalır. Sildiğiniz bir seti aynı dosyayla yeniden içe aktarmak onu bütün cihazlarda geri getirir.

**Kaynak menüsü** (bir kaynağa uzun basın ya da üç noktaya dokunun):

- **Yeniden adlandır / bilgileri düzenle** — başlık ve kategori.
- **Klasöre taşı**.
- **Dışa aktar** — yalnızca o kaynağı JSON olarak indirir. Bu dosyayı başka bir cihaza ya da başka birine verebilirsiniz.
- **Arşivle** — kaynağı kütüphaneden kaldırır ama sorularını saklar. Arşivlenmiş kaynak testlere girmez ve sorularının tekrar saati **durur**: üç ay sonra geri getirdiğinizde hepsi birden "gecikmiş" olmaz.
- **Sil** — kaynağı ve istatistiklerini kaldırır. Geri alınamaz; önce dışa aktarın.

**Birleştirme.** Kaynaklar ekranındaki birleştirme seçeneği, seçtiğiniz kaynakların sorularını tek bir yeni kaynakta toplar; iki kaynakta birden bulunan sorular ayıklanır. Birleştirme de geri alınamaz, o yüzden önce dışa aktarmak iyi bir alışkanlıktır.

**Arşivleme yer açar mı?** Yalnızca GitHub senkronizasyonu bağlıysa: arşivlenen kaynağın soruları Gist'e taşınır ve cihazdan silinir. Bağlantı yoksa sorular cihazda kalır, yani arşivleme yer açmaz — o durumda uygulama size "İndir ve Sil"i önerir.

**Depolama uyarısı.** Tarayıcı deposu dolmaya yaklaşınca uyarı çıkar. Uyarı yüzde göstermez, çünkü tarayıcılar tavanı bildirmez; onun yerine kaç soru daha sığacağını tahmin eder.`,
en: `**On / off.** A source's switch decides whether it takes part in tests. You can have several on at once; a test then draws from all of them.

**Folders.** Sources can be put into folders and folders can be coloured. Anything without a folder collects in "Uncategorized", which always exists and cannot be deleted. A folder that stays empty is removed on its own after 10 minutes, or at the next start if you closed the app. A folder with sources in the archive does not count as empty.

**Folder hint.** A data set can name a folder in its \`exam_metadata.folder\` field. The set goes into the folder of that name when it is imported or first arrives by sync (from Obsidian, for example); case, accents and punctuation do not matter. If there is no such folder it is created, and a folder you renamed since is still found. Without a hint the set goes to "Uncategorized". It happens once per set: a set you move later stays where you put it. Importing a set you deleted again, from the same file, brings it back on every device.

**The source menu** (long-press a source, or tap its three dots):

- **Rename / edit details** - title and category.
- **Move to folder**.
- **Export** - downloads just that source as JSON. You can hand that file to another device or another person.
- **Archive** - takes the source out of the library but keeps its questions. An archived source takes no part in tests and its review clock **stops**: bring it back three months later and its questions are not all overdue at once.
- **Delete** - removes the source and its statistics. It cannot be undone; export first.

**Merging.** The merge option on the Sources screen gathers the questions of the sources you pick into a single new source, de-duplicating anything that appears in two of them. Merging cannot be undone either, so exporting first is a good habit.

**Does archiving free space?** Only when GitHub sync is connected: the archived source's questions are moved into the Gist and removed from the device. Without a connection the questions stay on the device, so archiving frees nothing - and in that case the app offers "Download and delete" instead.

**The storage warning.** A warning appears as browser storage fills up. It shows no percentage, because browsers do not publish the ceiling; it estimates how many more questions will fit instead.`,
de: `**Ein / aus.** Der Schalter einer Quelle entscheidet, ob sie an Tests teilnimmt. Sie können mehrere gleichzeitig einschalten; ein Test zieht dann aus allen.

**Ordner.** Quellen lassen sich in Ordner legen, Ordner lassen sich einfärben. Alles ohne Ordner sammelt sich in "Ohne Kategorie", der immer existiert und nicht gelöscht werden kann. Ein Ordner, der leer bleibt, wird nach 10 Minuten von selbst entfernt, oder beim nächsten Start, wenn Sie die App geschlossen haben. Ein Ordner mit Quellen im Archiv gilt nicht als leer.

**Ordnerhinweis.** Ein Datensatz kann im Feld \`exam_metadata.folder\` einen Ordner nennen. Der Satz landet beim Import oder wenn er zum ersten Mal per Sync ankommt (etwa aus Obsidian) in dem Ordner dieses Namens; Groß-/Kleinschreibung, Akzente und Satzzeichen spielen keine Rolle. Gibt es keinen, wird er angelegt, und auch ein inzwischen umbenannter Ordner wird gefunden. Ohne Hinweis kommt der Satz nach "Ohne Kategorie". Das geschieht einmal pro Satz: Einen Satz, den Sie später verschieben, lässt die App, wo er ist. Einen gelöschten Satz aus derselben Datei erneut zu importieren, holt ihn auf allen Geräten zurück.

**Das Quellenmenü** (lange auf eine Quelle drücken oder die drei Punkte antippen):

- **Umbenennen / Details bearbeiten** - Titel und Kategorie.
- **In Ordner verschieben**.
- **Exportieren** - lädt genau diese Quelle als JSON herunter. Diese Datei können Sie einem anderen Gerät oder einer anderen Person geben.
- **Archivieren** - nimmt die Quelle aus der Bibliothek, behält aber ihre Fragen. Eine archivierte Quelle nimmt an keinem Test teil, und ihre Wiederholungsuhr **steht still**: Holen Sie sie drei Monate später zurück, sind nicht alle Fragen auf einmal überfällig.
- **Löschen** - entfernt die Quelle und ihre Statistiken. Es ist nicht rückgängig zu machen; exportieren Sie vorher.

**Zusammenführen.** Die Zusammenführen-Option im Quellen-Bildschirm fasst die Fragen der gewählten Quellen in einer neuen Quelle zusammen und entfernt Dubletten. Auch das ist nicht rückgängig zu machen, also exportieren Sie vorher.

**Schafft Archivieren Platz?** Nur bei verbundener GitHub-Synchronisierung: Die Fragen der archivierten Quelle wandern in den Gist und werden vom Gerät entfernt. Ohne Verbindung bleiben die Fragen auf dem Gerät, Archivieren schafft also keinen Platz - dann bietet die App stattdessen "Herunterladen und löschen" an.

**Die Speicherwarnung.** Wenn der Browserspeicher voll wird, erscheint eine Warnung. Sie zeigt keine Prozentzahl, weil Browser die Obergrenze nicht veröffentlichen; stattdessen schätzt sie, wie viele Fragen noch hineinpassen.`
    }
},
{
    id: 'start-test',
    title: { tr: 'Test başlatma ve hızlı test grupları', en: 'Starting a test and quick groups', de: 'Test starten und Schnellgruppen' },
    body: {
tr: `Ana ekranda açık kaynaklarınızı, soru sayısını ve sırayı seçip teste başlarsınız.

**Soru sayısı.** 10, 20, 40 gibi hazır değerler ya da **Tüm Sorular**. Hangi soruların seçileceğine uygulama karar verir: en çok unutmaya yakın olanlar önce gelir.

**Sıralı mod.** Kaynak "sıralı" olarak işaretlenmişse sorular JSON'daki sırayla gelir, karıştırılmaz. Bu modda ayrıca bir **aralık seçici** çıkar: 40 soruluk bir kitapta ilk 10'u çözüp sonraki sefer 11–20'ye geçebilirsiniz. Test bitince aralık kendiliğinden bir blok ilerler ve uygulama size bunu söyler.

**Hızlı test grupları** (ana ekrandaki şimşek düğmesi). Sık kullandığınız kaynak kombinasyonlarını kaydedersiniz: "Sınav haftası" = Anatomi + Fizyoloji + Biyokimya. Gruba dokunmak o kaynakları açar ve sizi teste hazır bırakır.

Grubu düzenlemek için listedeki kalem düğmesine dokunun. Açılan pencerede hem **adını** değiştirebilir, hem de **hangi kaynakların içinde olduğunu** doğrudan seçip çıkarabilirsiniz. Çalışma ortamınızı bu tek ekrandan kurarsınız.

**Etiketten test.** İstatistikler ekranında bir etikete dokunduğunuzda o etiketi taşıyan sorular listelenir; oradan doğrudan test başlatabilirsiniz. Aynı şey arama sonuçları ve filtreler için de geçerli: ekranda gördüğünüz liste neyse, test onunla başlar.`,
en: `From the home screen you pick your active sources, how many questions you want and the order, then start.

**How many questions.** Ready values like 10, 20, 40, or **All questions**. Which questions you get is the app's decision: the ones closest to being forgotten come first.

**Sequential mode.** If a source is marked sequential its questions come in the order they appear in the JSON, unshuffled. That mode also shows a **range picker**: in a 40-question book you can do the first 10 and move to 11-20 next time. When the test ends the range moves on by one block and the app tells you so.

**Quick test groups** (the lightning button on the home screen). Save the source combinations you use often: "Exam week" = Anatomy + Physiology + Biochemistry. Tapping a group switches those sources on and leaves you ready to start.

To edit a group, tap the pencil next to it. The window that opens lets you change **its name** and also pick or remove **which sources are in it**, directly. That is where you build your study set, on one screen.

**Testing from a tag.** Tap a tag on the statistics screen and you get the questions carrying it; you can start a test straight from there. The same is true of search results and filters: whatever list is on screen is what the test starts with.`,
de: `Auf der Startseite wählen Sie Ihre aktiven Quellen, die Fragenzahl und die Reihenfolge und starten dann.

**Wie viele Fragen.** Fertige Werte wie 10, 20, 40 oder **Alle Fragen**. Welche Fragen Sie bekommen, entscheidet die App: Die am nächsten am Vergessen stehen zuerst.

**Sequenzieller Modus.** Ist eine Quelle als sequenziell markiert, kommen ihre Fragen in der Reihenfolge der JSON, ungemischt. In diesem Modus erscheint zusätzlich eine **Bereichsauswahl**: In einem Buch mit 40 Fragen machen Sie die ersten 10 und nächstes Mal 11-20. Nach dem Test rückt der Bereich automatisch einen Block weiter, und die App sagt Ihnen das.

**Schnelltest-Gruppen** (die Blitz-Schaltfläche auf der Startseite). Speichern Sie die Quellenkombinationen, die Sie oft brauchen: "Prüfungswoche" = Anatomie + Physiologie + Biochemie. Ein Tippen auf die Gruppe schaltet diese Quellen ein und macht Sie startbereit.

Zum Bearbeiten tippen Sie auf den Stift neben der Gruppe. Im Fenster können Sie **den Namen** ändern und auch direkt auswählen oder entfernen, **welche Quellen darin sind**. Dort bauen Sie Ihre Lernumgebung auf einem einzigen Bildschirm.

**Test aus einem Schlagwort.** Tippen Sie im Statistik-Bildschirm auf ein Schlagwort, und Sie bekommen die Fragen, die es tragen; von dort starten Sie direkt einen Test. Dasselbe gilt für Suchergebnisse und Filter: Was auf dem Bildschirm steht, ist das, womit der Test beginnt.`
    }
},
{
    id: 'question-types',
    title: { tr: 'Soru tipleri', en: 'Question types', de: 'Fragetypen' },
    body: {
tr: `Yedi tip vardır ve bu küme kapalıdır — yenisi eklenmez.

| Tip | Ne yapar |
|---|---|
| \`single_choice\` | Tek doğru şık. |
| \`multiple_choice\` | Birden fazla doğru şık; hepsini işaretlemeniz gerekir. |
| \`true_false\` | Doğru / Yanlış. |
| \`short_answer\` | Kısa metin yazarsınız. Birden fazla kabul edilebilir cevap tanımlanabilir. |
| \`fill_in_the_blank\` | Cümle içinde boşluk(lar). Metinde \`{{blank}}\` ya da \`{{doğru|eşdeğer}}\` yazarsınız; her boşluk ayrı değerlendirilir. |
| \`flashcard\` | Ön yüz / arka yüz. Kendi kendinizi değerlendirirsiniz. |
| \`reading\` | Soru değil, okuma parçası. Bölüm bölüm okunur; ilerleme sayılır ama doğru/yanlış yoktur. |

**Eski adlar.** \`text\`, \`text_input\` ve \`open_ended\` otomatik olarak \`short_answer\`'a, \`topic_review\` ise \`reading\`'e çevrilir. Eski dosyalarınız çalışmaya devam eder.

**Markdown her yerde.** Soru metni, şıklar ve açıklamalar Markdown destekler: kalın, italik, başlık, liste, kod bloğu, tablo, \`==vurgu==\`. Resim eklemek için soru düzenleyicisindeki medya alanını kullanın.`,
en: `There are seven types, and the set is closed - no new ones are added.

| Type | What it does |
|---|---|
| \`single_choice\` | One correct option. |
| \`multiple_choice\` | Several correct options; you have to mark all of them. |
| \`true_false\` | True / false. |
| \`short_answer\` | You type a short text. Several acceptable answers can be defined. |
| \`fill_in_the_blank\` | Gap(s) in a sentence. Write \`{{blank}}\` or \`{{correct|alternative}}\` in the text; each gap is graded on its own. |
| \`flashcard\` | Front / back. You rate yourself. |
| \`reading\` | Not a question but a passage. Read section by section; progress counts, but there is no right or wrong. |

**Old names.** \`text\`, \`text_input\` and \`open_ended\` map to \`short_answer\`; \`topic_review\` maps to \`reading\`. Your older files keep working.

**Markdown everywhere.** Question text, options and explanations all support Markdown: bold, italic, headings, lists, code blocks, tables, \`==highlight==\`. To add a picture, use the media field in the question editor.`,
de: `Es gibt sieben Typen, und die Menge ist geschlossen - neue kommen nicht dazu.

| Typ | Was er tut |
|---|---|
| \`single_choice\` | Eine richtige Option. |
| \`multiple_choice\` | Mehrere richtige Optionen; Sie müssen alle markieren. |
| \`true_false\` | Richtig / falsch. |
| \`short_answer\` | Sie tippen einen kurzen Text. Mehrere zulässige Antworten sind definierbar. |
| \`fill_in_the_blank\` | Lücke(n) in einem Satz. Schreiben Sie \`{{blank}}\` oder \`{{richtig|alternative}}\` in den Text; jede Lücke wird einzeln bewertet. |
| \`flashcard\` | Vorder- / Rückseite. Sie bewerten sich selbst. |
| \`reading\` | Keine Frage, sondern ein Lesetext. Abschnittsweise zu lesen; der Fortschritt zählt, aber es gibt kein Richtig oder Falsch. |

**Alte Namen.** \`text\`, \`text_input\` und \`open_ended\` werden zu \`short_answer\`, \`topic_review\` wird zu \`reading\`. Ihre älteren Dateien funktionieren weiter.

**Markdown überall.** Fragetext, Optionen und Erklärungen unterstützen Markdown: fett, kursiv, Überschriften, Listen, Codeblöcke, Tabellen, \`==Hervorhebung==\`. Für ein Bild nutzen Sie das Medienfeld im Frageneditor.`
    }
},
{
    id: 'during-test',
    title: { tr: 'Test sırasında', en: 'During a test', de: 'Während eines Tests' },
    body: {
tr: `**Cevaplama.** Şıkkı seçin ve kontrol edin. Cevap işaretlendikten sonra doğru cevap ve varsa açıklama görünür. Yanlış cevaplar test içinde tekrar sorulmaz — sorular baştan seçilir.

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

**Test nasıl biter?** Cevapsız soru kalmadığında test kendini bitirir — ama hemen değil: Zor/Kolay'a basmanız için 1,5 saniye bekler ve o arada herhangi bir şeye dokunmanız beklemeyi iptal eder. Son soruda düğme zaten "Testi Bitir" der. Kasten yarım bıraktığınız test ana ekranda "Devam Et" olarak sizi bekler.`,
en: `**Answering.** Pick an option and check it. Once an answer is checked the correct answer appears, with the explanation if there is one. Wrong answers are not re-asked within the session - the questions are chosen up front.

**Hard / Easy.** These two buttons, which appear after checking, shorten or lengthen the question's review interval. Pressing **Hard** on something you struggled with brings it back sooner. They are optional; without them an ordinary result is recorded.

**The marks in the top bar:**

- **Star** - the ones you want to come back to.
- **Flag** - the ones where you think the question itself is wrong.
- **Note** - your own note on the question. Notes sync, and a progress reset does not delete them.

All three carry **un-marking** too: clear a star on one device and it clears on the other.

**Menu buttons:**

- **Translate** - translates the whole question into your chosen language (needs the internet).
- **AI** - two buttons. The copy button puts the question and the correct answer on the clipboard; the share button hands your chosen prompt out in full (the system share sheet on a phone, the clipboard on a desktop).
- **Read aloud** - speaks the question or the reading section.

**Timers.** Menu - Timer gives you two independent things: a per-question **countdown** (which warns you when time is up) and a **stopwatch**. Both are off by default.

**How a test ends.** When nothing is left unanswered the test finishes itself - but not instantly: it waits 1.5 seconds so you can press Hard or Easy, and touching anything in that beat cancels the wait. On the last question the button already says "Finish test". A test you deliberately leave half-done waits for you on the home screen as "Resume".`,
de: `**Antworten.** Wählen Sie eine Option und prüfen Sie sie. Nach dem Prüfen erscheint die richtige Antwort, mit Erklärung, falls vorhanden. Falsche Antworten werden innerhalb der Sitzung nicht erneut gestellt - die Fragen werden vorab ausgewählt.

**Schwer / Einfach.** Diese beiden Schaltflächen nach dem Prüfen verkürzen oder verlängern das Wiederholungsintervall der Frage. **Schwer** bei etwas, womit Sie gekämpft haben, bringt es früher zurück. Sie sind optional; ohne sie wird ein normales Ergebnis gespeichert.

**Die Markierungen in der oberen Leiste:**

- **Stern** - was Sie sich noch einmal ansehen wollen.
- **Fahne** - wo Sie meinen, dass mit der Frage selbst etwas nicht stimmt.
- **Notiz** - Ihre eigene Notiz zur Frage. Notizen werden synchronisiert, und ein Fortschritts-Reset löscht sie nicht.

Alle drei tragen auch das **Entfernen**: Löschen Sie einen Stern auf einem Gerät, verschwindet er auch auf dem anderen.

**Menü-Schaltflächen:**

- **Übersetzen** - übersetzt die ganze Frage in Ihre gewählte Sprache (braucht Internet).
- **KI** - zwei Schaltflächen. Die Kopieren-Schaltfläche legt Frage und richtige Antwort in die Zwischenablage; die Teilen-Schaltfläche gibt Ihren gewählten Prompt vollständig nach außen (auf dem Telefon das System-Teilen-Fenster, am Desktop die Zwischenablage).
- **Vorlesen** - liest die Frage oder den Leseabschnitt vor.

**Zeitmessung.** Menü - Timer bietet zwei unabhängige Dinge: einen **Countdown** pro Frage (der warnt, wenn die Zeit um ist) und eine **Stoppuhr**. Beide sind standardmäßig aus.

**Wie ein Test endet.** Wenn nichts mehr unbeantwortet ist, beendet sich der Test selbst - aber nicht sofort: Er wartet 1,5 Sekunden, damit Sie Schwer oder Einfach drücken können, und jede Berührung in diesem Moment bricht das Warten ab. Auf der letzten Frage heißt die Schaltfläche ohnehin "Test beenden". Einen absichtlich halb gelassenen Test finden Sie auf der Startseite als "Fortsetzen".`
    }
},
{
    id: 'results',
    title: { tr: 'Sonuç ekranı ve yeniden çözme', en: 'The results screen and retaking', de: 'Ergebnisseite und Wiederholen' },
    body: {
tr: `Test bitince doğru / yanlış / boş sayıları, başarı oranı ve süre görünür. Altında testin bütün soruları listelenir; herhangi birine dokunup cevabı ve açıklamayı yeniden okuyabilirsiniz.

**Yeniden Çöz** düğmesi testin sorularını bir kez daha sorar — özellikle çok hata yaptığınızda, açıklamalar hâlâ aklınızdayken.

Yeniden çözerken, ilk seferde **yanlış** yaptığınız bir soruyu şimdi doğru bilmeniz **tam başarı sayılmaz**. Az önce kaçırdığınız bir soruyu bilmek bir *toparlanma*dır, ilk seferde bilmekle aynı şey değil; uygulama bunu "Zor" olarak kaydeder. Böyle olmasaydı bir soruyu yanlış yapıp hemen ardından doğru yapmak, o soruyu ilk seferde doğru yapmaktan **daha iyi** bir kayıt bırakırdı. İlk seferde doğru bildiğiniz ya da boş bıraktığınız sorular normal değerlendirilir.`,
en: `When a test ends you see correct / wrong / blank counts, the success rate and the elapsed time. Below them every question of the test is listed; tap any of them to read the answer and explanation again.

The **Retake** button asks the test's questions once more - most useful after a lot of misses, while the explanations are still fresh.

In a retake, getting right a question you got **wrong** the first time **does not count as a full success**. Knowing something you missed minutes ago is a *recovery*, not the same event as knowing it first time, and the app records it as "Hard". Without that, missing a question and then getting it right straight after would leave a **better** record than answering it correctly in the first place. Questions you got right or left blank the first time are rated normally.`,
de: `Am Ende eines Tests sehen Sie die Zahlen für richtig / falsch / leer, die Erfolgsquote und die verstrichene Zeit. Darunter sind alle Fragen des Tests aufgelistet; tippen Sie eine an, um Antwort und Erklärung noch einmal zu lesen.

Die Schaltfläche **Wiederholen** stellt die Fragen des Tests noch einmal - besonders nützlich nach vielen Fehlern, solange die Erklärungen noch frisch sind.

Beim Wiederholen zählt eine richtige Antwort auf eine Frage, die Sie beim ersten Mal **falsch** hatten, **nicht als voller Erfolg**. Etwas zu wissen, was Sie vor Minuten verpasst haben, ist eine *Erholung* und nicht dasselbe wie es beim ersten Mal zu wissen; die App verbucht es als "Schwer". Sonst würde eine falsch beantwortete und gleich danach richtig beantwortete Frage einen **besseren** Eintrag hinterlassen als eine, die gleich richtig war. Fragen, die beim ersten Mal richtig oder leer waren, werden normal gewertet.`
    }
},
{
    id: 'question-details',
    title: { tr: 'Soru detayları ve düzenleme', en: 'Question details and editing', de: 'Fragendetails und Bearbeiten' },
    body: {
tr: `İstatistikler listesinden bir soruya dokunduğunuzda **önizleme** ekranı açılır: sorunun tam hali, doğru cevabı, açıklaması, etiketleri, sizin notunuz ve o soruya dair sayılar.

**Oklar.** Önizlemedeki sağ/sol oklar sizi listedeki **bir sonraki** soruya götürür — filtre, arama ve sıralama uygulanmış haliyle. Yani "yıldızlılar arasında gezinmek" tam olarak budur. Ortadaki \`12 / 30\` kaçıncı sırada olduğunuzu söyler.

**Düzenleme.** Kalem düğmesi soru düzenleyicisini açar. Metin, şıklar, doğru cevap, açıklama, zorluk, etiketler ve medya — hepsi buradan değişir.

- **Hızlı biçimlendirme çubuğu**: kalın, italik, başlık, liste, vurgu, kod.
- **Canlı önizleme**: Markdown'ın nasıl görüneceğini yazarken gösterir.
- **Odak modu**: bir metin alanına dokunduğunuzda diğer her şey gizlenir ve alan büyür. Telefonda uzun metin yazmak için. Çıkmak için dışarı dokunun ya da çıkış düğmesini kullanın.
- **Kaydedilmemiş değişiklik**: kaydetmeden çıkmaya kalkarsanız uygulama sorar — Kaydet / Kaydetmeden çık / Vazgeç.
- **Alt taraftaki oklar** düzenleyiciyi kapatmadan bir sonraki soruya geçirir.

Kaydettiğinizde önizleme anında yenilenir; listeye çıkıp geri girmeniz gerekmez.`,
en: `Tapping a question in the statistics list opens the **preview** screen: the full question, its correct answer, the explanation, its tags, your note and its figures.

**The arrows.** The left/right arrows in the preview take you to the **next** question in the list - as filtered, searched and sorted. So "walk through the starred ones" is exactly that. The \`12 / 30\` between them says where you are.

**Editing.** The pencil opens the question editor. Text, options, correct answer, explanation, difficulty, tags and media all change from here.

- **Quick formatting bar**: bold, italic, heading, list, highlight, code.
- **Live preview**: shows how the Markdown will look as you type.
- **Focus mode**: tap a text field and everything else hides while the field grows. For writing long text on a phone. Tap outside or use the exit button to leave.
- **Unsaved changes**: if you try to leave without saving, the app asks - Save / Leave without saving / Cancel.
- **The arrows at the bottom** move to the next question without closing the editor.

When you save, the preview refreshes immediately; you do not have to go out to the list and back in.`,
de: `Wenn Sie in der Statistikliste eine Frage antippen, öffnet sich die **Vorschau**: die vollständige Frage, ihre richtige Antwort, die Erklärung, ihre Schlagwörter, Ihre Notiz und ihre Kennzahlen.

**Die Pfeile.** Die Pfeile links und rechts führen zur **nächsten** Frage in der Liste - so gefiltert, gesucht und sortiert, wie sie ist. "Durch die markierten blättern" ist genau das. Das \`12 / 30\` dazwischen sagt, wo Sie sind.

**Bearbeiten.** Der Stift öffnet den Frageneditor. Text, Optionen, richtige Antwort, Erklärung, Schwierigkeit, Schlagwörter und Medien ändern Sie alle von hier aus.

- **Schnellformatierungsleiste**: fett, kursiv, Überschrift, Liste, Hervorhebung, Code.
- **Live-Vorschau**: zeigt beim Tippen, wie das Markdown aussehen wird.
- **Fokusmodus**: Tippen Sie in ein Textfeld, und alles andere verschwindet, während das Feld wächst. Für lange Texte auf dem Telefon. Tippen Sie daneben oder nutzen Sie die Beenden-Schaltfläche.
- **Ungespeicherte Änderungen**: Wollen Sie ohne Speichern gehen, fragt die App - Speichern / Ohne Speichern verlassen / Abbrechen.
- **Die Pfeile unten** wechseln zur nächsten Frage, ohne den Editor zu schließen.

Beim Speichern aktualisiert sich die Vorschau sofort; Sie müssen nicht zur Liste hinaus und wieder hinein.`
    }
},
{
    id: 'stats',
    title: { tr: 'İstatistikler neyi gösterir', en: 'What the statistics show', de: 'Was die Statistiken zeigen' },
    body: {
tr: `İstatistikler ekranı sorularınızın listesidir; her satır bir soru ve o sorunun durumudur.

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

**Kapsam.** Alttaki çubuk hangi kaynaklara baktığınızı söyler. Başlıktaki **Tüm Kaynaklar** anahtarı kapalıyken kapsam açık kaynaklarınızdır; açtığınızda bütün kütüphanedir. Arama kutusuna \`$KaynakAdı\` yazarak kapsamı doğrudan da adlandırabilirsiniz.

**Arama.** Düz metin soruda arar, \`#etiket\` etikette arar, \`$Kaynak\` kaynağa daraltır.

**Sıralama.** Orijinal sıra, zorluk, başarı yüzdesi ya da hatırlanabilirlik.`,
en: `The statistics screen is a list of your questions; each row is one question and where it stands.

**What is in a row:**

- **✓ / ✗ and a percentage** - how many times you got it right and wrong.
- **Difficulty** - the difficulty the app holds for that question (1-5). Your answers move it.
- **🧠 percentage** - *retrievability*: the chance you would know it if asked right now. Below 90% a question counts as overdue and is prioritised.
- **🔥 / ❄️ number** - how many right or wrong in a row.
- **🎓** - considered learned.
- Star, flag, note and **suspended** badges.

**The filters (the strip at the top):**

| Filter | What it lists |
|---|---|
| All | Every question in scope |
| Recently answered | Past test sessions |
| Answered incorrectly | Everything you have missed at least once |
| Starred / Flagged / With note | The questions you marked |
| **Stuck** | Questions that are stuck - see below |

**Stuck.** Missing a question over and over drives its review interval down to the minimum: it comes back every single day and takes one of that day's slots, while never becoming learned. Questions missed **8 times** that are still not going right collect in this filter.

Each row here has two buttons:

- **Edit** - usually the question is at fault: ambiguous wording, two defensible answers, or a mistake in the answer key. Look here first.
- **Suspend** - the question stops appearing in tests. **No statistic is deleted**, it stays in the list, and you can undo it whenever you like. Suspending is not a punishment; it means "not this one, not now".

**Scope.** The bar at the bottom says which sources you are looking at. With the **All sources** switch in the header off, the scope is your active sources; on, it is the whole library. You can also name a scope directly by typing \`$SourceName\` into the search box.

**Search.** Plain text searches the question, \`#tag\` searches tags, \`$Source\` narrows to a source.

**Sorting.** Original order, difficulty, success rate or retrievability.`,
de: `Der Statistik-Bildschirm ist eine Liste Ihrer Fragen; jede Zeile ist eine Frage und ihr Stand.

**Was in einer Zeile steht:**

- **✓ / ✗ und ein Prozentwert** - wie oft Sie richtig und falsch lagen.
- **Schwierigkeit** - die Schwierigkeit, die die App für diese Frage führt (1-5). Ihre Antworten verschieben sie.
- **🧠 Prozent** - *Abrufbarkeit*: die Wahrscheinlichkeit, dass Sie es jetzt wüssten. Unter 90 % gilt eine Frage als überfällig und wird bevorzugt.
- **🔥 / ❄️ Zahl** - wie viele richtig oder falsch in Folge.
- **🎓** - gilt als gelernt.
- Stern-, Fahnen-, Notiz- und **Ausgesetzt**-Abzeichen.

**Die Filter (die Leiste oben):**

| Filter | Was er auflistet |
|---|---|
| Alle | Jede Frage im Bereich |
| Zuletzt beantwortet | Frühere Testsitzungen |
| Falsch beantwortet | Alles, was Sie mindestens einmal falsch hatten |
| Markiert / Gekennzeichnet / Mit Notiz | Die von Ihnen markierten Fragen |
| **Hängengeblieben** | Festhängende Fragen - siehe unten |

**Hängengeblieben.** Eine Frage immer wieder falsch zu beantworten drückt ihr Wiederholungsintervall auf den Mindestwert: Sie kommt jeden Tag zurück und belegt einen Platz des Tages, wird aber nie gelernt. Fragen, die **8-mal** falsch waren und weiterhin nicht sitzen, sammeln sich in diesem Filter.

Jede Zeile hat hier zwei Schaltflächen:

- **Bearbeiten** - meist liegt es an der Frage: unklare Formulierung, zwei vertretbare Antworten oder ein Fehler im Lösungsschlüssel. Schauen Sie zuerst hier.
- **Aussetzen** - die Frage erscheint nicht mehr in Tests. **Keine Statistik wird gelöscht**, sie bleibt in der Liste, und Sie können es jederzeit rückgängig machen. Aussetzen ist keine Strafe, sondern heißt "diese nicht, jetzt nicht".

**Bereich.** Die Leiste unten sagt, welche Quellen Sie betrachten. Ist der Schalter **Alle Quellen** oben aus, ist der Bereich Ihre aktiven Quellen; ist er an, die ganze Bibliothek. Sie können einen Bereich auch direkt benennen, indem Sie \`$Quellenname\` ins Suchfeld tippen.

**Suche.** Klartext durchsucht die Frage, \`#schlagwort\` die Schlagwörter, \`$Quelle\` grenzt auf eine Quelle ein.

**Sortierung.** Ursprüngliche Reihenfolge, Schwierigkeit, Erfolgsquote oder Abrufbarkeit.`
    }
},
{
    id: 'charts',
    title: { tr: 'Grafikler ve ilerleme paneli', en: 'Charts and the progress panel', de: 'Diagramme und das Fortschrittsfenster' },
    body: {
tr: `**Ana ekran kartları** kütüphanenizi anlatır — arşivlenmemiş her kaynağı.

- **Zorluk dağılımı** — sorularınızın kolay/orta/zor dağılımı.
- **Trend** — son 7 günün günlük soru sayısı. Kartı çevirirseniz aylık görünüme geçer.
- **Isı haritası** — bir yılın çalışma günleri. Koyu gün, çok çalışılmış gün.
- **Sınav hazırlığı** — kaynak başına ortalama hazırlık yüzdesi.

**İlerleme paneli** (kartın üzerindeki büyütme düğmesi) ise **testinizi** anlatır — yalnızca açık kaynakları. Üç grafik vardır ve üçü de aynı kümeyi okur:

- **Genel bakış** — doğru/yanlış/boş dağılımı.
- **Zorluk barı** — soruların zorluğa göre dağılımı.
- **İş yükü** — asıl okunması gereken grafik. Soldan sağa zaman:

  \`−6g … dün │ Gecikmiş · Başlanmamış │ Bugün │ +1g … +6g\`

  **Dolu** = o an geride kaldı (verdiğiniz cevap ya da sizsiz geçip giden tekrar günü). **İçi boş** = hâlâ önünüzde. Renk borcun türünü söyler: kırmızı gecikmiş, mavi hiç başlanmamış, sarı bugün, gri plan.

  Sağ taraftaki gri sütunlar **borç değil plandır** — önümüzdeki günlerde sizi bekleyen normal tekrarlar.

Her grafiğin yanındaki **i** düğmesi o grafiğin ne anlattığını açıklar.

**İncele** düğmesi paneldeki kaynakların sorularını istatistikler ekranında açar.`,
en: `**The home screen cards** describe your library - every source that is not archived.

- **Difficulty spread** - how your questions divide into easy/medium/hard.
- **Trend** - questions per day over the last 7 days. Flip the card for a monthly face.
- **Heatmap** - a year of study days. A dark day is a day you worked a lot.
- **Exam readiness** - the average readiness across your sources.

**The progress panel** (the expand button on the card) describes **your test** instead - only the sources that are switched on. It holds three charts and all three read the same set:

- **Overview** - the right/wrong/blank split.
- **Difficulty bar** - the questions by difficulty.
- **Workload** - the chart actually worth reading. Left to right is time:

  \`−6d … yesterday │ Overdue · Not started │ Today │ +1d … +6d\`

  **Filled** = that moment is behind you (an answer you gave, or a review day that went past without you). **Hollow** = still ahead of you. Colour says what kind of debt: red is overdue, blue is never started, yellow is today, grey is plan.

  The grey columns on the right are **plan, not debt** - the ordinary reviews waiting for you over the coming days.

The **i** button beside each chart explains what that chart says.

The **Inspect** button opens the panel's sources as a question list on the statistics screen.`,
de: `**Die Karten auf der Startseite** beschreiben Ihre Bibliothek - jede nicht archivierte Quelle.

- **Schwierigkeitsverteilung** - wie sich Ihre Fragen auf leicht/mittel/schwer verteilen.
- **Trend** - Fragen pro Tag der letzten 7 Tage. Drehen Sie die Karte für die Monatsansicht.
- **Heatmap** - ein Jahr Lerntage. Ein dunkler Tag ist ein Tag mit viel Arbeit.
- **Prüfungsreife** - die durchschnittliche Reife über Ihre Quellen.

**Das Fortschrittsfenster** (die Vergrößern-Schaltfläche auf der Karte) beschreibt dagegen **Ihren Test** - nur die eingeschalteten Quellen. Es enthält drei Diagramme, und alle drei lesen dieselbe Menge:

- **Überblick** - die Aufteilung richtig/falsch/leer.
- **Schwierigkeitsbalken** - die Fragen nach Schwierigkeit.
- **Arbeitslast** - das Diagramm, das wirklich zu lesen lohnt. Links nach rechts ist Zeit:

  \`−6T … gestern │ Überfällig · Nicht begonnen │ Heute │ +1T … +6T\`

  **Gefüllt** = dieser Moment liegt hinter Ihnen (eine Antwort, die Sie gegeben haben, oder ein Wiederholungstag, der ohne Sie verging). **Hohl** = liegt noch vor Ihnen. Die Farbe sagt die Art der Schuld: Rot ist überfällig, Blau nie begonnen, Gelb heute, Grau Plan.

  Die grauen Säulen rechts sind **Plan, keine Schuld** - die normalen Wiederholungen der kommenden Tage.

Die **i**-Schaltfläche neben jedem Diagramm erklärt, was es aussagt.

Die Schaltfläche **Untersuchen** öffnet die Fragen der Quellen des Fensters als Liste im Statistik-Bildschirm.`
    }
},
{
    id: 'streaks',
    title: { tr: 'Seriler ve dondurma jetonları', en: 'Streaks and freeze tokens', de: 'Serien und Einfrier-Token' },
    body: {
tr: `İki seri vardır ve birbirinden bağımsız çalışırlar.

**Genel Seri.** Kütüphanenizin tamamı için. Bir günü kazanmak için o gün **en az 15 soru** çözmeniz gerekir. Bu sayı sabittir ve ayarlanamaz: hareket eden bir taban taban değildir. 15'ten fazlası sizi ilgilendirir — uygulama fazlasını ne ödüllendirir ne cezalandırır.

**Odak Seri.** Seçtiğiniz **en fazla 3 kaynak** için ayrı bir seri. Kaynakları seçmek için Odak kartındaki dişli düğmesini kullanın; yanındaki "Kaynak Seç" yazısı oraya işaret eder. Odak serisi yalnızca seçtiğiniz kaynaklarda **seçim tarihinden sonra** çözdüğünüz soruları sayar.

**Gün sınırı.** Gün, cihazınızın saatine göre değil, sabit olarak **Europe/Berlin** gecesine göre döner. Sebebi basit: aksi halde farklı saat dilimlerindeki iki cihazınız aynı çalışmayı iki ayrı güne yazar ve bunu hiçbir birleştirme kuralı onaramaz.

**Dondurma jetonları (❄️).** Bir gün kaçırdığınızda seriniz kırılmasın diye harcanan jetonlar.

- Düzenli çalışarak kazanılır; iki kademe vardır.
- Kaçırılan bir gün, siz bir şey yapmadan, açılışta otomatik dondurulur.
- **Donmuş bir gün yeni jeton kazandırmaz** — yoksa dondur/kazan/dondur diye kendini besleyen bir döngü olurdu.
- Genel ve Odak serilerinin kendi jetonları vardır. Biri bitince diğerininkinden ödünç alınabilir, ama önce herkes kendi jetonunu kullanır.
- Odak serisinde **hiç kaynak seçmemişseniz jeton harcanmaz**. Seçilmemiş bir hedef her gün "kaçırılmış" okunur ve bütün jetonlarınızı sessizce yakardı.

**Seriyi Koru** düğmesi o gün için gereken soruları doğrudan bir teste dönüştürür: gecikmişler, birkaç yeni soru ve yaklaşanlar karışık gelir.`,
en: `There are two streaks and they run independently.

**General streak.** For your whole library. To win a day you must answer **at least 15 questions** that day. That number is fixed and cannot be changed: a floor that moves is not a floor. More than 15 is your business - the app neither rewards nor penalises the surplus.

**Focus streak.** A separate streak for **up to 3 sources** of your choosing. Pick them with the gear on the Focus card; the words "Sources" next to it point at exactly that. The focus streak only counts questions you answer in those sources **after** you picked them.

**Where the day ends.** The day turns on a fixed **Europe/Berlin** midnight, not on your device's clock. The reason is simple: otherwise two of your devices in different time zones file the same study session under two different days, and no merge rule can repair that.

**Freeze tokens (❄️).** Tokens spent so that a missed day does not break your streak.

- Earned by studying regularly; there are two tiers.
- A missed day is frozen automatically on the next launch, with nothing for you to do.
- **A frozen day earns no new token** - otherwise freezing and earning would feed each other in a loop.
- The general and focus streaks have their own tokens. One can borrow from the other when it runs out, but each spends its own first.
- If you have **no focus sources selected, no token is spent** on the focus streak. An unset target reads as "missed" every single day and would quietly burn every token you have.

The **Keep the streak** button turns the day's requirement straight into a test: a mix of overdue questions, a few new ones and some coming up.`,
de: `Es gibt zwei Serien, und sie laufen unabhängig voneinander.

**Allgemeine Serie.** Für Ihre ganze Bibliothek. Um einen Tag zu gewinnen, müssen Sie an diesem Tag **mindestens 15 Fragen** beantworten. Diese Zahl ist fest und nicht einstellbar: Eine Untergrenze, die sich bewegt, ist keine. Mehr als 15 ist Ihre Sache - die App belohnt den Überschuss nicht und bestraft ihn auch nicht.

**Fokus-Serie.** Eine eigene Serie für **bis zu 3 selbst gewählte Quellen**. Wählen Sie sie über das Zahnrad auf der Fokus-Karte; die Worte "Quellen" daneben weisen genau darauf hin. Die Fokus-Serie zählt nur Fragen, die Sie in diesen Quellen **nach** der Auswahl beantworten.

**Wo der Tag endet.** Der Tag wechselt zu einer festen Mitternacht in **Europe/Berlin**, nicht nach der Uhr Ihres Geräts. Der Grund ist einfach: Sonst verbuchen zwei Geräte in verschiedenen Zeitzonen dieselbe Lerneinheit auf zwei verschiedene Tage, und keine Merge-Regel kann das reparieren.

**Einfrier-Token (❄️).** Token, die ausgegeben werden, damit ein verpasster Tag Ihre Serie nicht bricht.

- Werden durch regelmäßiges Lernen verdient; es gibt zwei Stufen.
- Ein verpasster Tag wird beim nächsten Start automatisch eingefroren, ohne Ihr Zutun.
- **Ein eingefrorener Tag verdient kein neues Token** - sonst würden Einfrieren und Verdienen einander in einer Schleife füttern.
- Allgemeine und Fokus-Serie haben eigene Token. Eine kann von der anderen borgen, wenn sie leer ist, aber jede gibt zuerst ihre eigenen aus.
- Haben Sie **keine Fokus-Quellen ausgewählt, wird kein Token ausgegeben**. Ein nicht gesetztes Ziel liest sich jeden Tag als "verpasst" und hätte still jedes Ihrer Token verbrannt.

Die Schaltfläche **Serie halten** verwandelt das Tagespensum direkt in einen Test: eine Mischung aus überfälligen Fragen, ein paar neuen und einigen, die anstehen.`
    }
},
{
    id: 'algorithm',
    title: { tr: 'Tekrar algoritması nasıl karar verir', en: 'How the review algorithm decides', de: 'Wie der Wiederholungsalgorithmus entscheidet' },
    body: {
tr: `Uygulama **FSRS** adlı bir aralıklı tekrar algoritması kullanır (Anki'nin de kullandığı ailenin modern üyesi). Her soru için iki sayı tutar:

- **Kararlılık** — o bilgiyi ne kadar süre hatırlayacağınızın gün cinsinden tahmini.
- **Zorluk** — sorunun sizin için ne kadar zor olduğu.

Bu ikisinden **hatırlanabilirlik** çıkar: \`R = 0.9 ^ (geçen gün / kararlılık)\`. \`R\` %90'ın altına düştüğünde soru "gecikmiş" olur — yani vadesi tam olarak **son tekrar + kararlılık** günüdür.

**Ne değiştirir:**

- **Doğru cevap** kararlılığı artırır; aralık uzar.
- **Yanlış cevap** kararlılığı düşürür; soru yakında geri gelir.
- **Zor** düğmesi aralığı kısar, **Kolay** uzatır.
- JSON'daki \`difficulty\` yalnızca **başlangıç** tahminini verir.

**Öğrenilmiş** işareti (🎓) üst üste 5 doğru ya da 30 günü aşan bir kararlılık demektir. Bir yanlış cevap bu işareti kaldırır.

Bunların hiçbirini elle ayarlamanız gerekmez ve bir ayar da yoktur. Tek müdahaleniz Zor/Kolay düğmeleri ve — gerçekten takılan sorular için — askıya almadır.`,
en: `The app uses a spaced-repetition algorithm called **FSRS** (the modern member of the family Anki also uses). For every question it keeps two numbers:

- **Stability** - an estimate, in days, of how long you will remember it.
- **Difficulty** - how hard that question is for you.

Those two give **retrievability**: \`R = 0.9 ^ (days elapsed / stability)\`. When \`R\` falls below 90% the question is overdue - which means its due date is exactly **last review + stability** days.

**What moves them:**

- **A right answer** raises stability; the interval grows.
- **A wrong answer** lowers it; the question comes back soon.
- The **Hard** button shortens the interval, **Easy** lengthens it.
- \`difficulty\` in the JSON only supplies the **initial** estimate.

The **learned** mark (🎓) means five right in a row or a stability past 30 days. One wrong answer clears it.

You never have to tune any of this, and there is no setting for it. Your only inputs are the Hard/Easy buttons and - for questions that really are stuck - suspending.`,
de: `Die App verwendet einen Algorithmus für verteiltes Wiederholen namens **FSRS** (das moderne Mitglied der Familie, die auch Anki nutzt). Für jede Frage führt sie zwei Zahlen:

- **Stabilität** - eine Schätzung in Tagen, wie lange Sie es behalten werden.
- **Schwierigkeit** - wie schwer diese Frage für Sie ist.

Daraus ergibt sich die **Abrufbarkeit**: \`R = 0.9 ^ (vergangene Tage / Stabilität)\`. Fällt \`R\` unter 90 %, ist die Frage überfällig - ihr Fälligkeitstag ist also genau **letzte Wiederholung + Stabilität** Tage.

**Was sie bewegt:**

- **Eine richtige Antwort** hebt die Stabilität; das Intervall wächst.
- **Eine falsche Antwort** senkt sie; die Frage kommt bald zurück.
- Die Schaltfläche **Schwer** verkürzt das Intervall, **Einfach** verlängert es.
- \`difficulty\` in der JSON liefert nur die **anfängliche** Schätzung.

Die Markierung **gelernt** (🎓) bedeutet fünf richtige in Folge oder eine Stabilität über 30 Tage. Eine falsche Antwort löscht sie.

Sie müssen davon nichts einstellen, und es gibt auch keine Einstellung dafür. Ihre einzigen Eingriffe sind die Schaltflächen Schwer/Einfach und - für wirklich festhängende Fragen - das Aussetzen.`
    }
},
{
    id: 'sync',
    title: { tr: 'Senkronizasyon ve yedekleme', en: 'Syncing and backups', de: 'Synchronisierung und Sicherung' },
    body: {
tr: `İki ayrı şey vardır: **senkronizasyon** (cihazlar arası, sürekli) ve **yedek** (tek dosya, elle).

### GitHub senkronizasyonu

Verileriniz sizin GitHub hesabınızdaki gizli bir **Gist**'te tutulur. Bizim sunucumuz yoktur; veriniz bize hiç uğramaz.

**Kurulum:**

1. GitHub'da bir **Personal Access Token** oluşturun. Tek gereken yetki \`gist\`.
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

Yeni bir cihaza geçerken ya da riskli bir şey yapmadan önce (kaynak silme, birleştirme, sıfırlama) bir yedek alın. Yedek dosyası hiçbir yere gönderilmez; sizde kalır.`,
en: `There are two separate things: **syncing** (between devices, continuous) and a **backup** (one file, manual).

### GitHub sync

Your data lives in a secret **Gist** in your own GitHub account. There is no server of ours; your data never passes through us.

**Setting it up:**

1. Create a **Personal Access Token** on GitHub. The only scope it needs is \`gist\`.
2. Enter the token under Menu - Backup.
3. On the first connection the app creates the Gist itself.

**How it works:**

- Changes are pushed up after every answer.
- They are pulled down when the app comes to the foreground (returning to the tab, unlocking the phone) - no more often than once every 30 seconds.
- **A pull is deferred while you are in a test**, or the questions would change under you.
- Half-finished tests sync too: start on the phone, carry on at the computer.
- When two devices disagree the app merges rather than overwrites. Study the same day on both and the two are **added together**.

**The sync badge in the menu** shows the state: fine, a network problem, or a token problem. If failures pile up the badge says so.

### Manual backup

Menu - Backup - **Export** downloads a single JSON file. It holds your sources, folders, all your statistics, your **daily study history**, your streak settings, your tokens and your quick test groups.

**Import** restores that file. It writes over what is there and reloads the page, so it asks for confirmation first.

Take a backup when you move to a new device, and before anything risky (deleting a source, merging, resetting). The backup file goes nowhere; it stays with you.`,
de: `Es gibt zwei verschiedene Dinge: **Synchronisierung** (zwischen Geräten, laufend) und eine **Sicherung** (eine Datei, manuell).

### GitHub-Synchronisierung

Ihre Daten liegen in einem geheimen **Gist** in Ihrem eigenen GitHub-Konto. Es gibt keinen Server von uns; Ihre Daten laufen nie über uns.

**Einrichtung:**

1. Erstellen Sie auf GitHub ein **Personal Access Token**. Der einzige nötige Bereich ist \`gist\`.
2. Tragen Sie das Token unter Menü - Sicherung ein.
3. Bei der ersten Verbindung legt die App den Gist selbst an.

**Wie es funktioniert:**

- Änderungen werden nach jeder Antwort hochgeschickt.
- Heruntergeholt wird, wenn die App in den Vordergrund kommt (Rückkehr zum Tab, Entsperren des Telefons) - höchstens alle 30 Sekunden.
- **Während eines Tests wird das Herunterholen aufgeschoben**, sonst würden sich die Fragen unter Ihnen ändern.
- Auch halbfertige Tests werden synchronisiert: auf dem Telefon anfangen, am Rechner weitermachen.
- Sind zwei Geräte uneins, führt die App zusammen, statt zu überschreiben. Lernen Sie denselben Tag auf beiden, werden beide **addiert**.

**Das Sync-Abzeichen im Menü** zeigt den Zustand: in Ordnung, ein Netzwerkproblem oder ein Token-Problem. Häufen sich Fehler, sagt das Abzeichen es.

### Manuelle Sicherung

Menü - Sicherung - **Exportieren** lädt eine einzelne JSON-Datei herunter. Sie enthält Ihre Quellen, Ordner, alle Statistiken, Ihren **täglichen Lernverlauf**, Ihre Serieneinstellungen, Ihre Token und Ihre Schnelltest-Gruppen.

**Importieren** stellt diese Datei wieder her. Es überschreibt das Vorhandene und lädt die Seite neu, fragt also vorher nach.

Machen Sie eine Sicherung, wenn Sie auf ein neues Gerät wechseln, und vor allem Riskanten (Quelle löschen, zusammenführen, zurücksetzen). Die Sicherungsdatei geht nirgendwohin; sie bleibt bei Ihnen.`
    }
},
{
    id: 'ai',
    title: { tr: 'Yapay zekâ ile kullanım', en: 'Working with an AI', de: 'Arbeiten mit einer KI' },
    body: {
tr: `Uygulamanın içinde yapay zekâ **çalışmaz**. Bunun yerine dışarıdaki bir yapay zekâya göndereceğiniz metni hazırlar. Anahtar vermezsiniz, ücret ödemezsiniz, arka planda hiçbir yere veri gitmez — ne gönderdiğinize siz karar verirsiniz.

**Soru üretme.** Çoğu kişi kaynaklarını böyle oluşturur: bir yapay zekâya ders notlarınızı verip yukarıdaki JSON biçiminde soru üretmesini istersiniz, çıkan metni Kaynaklar ekranına yapıştırırsınız. \`difficulty\` alanını doldurmasını istemek işe yarar — algoritmanın başlangıç tahminini iyileştirir.

**Prompt kütüphanesi.** Menü → Yapay Zekâ bölümünden kendi promptlarınızı yazıp saklarsınız. Üç hazır prompt gelir: soruyu denetlet, konuyu anlattır, kendi cevabını değerlendirt.

Promptlarda kullanabileceğiniz değişkenler:

| Değişken | Yerine geçen |
|---|---|
| \`{question}\` | Sorunun metni |
| \`{options}\` | Şıklar |
| \`{correct}\` | Doğru cevap |
| \`{answer}\` | Sizin verdiğiniz cevap |
| \`{source}\` | Kaynağın adı |
| \`{explanation}\` | Açıklama |

**Karşılığı olmayan değişken satırı düşürür.** Şıksız bir soruda \`{options}\` içeren satır hiç yazılmaz — yapay zekâya hiçbir şey söylemeyen boş bir "Şıklar:" satırı göndermenin anlamı yok.

**Sağlayıcı listesi.** Sık kullandığınız yapay zekâların adreslerini \`{PROMPT}\` yer tutucusuyla kaydedebilirsiniz; tek dokunuşla prompt doldurulmuş olarak açılır. Bu liste cihaza özeldir, senkronize edilmez.

**AI Bağla (isteğe bağlı).** Menü → Yapay Zekâ → **AI Bağla** ile bu bilgisayarda çalışan bir modeli (Ollama, LM Studio veya yerel bir proxy üzerinden OpenAI uyumlu bir adres) doğrudan bağlayabilirsiniz; e-Reader'daki öz ve kavram düğmeleri o zaman cevabı uygulama içinde gösterir. Adres ve model girilir, **Bağlantıyı test et** ile denenir. Tarayıcının erişebilmesi için sunucunun CORS izni olmalıdır (Ollama: \`OLLAMA_ORIGINS\`) ya da araya yerel bir proxy konur. Bağlantı yalnızca bu cihazda saklanır. Bulut AI bağlantısı yakında.

**Bu rehber de bir referanstır.** Uygulamanın kullanımına dair bir yapay zekâya soru soracaksanız, rehberin tamamı depoda \`docs/USER_GUIDE.md\` olarak durur; ona verip sorularınızı sorabilirsiniz.`,
en: `There is **no AI running inside** the app. Instead it prepares the text you will send to an AI outside it. You provide no key, you pay nothing, and nothing goes anywhere in the background - you decide what is sent.

**Generating questions.** This is how most people build their sources: give an AI your notes, ask for questions in the JSON format above, and paste the result into the Sources screen. Asking it to fill in \`difficulty\` is worth doing - it improves the algorithm's starting estimate.

**The prompt library.** Menu - AI lets you write and keep your own prompts. Three come ready: have the question audited, have the topic explained, have your own answer assessed.

The variables you can use in a prompt:

| Variable | Stands for |
|---|---|
| \`{question}\` | The question text |
| \`{options}\` | The options |
| \`{correct}\` | The correct answer |
| \`{answer}\` | The answer you gave |
| \`{source}\` | The source name |
| \`{explanation}\` | The explanation |

**A variable with nothing behind it drops its line.** On a question with no options, the line containing \`{options}\` is not written at all - there is no point sending an AI an empty "Options:" that tells it nothing.

**The provider list.** Save the addresses of the AIs you use with a \`{PROMPT}\` placeholder, and one tap opens them with the prompt already filled in. That list is per device and is not synced.

**Connect AI (optional).** Menu - AI - **Connect AI** connects a model running on this computer (Ollama, LM Studio, or any OpenAI-compatible address, e.g. a local proxy); the e-Reader's core idea and concepts buttons then answer inside the app. Enter the address and the model and try it with **Test connection**. For the browser to reach it the server must allow CORS (Ollama: \`OLLAMA_ORIGINS\`), or a local proxy sits in front of it. The connection is kept on this device only. Cloud AI connections are coming soon.

**This guide is a reference too.** If you want to ask an AI how to use the app, the whole guide sits in the repository as \`docs/USER_GUIDE.md\`; hand it over and ask away.`,
de: `In der App läuft **keine KI**. Stattdessen bereitet sie den Text vor, den Sie an eine KI außerhalb schicken. Sie geben keinen Schlüssel an, zahlen nichts, und im Hintergrund geht nichts irgendwohin - Sie entscheiden, was gesendet wird.

**Fragen erzeugen.** So bauen die meisten ihre Quellen auf: Geben Sie einer KI Ihre Notizen, bitten Sie um Fragen im obigen JSON-Format und fügen Sie das Ergebnis im Quellen-Bildschirm ein. Sie um das Feld \`difficulty\` zu bitten, lohnt sich - es verbessert die Startschätzung des Algorithmus.

**Die Prompt-Bibliothek.** Unter Menü - KI schreiben und speichern Sie eigene Prompts. Drei sind fertig dabei: die Frage prüfen lassen, das Thema erklären lassen, die eigene Antwort bewerten lassen.

Die Variablen, die Sie in einem Prompt verwenden können:

| Variable | Steht für |
|---|---|
| \`{question}\` | Der Fragetext |
| \`{options}\` | Die Optionen |
| \`{correct}\` | Die richtige Antwort |
| \`{answer}\` | Ihre gegebene Antwort |
| \`{source}\` | Der Quellenname |
| \`{explanation}\` | Die Erklärung |

**Eine Variable ohne Inhalt lässt ihre Zeile weg.** Bei einer Frage ohne Optionen wird die Zeile mit \`{options}\` gar nicht geschrieben - es bringt nichts, einer KI ein leeres "Optionen:" zu schicken, das ihr nichts sagt.

**Die Anbieterliste.** Speichern Sie die Adressen der KIs, die Sie nutzen, mit einem \`{PROMPT}\`-Platzhalter; ein Tippen öffnet sie mit bereits eingesetztem Prompt. Diese Liste ist gerätespezifisch und wird nicht synchronisiert.

**KI verbinden (optional).** Unter Menü - KI - **KI verbinden** verbinden Sie ein Modell, das auf diesem Computer läuft (Ollama, LM Studio oder eine OpenAI-kompatible Adresse, z. B. ein lokaler Proxy); die Schaltflächen Kern und Begriffe im e-Reader antworten dann in der App. Adresse und Modell eintragen und mit **Verbindung testen** prüfen. Damit der Browser den Server erreicht, muss dieser CORS erlauben (Ollama: \`OLLAMA_ORIGINS\`) oder ein lokaler Proxy davorstehen. Die Verbindung wird nur auf diesem Gerät gespeichert. Cloud-KI folgt demnächst.

**Auch dieses Handbuch ist eine Referenz.** Wenn Sie eine KI zur Bedienung der App befragen wollen: Das ganze Handbuch liegt im Repository als \`docs/USER_GUIDE.md\`; geben Sie es ihr und fragen Sie.`
    }
},
{
    id: 'settings',
    title: { tr: 'Menü ve ayarlar', en: 'The menu and settings', de: 'Menü und Einstellungen' },
    body: {
tr: `Menü (sağ üstteki düğme) bölüm bölüm açılır.

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

**Hangi ayarlar senkronize olur?** Dil, çeviri hedefi, sesli okuma ayarları, sayaç ayarları ve prompt seçiminiz cihazlar arasında taşınır. **Yapay zekâ sağlayıcı listesi** ve **tema** cihaza özeldir.`,
en: `The menu (the button at the top right) opens section by section.

- **Backup** - export/import and GitHub sync.
- **AI** - the prompt library and the provider list.
- **Timer** - per-question countdown and stopwatch; both optional.
- **Translation** - turn translation on or off and choose the target language (10 available).
- **Text-to-speech** - voice, speed and automatic reading.
- **Home screen** - which cards are shown.
- **Notifications** - two independent channels: a general streak reminder (morning) and a focus streak reminder (evening). You can set quiet hours. Notifications are produced on your device; there is no server.
- **Language** - interface language: Turkish, English, German.
- **Theme** - light / dark.

**The in-page mark buttons** (star, flag, note, translate all, copy the AI prompt) appear in the menu on the test and preview screens.

**Delete sources** is at the bottom of the menu and cannot be undone. It has two levels: reset progress only (sources stay) and delete everything. Both keep your prompts and your quick test groups - those are not a record of something you studied but tools you wrote.

**Which settings sync?** Language, translation target, text-to-speech settings, timer settings and your prompt selection travel between devices. The **AI provider list** and the **theme** are per device.`,
de: `Das Menü (die Schaltfläche oben rechts) öffnet sich Abschnitt für Abschnitt.

- **Sicherung** - Export/Import und GitHub-Synchronisierung.
- **KI** - die Prompt-Bibliothek und die Anbieterliste.
- **Timer** - Countdown pro Frage und Stoppuhr; beide optional.
- **Übersetzung** - Übersetzung ein- oder ausschalten und die Zielsprache wählen (10 verfügbar).
- **Vorlesen** - Stimme, Tempo und automatisches Vorlesen.
- **Startseite** - welche Karten angezeigt werden.
- **Benachrichtigungen** - zwei unabhängige Kanäle: eine Erinnerung für die allgemeine Serie (morgens) und eine für die Fokus-Serie (abends). Ruhezeiten sind einstellbar. Benachrichtigungen entstehen auf Ihrem Gerät; es gibt keinen Server.
- **Sprache** - Oberflächensprache: Türkisch, Englisch, Deutsch.
- **Design** - hell / dunkel.

**Die Markierungs-Schaltflächen** (Stern, Fahne, Notiz, alles übersetzen, KI-Prompt kopieren) erscheinen im Menü auf dem Test- und dem Vorschau-Bildschirm.

**Quellen löschen** steht ganz unten im Menü und ist nicht rückgängig zu machen. Es hat zwei Stufen: nur den Fortschritt zurücksetzen (Quellen bleiben) und alles löschen. Beide behalten Ihre Prompts und Ihre Schnelltest-Gruppen - das ist keine Aufzeichnung von Gelerntem, sondern Werkzeug, das Sie geschrieben haben.

**Welche Einstellungen werden synchronisiert?** Sprache, Übersetzungsziel, Vorlese-Einstellungen, Timer-Einstellungen und Ihre Prompt-Auswahl reisen zwischen den Geräten. Die **KI-Anbieterliste** und das **Design** sind gerätespezifisch.`
    }
},
{
    id: 'ereader',
    title: { tr: 'e-Reader ve Kitaplar', en: 'e-Reader and Books', de: 'e-Reader und Bücher' },
    body: {
tr: `e-Reader, uzun çalışma metinlerini, PDF'leri, EPUB kitapları ve dokümantasyonları dikkat dağıtıcı unsurlardan arınmış biçimde, tek bir akış hâlinde kaydırarak okumanızı sağlar. Üst başlık her zaman **e-Reader** yazar.

**Kitap ekleme ve AI promptu.** Bir kaynağı e-Reader'a dönüştürmek için harici AI modellerine (ChatGPT, Claude, Gemini vb.) \`EREADER_AI_PROMPT.md\` yönergesi verilir. Elde edilen standart JSON verisi panodan yapıştırılarak veya dosya seçilerek kütüphaneye eklenir. Kitap eklendikten sonra doğrudan tarayıcının IndexedDB alanında saklanır.

**Parçalı üretim ve birleştirme.** Büyük kitaplar AI bağlam sınırlarına takılmadan parça parça üretilebilir (\`part: { from: 1, to: 20, ... }\`). Aynı kitap anahtarına (\`book_key\`) sahip parçalar otomatik olarak tespit edilir veya kütüphane başlığındaki **Parçaları birleştir** düğmesiyle tek bir kitapta birleştirilebilir. Parçalar arasında eksik sayfa/bölüm varsa içindekiler tablosunda boşluk uyarısı gösterilir ve kitap menüsünden sonraki parçanın promptu tek tıkla panoya kopyalanabilir.

**Görsel desteği ve bağlantı ekleme.** Kitap metinlerinde güvenli \`https://\` bağlantılı Markdown görselleri görüntülenir. \`placeholder:id\` veya dosya ekleri yer tutucu kartı olarak çizilir; yer tutucuya dokunarak gerçek bir \`https://\` görsel bağlantısı tanımlayabilirsiniz. Güvenlik ve veri tasarrufu nedeniyle ham görsel verisi cihazda depolanmaz veya senkronlanmaz.

**Okuma.** Kitap sayfalara bölünmez; baştan sona tek bir akışta kaydırılır. Çok uzun kitaplarda da akıcı kalması için yalnızca ekranın çevresindeki bölümler yüklenir, uzaklaşanlar boşaltılır — okuduğunuz satır kaymaz. Sağ alttaki **yukarı** düğmesi okuduğunuz bölümün başlığına, oradaysanız bir önceki başlığa gider; **Ctrl+tık** (mobilde uzun basış) kitabın başına götürür. Okuma konumu kendiliğinden kaydedilir; üstteki **yer imi** düğmesi konumu anında kaydeder. Kitaptayken üstteki ev düğmesi kütüphaneye döner.

**Üst araçlar.** **Aa+** düğmesi her basışta yazı boyutunu küçük → normal → büyük arasında değiştirir; yalnızca okuma alanı değişir. **Ara** düğmesi (veya Ctrl+K, Ctrl+F, "/") ekranı karartıp odaklı bir arama açar: ↑/↓ ile sonuç seçilir, Enter ile gidilir, Esc ile kapanır. Tam ekran düğmesi masaüstündedir.

**Yan menü.** Yalnızca **İçindekiler** ve **Ayarlar** vardır; menü her açıldığında İçindekiler açık gelir. İçindekilerde önce ana başlıklar görünür; bir başlığa dokunmak alt başlıklarını açar ve oraya kaydırır, menü açık kalır (okuma alanına dokununca kapanır). Ayarlar'da yazdırma/PDF ve tüm kitapları etkileyen **e-Reader'ı Sıfırla** bulunur.

**Paragraf araçları.** Her paragrafın sonunda (masaüstünde üzerine gelince, mobilde paragrafa dokununca) dört küçük düğme belirir: **dinle** (kitabın dilinde), **öz & temel mantık**, **kavram & terimler** (B1) ve **çevir**. Sonuç, paragrafın hemen altındaki tek bir kutuda açılır; kutuda Kopyala, Yeniden dene ve Gizle vardır. Öz ve kavramlar bir yapay zekâ ister: bağlı bir AI varsa cevap kutuda gelir, yoksa kutu promptu kopyalamayı, bir AI sayfasında açmayı veya **AI Bağla**'yı önerir.

**Kütüphane.** Kitaplar klasörlere ayrılabilir, tutamacından sürüklenerek sıralanabilir veya bir klasör başlığına bırakılarak taşınabilir. Klasör menüsündeki **Kitapları seç** ile birden çok kitap seçilip birlikte taşınabilir, arşivlenebilir, sıfırlanabilir veya silinebilir. Her kitabın işlem menüsünde klasöre taşıma, meta verileri düzenleme, indirme, paylaşma, yazdırma, arşivleme, silme ve okuma konumunu sıfırlama vardır. Arşivlenen kitaplar kütüphaneden çıkar, arşiv düğmesiyle görülür.

**Senkronizasyon.** GitHub Gist senkronizasyonunuz etkinse kitaplarınız, okuma konumunuz ve kütüphane düzeniniz (klasörler, sıra, arşiv) cihazlarınız arasında arka planda senkronize edilir. Kitapları taşımak veya sıralamak kitapların kendisini yeniden yüklemez.

**e-Reader'ı sıfırlama.** Yan menüde **Ayarlar → e-Reader'ı Sıfırla** ile okuma ilerlemenizi sıfırlayabilir veya tüm kitapları silebilirsiniz; tek bir kitabın konumu kendi işlem menüsünden sıfırlanır. Bu işlem sınav/test verilerinize, FSRS istatistiklerinize veya kaynaklarınıza kesinlikle dokunmaz.`,
en: `The e-Reader lets you read long study materials, PDFs, EPUB books and documentation as one continuous, distraction-free scroll. The header always reads **e-Reader**.

**Adding books and the AI prompt.** To convert any material into e-Reader format, provide the \`EREADER_AI_PROMPT.md\` instructions to an external AI (ChatGPT, Claude, Gemini, etc.). The resulting standard JSON can be imported from clipboard or file. Books are stored directly in your browser's IndexedDB.

**Multi-part generation and merging.** Large books can be produced in parts without running into AI context limits (\`part: { from: 1, to: 20, ... }\`). Parts sharing the same \`book_key\` are detected automatically or can be combined into a single book via the **Merge parts** button in the library header. If any range is missing between parts, a gap warning appears in the contents list, and you can copy the prompt for the next part from the book actions menu.

**Image support and URL placeholders.** Markdown images with secure \`https://\` URLs are rendered inline. Images specified with \`placeholder:id\` or file links appear as interactive placeholder cards; tap a placeholder to assign an \`https://\` image URL directly. For data economy and privacy, raw image binaries are never stored or synced.

**Reading.** A book is not split into pages; it scrolls from start to end in one flow. To stay smooth on very long books only the sections around the screen are loaded and far ones are emptied - the line you are reading does not move. The **up** button at the bottom right goes to the heading of the section you are in, or to the previous heading when you are already on one; **Ctrl+click** (a long press on a phone) goes to the start of the book. The reading position is saved by itself; the **bookmark** button in the header saves it at once. In a book, the header's home button goes back to the library.

**Header tools.** **Aa+** switches the text size small -> normal -> large on each press; only the reading area changes. **Search** (or Ctrl+K, Ctrl+F, "/") dims the page and opens a focused search: Up/Down pick a match, Enter goes there, Esc closes. Fullscreen is offered on desktop.

**Side menu.** It holds only **Contents** and **Settings**; Contents is open every time the menu opens. Contents first shows the chapters; tapping one opens its subheadings and scrolls there, and the menu stays open (a tap on the text closes it). Settings holds print/PDF and **Reset e-Reader**, which affects every book.

**Paragraph tools.** At the end of every paragraph (on hover on a desktop, after a tap on a phone) four small buttons appear: **listen** (in the book's language), **core idea & logic**, **concepts & terms** (B1) and **translate**. The result opens in one box right under the paragraph, with Copy, Retry and Hide. Core idea and concepts need an AI: with a connected AI the answer arrives in the box; without one the box offers to copy the prompt, open it on an AI page, or **Connect AI**.

**Library.** Books can be sorted into folders, reordered by dragging their grip, or moved by dropping them on a folder header. **Select books** in a folder's menu lets you move, archive, reset or delete several books at once. Each book's actions menu offers move to folder, edit metadata, download, share, print, archive, delete and reset reading position. Archived books leave the library and are listed behind the archive button.

**Synchronization.** With GitHub Gist sync configured, your books, reading positions and library organisation (folders, order, archive) sync between your devices in the background. Moving or reordering books does not upload the books again.

**Resetting e-Reader.** **Settings -> Reset e-Reader** in the side menu resets reading positions or deletes all books; one book's position is reset from its own actions menu. This never affects your exam/test progress, FSRS history, or regular study sources.`,
de: `Der e-Reader ermöglicht das ablenkungsfreie Lesen umfangreicher Lernmaterialien, PDFs, EPUB-Bücher und Dokumentationen in einem durchgehenden Bildlauf. Die Kopfzeile zeigt immer **e-Reader**.

**Bücher hinzufügen und der KI-Prompt.** Um ein Dokument in das e-Reader-Format umzuwandeln, übergeben Sie die Anweisungen aus \`EREADER_AI_PROMPT.md\` an eine externe KI (ChatGPT, Claude, Gemini usw.). Die standardisierte JSON-Ausgabe kann über die Zwischenablage oder als Datei importiert werden. Bücher werden direkt im IndexedDB-Speicher des Browsers abgelegt.

**Mehrteilige Erstellung und Zusammenführung.** Umfangreiche Werke können in mehreren Abschnitten generiert werden, ohne das Kontextfenster der KI zu überlasten (\`part: { from: 1, to: 20, ... }\`). Teile mit identischem \`book_key\` werden erkannt und können über die Schaltfläche **Teile zusammenführen** in der Bibliotheksleiste vereint werden. Fehlende Bereiche werden im Inhaltsverzeichnis als Lücken markiert, und der Prompt für den nächsten Teil lässt sich direkt kopieren.

**Bilder und Platzhalter-URLs.** Markdown-Bilder mit sicheren \`https://\`-URLs werden direkt dargestellt. Lokale Verweise oder \`placeholder:id\` erscheinen als Platzhalter-Karten; durch Antippen kann eine \`https://\`-Bild-URL hinterlegt werden. Aus Speicher- und Datenschutzgründen werden keine Bild-Binärdaten gespeichert oder synchronisiert.

**Lesen.** Ein Buch wird nicht in Seiten geteilt, sondern von Anfang bis Ende durchgehend gescrollt. Damit auch sehr lange Bücher flüssig bleiben, werden nur die Abschnitte um den Bildschirm geladen und entfernte geleert - die Zeile, die Sie lesen, verrutscht nicht. Die **Nach-oben**-Schaltfläche unten rechts springt zur Überschrift des aktuellen Abschnitts bzw. zur vorherigen; **Strg+Klick** (auf dem Handy langes Drücken) springt zum Buchanfang. Die Leseposition wird automatisch gespeichert; das **Lesezeichen** in der Kopfzeile speichert sie sofort. Im Buch führt die Home-Schaltfläche zurück zur Bibliothek.

**Werkzeuge in der Kopfzeile.** **Aa+** wechselt bei jedem Druck die Textgröße klein -> normal -> groß; nur der Lesebereich ändert sich. **Suche** (oder Strg+K, Strg+F, "/") dunkelt die Seite ab und öffnet eine fokussierte Suche: Pfeil hoch/runter wählt einen Treffer, Enter springt hin, Esc schließt. Vollbild gibt es am Desktop.

**Seitenmenü.** Es enthält nur **Inhalt** und **Einstellungen**; beim Öffnen ist immer der Inhalt aufgeklappt. Zunächst stehen dort die Kapitel; ein Tipp öffnet die Unterüberschriften und scrollt dorthin, das Menü bleibt offen (ein Tipp auf den Text schließt es). Unter Einstellungen finden Sie Drucken/PDF und **e-Reader zurücksetzen**, das alle Bücher betrifft.

**Absatz-Werkzeuge.** Am Ende jedes Absatzes (am Desktop beim Überfahren, am Handy nach einem Tipp) erscheinen vier kleine Schaltflächen: **anhören** (in der Sprache des Buchs), **Kern & Logik**, **Begriffe & Fachwörter** (B1) und **übersetzen**. Das Ergebnis öffnet sich in einem Kasten direkt unter dem Absatz, mit Kopieren, Erneut versuchen und Ausblenden. Kern und Begriffe brauchen eine KI: Ist eine KI verbunden, kommt die Antwort in den Kasten; sonst bietet der Kasten an, den Prompt zu kopieren, ihn auf einer KI-Seite zu öffnen oder **KI verbinden**.

**Bibliothek.** Bücher lassen sich in Ordner einteilen, am Griff ziehend sortieren oder durch Ablegen auf einer Ordnerzeile verschieben. **Bücher auswählen** im Ordnermenü verschiebt, archiviert, setzt zurück oder löscht mehrere Bücher auf einmal. Das Aktionsmenü jedes Buchs bietet: in Ordner verschieben, Metadaten bearbeiten, herunterladen, teilen, drucken, archivieren, löschen und Leseposition zurücksetzen. Archivierte Bücher verlassen die Bibliothek und stehen hinter der Archiv-Schaltfläche.

**Synchronisierung.** Bei aktivierter GitHub-Gist-Synchronisierung werden Bücher, Lesestände und die Ordnung der Bibliothek (Ordner, Reihenfolge, Archiv) im Hintergrund zwischen Geräten abgeglichen. Verschieben oder Sortieren lädt die Bücher nicht erneut hoch.

**e-Reader zurücksetzen.** Über **Einstellungen -> e-Reader zurücksetzen** im Seitenmenü können Sie Lesestände leeren oder alle Bücher löschen; die Position eines einzelnen Buchs setzen Sie in dessen Aktionsmenü zurück. Dies berührt Ihre Testdaten, FSRS-Statistiken oder Lernquellen in keiner Weise.`
    }
},
{
    id: 'troubleshooting',
    title: { tr: 'Sık karşılaşılan durumlar', en: 'Common situations', de: 'Häufige Situationen' },
    body: {
tr: `**"Bir soru sürekli karşıma çıkıyor."** Muhtemelen takılmış bir sorudur. İstatistikler → **Takılanlar** filtresine bakın; düzeltin ya da askıya alın.

**"Serim kırıldı ama çalışmıştım."** Gün sınırı **Europe/Berlin** gecesidir; gece yarısından sonra başka bir saat diliminde çözdüğünüz sorular bir sonraki güne yazılmış olabilir. Ayrıca bir günü kazanmak için 15 soru gerekir.

**"İki cihazda farklı sayılar görüyorum."** Uygulamayı ikisinde de öne getirip birkaç saniye bekleyin — aşağı çekme uygulama öne geldiğinde olur. Test ekranındaysanız ertelenir.

**"Senkron rozeti kırmızı."** Token'ınızın süresi dolmuş ya da yetkisi yetersiz olabilir (\`gist\` yetkisi gerekir). Rozete dokunarak durumu okuyun; geçici bir ağ hatası ile token sorunu ayrı ayrı gösterilir.

**"Yer kalmadı uyarısı alıyorum."** Kullanmadığınız kaynakları dışa aktarıp silin, ya da GitHub bağlıysa arşivleyin. Arşivleme yalnızca GitHub bağlıyken cihazda yer açar.

**"Sorularım kayboldu."** Tarayıcı verisini temizlemek uygulamanın verisini de siler. GitHub senkronizasyonu bağlıysa yeniden bağlanmak geri getirir; değilse elinizdeki yedek dosyasını içe aktarın. Düzenli yedek almanın sebebi budur.

**"Cevabım doğru ama yanlış saydı."** Kısa cevap ve boşluk doldurmada kabul edilen cevapları soru düzenleyicisinden genişletebilirsiniz; birden fazla eşdeğer cevap tanımlanabilir.

**"Uygulama telefonda takıldı."** Sayfayı yenileyin. Yarım kalan testiniz kaybolmaz; ana ekranda "Devam Et" olarak durur.`,
en: `**"One question keeps coming back."** It is probably stuck. Look at Statistics - the **Stuck** filter; fix it or suspend it.

**"My streak broke although I studied."** The day turns at **Europe/Berlin** midnight; questions you answered after midnight in another time zone may have been filed under the next day. And a day needs 15 questions to be won.

**"The two devices show different numbers."** Bring the app to the foreground on both and wait a few seconds - pulling happens when the app comes forward. It is deferred while you are on the test screen.

**"The sync badge is red."** Your token may have expired or may not have the right scope (it needs \`gist\`). Tap the badge to read the state; a passing network error and a token problem are reported separately.

**"I am getting an out-of-space warning."** Export and delete sources you are not using, or archive them if GitHub is connected. Archiving only frees space on the device when GitHub is connected.

**"My questions are gone."** Clearing browser data clears the app's data with it. If GitHub sync is connected, reconnecting brings everything back; if not, import the backup file you have. That is what regular backups are for.

**"My answer was right but it was marked wrong."** For short answers and gap-fills you can widen the accepted answers in the question editor; several equivalent answers can be defined.

**"The app froze on my phone."** Reload the page. A half-finished test is not lost; it waits on the home screen as "Resume".`,
de: `**"Eine Frage kommt ständig wieder."** Wahrscheinlich hängt sie fest. Sehen Sie in der Statistik im Filter **Hängengeblieben** nach; korrigieren Sie die Frage oder setzen Sie sie aus.

**"Meine Serie ist gerissen, obwohl ich gelernt habe."** Der Tag wechselt um Mitternacht in **Europe/Berlin**; Fragen, die Sie nach Mitternacht in einer anderen Zeitzone beantwortet haben, können auf den nächsten Tag gebucht worden sein. Und ein Tag braucht 15 Fragen.

**"Die beiden Geräte zeigen verschiedene Zahlen."** Holen Sie die App auf beiden in den Vordergrund und warten Sie ein paar Sekunden - heruntergeholt wird, wenn die App nach vorne kommt. Auf dem Test-Bildschirm wird es aufgeschoben.

**"Das Sync-Abzeichen ist rot."** Ihr Token kann abgelaufen sein oder den falschen Bereich haben (es braucht \`gist\`). Tippen Sie auf das Abzeichen, um den Zustand zu lesen; ein vorübergehender Netzwerkfehler und ein Token-Problem werden getrennt gemeldet.

**"Ich bekomme eine Speicherwarnung."** Exportieren und löschen Sie Quellen, die Sie nicht brauchen, oder archivieren Sie sie, wenn GitHub verbunden ist. Archivieren schafft nur bei verbundenem GitHub Platz auf dem Gerät.

**"Meine Fragen sind weg."** Browserdaten zu löschen löscht auch die Daten der App. Ist die GitHub-Synchronisierung verbunden, holt ein erneutes Verbinden alles zurück; sonst importieren Sie Ihre Sicherungsdatei. Genau dafür sind regelmäßige Sicherungen da.

**"Meine Antwort war richtig, wurde aber als falsch gewertet."** Bei Kurzantworten und Lückentexten können Sie die zulässigen Antworten im Frageneditor erweitern; mehrere gleichwertige Antworten sind möglich.

**"Die App hängt auf dem Telefon."** Laden Sie die Seite neu. Ein halbfertiger Test geht nicht verloren; er wartet auf der Startseite als "Fortsetzen".`
    }
},
{
    id: 'about',
    title: { tr: 'Sürüm ve iletişim', en: 'Version and contact', de: 'Version und Kontakt' },
    body: {
tr: `**Sürüm:** ${APP_VERSION}

**İletişim:** ${CONTACT_EMAIL}

Bir hata bulduysanız, bir şey anlaşılmadıysa ya da bir öneriniz varsa yazın. Hata bildirirken hangi ekranda olduğunuzu ve ne yapmaya çalıştığınızı belirtmek çok yardımcı olur.

**Kaynak kodu:** ${SOURCE_URL}

**Verileriniz kimde?** Sizde. Uygulamanın sunucusu yoktur. Veriler tarayıcınızın deposunda durur; senkronizasyonu açarsanız kendi GitHub hesabınızdaki gizli bir Gist'te tutulur. Çeviri ve sesli okuma dışında hiçbir istek cihazdan çıkmaz, o ikisini de kapatabilirsiniz.`,
en: `**Version:** ${APP_VERSION}

**Contact:** ${CONTACT_EMAIL}

Write if you find a bug, if something here was unclear, or if you have a suggestion. When reporting a bug it helps a great deal to say which screen you were on and what you were trying to do.

**Source code:** ${SOURCE_URL}

**Who holds your data?** You do. The app has no server. Data lives in your browser's storage, and if you turn on syncing it lives in a secret Gist in your own GitHub account. Apart from translation and text-to-speech no request leaves the device, and you can switch both of those off.`,
de: `**Version:** ${APP_VERSION}

**Kontakt:** ${CONTACT_EMAIL}

Schreiben Sie, wenn Sie einen Fehler finden, wenn hier etwas unklar war oder wenn Sie einen Vorschlag haben. Bei einer Fehlermeldung hilft es sehr, zu sagen, auf welchem Bildschirm Sie waren und was Sie versucht haben.

**Quellcode:** ${SOURCE_URL}

**Wer hat Ihre Daten?** Sie. Die App hat keinen Server. Die Daten liegen im Speicher Ihres Browsers, und wenn Sie die Synchronisierung einschalten, in einem geheimen Gist in Ihrem eigenen GitHub-Konto. Außer für Übersetzung und Vorlesen verlässt keine Anfrage das Gerät, und beides können Sie abschalten.`
    }
}
];
