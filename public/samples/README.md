# Beispielteile (Demo-Messdaten)

| Datei | Teil | Dreiecke | Kantenlänge Ø (5–95 %) | Download (gzip) |
|---|---|---|---|---|
| `beispielteil.stl` | Beispielteil (Standard, Trainingsmodus) – tessellierte CAD + Rauschen | 284 227 | variabel (CAD) | 14,2 MB (ungepackt) |
| `pruefplatte.stl.gz` | Prüfplatte | 334 838 | 0,51 mm (0,39–0,62) | 13,0 MB |
| `flansch.stl.gz` | Flansch/Welle | 304 374 | 0,57 mm (0,45–0,69) | 11,1 MB |
| `freiform.stl.gz` | Freiform-Demoteil | 363 132 | 0,47 mm (0,36–0,57) | 13,7 MB |

Die drei Scan-Teile sehen aus wie Daten aus einem Streifenlicht-Scanner oder CT:
- Netz: isotrop neu vernetzt mit pymeshlab, mittlere Dreiecksqualität 0,96, keine Splitter, größte Kante < 1,1 mm.
- Streuung: tangentialer Jitter von 6 % der Kantenlänge.
- Rauschen: normal zur Fläche mit σ = 8 µm.
- Welligkeit: ±3 µm (Wellenlänge 9 × 13 mm).
- Scanlücken: 6 kleine Lücken mit Ø 0,8–1,8 mm.

Kanten mit einem Knick ab 15° bleiben scharf. Echte Rundungen sind im CAD modelliert: R6 und R4 an der Prüfplatte, R1,5 am Flansch.

**Soll-Geometrie** steht je Teil in `<teil>.json`:
- Typ, Mitte, Achse/Normale und Maße.
- `probe`: ein Prüfpunkt auf der Fläche. Ein Klick dort im Modus „Automatisch“ muss das Merkmal liefern.
- `mesh`: Netzstatistik.

Das Netz entspricht exakt dieser Soll-Geometrie plus Rauschen. Absichtlich eingebaute Abweichungen gibt es nicht.

Erzeugung: `python scripts/make_scan_parts.py public/samples`, danach `python scripts/make_sample_index.py`. Vorschaubilder: `npm run build && node scripts/make_thumbs.mjs`. Benötigt werden cadquery-ocp, numpy und pymeshlab.

## Prüfplatte (140 × 90 × 16)
- Ebenen: Oberseite z = 16, Unterseite z = 0.
- Teilkreis Ø60 um (70, 45): 6 × Ø8 durchgehend, Startwinkel 30°.
- Mittelbohrung Ø30 bei (70, 45).
- Langloch 1: 24 × 10, durchgehend, Mitte (22, 72), Längsrichtung X.
- Langloch 2: 24 × 10, 8 tief, Mitte (120, 45), Längsrichtung Y.
- Tasche: 30 × 20 × 6, Ecken R4, Boden z = 10.
- Kugel Ø20, Mitte (115, 17, 18).
- Kegel: Ø16 → Ø8 auf 10 mm Höhe bei (110, 74), Öffnungswinkel 43,603°.
- Senkrechte Ecken R6, obere Umfangskante Fase 1 × 45°.

## Flansch/Welle (Achse Z)
- Flansch Ø110 × 16 mit Kanten R1,5.
- Teilkreis Ø85: 6 × Ø10.
- Welle Ø50 (z 16–56) mit Torus-Einstich R25 / r2,5 bei z = 38.
- Absatz Ø36 (z 56–80).
- Kegel Ø36 → Ø24 (z 80–92), Öffnungswinkel 53,130°.
- Zapfen Ø24 (z 92–105).
- Bohrung Ø16 durchgehend.

## Freiform-Demoteil (130 × 80 × 20)
- Freiformfläche auf x 0–70: z = 20 + sin(πx/70)·(17 + 3·cos(2πy/80) + 2,5·y/80). Sie ist als B-Spline-Loft aus 15 Schnitten modelliert. An x = 70 entsteht ein Knick von 34–45° zur ebenen Oberseite.
- Bohrung Ø14 bei (100, 25).
- Bolzen Ø18 × 12 bei (100, 60).
- Halbkugel Ø16 bei (120, 25, 20).
- Kegel: Ø12 → Ø4 auf 10 mm Höhe bei (80, 64).

## Islands demo (80 × 60 × 10) – `inseldemo.stl.gz`
Synthetisch (generisch), erzeugt mit `python scripts/make_islanddemo.py public/samples` (numpy + scipy). Für Ebene › „All inside boundary“: Inseln und geglättete Berandung.
- Oberseite z = 10, Unterseite z = 0; Netz 0,4 mm (Delaunay), Rauschen σ = 8 µm.
- Teilkreis Ø40 um (40, 30): 6 × Ø8 durchgehend, Startwinkel 0°. Bohrungen bei 0°, 120°, 240° mit aufgeworfenem Rand (0,25 mm hoch, ~1 mm breit), bei 60° ein Spritzerkranz.
- Mittelbohrung Ø14; lokale Erhebung 0,5 mm bei (12, 48); flache Beule 0,12 mm bei (68, 10); Scanlücke Ø1,6 bei (15, 12).
