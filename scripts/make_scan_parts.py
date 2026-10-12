"""Erzeugt scannerähnliche Demo-Teile (isotropes Dreiecksnetz ~0,45 mm, Rauschen, Welligkeit, kleine Scanlücken).
Ablauf je Teil: CAD (OCC) -> feine Tessellierung -> isotropes Remeshing (pymeshlab) -> Jitter/Rauschen/Welligkeit -> Lücken -> STL.gz
Benötigt (nur Entwicklung): cadquery-ocp, numpy, pymeshlab.  Aufruf: python scripts/make_scan_parts.py [public/samples]"""
import sys, json, gzip, struct, math, time, numpy as np, pymeshlab
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeSphere, BRepPrimAPI_MakeTorus
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet, BRepFilletAPI_MakeChamfer
from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire
from OCP.GeomAPI import GeomAPI_PointsToBSpline
from OCP.collections import Array1_gp_Pnt as TColgp_Array1OfPnt
from OCP.gp import gp_Pnt, gp_Ax2, gp_Dir
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_EDGE, TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.BRep import BRep_Tool
from OCP.TopLoc import TopLoc_Location
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.GeomAbs import GeomAbs_Line
def st(c, n): return getattr(c, n + "_s", None) or getattr(c, n)
Z = gp_Dir(0, 0, 1)
cut = lambda a, b: BRepAlgoAPI_Cut(a, b).Shape()
fuse = lambda a, b: BRepAlgoAPI_Fuse(a, b).Shape()
def cyl(x, y, r, z0, h): return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, y, z0), Z), r, h).Shape()
def edges(s):
    e = TopExp_Explorer(s, TopAbs_EDGE); out = []
    while e.More(): out.append(st(TopoDS, "Edge")(e.Current())); e.Next()
    return out
def line_dir(e):
    c = BRepAdaptor_Curve(e)
    if c.GetType() != GeomAbs_Line: return None
    d = c.Line().Direction(); return (d.X(), d.Y(), d.Z()), c
def slot(x1, y1, x2, y2, w, z0, h):
    """Langloch-Werkzeug: Mittelpunkte der Endkreise (x1,y1)-(x2,y2), Breite w."""
    r = w / 2; L = math.hypot(x2 - x1, y2 - y1); ux, uy = (x2 - x1) / L, (y2 - y1) / L
    if abs(uy) < 1e-9: b = BRepPrimAPI_MakeBox(gp_Pnt(min(x1, x2), y1 - r, z0), L, w, h).Shape()
    else: b = BRepPrimAPI_MakeBox(gp_Pnt(x1 - r, min(y1, y2), z0), w, L, h).Shape()
    return fuse(fuse(b, cyl(x1, y1, r, z0, h)), cyl(x2, y2, r, z0, h))

# ---------------------------------------------------------------- Teil 1: Prüfplatte
def pruefplatte():
    s = BRepPrimAPI_MakeBox(140, 90, 16).Shape()
    f = BRepFilletAPI_MakeFillet(s)
    for e in edges(s):
        ld = line_dir(e)
        if ld and abs(ld[0][2]) > 0.99: f.Add(6.0, e)          # senkrechte Ecken R6
    s = f.Shape()
    ch = BRepFilletAPI_MakeChamfer(s)
    for e in edges(s):                                         # obere Umfangskante 1 x 45°
        c = BRepAdaptor_Curve(e); p = c.Value((c.FirstParameter() + c.LastParameter()) / 2)
        if abs(p.Z() - 16) < 1e-6 and (p.X() < 1e-6 or p.Y() < 1e-6 or abs(p.X() - 140) < 1e-6 or abs(p.Y() - 90) < 1e-6 or
                                     math.hypot(p.X() - 6, p.Y() - 6) < 6.1 or math.hypot(p.X() - 134, p.Y() - 6) < 6.1 or
                                     math.hypot(p.X() - 6, p.Y() - 84) < 6.1 or math.hypot(p.X() - 134, p.Y() - 84) < 6.1):
            ch.Add(1.0, e)
    s = ch.Shape()
    s = cut(s, cyl(70, 45, 15, -1, 18))                        # Mittelbohrung Ø30
    for k in range(6):                                         # Teilkreis Ø60, 6 x Ø8
        a = math.radians(30 + 60 * k); s = cut(s, cyl(70 + 30 * math.cos(a), 45 + 30 * math.sin(a), 4, -1, 18))
    s = cut(s, slot(15, 72, 29, 72, 10, -1, 18))                # Langloch 1 durchgehend 24 x 10
    s = cut(s, slot(120, 38, 120, 52, 10, 8, 9))                # Langloch 2 Tiefe 8
    t = BRepPrimAPI_MakeBox(gp_Pnt(15, 12, 10), 30, 20, 7).Shape()   # Tasche 30 x 20 x 6, Ecken R4
    f = BRepFilletAPI_MakeFillet(t)
    for e in edges(t):
        ld = line_dir(e)
        if ld and abs(ld[0][2]) > 0.99: f.Add(4.0, e)
    s = cut(s, f.Shape())
    s = fuse(s, BRepPrimAPI_MakeSphere(gp_Pnt(115, 17, 18), 10).Shape())     # Kugel Ø20
    s = fuse(s, BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(110, 74, 16), Z), 8, 4, 10).Shape())  # Kegel
    nominal = {
        "name": "Prüfplatte", "file": "pruefplatte.stl.gz", "units": "mm",
        "description": "Platte 140 × 90 × 16 mit Teilkreis 6 × Ø8 auf Ø60, Mittelbohrung Ø30, zwei Langlöchern, Tasche, Kugel und Kegel; Ecken R6, Fase 1 × 45°.",
        "features": [
            {"id": "Oberseite", "type": "Ebene", "point": [70, 45, 16], "normal": [0, 0, 1], "probe": [125, 60, 16]},
            {"id": "Unterseite", "type": "Ebene", "point": [70, 45, 0], "normal": [0, 0, -1]},
            {"id": "Mittelbohrung", "type": "Zylinder", "center": [70, 45, 8], "axis": [0, 0, 1], "diameter": 30, "probe": [85, 45, 8]},
            *[{"id": f"Teilkreis-Bohrung {k + 1}", "type": "Zylinder", "center": [round(70 + 30 * math.cos(math.radians(30 + 60 * k)), 4), round(45 + 30 * math.sin(math.radians(30 + 60 * k)), 4), 8], "axis": [0, 0, 1], "diameter": 8,
               **({"probe": [round(70 + 30 * math.cos(math.radians(30 + 60 * k)) + 4, 4), round(45 + 30 * math.sin(math.radians(30 + 60 * k)), 4), 8]} if k == 0 else {})} for k in range(6)],
            {"id": "Teilkreis", "type": "Teilkreis", "center": [70, 45], "diameter": 60, "count": 6, "startAngleDeg": 30},
            {"id": "Langloch 1", "type": "Langloch", "center": [22, 72, 16], "axis": [0, 0, 1], "length": 24, "width": 10, "through": True, "probe": [22, 77, 8]},
            {"id": "Langloch 2", "type": "Langloch", "center": [120, 45, 16], "axis": [0, 0, 1], "length": 24, "width": 10, "depth": 8},
            {"id": "Tasche", "type": "Tasche", "box": [[15, 12, 10], [45, 32, 16]], "cornerRadius": 4, "depth": 6, "floor": {"point": [30, 22, 10], "normal": [0, 0, 1]}},
            {"id": "Kugel", "type": "Kugel", "center": [115, 17, 18], "diameter": 20, "probe": [115, 17, 28]},
            {"id": "Kegel", "type": "Kegel", "apexAxis": [0, 0, 1], "baseCenter": [110, 74, 16], "baseDiameter": 16, "topDiameter": 8, "height": 10, "includedAngleDeg": round(2 * math.degrees(math.atan(4 / 10)), 4), "probe": [116.03, 74, 20]},
            {"id": "Eckenradien", "type": "Rundung", "radius": 6}, {"id": "Fase", "type": "Fase", "size": "1 x 45°"},
        ]}
    return s, nominal

# ---------------------------------------------------------------- Teil 2: Flansch/Welle
def flansch():
    d = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), Z), 55, 16).Shape()
    f = BRepFilletAPI_MakeFillet(d)
    for e in edges(d):
        c = BRepAdaptor_Curve(e)
        if c.GetType() != GeomAbs_Line: f.Add(1.5, e)               # Umfangskanten R1,5
    s = f.Shape()
    s = fuse(s, cyl(0, 0, 25, 16, 40))                               # Welle Ø50, z 16..56
    s = fuse(s, cyl(0, 0, 18, 56, 24))                               # Absatz Ø36, z 56..80
    s = fuse(s, BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(0, 0, 80), Z), 18, 12, 12).Shape())  # Kegel Ø36 -> Ø24
    s = fuse(s, cyl(0, 0, 12, 92, 13))                               # Zapfen Ø24, z 92..105
    s = cut(s, BRepPrimAPI_MakeTorus(gp_Ax2(gp_Pnt(0, 0, 38), Z), 25, 2.5).Shape())   # Torus-Einstich r2,5
    s = cut(s, cyl(0, 0, 8, -1, 107))                                # Bohrung Ø16
    for k in range(6): a = math.radians(60 * k); s = cut(s, cyl(42.5 * math.cos(a), 42.5 * math.sin(a), 5, -1, 18))  # Teilkreis Ø85
    nominal = {
        "name": "Flansch/Welle", "file": "flansch.stl.gz", "units": "mm",
        "description": "Rotationsteil: Flansch Ø110 × 16 mit Teilkreis 6 × Ø10 auf Ø85, Welle Ø50 mit Torus-Einstich, Absatz Ø36, Kegel 53,13°, Zapfen Ø24, Bohrung Ø16 – alle koaxial zur Z-Achse.",
        "features": [
            {"id": "Flansch Oberseite", "type": "Ebene", "point": [0, 0, 16], "normal": [0, 0, 1], "probe": [38, -14, 16]},
            {"id": "Flansch Unterseite", "type": "Ebene", "point": [0, 0, 0], "normal": [0, 0, -1]},
            {"id": "Flansch Umfang", "type": "Zylinder", "center": [0, 0, 8], "axis": [0, 0, 1], "diameter": 110, "probe": [0, -55, 8]},
            {"id": "Welle Ø50", "type": "Zylinder", "center": [0, 0, 36], "axis": [0, 0, 1], "diameter": 50, "range_z": [16, 56], "probe": [0, -25, 48]},
            {"id": "Absatz Ø36", "type": "Zylinder", "center": [0, 0, 68], "axis": [0, 0, 1], "diameter": 36, "probe": [0, -18, 68]},
            {"id": "Kegel", "type": "Kegel", "axis": [0, 0, 1], "fromZ": 80, "toZ": 92, "fromDiameter": 36, "toDiameter": 24, "includedAngleDeg": round(2 * math.degrees(math.atan(6 / 12)), 4), "probe": [0, -15, 86]},
            {"id": "Zapfen Ø24", "type": "Zylinder", "center": [0, 0, 98.5], "axis": [0, 0, 1], "diameter": 24, "probe": [0, -12, 99]},
            {"id": "Stirnfläche", "type": "Ebene", "point": [0, 0, 105], "normal": [0, 0, 1]},
            {"id": "Torus-Einstich", "type": "Torus", "center": [0, 0, 38], "axis": [0, 0, 1], "majorRadius": 25, "minorRadius": 2.5, "probe": [0, -22.5, 38]},
            {"id": "Bohrung Ø16", "type": "Zylinder", "center": [0, 0, 52.5], "axis": [0, 0, 1], "diameter": 16},
            *[{"id": f"Teilkreis-Bohrung {k + 1}", "type": "Zylinder", "center": [round(42.5 * math.cos(math.radians(60 * k)), 4), round(42.5 * math.sin(math.radians(60 * k)), 4), 8], "axis": [0, 0, 1], "diameter": 10,
               **({"probe": [42.5, -5, 8]} if k == 0 else {})} for k in range(6)],
            {"id": "Teilkreis", "type": "Teilkreis", "center": [0, 0], "diameter": 85, "count": 6, "startAngleDeg": 0},
            {"id": "Flanschkanten", "type": "Rundung", "radius": 1.5},
        ]}
    return s, nominal

# ---------------------------------------------------------------- Teil 3: Freiform-Demoteil
def hump(x, y): # Freiformhöhe über z=20 im Bereich x 0..70
    u = math.sin(math.pi * x / 70)
    return 20 + u * (17 + 3 * math.cos(2 * math.pi * y / 80) + 2.5 * y / 80)
def freiform():
    sec = BRepOffsetAPI_ThruSections(True, False, 1e-6)
    for i in range(15):
        x = 70 * i / 14; arr = TColgp_Array1OfPnt(1, 33)
        for j in range(33): y = 80 * j / 32; arr.SetValue(j + 1, gp_Pnt(x, y, hump(x, y)))
        top = GeomAPI_PointsToBSpline(arr, 3, 8).Curve()
        w = BRepBuilderAPI_MakeWire()
        w.Add(BRepBuilderAPI_MakeEdge(top).Edge())
        w.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(x, 80, hump(x, 80)), gp_Pnt(x, 80, 0)).Edge())
        w.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(x, 80, 0), gp_Pnt(x, 0, 0)).Edge())
        w.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(x, 0, 0), gp_Pnt(x, 0, hump(x, 0))).Edge())
        sec.AddWire(w.Wire())
    sec.Build(); s = sec.Shape()
    s = fuse(s, BRepPrimAPI_MakeBox(gp_Pnt(70, 0, 0), 60, 80, 20).Shape())
    s = cut(s, cyl(100, 25, 7, -1, 22))                                # Bohrung Ø14
    s = fuse(s, cyl(100, 60, 9, 20, 12))                               # Bolzen Ø18 × 12
    s = fuse(s, BRepPrimAPI_MakeSphere(gp_Pnt(120, 25, 20), 8).Shape())  # Halbkugel Ø16
    s = fuse(s, BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(80, 64, 20), Z), 6, 2, 10).Shape())  # Kegel
    nominal = {
        "name": "Freiform-Demoteil", "file": "freiform.stl.gz", "units": "mm",
        "description": "Block 130 × 80 × 20 mit glatter Freiformfläche (B-Spline, bis +22,5 mm) links und Regelgeometrie rechts: Bohrung Ø14, Bolzen Ø18, Halbkugel Ø16, Kegel.",
        "freeform": {"region_x": [0, 70], "formula": "z = 20 + sin(πx/70)·(17 + 3·cos(2πy/80) + 2.5·y/80)", "sections": 15, "pointsPerSection": 33},
        "features": [
            {"id": "Oberseite (eben)", "type": "Ebene", "point": [100, 40, 20], "normal": [0, 0, 1], "probe": [115, 45, 20]},
            {"id": "Unterseite", "type": "Ebene", "point": [65, 40, 0], "normal": [0, 0, -1]},
            {"id": "Bohrung Ø14", "type": "Zylinder", "center": [100, 25, 10], "axis": [0, 0, 1], "diameter": 14, "probe": [100, 18, 10]},
            {"id": "Bolzen Ø18", "type": "Zylinder", "center": [100, 60, 26], "axis": [0, 0, 1], "diameter": 18, "probe": [100, 51, 26]},
            {"id": "Halbkugel Ø16", "type": "Kugel", "center": [120, 25, 20], "diameter": 16, "probe": [120, 25, 28]},
            {"id": "Kegel", "type": "Kegel", "baseCenter": [80, 64, 20], "baseDiameter": 12, "topDiameter": 4, "height": 10, "includedAngleDeg": round(2 * math.degrees(math.atan(4 / 10)), 4), "probe": [84, 64, 25]},
            {"id": "Freiformfläche", "type": "Freiform", "region": "x 0..70", "probe": [35, 40, round(hump(35, 40), 4)]},
        ]}
    return s, nominal

# ---------------------------------------------------------------- Netz
def occ_mesh(s, defl):
    BRepMesh_IncrementalMesh(s, defl, False, 0.05, True)
    V = []; T = []; off = 0; e = TopExp_Explorer(s, TopAbs_FACE)
    while e.More():
        f = st(TopoDS, "Face")(e.Current()); loc = TopLoc_Location()
        p = st(BRep_Tool, "Triangulation")(f, loc); tr = loc.Transformation()
        for i in range(1, p.NbNodes() + 1): q = p.Node(i).Transformed(tr); V.append((q.X(), q.Y(), q.Z()))
        for i in range(1, p.NbTriangles() + 1):
            a, b, c = p.Triangle(i).Get(); t = (a - 1 + off, b - 1 + off, c - 1 + off)
            if f.Orientation() == TopAbs_REVERSED: t = (t[0], t[2], t[1])
            T.append(t)
        off += p.NbNodes(); e.Next()
    return np.array(V, float), np.array(T, np.int32)
def scanify(V, T, L, seed, holes=6):
    rng = np.random.default_rng(seed)
    ms = pymeshlab.MeshSet(); ms.add_mesh(pymeshlab.Mesh(V, T))
    ms.meshing_merge_close_vertices(threshold=pymeshlab.PureValue(1e-4))
    ms.meshing_remove_duplicate_faces(); ms.meshing_remove_null_faces()
    # Kanten ab 15° bleiben als Merkmalskanten erhalten (Knick zwischen Regelgeometrien)
    ms.meshing_surface_subdivision_midpoint(iterations=12, threshold=pymeshlab.PureValue(2 * L))   # lange CAD-Splitter vorab teilen
    ms.meshing_isotropic_explicit_remeshing(targetlen=pymeshlab.PureValue(L), iterations=15, featuredeg=15, adaptive=False)
    m = ms.current_mesh(); V = m.vertex_matrix().copy(); T = m.face_matrix().copy(); N = m.vertex_normal_matrix().copy()
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
    # tangentialer Jitter (natürliche Streuung der Dreiecksgrößen), Rauschen σ 8 µm entlang Normale, Welligkeit ±3 µm
    j = rng.normal(0, 0.06 * L, V.shape); j -= (j * N).sum(1, keepdims=True) * N
    wav = 0.003 * np.sin(2 * math.pi * V[:, 0] / 9.0 + 1.3) * np.sin(2 * math.pi * V[:, 1] / 13.0)
    V = V + j + N * (rng.normal(0, 0.008, (len(V), 1)) + wav[:, None])
    # kleine Scanlücken (r 0,4–0,9 mm) an zufälligen Stellen
    C = V[T].mean(1); keep = np.ones(len(T), bool)
    for _ in range(holes):
        c = C[rng.integers(len(C))]; keep &= np.linalg.norm(C - c, axis=1) > rng.uniform(0.4, 0.9)
    return V, T[keep]
def write_stl_gz(path, V, T, name):
    tris = V[T].astype(np.float32)
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]); n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    dt = np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]); a = np.zeros(len(tris), dt); a["n"] = n; a["v"] = tris
    raw = (f"MessWerk 3D Demo-Scan {name}".encode().ljust(80, b" ")) + struct.pack("<I", len(tris)) + a.tobytes()
    with gzip.open(path, "wb", compresslevel=9) as f: f.write(raw)
    return len(raw)
def stats(V, T):
    E = np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]]); l = np.linalg.norm(V[E[:, 0]] - V[E[:, 1]], axis=1)
    P = V[T]; a = np.linalg.norm(P[:, 1] - P[:, 0], axis=1); b = np.linalg.norm(P[:, 2] - P[:, 1], axis=1); c = np.linalg.norm(P[:, 0] - P[:, 2], axis=1)
    A = 0.5 * np.linalg.norm(np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]), axis=1)
    q = 4 * math.sqrt(3) * A / (a * a + b * b + c * c)  # 1 = gleichseitig
    return {"triangles": int(len(T)), "vertices": int(len(V)), "edge_mm": {"mean": round(float(l.mean()), 3), "p5": round(float(np.percentile(l, 5)), 3), "p95": round(float(np.percentile(l, 95)), 3), "max": round(float(l.max()), 3)},
            "quality": {"mean": round(float(q.mean()), 3), "p1": round(float(np.percentile(q, 1)), 3), "min": round(float(q.min()), 3)}}

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "public/samples"
    only = sys.argv[2:] or ["pruefplatte", "flansch", "freiform"]
    for i, key in enumerate(["pruefplatte", "flansch", "freiform"]):
        if key not in only: continue
        t0 = time.time(); s, nom = {"pruefplatte": pruefplatte, "flansch": flansch, "freiform": freiform}[key]()
        V, T = occ_mesh(s, 0.003)
        L = {'pruefplatte': 0.48, 'flansch': 0.55, 'freiform': 0.45}[key]
        V, T = scanify(V, T, L, 10 + i)
        size = write_stl_gz(f"{out}/{key}.stl.gz", V, T, nom["name"])
        nom["mesh"] = {**stats(V, T), "stl_bytes": size, "noise_sigma_mm": 0.008, "waviness_mm": 0.003, "target_edge_mm": L, "scan_holes": 6, "generator": "scripts/make_scan_parts.py"}
        json.dump(nom, open(f"{out}/{key}.json", "w"), ensure_ascii=False, indent=1)
        import os; print(key, nom["mesh"], "gz", os.path.getsize(f"{out}/{key}.stl.gz"), f"{time.time() - t0:.0f}s", flush=True)
