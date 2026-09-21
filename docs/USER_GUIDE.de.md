# Benutzerhandbuch

> Diese Datei wird aus `src/features/help/guide-content.js` erzeugt. Nicht von Hand bearbeiten; `npm run build:guide` ausfuhren.

Jeder Teil der App: wofür er da ist und wie man ihn benutzt. Tippen Sie auf die gesuchte Überschrift.

## Inhalt

1. [Erste Schritte](#erste-schritte)
2. [Quellen hinzufügen](#quellen-hinzufügen)
3. [Quellen verwalten, zusammenführen, exportieren](#quellen-verwalten-zusammenführen-exportieren)
4. [Test starten und Schnellgruppen](#test-starten-und-schnellgruppen)
5. [Fragetypen](#fragetypen)
6. [Während eines Tests](#während-eines-tests)
7. [Ergebnisseite und Wiederholungsrunde](#ergebnisseite-und-wiederholungsrunde)
8. [Fragendetails und Bearbeiten](#fragendetails-und-bearbeiten)
9. [Was die Statistiken zeigen](#was-die-statistiken-zeigen)
10. [Diagramme und das Fortschrittsfenster](#diagramme-und-das-fortschrittsfenster)
11. [Serien und Einfrier-Token](#serien-und-einfrier-token)
12. [Wie der Wiederholungsalgorithmus entscheidet](#wie-der-wiederholungsalgorithmus-entscheidet)
13. [Synchronisierung und Sicherung](#synchronisierung-und-sicherung)
14. [Arbeiten mit einer KI](#arbeiten-mit-einer-ki)
15. [Menü und Einstellungen](#menü-und-einstellungen)
16. [Häufige Situationen](#häufige-situationen)
17. [Version und Kontakt](#version-und-kontakt)

---

## Erste Schritte

Dies ist eine App für verteiltes Wiederholen und Prüfungsvorbereitung, gebaut um **Ihre eigenen** Fragen. Drei Dinge unterscheiden sie von den meisten Alternativen:

- **Kein Konto.** Keine Registrierung, keine Anmeldung. Alle Ihre Daten liegen im Speicher Ihres eigenen Browsers.
- **Funktioniert offline.** Das Internet wird nur für Synchronisierung, Übersetzung und Vorlesen gebraucht.
- **Ihre Inhalte.** Es gibt keine fertige Fragenbibliothek; Sie fügen die Fragen hinzu (die meisten lassen sie von einer KI erzeugen).

**Die ersten fünf Minuten**

1. Öffnen Sie **Quellen** über das Menü oder die Startseite und fügen Sie eine JSON-Datei hinzu. Wenn Sie keine haben, laden Sie die Beispielquelle.
2. Gehen Sie zurück zur Startseite und schalten Sie die Quelle ein, mit der Sie lernen wollen.
3. Wählen Sie die Anzahl der Fragen und starten Sie den Test.
4. Am Ende erscheint die Ergebnisseite; von dort aus können Sie die falsch beantworteten Fragen sofort noch einmal ansehen.

Um den Rest kümmert sich die App: Sie entscheidet, wann Sie jede Frage wiedersehen.

---

## Quellen hinzufügen

Eine **Quelle** ist eine Menge von Fragen zu einem Thema: ein Kurs, ein Kapitel, ein Prüfungsgebiet. Halten Sie eine Quelle eng und zusammenhängend - Statistiken werden pro Quelle berechnet, also ist "Anatomie" als eine Quelle nützlich, während "Alles" einen nichtssagenden Durchschnitt ergibt.

**Drei Wege, eine hinzuzufügen** (Quellen-Bildschirm):

- **Aus einer Datei** - wählen Sie eine `.json`-Datei von Ihrem Gerät.
- **Von einer URL** - fügen Sie die direkte Adresse der JSON ein (etwa einen GitHub-Raw-Link).
- **Durch Einfügen** - fügen Sie den JSON-Text direkt in das Feld ein. Das ist der schnellste Weg für Ausgaben einer KI.

**Das erwartete Format**

```json
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
```

`difficulty` reicht von 1 bis 5 und liefert nur die **anfängliche** Schwierigkeitsschätzung; danach entscheiden Ihre Antworten. `tags` sind optional und werden von der Suche und vom Teststart nach Schlagwort genutzt.

**Der Importbericht.** Nach einem Import werden unvollständige Fragen (ohne Antwort, ohne Optionen, mit leerem Text) in einem Bericht aufgeführt. Von dort korrigieren, markieren oder löschen Sie sie - stillschweigend übernommen wird nichts.

**Sicherheit.** Fragetexte werden als Markdown gezeichnet, und rohes HTML darin wird **nie ausgeführt** - es erscheint als Text. Eine JSON zu öffnen, der Sie nicht trauen, setzt Sie keinem Skript aus.

---

## Quellen verwalten, zusammenführen, exportieren

**Ein / aus.** Der Schalter einer Quelle entscheidet, ob sie an Tests teilnimmt. Sie können mehrere gleichzeitig einschalten; ein Test zieht dann aus allen.

**Ordner.** Quellen lassen sich in Ordner legen, Ordner lassen sich einfärben. Alles ohne Ordner sammelt sich in "Ohne Kategorie", der immer existiert und nicht gelöscht werden kann.

**Das Quellenmenü** (lange auf eine Quelle drücken oder die drei Punkte antippen):

- **Umbenennen / Details bearbeiten** - Titel und Kategorie.
- **In Ordner verschieben**.
- **Exportieren** - lädt genau diese Quelle als JSON herunter. Diese Datei können Sie einem anderen Gerät oder einer anderen Person geben.
- **Archivieren** - nimmt die Quelle aus der Bibliothek, behält aber ihre Fragen. Eine archivierte Quelle nimmt an keinem Test teil, und ihre Wiederholungsuhr **steht still**: Holen Sie sie drei Monate später zurück, sind nicht alle Fragen auf einmal überfällig.
- **Löschen** - entfernt die Quelle und ihre Statistiken. Es ist nicht rückgängig zu machen; exportieren Sie vorher.

**Zusammenführen.** Die Zusammenführen-Option im Quellen-Bildschirm fasst die Fragen der gewählten Quellen in einer neuen Quelle zusammen und entfernt Dubletten. Auch das ist nicht rückgängig zu machen, also exportieren Sie vorher.

**Schafft Archivieren Platz?** Nur bei verbundener GitHub-Synchronisierung: Die Fragen der archivierten Quelle wandern in den Gist und werden vom Gerät entfernt. Ohne Verbindung bleiben die Fragen auf dem Gerät, Archivieren schafft also keinen Platz - dann bietet die App stattdessen "Herunterladen und löschen" an.

**Die Speicherwarnung.** Wenn der Browserspeicher voll wird, erscheint eine Warnung. Sie zeigt keine Prozentzahl, weil Browser die Obergrenze nicht veröffentlichen; stattdessen schätzt sie, wie viele Fragen noch hineinpassen.

---

## Test starten und Schnellgruppen

Auf der Startseite wählen Sie Ihre aktiven Quellen, die Fragenzahl und die Reihenfolge und starten dann.

**Wie viele Fragen.** Fertige Werte wie 10, 20, 40 oder **Alle Fragen**. Welche Fragen Sie bekommen, entscheidet die App: Die am nächsten am Vergessen stehen zuerst.

**Sequenzieller Modus.** Ist eine Quelle als sequenziell markiert, kommen ihre Fragen in der Reihenfolge der JSON, ungemischt. In diesem Modus erscheint zusätzlich eine **Bereichsauswahl**: In einem Buch mit 40 Fragen machen Sie die ersten 10 und nächstes Mal 11-20. Nach dem Test rückt der Bereich automatisch einen Block weiter, und die App sagt Ihnen das.

**Schnelltest-Gruppen** (die Blitz-Schaltfläche auf der Startseite). Speichern Sie die Quellenkombinationen, die Sie oft brauchen: "Prüfungswoche" = Anatomie + Physiologie + Biochemie. Ein Tippen auf die Gruppe schaltet diese Quellen ein und macht Sie startbereit.

Zum Bearbeiten tippen Sie auf den Stift neben der Gruppe. Im Fenster können Sie **den Namen** ändern und auch direkt auswählen oder entfernen, **welche Quellen darin sind**. Dort bauen Sie Ihre Lernumgebung auf einem einzigen Bildschirm.

**Test aus einem Schlagwort.** Tippen Sie im Statistik-Bildschirm auf ein Schlagwort, und Sie bekommen die Fragen, die es tragen; von dort starten Sie direkt einen Test. Dasselbe gilt für Suchergebnisse und Filter: Was auf dem Bildschirm steht, ist das, womit der Test beginnt.

---

## Fragetypen

Es gibt sieben Typen, und die Menge ist geschlossen - neue kommen nicht dazu.

| Typ | Was er tut |
|---|---|
| `single_choice` | Eine richtige Option. |
| `multiple_choice` | Mehrere richtige Optionen; Sie müssen alle markieren. |
| `true_false` | Richtig / falsch. |
| `short_answer` | Sie tippen einen kurzen Text. Mehrere zulässige Antworten sind definierbar. |
| `fill_in_the_blank` | Lücke(n) in einem Satz. Schreiben Sie `{{blank}}` oder `{{richtig|alternative}}` in den Text; jede Lücke wird einzeln bewertet. |
| `flashcard` | Vorder- / Rückseite. Sie bewerten sich selbst. |
| `reading` | Keine Frage, sondern ein Lesetext. Abschnittsweise zu lesen; der Fortschritt zählt, aber es gibt kein Richtig oder Falsch. |

**Alte Namen.** `text`, `text_input` und `open_ended` werden zu `short_answer`, `topic_review` wird zu `reading`. Ihre älteren Dateien funktionieren weiter.

**Markdown überall.** Fragetext, Optionen und Erklärungen unterstützen Markdown: fett, kursiv, Überschriften, Listen, Codeblöcke, Tabellen, `==Hervorhebung==`. Für ein Bild nutzen Sie das Medienfeld im Frageneditor.

---

## Während eines Tests

**Antworten.** Wählen Sie eine Option und prüfen Sie sie. Nach dem Prüfen erscheint die richtige Antwort, mit Erklärung, falls vorhanden. Falsche Antworten werden innerhalb der Sitzung nicht erneut gestellt - die Fragen werden vorab ausgewählt.

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

**Wie ein Test endet.** Wenn nichts mehr unbeantwortet ist, beendet sich der Test selbst - aber nicht sofort: Er wartet 1,5 Sekunden, damit Sie Schwer oder Einfach drücken können, und jede Berührung in diesem Moment bricht das Warten ab. Auf der letzten Frage heißt die Schaltfläche ohnehin "Test beenden". Einen absichtlich halb gelassenen Test finden Sie auf der Startseite als "Fortsetzen".

---

## Ergebnisseite und Wiederholungsrunde

Am Ende eines Tests sehen Sie die Zahlen für richtig / falsch / leer, die Erfolgsquote und die verstrichene Zeit. Darunter sind alle Fragen des Tests aufgelistet; tippen Sie eine an, um Antwort und Erklärung noch einmal zu lesen.

**Die Wiederholungsrunde.** Wenn Sie etwas falsch hatten, erscheint eine Schaltfläche "Wiederholungsrunde starten (n)". Sie stellt nur die verpassten Fragen noch einmal - solange die Erklärung noch frisch ist.

In einer Wiederholungsrunde zählt **eine richtige Antwort nicht als voller Erfolg**. Etwas jetzt zu wissen, was Sie vor Minuten verpasst haben, ist eine *Erholung* und nicht dasselbe wie es beim ersten Mal zu wissen; die App verbucht es als "Schwer". Sonst würde eine falsch beantwortete und dann erholte Frage einen **besseren** Eintrag hinterlassen als eine, die gleich richtig war.

Die Schaltfläche **Wiederholen** stellt den ganzen Test erneut; das ist ein gewöhnlicher Test.

---

## Fragendetails und Bearbeiten

Wenn Sie in der Statistikliste eine Frage antippen, öffnet sich die **Vorschau**: die vollständige Frage, ihre richtige Antwort, die Erklärung, ihre Schlagwörter, Ihre Notiz und ihre Kennzahlen.

**Die Pfeile.** Die Pfeile links und rechts führen zur **nächsten** Frage in der Liste - so gefiltert, gesucht und sortiert, wie sie ist. "Durch die markierten blättern" ist genau das. Das `12 / 30` dazwischen sagt, wo Sie sind.

**Bearbeiten.** Der Stift öffnet den Frageneditor. Text, Optionen, richtige Antwort, Erklärung, Schwierigkeit, Schlagwörter und Medien ändern Sie alle von hier aus.

- **Schnellformatierungsleiste**: fett, kursiv, Überschrift, Liste, Hervorhebung, Code.
- **Live-Vorschau**: zeigt beim Tippen, wie das Markdown aussehen wird.
- **Fokusmodus**: Tippen Sie in ein Textfeld, und alles andere verschwindet, während das Feld wächst. Für lange Texte auf dem Telefon. Tippen Sie daneben oder nutzen Sie die Beenden-Schaltfläche.
- **Ungespeicherte Änderungen**: Wollen Sie ohne Speichern gehen, fragt die App - Speichern / Ohne Speichern verlassen / Abbrechen.
- **Die Pfeile unten** wechseln zur nächsten Frage, ohne den Editor zu schließen.

Beim Speichern aktualisiert sich die Vorschau sofort; Sie müssen nicht zur Liste hinaus und wieder hinein.

---

## Was die Statistiken zeigen

Der Statistik-Bildschirm ist eine Liste Ihrer Fragen; jede Zeile ist eine Frage und ihr Stand.

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

**Bereich.** Die Leiste unten sagt, welche Quellen Sie betrachten. Ist der Schalter **Alle Quellen** oben aus, ist der Bereich Ihre aktiven Quellen; ist er an, die ganze Bibliothek. Sie können einen Bereich auch direkt benennen, indem Sie `$Quellenname` ins Suchfeld tippen.

**Suche.** Klartext durchsucht die Frage, `#schlagwort` die Schlagwörter, `$Quelle` grenzt auf eine Quelle ein.

**Sortierung.** Ursprüngliche Reihenfolge, Schwierigkeit, Erfolgsquote oder Abrufbarkeit.

---

## Diagramme und das Fortschrittsfenster

**Die Karten auf der Startseite** beschreiben Ihre Bibliothek - jede nicht archivierte Quelle.

- **Schwierigkeitsverteilung** - wie sich Ihre Fragen auf leicht/mittel/schwer verteilen.
- **Trend** - Fragen pro Tag der letzten 7 Tage. Drehen Sie die Karte für die Monatsansicht.
- **Heatmap** - ein Jahr Lerntage. Ein dunkler Tag ist ein Tag mit viel Arbeit.
- **Prüfungsreife** - die durchschnittliche Reife über Ihre Quellen.

**Das Fortschrittsfenster** (die Vergrößern-Schaltfläche auf der Karte) beschreibt dagegen **Ihren Test** - nur die eingeschalteten Quellen. Es enthält drei Diagramme, und alle drei lesen dieselbe Menge:

- **Überblick** - die Aufteilung richtig/falsch/leer.
- **Schwierigkeitsbalken** - die Fragen nach Schwierigkeit.
- **Arbeitslast** - das Diagramm, das wirklich zu lesen lohnt. Links nach rechts ist Zeit:

  `−6T … gestern │ Überfällig · Nicht begonnen │ Heute │ +1T … +6T`

  **Gefüllt** = dieser Moment liegt hinter Ihnen (eine Antwort, die Sie gegeben haben, oder ein Wiederholungstag, der ohne Sie verging). **Hohl** = liegt noch vor Ihnen. Die Farbe sagt die Art der Schuld: Rot ist überfällig, Blau nie begonnen, Gelb heute, Grau Plan.

  Die grauen Säulen rechts sind **Plan, keine Schuld** - die normalen Wiederholungen der kommenden Tage.

Die **i**-Schaltfläche neben jedem Diagramm erklärt, was es aussagt.

Die Schaltfläche **Untersuchen** öffnet die Fragen der Quellen des Fensters als Liste im Statistik-Bildschirm.

---

## Serien und Einfrier-Token

Es gibt zwei Serien, und sie laufen unabhängig voneinander.

**Allgemeine Serie.** Für Ihre ganze Bibliothek. Um einen Tag zu gewinnen, müssen Sie an diesem Tag **mindestens 15 Fragen** beantworten. Diese Zahl ist fest und nicht einstellbar: Eine Untergrenze, die sich bewegt, ist keine. Mehr als 15 ist Ihre Sache - die App belohnt den Überschuss nicht und bestraft ihn auch nicht.

**Fokus-Serie.** Eine eigene Serie für **bis zu 3 selbst gewählte Quellen**. Wählen Sie sie über das Zahnrad auf der Fokus-Karte; die Worte "Quellen" daneben weisen genau darauf hin. Die Fokus-Serie zählt nur Fragen, die Sie in diesen Quellen **nach** der Auswahl beantworten.

**Wo der Tag endet.** Der Tag wechselt zu einer festen Mitternacht in **Europe/Berlin**, nicht nach der Uhr Ihres Geräts. Der Grund ist einfach: Sonst verbuchen zwei Geräte in verschiedenen Zeitzonen dieselbe Lerneinheit auf zwei verschiedene Tage, und keine Merge-Regel kann das reparieren.

**Einfrier-Token (❄️).** Token, die ausgegeben werden, damit ein verpasster Tag Ihre Serie nicht bricht.

- Werden durch regelmäßiges Lernen verdient; es gibt zwei Stufen.
- Ein verpasster Tag wird beim nächsten Start automatisch eingefroren, ohne Ihr Zutun.
- **Ein eingefrorener Tag verdient kein neues Token** - sonst würden Einfrieren und Verdienen einander in einer Schleife füttern.
- Allgemeine und Fokus-Serie haben eigene Token. Eine kann von der anderen borgen, wenn sie leer ist, aber jede gibt zuerst ihre eigenen aus.
- Haben Sie **keine Fokus-Quellen ausgewählt, wird kein Token ausgegeben**. Ein nicht gesetztes Ziel liest sich jeden Tag als "verpasst" und hätte still jedes Ihrer Token verbrannt.

Die Schaltfläche **Serie halten** verwandelt das Tagespensum direkt in einen Test: eine Mischung aus überfälligen Fragen, ein paar neuen und einigen, die anstehen.

---

## Wie der Wiederholungsalgorithmus entscheidet

Die App verwendet einen Algorithmus für verteiltes Wiederholen namens **FSRS** (das moderne Mitglied der Familie, die auch Anki nutzt). Für jede Frage führt sie zwei Zahlen:

- **Stabilität** - eine Schätzung in Tagen, wie lange Sie es behalten werden.
- **Schwierigkeit** - wie schwer diese Frage für Sie ist.

Daraus ergibt sich die **Abrufbarkeit**: `R = 0.9 ^ (vergangene Tage / Stabilität)`. Fällt `R` unter 90 %, ist die Frage überfällig - ihr Fälligkeitstag ist also genau **letzte Wiederholung + Stabilität** Tage.

**Was sie bewegt:**

- **Eine richtige Antwort** hebt die Stabilität; das Intervall wächst.
- **Eine falsche Antwort** senkt sie; die Frage kommt bald zurück.
- Die Schaltfläche **Schwer** verkürzt das Intervall, **Einfach** verlängert es.
- `difficulty` in der JSON liefert nur die **anfängliche** Schätzung.

Die Markierung **gelernt** (🎓) bedeutet fünf richtige in Folge oder eine Stabilität über 30 Tage. Eine falsche Antwort löscht sie.

Sie müssen davon nichts einstellen, und es gibt auch keine Einstellung dafür. Ihre einzigen Eingriffe sind die Schaltflächen Schwer/Einfach und - für wirklich festhängende Fragen - das Aussetzen.

---

## Synchronisierung und Sicherung

Es gibt zwei verschiedene Dinge: **Synchronisierung** (zwischen Geräten, laufend) und eine **Sicherung** (eine Datei, manuell).

### GitHub-Synchronisierung

Ihre Daten liegen in einem geheimen **Gist** in Ihrem eigenen GitHub-Konto. Es gibt keinen Server von uns; Ihre Daten laufen nie über uns.

**Einrichtung:**

1. Erstellen Sie auf GitHub ein **Personal Access Token**. Der einzige nötige Bereich ist `gist`.
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

Machen Sie eine Sicherung, wenn Sie auf ein neues Gerät wechseln, und vor allem Riskanten (Quelle löschen, zusammenführen, zurücksetzen). Die Sicherungsdatei geht nirgendwohin; sie bleibt bei Ihnen.

---

## Arbeiten mit einer KI

In der App läuft **keine KI**. Stattdessen bereitet sie den Text vor, den Sie an eine KI außerhalb schicken. Sie geben keinen Schlüssel an, zahlen nichts, und im Hintergrund geht nichts irgendwohin - Sie entscheiden, was gesendet wird.

**Fragen erzeugen.** So bauen die meisten ihre Quellen auf: Geben Sie einer KI Ihre Notizen, bitten Sie um Fragen im obigen JSON-Format und fügen Sie das Ergebnis im Quellen-Bildschirm ein. Sie um das Feld `difficulty` zu bitten, lohnt sich - es verbessert die Startschätzung des Algorithmus.

**Die Prompt-Bibliothek.** Unter Menü - KI schreiben und speichern Sie eigene Prompts. Drei sind fertig dabei: die Frage prüfen lassen, das Thema erklären lassen, die eigene Antwort bewerten lassen.

Die Variablen, die Sie in einem Prompt verwenden können:

| Variable | Steht für |
|---|---|
| `{question}` | Der Fragetext |
| `{options}` | Die Optionen |
| `{correct}` | Die richtige Antwort |
| `{answer}` | Ihre gegebene Antwort |
| `{source}` | Der Quellenname |
| `{explanation}` | Die Erklärung |

**Eine Variable ohne Inhalt lässt ihre Zeile weg.** Bei einer Frage ohne Optionen wird die Zeile mit `{options}` gar nicht geschrieben - es bringt nichts, einer KI ein leeres "Optionen:" zu schicken, das ihr nichts sagt.

**Die Anbieterliste.** Speichern Sie die Adressen der KIs, die Sie nutzen, mit einem `{PROMPT}`-Platzhalter; ein Tippen öffnet sie mit bereits eingesetztem Prompt. Diese Liste ist gerätespezifisch und wird nicht synchronisiert.

**Auch dieses Handbuch ist eine Referenz.** Wenn Sie eine KI zur Bedienung der App befragen wollen: Das ganze Handbuch liegt im Repository als `docs/USER_GUIDE.md`; geben Sie es ihr und fragen Sie.

---

## Menü und Einstellungen

Das Menü (die Schaltfläche oben rechts) öffnet sich Abschnitt für Abschnitt.

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

**Welche Einstellungen werden synchronisiert?** Sprache, Übersetzungsziel, Vorlese-Einstellungen, Timer-Einstellungen und Ihre Prompt-Auswahl reisen zwischen den Geräten. Die **KI-Anbieterliste** und das **Design** sind gerätespezifisch.

---

## Häufige Situationen

**"Eine Frage kommt ständig wieder."** Wahrscheinlich hängt sie fest. Sehen Sie in der Statistik im Filter **Hängengeblieben** nach; korrigieren Sie die Frage oder setzen Sie sie aus.

**"Meine Serie ist gerissen, obwohl ich gelernt habe."** Der Tag wechselt um Mitternacht in **Europe/Berlin**; Fragen, die Sie nach Mitternacht in einer anderen Zeitzone beantwortet haben, können auf den nächsten Tag gebucht worden sein. Und ein Tag braucht 15 Fragen.

**"Die beiden Geräte zeigen verschiedene Zahlen."** Holen Sie die App auf beiden in den Vordergrund und warten Sie ein paar Sekunden - heruntergeholt wird, wenn die App nach vorne kommt. Auf dem Test-Bildschirm wird es aufgeschoben.

**"Das Sync-Abzeichen ist rot."** Ihr Token kann abgelaufen sein oder den falschen Bereich haben (es braucht `gist`). Tippen Sie auf das Abzeichen, um den Zustand zu lesen; ein vorübergehender Netzwerkfehler und ein Token-Problem werden getrennt gemeldet.

**"Ich bekomme eine Speicherwarnung."** Exportieren und löschen Sie Quellen, die Sie nicht brauchen, oder archivieren Sie sie, wenn GitHub verbunden ist. Archivieren schafft nur bei verbundenem GitHub Platz auf dem Gerät.

**"Meine Fragen sind weg."** Browserdaten zu löschen löscht auch die Daten der App. Ist die GitHub-Synchronisierung verbunden, holt ein erneutes Verbinden alles zurück; sonst importieren Sie Ihre Sicherungsdatei. Genau dafür sind regelmäßige Sicherungen da.

**"Meine Antwort war richtig, wurde aber als falsch gewertet."** Bei Kurzantworten und Lückentexten können Sie die zulässigen Antworten im Frageneditor erweitern; mehrere gleichwertige Antworten sind möglich.

**"Die App hängt auf dem Telefon."** Laden Sie die Seite neu. Ein halbfertiger Test geht nicht verloren; er wartet auf der Startseite als "Fortsetzen".

---

## Version und Kontakt

**Version:** 1.1.0

**Kontakt:** tafirnat@gmail.com

Schreiben Sie, wenn Sie einen Fehler finden, wenn hier etwas unklar war oder wenn Sie einen Vorschlag haben. Bei einer Fehlermeldung hilft es sehr, zu sagen, auf welchem Bildschirm Sie waren und was Sie versucht haben.

**Quellcode:** https://github.com/tafirnat/exam-app

**Wer hat Ihre Daten?** Sie. Die App hat keinen Server. Die Daten liegen im Speicher Ihres Browsers, und wenn Sie die Synchronisierung einschalten, in einem geheimen Gist in Ihrem eigenen GitHub-Konto. Außer für Übersetzung und Vorlesen verlässt keine Anfrage das Gerät, und beides können Sie abschalten.

---

<https://github.com/tafirnat/exam-app> · tafirnat@gmail.com
