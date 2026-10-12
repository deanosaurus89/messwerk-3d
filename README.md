# MessWerk 3D – Inspektion im Browser (v1)

**Live:** https://deanosaurus89.github.io/messwerk-3d/

Prototyp einer 3D-Messtechnik-Software, die vollständig **im Browser** läuft (Windows 11: Edge/Chrome/Firefox, iPad: Safari).
Bedienkonzept und Layout sind an gängige Inspektionssoftware angelehnt (Ribbon, Baumansicht, 3D-Szene, Dialogbereich, Prüfmerkmal-Tabelle).
Es werden keine fremden Icons oder Assets verwendet.

**Umfang v1 (ohne CAD):** Polygonmodell importieren → Merkmale per Klick extrahieren (automatische Typerkennung) →
Prüfmerkmale mit von Hand eingegebenen Sollwerten und Toleranzen → IO/NIO → CSV-Export.

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
   Standardansichten im Register **Ansicht** bzw. oben rechts in der Szene.
3. **Merkmale** → Typ wählen: *Automatisch* oder fest *Ebene, Kreis, Zylinder, Langloch, Kegel, Kugel, Punkt*.
   - **Klick + Wachstum:** auf die Fläche tippen. Vom Klickpunkt aus wachsen die Dreiecke, solange der Normalenwinkel
     zwischen Nachbarn unter dem Grenzwert liegt (Standard 20°); optional mit Suchradius. Kanten beenden das Wachstum.
   - **Pinsel:** Bereich überstreichen (während des Malens ist die Navigation pausiert), dann **Erstellen**.
   - Das Merkmal erscheint in der Baumansicht (Objekte › Merkmale), die verwendeten Punkte werden eingefärbt, die gefittete Geometrie gezeichnet.
4. Dialogbereich: Ist-Komponente (Mittelpunkt XYZ, Orientierung IJK, Durchmesser/Radius, Länge/Breite, Kegelwinkel,
   Formabweichung, Standardabweichung, Punktanzahl), RMS je Kandidatentyp der Erkennung, **Typ ändern → Neu fitten**.
5. **Prüfmerkmale**: je Merkmal Durchmesser, Radius, X/Y/Z, Länge/Breite, Kegelwinkel, Form (Ebenheit, Rundheit, Zylindrizität …).
   **Abstand X/Y/Z/3D**: erstes Merkmal wählen, Abstand anklicken, dann zweites Merkmal in der Baumansicht wählen.
6. **Prüfmerkmal-Tabelle** unten: Soll, Tol +, Tol − direkt eintragen (Komma oder Punkt). Abweichung und IO/NIO werden sofort berechnet und grün/rot markiert.
7. **Start → Tabelle CSV / Merkmale CSV** (Semikolon, Dezimalkomma, für Excel).

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

Alle Fits robust: nach dem ersten Fit werden Punkte mit |Residuum| > 3·σ (σ aus MAD) entfernt und neu gefittet.
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

## Grenzen v1
- Kein CAD-Import, keine Ausrichtung, kein Farbvergleich (bewusst ausgelassen, Architektur vorbereitet).
- Sollwerte werden von Hand eingetragen; Projekte können noch nicht gespeichert/geladen werden (nur CSV-Export).
- Punktwolken ohne Dreiecke: nur Pinsel-Auswahl (kein Regionenwachstum), Normalen werden noch nicht geschätzt → Zylinder/Kegel/Langloch dort unzuverlässig.
- Kreis wird aus einer Bohrung/einem Bolzen (Zylindermantel) berechnet; Kreise an ebenen Kanten ohne Mantelfläche werden nicht erkannt.
- Bei sehr großen Netzen (≈1 Mio. Punkte) dauert der Import einige Sekunden, ein Klick-Fit 2–4 s.
