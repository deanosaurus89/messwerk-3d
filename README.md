# MessWerk 3D – Inspektion im Browser (v4)

**Live:** https://deanosaurus89.github.io/messwerk-3d/

Prototyp einer 3D-Messtechnik-Software, die vollständig **im Browser** läuft (Windows 11: Edge/Chrome/Firefox, iPad: Safari).
Bedienkonzept und Layout sind an gängige Inspektionssoftware angelehnt (Ribbon, Baumansicht, 3D-Szene, Dialogbereich, Prüfmerkmal-Tabelle).
Es werden keine fremden Icons oder Assets verwendet.

**Umfang v1 (ohne CAD):** Polygonmodell importieren → Merkmale per Klick extrahieren (automatische Typerkennung) →
Prüfmerkmale mit von Hand eingegebenen Sollwerten und Toleranzen → IO/NIO → CSV-Export.

## Beispielteile (Scan-/CT-ähnlich)
**Start › Beispiel laden** öffnet eine Auswahl mit Vorschaubild, Beschreibung und Größe. Sie funktioniert auch auf iPhone/iPad. Es gibt vier Teile:
- Beispielteil (Standard, wird vom Trainingsmodus genutzt)
- **Prüfplatte**: Teilkreis, Langlöcher, Tasche, Kugel, Kegel, Rundungen und Fase
- **Flansch/Welle**: koaxiale Durchmesser, Kegel, Torus-Einstich, Teilkreis
- **Freiform-Demoteil**: B-Spline-Fläche plus Regelgeometrie

Die drei neuen Teile sind dichte, isotrope Dreiecksnetze mit ca. 0,5 mm Kantenlänge, 8 µm Rauschen, leichter Welligkeit und kleinen Scanlücken. Sie liegen als `*.stl.gz` vor; der Import entpackt gzip automatisch, auch bei eigenen Dateien. Soll-Geometrie und Netzstatistik stehen in `public/samples/*.json` und `public/samples/README.md`.

Für solche gleichmäßigen Netze prüft das Regionenwachstum zusätzlich die Krümmung: gegenüber der Saat-Umgebung und über einen Abstand von etwa 1 mm. Dadurch stoppt es auch an tangentialen Rundungen (z. B. R1,5 zwischen Flanschfläche und Umfang) und an flachen Knicken, die sich auf einzelne Dreiecke verteilen. Bei tessellierten CAD-Netzen bleibt das alte Verhalten.

Ansicht › **Netz** zeigt das Dreiecksnetz als Drahtgitter.

## Neu in v4

### Projekt speichern / öffnen (.mw3d)
* **Start › Projekt speichern** schreibt eine `.mw3d`-Datei: ZIP mit `project.json` (Merkmale inkl. Hilfsebenen, Prüfmerkmale mit Soll/Toleranzen, Bezüge, Label-Positionen, Sichtbarkeit, Berichte, Kamera) und binärem Netz (`mesh/positions.f32`, `mesh/indices.u32`, `features/indices.u32`).
* iPhone/iPad: Teilen-Dialog („In Dateien sichern“); Desktop: Download. **Projekt öffnen** über die Dateiauswahl.
* **Autosave** in IndexedDB (1,5 s nach jeder Änderung). Beim Start erscheint „Letztes Projekt wiederherstellen“; zusätzlich Start › Letztes Projekt.

### Bezüge (ISO 5459) und Toleranzen mit Bezug (ISO 1101)
* Zuweisen: Dialog › Bezug › Buchstabe › *Bezug zuweisen*, oder Rechtsklick/langes Tippen im Baum. Buchstaben A–T (ohne I, O, Q).
* Umbenennen: einen anderen Buchstaben wählen. Ist er schon vergeben, werden die beiden Buchstaben getauscht. Prüfmerkmale verweisen auf das Merkmal, nicht auf den Buchstaben, und bleiben daher gültig.
* Entfernen: abhängige Prüfmerkmale bleiben erhalten und werden mit ⚠ „Bezug entfernt“ markiert. Ist das Bezugsmerkmal gelöscht, steht dort „Bezugsmerkmal gelöscht“. Weist man den Bezug neu zu, verschwindet die Markierung.
* Die Bezugsfahne steht im Baum und im 3D-Label. Der Rahmen (z. B. `⌖ Ø0.100 | A|B|C`) steht in Katalog, Liste und Label.
* Bezugssystem:
  * **A** legt die Orientierung fest: bei einer Ebene ist Z die Normale, bei einer Achse ist Z die Achse; der Ursprung liegt auf A.
  * **B**: bei einer Ebene die Richtung in A und der Ursprung auf B; bei einer Achse oder einem Punkt der Ursprung.
  * **C** legt die restliche Drehung bzw. den Ursprung fest.
* Katalog „Mit Bezug“:
  * Parallelität, Rechtwinkligkeit, Neigung: bei Ebenen die Punktspanne in Sollrichtung, bei Achsen L·sin(Δ).
  * Position mit DRF A|B|C und theoretisch genauen Maßen [X][Y][Z], von Hand eingegeben: bei Achsen eine zylindrische Zone aus den Achsendpunkten, bei Kugel/Punkt/Torus SØ, bei Ebenen 2·max|Δ|.
  * Koaxialität, Konzentrizität, Symmetrie.
  * Rundlauf (Messkreise), Gesamtrundlauf.
  * Flächenprofil mit Bezug: konservativ 2·(Form + Lage).
* Alle Istwerte werden aus der gemessenen Geometrie berechnet. Ohne CAD gibt es keine Sollgeometrie.
* Die Hilfe steht auch in der App unter Hilfe › Hilfe Bezüge.

### Trainingsmodus: Bezüge
Start über Hilfe › Trainingsmodus: Bezüge oder über den Link im Bezug-Abschnitt des Dialogs. Es sind 19 geführte Schritte am Beispielteil mit hervorgehobenen Bedienelementen und einem gelben Ring auf dem Netz:
1. Die Oberseite wird Bezug A, die Vorderseite B und die linke Seite C.
2. Danach wird die Bohrung Ø12 als Zylinder erzeugt.
3. Zum Schluss erhält sie eine Position ⌖ Ø0,1 | A | B | C mit [X]=20 und [Y]=20.

Jeder Schritt wird automatisch geprüft. Weiter und Zurück sind jederzeit möglich, und die Bedienelemente sind touchtauglich.

### Zentrieren
Der Knopf **⌖ Zentrieren** neben dem ViewCube zentriert und zoomt auf das gewählte Merkmal (ohne Auswahl auf das ganze Modell). Dasselbe geht per Doppelklick auf einen Baumeintrag, über das Kontextmenü oder über den Dialog.

### Torus
* Fit: zuerst eine Suche des Rohrradius r über die Spine-Kurve (p − r·n, Ebene + Kreis), danach Levenberg-Marquardt über Mitte, Achse, R und r mit robustem Trimmen.
* Wird auch im Modus „Automatisch“ erkannt.
* Katalog: Mitte X/Y/Z, Achswinkel, Leitkreis-Ø/R, Rohr-Ø/r, Torusform, Std.-Abw. und Toleranzen mit Bezug.
* Das Beispielteil enthält einen Torus (R 6, r 2) bei (40, 10, 20.8).

### Automatisch + Hilfsebene
* Ein Klick in der Nähe einer Bohrung oder eines Langlochs (auf der Wand nahe der Kante oder auf der Fläche direkt daneben) liefert dasselbe Ergebnis wie der explizite Kreis- bzw. Langloch-Modus: zweifarbige Vorschau und Statistik für Wand und Hilfsebene.
* Auf einer freien Fläche entsteht nur eine Ebene.
* Mitten in einer tiefen Wand entsteht ein Zylinder.

## Starten

### Windows 11 (fertige Version)
1. ZIP entpacken.
2. `start.bat` doppelklicken. Ein kleiner PowerShell-Webserver startet auf `http://localhost:8080/` und öffnet den Browser.
   (Ein Webserver ist nötig, weil Browser Web Worker nicht von `file://` laden.)
3. Alternativ mit Node.js: `npx serve dist` und die angezeigte Adresse öffnen.

### iPad
Die App ist rein statisch (`dist/`). Sie kann auf jedem Webserver bzw. GitHub Pages liegen und dann in Safari geöffnet werden.
Im lokalen Netz: auf dem PC `npx serve dist -l 8080` starten und am iPad `http://<PC-IP>:8080` aufrufen.

### Veröffentlichen (GitHub Pages)
`./deploy.sh` baut mit Basis `/messwerk-3d/` und überträgt `dist/` in den Branch `gh-pages`.

### Entwicklung
```
npm install
npm run dev        # Entwicklungsserver
npm test           # Unit- und End-to-End-Tests des Kerns (vitest)
npm run build      # Produktionsversion nach dist/
node e2e/ui-check.mjs   # Browser-Test der dist/-Version (Playwright + Chrome)
```

## Bedienung (Kurzanleitung)
1. **Start → Importieren** (STL ASCII/binär, PLY ASCII/binär, OBJ, XYZ/TXT-Punktwolke) oder **Beispiel laden**.
2. Navigation: linke Maustaste/1 Finger = Drehen, rechte Maustaste/2 Finger = Verschieben, Mausrad/Pinch = Zoom.
   **Navigationswürfel** unten links: Fläche antippen = Normalansicht (OBEN = XY-Ebene, X rechts, Y oben), Kante oder Ecke
   = Zwischenansicht; der Würfel dreht synchron mit der Kamera. Weitere Standardansichten im Register **Ansicht**.
3. **Merkmale** → Typ wählen: *Automatisch* oder fest *Ebene, Kreis, Zylinder, Langloch, Kegel, Kugel, Punkt*.
   - **Klick + Wachstum:** auf die Fläche tippen. Vom Klickpunkt aus wachsen die Dreiecke, solange der Normalenwinkel
     zwischen Nachbarn unter dem Grenzwert liegt (Standard 20°); optional mit Suchradius. Kanten beenden das Wachstum.
   - **Pinsel:** Bereich überstreichen (während des Malens ist die Navigation pausiert), dann **Fitten**.
   - Es erscheint zunächst eine **Vorschau** (Punkte + Geometrie orange) mit Kennwerten: erkannter Typ, Anzahl Punkte,
     Standardabweichung, Formabweichung (Ebenheit, Rundheit, Zylindrizität, Kugelform, Kegelform, Profil), Max. +/−,
     entfernte Ausreißer, Hauptmaße. Typ kann in der Vorschau überschrieben werden (Neuberechnung).
   - **Erzeugen** (oder Enter) legt das Merkmal an (Meldung + Markierung im Baum), **Verwerfen** (oder Esc) verwirft.
4. **Baumansicht** zeigt nur Objekte: Daten und Merkmale; unter jedem Merkmal nur seine Komponenten **Ist**, ggf. **Hilfsebene**
   und später **Soll**. Prüfmerkmale stehen bewusst nicht im Baum. Das **Auge** vor Polygonmodell und jedem Merkmal blendet
   es in 3D aus/ein (inkl. Punkte, Geometrie und Label). Unter **Berichte** liegen erzeugte Tabellen.
5. **Hilfsebene (Kreis/Langloch):** im Kreis- oder Langloch-Modus nahe dem Übergang Planfläche/Bohrungswand tippen (oder nur
   auf die Wand). Die angrenzende Planfläche wird automatisch erkannt, die Wandpunkte werden senkrecht in diese Ebene projiziert
   und Kreis bzw. Langloch in der Ebene gefittet (Mittelpunkt in der Ebene, Orientierung = Ebenennormale). Vorschau zweifarbig:
   Wand = orange, Ebene = blau, mit Kennwerten beider Punktmengen. Alternativ im Dialog eine **vorhandene Ebene** als Hilfsebene
   wählen oder „Keine (3D-Fit)“.
6. **Abstand** (Register Merkmale › Konstruieren): zwei Merkmale über Dropdown, Baumansicht oder Antippen im 3D-Bild wählen,
   Vorschau prüfen, Erzeugen. Darstellung: Linie und gestrichelte X/Y/Z-Komponenten (rot/grün/blau).
   **Regel:** Mittelpunkt–Mittelpunkt; ist eine Ebene beteiligt, wird der Mittelpunkt des anderen Merkmals senkrecht auf die
   Ebene projiziert. X/Y/Z sind die Beträge der Komponenten.
7. **Prüfmerkmale** (Fenster unter der 3D-Ansicht; am Telefon Bottom-Sheet mit Registern Katalog/Alle):
   - **Katalog** für das gewählte Merkmal, gegliedert nach DIN EN ISO 1101: Form (Ebenheit ⏥, Rundheit ○, Zylinderform ⌭,
     Flächenprofil ⌓ für Kugel/Kegel, Linienprofil ⌒ für Langloch, Standardabweichung), Maß (⌀, R, Länge, Breite, Kegelwinkel),
     Ort (Position X/Y/Z), Richtung (Winkel der Normale/Achse zur X/Y/Z-Achse), bei Abständen Abstand 3D/X/Y/Z.
   - Haken setzen = Prüfmerkmal anlegen (Soll, Tol +, Tol − direkt editierbar, IO/NIO), Haken entfernen = löschen.
   - Rechts bzw. Register „Alle“: Liste aller Prüfmerkmale.
8. **3D-Labels** für alle Merkmale: Kopf = Name, darunter genau die abgehakten Prüfmerkmale (Ist, Soll, Abw., grün/rot).
   Automatische Platzierung mit Führungslinie und Überlappungsvermeidung; Label ziehen = eigene Position (als 3D-Versatz
   gespeichert, bleibt bei Drehen/Zoomen erhalten); Antippen wählt das Merkmal. Ein/aus: Ansicht › Labels.
9. **Tabelle erzeugen** (Start › Bericht oder Prüfmerkmale): Momentaufnahme aller Merkmale (Typ, Ist-Lage, Maß, Form, RMS,
   Hilfsebene) und aller Prüfmerkmale mit IO/NIO als **Berichte › Tabelle n** im Baum; Ansicht mit Export **CSV**, **HTML** und **Drucken**.
10. **Start → Tabelle CSV / Merkmale CSV** (Semikolon, Dezimalkomma, für Excel).

Tasten: `Esc` beendet den Erstellmodus, `Entf` löscht die Auswahl.

## Algorithmen
| Typ | Verfahren |
|---|---|
| Ebene | Schwerpunkt + SVD/Eigenvektor der Kovarianz (orthogonale Regression) |
| Kreis | Achse aus Zylinderfit, 2D-Kreis in der Ebene (Kasa-Start + Levenberg-Marquardt, geometrisch) |
| Zylinder | Achs-Startwert aus Normalen (kleinster Eigenvektor von Σnnᵀ), 2D-Kreis als Start, LM über 5 Parameter |
| Kegel | Achse aus zentrierten Normalen, Spitze aus nᵢ·(pᵢ−A)=0, LM über 6 Parameter (orth. Abstand zur Mantelfläche) |
| Kugel | algebraischer Start + LM |
| Langloch | Projektion der Wandpunkte in die Ebene ⟂ Achse, Stadion-Kontur (Mittelpunkt, Winkel, halbe Länge, Radius) per LM |
| Punkt | Schwerpunkt der Auswahl |

Alle Fits robust: Punkte mit |Residuum| > 3·σ (σ aus MAD) werden iterativ (bis zu 3 Runden) entfernt und neu gefittet. Eine Region, deren Normalen zu > 95 % innerhalb 3° liegen, wird direkt als Ebene erkannt.
**Automatische Erkennung:** Ebene, Kugel, Zylinder, Kegel und (bei prismatischen Normalen) Langloch werden gefittet; Plausibilitätsprüfungen
(z. B. Radius < 3× Ausdehnung, Kegelwinkel 2°–80°); gewählt wird der einfachste Typ, dessen RMS höchstens 30 % über dem besten liegt.
Ein sehr kurzer Zylinder (Höhe < ¼ Durchmesser) wird als Kreis ausgegeben.
Regionenwachstum ignoriert extrem schmale „Splitterdreiecke“ als Brücke, weil deren Normalen bei Rauschen beliebig sind.

## Architektur
```
src/core/        reiner TypeScript-Kern, ohne DOM/three.js, mit vitest getestet
  linalg.ts      Vektoren, 3×3-Eigenzerlegung (Jacobi), Gauß, Levenberg-Marquardt
  fit.ts         Fits aller Regelgeometrien + automatische Typwahl
  mesh.ts        Netzdaten, Verschweißen, Normalen, Knoten→Dreieck-Zuordnung
  io.ts          STL/PLY/OBJ/XYZ-Import, STL-Export
  region.ts      Regionenwachstum, Pinsel, Punktauswahl
  features.ts    Merkmal (Ist- und künftig Soll-Komponente), Prüfmerkmale, IO/NIO, CSV
src/worker.ts    Web Worker: Import, Topologie, Wachstum, Fits (UI bleibt flüssig)
src/engine.ts    Promise-Schnittstelle zum Worker
src/viewer.ts    three.js-Szene, BVH-Picking (three-mesh-bvh), Primitive, Ansichten
src/main.ts      Oberfläche (Ribbon, Baum, Dialogbereich, Tabelle)
public/samples/  Beispielteil (STL)        scripts/make_sample.py  Generator (OpenCascade/Python)
tests/           Unit-Tests (synthetisch) + E2E-Test am Beispielteil   e2e/  Browser-Test
windows/         server.ps1 (statischer Server für start.bat)
```
**Erweiterbarkeit (CAD/Soll):** `Feature` hat bereits die Felder `measured` (Ist) und `nominal` (Soll). Ein künftiges CAD-Modul
(z. B. OpenCascade-WASM) füllt `nominal`; Prüfmerkmale können dann Sollwerte automatisch aus `nominal` übernehmen.
Ausrichtung (Best-Fit/ICP) und Farbvergleich setzen auf denselben Kern (KD-Baum, Worker) auf.

## Beispielteil
`public/samples/beispielteil.stl`: Block 100×60×20 mm mit Bohrung Ø12,08 (absichtlich +0,08), Bohrung Ø6, Langloch 30×10,
Bolzen Ø16 (um +0,05 in X versetzt), Kegelstumpf (Ø20→Ø8, Höhe 10, Kegelwinkel 61,93°), Kugelkalotte R7; Rauschen σ = 8 µm.
Neu erzeugen: `pip install cadquery-ocp numpy` und `python scripts/make_sample.py`.

## Grenzen v4

* Regionenwachstum: Knicke unter ~25° zwischen Flächen, die von Dreieck zu Dreieck wachsen, können bei verrauschten Netzen überlaufen. Abhilfe: Normalenwinkel verkleinern, Suchradius setzen oder den Pinsel verwenden.

* Profil mit Bezug ist eine konservative Abschätzung ohne CAD-Soll.
* Position nutzt das DRF ohne Materialbedingungen (kein Ⓜ/Ⓛ).
* Autosave hält nur das zuletzt geladene Netz. Wer ein neues Netz importiert, ersetzt damit den Autosave.
* iOS: Ob der Teilen-Dialog oder ein Download erscheint, hängt von der Safari-Version ab.

## Grenzen v3
- Kein CAD-Import, keine Ausrichtung, kein Farbvergleich (bewusst ausgelassen, Architektur vorbereitet).
- Sollwerte werden von Hand eingetragen; Projekte können noch nicht gespeichert/geladen werden (nur CSV-Export).
- Punktwolken ohne Dreiecke: nur Pinsel-Auswahl (kein Regionenwachstum), Normalen werden noch nicht geschätzt → Zylinder/Kegel/Langloch dort unzuverlässig.
- Hilfsebene automatisch: es wird die dem Klickpunkt nächstgelegene angrenzende Planfläche verwendet (Klick nahe der Unterseite einer
  Durchgangsbohrung → Unterseite). Wände ohne angrenzende Planfläche (z. B. Freiform) → vorhandene Ebene wählen.
- Richtungs-/Ortstoleranzen mit Bezug (∥, ⟂, ∠, ⌖ nach ISO 1101) benötigen ein Bezugssystem; v3 bietet ersatzweise Winkel zu den Achsen und X/Y/Z.
- Label-Positionen, Sichtbarkeit und Berichte werden noch nicht in einer Projektdatei gespeichert.
- Bei sehr großen Netzen (≈1 Mio. Punkte) dauert der Import einige Sekunden, ein Klick-Fit 2–4 s.
