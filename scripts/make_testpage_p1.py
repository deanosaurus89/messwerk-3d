"""Phase-1 section of public/test.html: ONE feature/change per item, grouped by release (Martin 19.10. 15:42).
Ids of earlier items are kept where the item continues (recorded results stay attached; F4/F5 = retests in 0.33)."""
import re, html
P = 'public/test.html'
R = [  # (release, [(id, title, steps, expected, note)])
 ('0.28', 'Datenmodell', [
  ('R1', 'Umbau Merkmal-Datenmodell (Merkmal → Ist) – nichts darf sich ändern', 'Ein mit 0.27 oder älter gespeichertes Projekt (.mw3d) öffnen bzw. „Letztes Projekt wiederherstellen“; Werte in Tabelle/Bericht vergleichen; neu speichern und wieder öffnen.', 'Alle Merkmale, Prüfmerkmale, Bezüge, KS, Beschriftungen und Berichtswerte exakt wie vorher; nach erneutem Speichern/Öffnen identisch.', 'Regressionscheck'),
 ]),
 ('0.29', 'Auswahl', [
  ('F1', 'Ebene per Click & grow – ein Klick, ganze Fläche', 'Beispielteil › Ebene › 👆 Click & grow › einmal auf die Oberseite tippen.', 'Die ganze zusammenhängende Oberseite ist ausgewählt (bis zu den Kanten, Bohrungen frei); ✓ erzeugt „Ebene n“.', ''),
  ('F1b', 'Merkmaldialog: Re-Extraktion zugeklappt', 'Ein Merkmal anklicken › Eigenschaften.', 'Re-Extraktion steht nur unter „⚙ Advanced · Re-extraction“ (zugeklappt); der Dialog ist kurz.', ''),
  ('F2', 'Zylinder per Click & grow', 'Zylinder › 👆 Click & grow › in die große Bohrung tippen.', 'Zylinder Ø ≈ 12,08.', ''),
  ('F2b', '„＋ Add region“ fügt Regionen hinzu', 'Nach F2: „＋ Add region“ › weitere Wandstücke (andere Seite) antippen › ✓.', 'Jede Region kommt dazu („n regions“), Ø bleibt plausibel; das Element enthält alle Regionen.', ''),
  ('F3', 'iPhone: Kreis durch Tippen auf die Kante', 'iPhone › Kreis › grob auf die Kante der kleinen Bohrung tippen (etwas auf der Ebene oder etwas an der Wand); mehrfach an verschiedenen Stellen.', 'Jedes Mal ein Kreis mit Wandpunkten (orange) und Hilfsebenenpunkten (blau), Ø ≈ 6.', ''),
  ('F3b', 'Saat-Rückmeldung beim Tippen', 'iPhone › Kreis oder Ebene › tippen.', 'Die Saat-Dreiecke im Pick-Kreis sind cyan hervorgehoben (auch an der Wand), bis zur Vorschau.', ''),
 ]),
 ('0.30', 'Rückmeldung + Erzeugen ohne Filter', [
  ('F5a', 'Vorschau zeigt nur Punkte, Formabweichung, Std.-Abw.', 'Beliebiges Element per Click & grow (Vorschau).', 'Unten im Panel genau: Punkte · Formabweichung · Std.-Abw. (Maße erst nach ✓ in Baum/Dialog).', ''),
  ('F5b', 'Maße ohne versteckte Filter', 'Ebene, Zylinder, Kreis, Kegel, Kugel am Beispielteil erzeugen; mit Sollmaßen vergleichen (Ø 12,08 / Ø 6, Bolzen Ø 16, Kugel R 7, Kegel R 10→4).', 'Maße ±0,01 mm, Std.-Abw. ≈ 0,008 mm; alle ausgewählten Punkte im Fit.', ''),
 ]),
 ('0.31', 'Berandung + Inseln', [
  ('F6', 'Geglättete Berandung', 'Load sample › „Islands demo (bolt circle)“ › Ebene oben und Zylinder in einer Bohrung › Vorschau und erzeugtes Element ansehen (auch iPhone).', 'Rand als glatte Kontur (kein Dreiecks-Zickzack), in Vorschau und am Element gleich.', ''),
  ('F6b', 'Glättung einstellbar (0 = aus, leer = auto)', 'Merkmaldialog › ⚙ Advanced › „Boundary smoothing“ 0 und leer vergleichen.', '0 zeigt den rohen Zickzack, leer = automatisch; Messwerte ändern sich nicht.', ''),
  ('F7', 'Inseln werden automatisch erkannt', 'Inseldemo › Ebene › Oberseite antippen › „🏝 Islands“ im Panel ansehen.', '◯ Löcher, ◎ Löcher mit Wulst/Spritzern, ▲ Erhebungen erkannt (orange umrandet) und ausgeschlossen.', ''),
  ('F7b', 'Insel „Refine ±“', 'Eine Insel antippen › „Refine“ +2 mm.', 'Die Aussparung wächst um 2 mm, Punkte sinken; das Element behält die Wahl.', ''),
 ]),
 ('0.32', 'Hilfsebene, Anzeige, Panel', [
  ('F8', 'Hilfsebene ◎ Ring (Kreis)', 'Kreis an der Bohrung Ø12 › „◎ Ring“ › Offset/Breite ändern.', 'Ring als Doppelkontur in der Hilfsebene, folgt Offset/Breite sofort; Ø ≈ 12,08.', ''),
  ('F8b', 'Hilfsebene ⊂⊃ Band (Langloch)', 'Langloch › „⊂⊃ Band“.', 'Band entlang der Kontur; Langloch 10 × 30.', ''),
  ('F8c', 'Hilfsebene ▭ zugewiesene Ebene', 'Ebene Oberseite erzeugen › Kreis › „▭ Plane“ (oder 🎯) › nur die Bohrungswand antippen.', 'Wandpunkte auf die gewählte Ebene projiziert; Quelle = Ebenenname.', ''),
  ('F8d', 'Auto nutzt nie heimlich eine vorhandene Ebene', 'Mit vorhandener Ebene: Kreis mit „▱ Auto“ erzeugen.', 'Quelle „automatic (adjacent face)“, nicht die vorhandene Ebene.', ''),
  ('F8e', 'Ansicht › „⁘ Used points“', 'Ansicht › Used points an/aus.', 'Zeigt die im Fit verwendeten Punkte aller Elemente in Elementfarbe; Standard aus.', ''),
  ('F8f', 'Baum-Rechtsklick › „Show used points“', 'Rechtsklick auf ein Element im Baum.', 'Nur dieses Element zeigt seine Punkte.', ''),
  ('F8g', 'Eine Darstellung (kein „Trimmed“-Schalter)', 'Ansicht ansehen.', 'Kein Trimmed-Schalter; jedes Element mit geglättetem Rand.', ''),
  ('F9', 'Dialog-Kopfzeile „Used points“', 'Element › Eigenschaften › oben „Used points“.', 'Checkbox neben Geometrie/Beschriftung schaltet die Punkte dieses Elements.', ''),
  ('F9b', '„Aux-plane points“ in eigener Farbe', 'Kreis mit Hilfsebene › Eigenschaften › „Aux-plane points“.', 'Hilfsebenen-Punkte blau, unabhängig von den Elementpunkten.', ''),
  ('F9c', 'Ansicht „▱ Aux-plane pts“ + Baum-Rechtsklick', 'Ansicht › Aux-plane pts; Rechtsklick › Show aux-plane points.', 'Alle bzw. ein Element zeigt die Hilfsebenen-Punkte blau.', ''),
  ('F9d', 'Creation Panel (Desktop) breiter und niedriger', 'Desktop: Vorschau einer Ebene ansehen; iPhone vergleichen.', 'Desktop weniger Zeilen, breiter; iPhone unverändert.', ''),
  ('F9e', 'Panel-Reihenfolge', 'Vorschau Zylinder: Panel ansehen.', 'Datum direkt nach dem Typ; „Boundary from“ direkt sichtbar; Search distance/Exclude raised unter „⚙ Advanced parameters“.', ''),
  ('F9f', '„− Remove region“ + „↶ Region“', 'Ebene › „− Remove region“ › einen Bereich bzw. eine Erhebung antippen › „↶ Region“.', 'Der Bereich fällt aus der Auswahl („1 removed“), ↶ stellt ihn wieder her.', ''),
  ('F10', 'Blocker-Fix: Re-Extract Kreis hält die Hilfsebene', 'Kreis an Bohrung Ø12 › Eigenschaften › ⚙ Advanced · Re-extraction › „✓ Apply extraction“ zweimal (auch mit größerer Search distance).', 'Hilfsebene exakt gleich (Lage, Seite, Normale); Ø 12,08 ±0,01.', ''),
  ('F10b', 'Re-Extract Langloch hält die Hilfsebene', 'Wie F10 mit dem Langloch.', 'Hilfsebene gleich; 10 × 30 ±0,02.', ''),
  ('F10c', 'Neuberechnung (Fit-Parameter ändern) hält die Hilfsebene', 'Kreis › Eigenschaften › einen Fit-Parameter ändern.', 'Hilfsebene gleich, Mittelpunkt in der Hilfsebene.', ''),
 ]),
 ('0.33', 'Pinsel, schlanke Berandung, ⚙-Menü, Baum', [
  ('F4', 'Retest: Pinsel in einem Schritt', 'Ebene (oder Auto) › 🖌 Brush › Fläche malen › Werte unten im Panel ansehen › grünes ✓.', 'Punkte/Form/Std. erscheinen nach jedem Strich im Panel; ✓ erzeugt sofort das Element – kein zweites Fenster.', 'Ergebnis 0.32: ❌ Major – zweites Bestätigungsfenster, „Use Auto Contour“'),
  ('F4b', 'Pinsel: Element auf die gemalte Fläche begrenzt', '🖌 Brush › zwei getrennte Flächen malen › ✓ › Element ansehen; Re-Extract.', 'Kein „Use outer contour“; Element genau auf den gemalten Bereichen (mehrere Inseln möglich); Re-Extract sucht nur darin.', ''),
  ('F5', 'Retest: Berandung schlank – Kontur automatisch', 'Ebene › Click & grow › Oberseite › Panel ansehen.', 'Kein „All inside boundary“ mehr; die erkannte Kontur gilt automatisch (Click & grow, Add region); deutlich schlankeres Panel.', 'Ergebnis 0.32: ❌ Major – Berandung zu kompliziert'),
  ('F5c', 'Insel aus der Liste entfernen', 'Inseldemo › Ebene › eine Insel antippen › „Not an island“.', 'Die Insel gehört wieder zur Ebene (Punkte steigen).', ''),
  ('F5d', 'Insel per Tippen hinzufügen', 'Islands › „＋ Island“ › eine Stelle der Ebene antippen (Pinselgröße = Durchmesser).', 'Ein Kreis mit Pinsel-Durchmesser wird ausgeschlossen (✚ in der Liste, ✕ entfernt ihn wieder).', ''),
  ('F5e', 'Keine Ausreißer-Entfernung beim Erzeugen', '⚙ Advanced parameters öffnen.', 'Keine „Outlier removal“; alle Punkte im Fit.', ''),
  ('F5f', '„Growth limit r“ entfernt', 'Click & grow: Panel/Dialog ansehen, Shift+Mausrad probieren; zwei Stellen nacheinander anklicken.', 'Kein Growth limit (auch nicht Shift+Rad); ein neuer Klick entfernt nichts von der vorigen Auswahl.', ''),
  ('F5g', '„Normal angle“ mit Tooltip und Doku-Bild', '⚙ Advanced parameters › Normal angle › Tooltip lesen › „?“.', 'Klarer Tooltip; Doku-Abschnitt mit Bild (Querschnitt: Wachstum stoppt an Rundung/Fase).', ''),
  ('F11', 'Eingefrorene Berandung: Re-Extract ohne Lücken', 'Ebene: Click & grow, Lücke mit „＋ Add region“ schließen › ✓ › Re-Extract mehrmals.', 'Keine Lücke; Punktzahl bleibt bei jeder Wiederholung gleich; nur der Ausschlussabstand versetzt den Rand.', ''),
  ('F12', 'Hilfsebenen-Optionen erst nach erkanntem Kreis', 'Auto bzw. Kreis wählen (noch nicht klicken) › dann Kreis antippen; danach eine Ebene antippen.', 'Vor dem Klick und bei Ebene keine ▱/◎/▭-Schalter; nach erkanntem Kreis/Langloch sichtbar.', ''),
  ('F13', '⚙-Menü immer vollständig sichtbar', 'Desktop + iPhone: ⚙ über dem Würfel öffnen – auch mit offenem Dialog, Tabelle und Creation Panel.', 'Alle Befehle sichtbar (öffnet sich ggf. seitlich bzw. scrollbar), nichts abgeschnitten.', ''),
  ('F14', '⚙-Menü: ohne „Center on origin“ und „ISO“', '⚙ öffnen; Rechtsklick auf das KS.', 'Beide Einträge fehlen im ⚙; „Center on origin“ bleibt im KS-Rechtsklick.', ''),
  ('F15', '⚙ „Transparent“ + Stärke in Optionen', '⚙ › Transparent; Optionen › Display › Transparency [%] ändern.', 'Datenobjekt wird durchsichtig; Stärke wirkt sofort und bleibt nach Neuladen.', ''),
  ('F16', 'Baum: Klick ins Leere hebt die Auswahl auf', 'Datenobjekt bzw. KS bzw. Element im Baum wählen › unten ins Leere klicken.', 'Nichts mehr ausgewählt, der Dialog folgt.', ''),
  ('F17', 'Baum: Gruppen „Data“ und „Reference“', 'Baum ansehen.', 'Gruppe Data (Polygonmodell) und neue Gruppe Reference (leer, später CAD).', ''),
  ('F19', 'Dialog: „Geometric properties ›“ als eine Zeile', 'Desktop: Element › Eigenschaften › unten „Geometric properties ›“ (Tooltip) anklicken.', 'Eine kompakte Zeile statt Text; öffnet das gleiche Info-Fenster wie bisher.', ''),
  ('F18', 'Baum: Gruppe anheften', 'An Data bzw. Reference 📌 klicken › Baum scrollen › erneut 📌.', 'Angeheftet steht die Gruppe immer oben sichtbar; gelöst wieder an ihrem Platz; bleibt nach Neuladen.', ''),
 ]),
 ('0.34', 'Start-Menüband neu', [
  ('R2', 'Desktop: alle Gruppen nebeneinander, kein Umschalter', 'Desktop (auch schmales Fenster ≈1024 px): Start-Reiter ansehen.', 'Features, Coordinate Systems und Mesh Editing gleichzeitig sichtbar; kein Abschnitts-Umschalter; nichts scrollt oder ist abgeschnitten.', ''),
  ('R2b', 'Auto groß, 8 Standardtypen klein mit ▾', 'Start › Auto bzw. Ebene, Kreis, Zylinder, Langloch, Linie, Kegel, Kugel, Punkt; je ▾ öffnen.', 'Auto groß links; die 8 Typen klein in 3 Reihen; ▾ zeigt die Methoden (Polygonmodell / Konstruktion / Anker).', ''),
  ('R2c', '⋯ More: Freiform, Linienzug, Torus, Lochkreis', 'Start › ⋯ More › jeden Eintrag einmal starten (Torus: ▾ = Methoden).', 'Alle vier Einträge da und funktionieren wie vorher; Menü schließt bei Klick daneben bzw. Esc.', ''),
  ('R2d', 'Spalte Distance / Angle', 'Start › Distance (▾ = Methode) bzw. Angle.', 'Beide klein in eigener Spalte, funktionieren wie vorher.', ''),
  ('R2e', 'EIN Properties / EIN Delete – für ein Element', 'Element im Baum wählen › Start › Properties; dann Delete.', 'Properties öffnet den Element-Dialog; Delete löscht nur dieses Element.', ''),
  ('R2f', 'EIN Properties / EIN Delete – für ein Koordinatensystem', 'KS im Baum wählen › Properties (= bearbeiten) › abbrechen › Delete. Danach „Global (WCS)“ wählen.', 'KS wird bearbeitet bzw. gelöscht (Elemente bleiben); bei Global sind beide ausgegraut.', ''),
  ('R2g', 'KS-Gruppe nur „New 3-2-1“ und „Activate“', 'Start › Coordinate Systems ansehen; Global/alle zeigen/Blick entlang Z über den Baum (Global-Punkt, Auge am Ordner, KS-Rechtsklick).', 'Kein From datums, Global, Show all, View along Z mehr im Band – alles weiter über den Baum erreichbar.', ''),
  ('R2h', 'Mesh-Gruppe: Status im Gruppennamen, ⋯ More = Subdivide', 'Start › Mesh Editing: Reduce, Smooth, Magic eraser, Compare, Restore original; ⋯ More › Subdivide; eine Reduktion ausführen.', 'Alle Befehle wie vorher; Gruppenname zeigt „Mesh Editing · Original“ bzw. „n edit(s)“.', ''),
  ('R2i', 'Schnellzugriff ↶ / ↷ in der Titelleiste', 'Eine Mesh-Bearbeitung ausführen › ↶ in der Titelleiste (oder Strg+Z); ↷ ansehen.', '↶ macht die letzte Mesh-Bearbeitung rückgängig (vorher ausgegraut); ↷ ausgegraut (kommt mit globalem Rückgängig).', ''),
  ('R2j', 'iPhone: Umschalter bleibt, ↶ ↷ rechts in der Chip-Zeile', 'iPhone: Start › Features / Coordinate Systems / Mesh editing durchschalten.', 'Schlanke Inhalte (Auto hoch, Typen in 2 Reihen), ↶ ↷ rechts in der Chip-Zeile, nichts scrollt.', ''),
  ('R2k', 'Tooltips im Start-Band', 'Desktop: über jede Schaltfläche (auch ▾, ⋯, ↶ ↷) fahren.', 'Jede Schaltfläche hat einen erklärenden Tooltip.', ''),
 ]),
 ('0.35', 'Re-Extract mit eingefrorener Berandung exakt', [
  ('F20', 'Re-Extract (Ausschlussabstand 0) = genau die Punkte der Erzeugung', 'Demo-Teil: Oberseite per Click & grow › ✓ › Eigenschaften › 🔁 Extraction › „Apply extraction“ zweimal; Projekt speichern/laden, nochmals.', 'Punktzahl exakt gleich wie beim Erzeugen (ab 0.36 neues Demo-Netz: ca. 19 000), auch nach Speichern/Laden; keine Randpunkte der Rundung dazu.', ''),
  ('F20b', 'Re-Extract mit Ausschlussabstand > 0 = Teilmenge', 'Wie F20, dann Boundary exclusion distance 1 mm › Apply.', 'Weniger Punkte, nur Punkte der Erzeugung, alle mindestens 1 mm innerhalb der Berandung (auch um Inseln).', ''),
 ]),
 ('0.36', 'Robuste Normalen, keine Löcher/Splitter in Ebenen, neues Demo-Netz', [
  ('F21', 'Ebene ohne Löcher in der Mitte', 'Demo-Teil: Oberseite per Click & grow › ✓ › Rechtsklick im Baum › Show used points; Fläche absuchen (auch nahe den langen Kanten).', 'Die ganze Oberseite ist ausgewählt; keine einzelnen nicht gewählten Punkte oder Streifen mitten in der Fläche – nur an den echten Kanten (Rand, Bohrungen, Langloch, Bolzen, Kegel, Kugel, Torus).', ''),
  ('F21b', 'Wachsen stoppt weiterhin an echten Kanten', 'Demo-Teil: Click & grow auf die Oberseite nahe der Bohrung Ø12 und nahe dem Bolzen; danach auf die Bohrungswand und die Bolzenwand.', 'Ebene läuft nicht in Wände/Rundungen; Zylinder läuft nicht auf die Ebene. Normalenwinkel (Advanced) wirkt wie bisher.', ''),
  ('F21c', 'Eingefrorene Berandung = Außenkontur + echte Inseln', 'Wie F21, dann Eigenschaften › 🔁 Extraction › Boundary exclusion distance 1 mm › Apply.', 'Punkte fehlen nur in einem 1-mm-Band am Außenrand und um Bohrungen/Inseln – keine schmalen Lücken mitten in der Fläche.', ''),
  ('F21d', 'Neues Netz des Demo-Teils', 'Training/Beispiel laden › View › Wireframe; Oberseite heranzoomen.', 'Gleichmäßige, fast gleichseitige Dreiecke (~0,5 mm) statt langer Nadeldreiecke; Ladezeit normal (Desktop und iPhone).', ''),
  ('F21e', 'Sollwerte des Demo-Teils unverändert', 'Bohrung Ø12, Bolzen Ø16, Langloch 30×10, Kugel R7, Torus r2 per Click & grow erzeugen.', 'Bohrung ≈ 12,08, Bolzen ≈ 16,00 (X +0,05), Langloch ≈ 30 × 10, Kugel ≈ R7, Torus ≈ r2 – innerhalb der Toleranzen.', ''),
  ('F21f', 'Tooltip/Doku Normalenwinkel', 'Creation Panel › Advanced › über „Normal angle“ fahren; Doku-Abschnitt „Normal angle“ öffnen.', 'Erklärt die robuste Normale (Ebenen-Fit über 1,3 × Kantenlänge bei Nadeldreiecken), Bedeutung des Winkels unverändert.', ''),
 ]),
 ('0.37', 'Derive-Knopf sichtbar, Classes erklärt', [
  ('A37', 'Analyze › 🔗 Derive: Bestätigen-Knopf sichtbar', 'iPhone und Desktop: Zylinder › Rechtwinkligkeit › Analyze › 🔗 Derive › Derived median line; ebenso Minimum-zone axis (Ebene: Flatness zone planes).', '„＋ Add to tree“ ist blau mit weißer Schrift (nicht leer); Klick legt den Linienzug/die Linie im Baum an.', ''),
  ('A37b', 'Analyze › Classes erklärt', 'Analyze › über „Classes“ fahren; Doku Farbskala öffnen.', 'Beispiel: 10 Klassen über ±0,05 mm = Bänder von 0,01 mm; 0 = stufenloser Verlauf; blau unten, grün Mitte, rot oben.', ''),
 ]),
 ('0.38', 'Einheitliche Normalen, Pick-Modus, Inseln, Fixes', [
  ('N38', 'Einheitliche kantenerhaltende Normalen – Kanten wie 0.36, Laden schnell', 'Beispielteil und Flansch laden (Ladezeit beobachten, auch iPhone); Ebene oben, Bohrung Ø12, Bolzen, Kegel, Kugel, Torus je per Auto antippen, auch knapp (0,3–0,8 mm) neben einer Kante.', 'Laden mindestens so schnell wie 0.37; Flächen werden bis ca. 0,3 mm an die Kante gewählt, kein Auslaufen über Kanten; Maße wie 0.37 (Ø 12,08, Bolzen Ø 16, Kugel R 7).', ''),
  ('P38', 'Desktop: Pick-Modus in der Merkmalerzeugung', 'Desktop › Auto oder Kreis/Ebene … (Click & grow) › Maus ziehen und Mausrad drehen; dann Leertaste › ziehen/drehen; wieder Leertaste.', 'Im Pick-Modus ändert die Maus die Ansicht NICHT; das Rad ändert den Pick-Radius (Kreis am Cursor). Leertaste = Navigation (drehen/zoomen), nochmals Leertaste = wieder picken. Auch bei Pinsel/Radierer: Rad = Pinselradius.', ''),
  ('I38', 'Inseln: alle entfernbar, auch Löcher', 'Inseldemo › Ebene › Click & grow auf die Platte › 🏝 Islands aufklappen › ein Loch (◯) antippen › „Not an island“.', 'Auch Löcher lassen sich entfernen; danach ist das Loch geschlossen dargestellt (keine Kontur); Hinweis „⚠ probably a hole/bore“.', ''),
  ('I38b', 'Inseln: Abschnitt zugeklappt, Zusammenfassung in der ersten Zeile', 'Wie I38, Panel ansehen (Desktop und iPhone).', 'Inselbereich standardmäßig zugeklappt, „🏝 Islands n“ steht in der ersten Zeile; aufgeklappt umbrechen die Chips ohne Scrollen; ab > 20 Inseln eine kompakte Auswahlliste.', ''),
  ('D38', 'Neues Demo-Teil „Multi-Feature plate (real scan)“', 'Load sample › Multi-Feature plate › laden; einige Elemente per Auto antippen.', 'Teil lädt mit Vorschaubild und Kurzbeschreibung; Auto erkennt Ebenen, Bohrungen, Langlöcher.', ''),
  ('F11b', 'Retest F11: Re-Extract mit „Boundary from: Point selection“ stabil', 'Zylinder/Kegel per Click & grow (Boundary from: Point selection) › ✓ › Eigenschaften › Re-extraction mehrmals hintereinander ausführen.', 'Punktzahl bleibt bei jeder Wiederholung identisch (wächst nicht mehr).', ''),
  ('F13b', 'Retest F13: ⚙ über dem Navigationswürfel bleibt sichtbar', 'Desktop und iPhone › Merkmal erzeugen (Auto/Ebene) › ⚙ links über dem Würfel suchen und anklicken.', '⚙ ist während der Merkmalerzeugung sichtbar und bedienbar (nicht vom Panel verdeckt).', ''),
  ('F15b', 'Retest F15: Datenobjekt standardmäßig undurchsichtig, Transparent schaltet', 'Desktop › App neu laden › Modell ansehen › ⚙ › Transparent an/aus (auch Options › Display).', 'Modell ist beim Start undurchsichtig; Transparent macht es durchscheinend, nochmals aus wieder undurchsichtig.', ''),
 ]),
]
RADIO = '<div class="s">' + ''.join(f'<label><input type="radio" name="{{id}}" value="{v}"{" checked" if v == "skip" else ""}>{t}</label>' for v, t in [('ok', '✅ Vollständig'), ('warn', '⚠️ Eingeschränkt'), ('fail', '❌ Geht nicht'), ('skip', '⏸ Nicht getestet')]) + '</div>'
SEV = '<label class="sevl">Schweregrad <select class="sev"><option value="">–</option><option>Blocker</option><option>Major</option><option>Minor</option></select></label>'
def item(rel, i, t, s, e, note):
    nt = f' <span class="obsn">{html.escape(note)}</span>' if note else ''
    return (f'<div class="it" data-id="{i}" data-grp="p1" data-from="{rel}"><div class="h"><b>{i}</b> <span class="na">noch nicht verfügbar</span>{nt}</div>'
            f'<div class="t"><b>{html.escape(t)}</b></div><div class="steps">▶ {html.escape(s)}</div><div class="exp">✔ Erwartet: {html.escape(e)}</div>\n'
            + RADIO.replace('{id}', i) + SEV + '\n<textarea class="cm" placeholder="Kommentar (Pflicht bei ⚠️/❌)"></textarea>\n'
            '<details class="bug"><summary>🐞 Fehler melden</summary><textarea class="bt" placeholder="Was passiert? Schritte, Gerät (Desktop/iPhone), erwartet vs. tatsächlich"></textarea></details></div>')
out = ['<h2>Phase 1 – Merkmalerzeugung (19.–25.10.)</h2><p class="note">Je Release ein Abschnitt; jeder Punkt prüft genau EINE Funktion/Änderung. Punkte mit „noch nicht verfügbar“ kommen mit dem genannten Release.</p>']
# 0.38 (Martin 19.10. 23:35/23:57): bestandene Punkte in einen zugeklappten Abschnitt „Erledigt“, offene oben
DONE = {'R1', 'F1', 'F1b', 'F2', 'F2b', 'F3', 'F3b', 'F5a', 'F4', 'F4b', 'F5c', 'F5d', 'F5e', 'F5f', 'F5g', 'F12', 'F14', 'F17', 'F18', 'F19'}
DNOTE = {'F4': 'ersetzt durch F4b'}
done = []
for rel, name, items in R:
    op = [x for x in items if x[0] not in DONE]
    done += [(rel, x) for x in items if x[0] in DONE]
    if op:
        out.append(f'<h3 class="rel">Release {rel} – {html.escape(name)}</h3>')
        out += [item(rel, *x) for x in op]
out.append(f'<details class="sec done-sec"><summary>✅ Erledigt ({len(done)}) – von Martin bestanden</summary>')
out += [item(rel, x[0], x[1], x[2], x[3], DNOTE.get(x[0], x[4] or 'bestanden')) for rel, x in done]
out.append('</details>')
s = open(P).read()
a = s.index('<h2>Phase 1'); b = s.index('<details class="sec"', a)
s = s[:a] + '\n'.join(out) + '\n' + s[b:]
s = s.replace('details.bug{margin-top:6px;font-size:14px}', 'details.bug{margin-top:6px;font-size:14px}h3.rel{font-size:15px;margin:16px 0 2px;color:#0d47a1;border-bottom:1px solid #c5d3e3}.sevl{font-size:14px;margin-left:4px}', 1) if 'h3.rel' not in s else s
open(P, 'w').write(s)
print(sum(len(x[2]) for x in R), 'items')
