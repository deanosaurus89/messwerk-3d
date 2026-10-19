"""Schreibt public/samples/index.json (Liste für den Dialog „Beispiel laden“)."""
import json, os
d = "public/samples"
items = [{"key": "beispielteil", "name": "Beispielteil (Standard)", "file": "beispielteil.stl", "kind": "Scan-ähnlich (isotropes Netz ~0,5 mm)",
          "description": "Block 100 × 60 × 20: Bohrungen Ø12/Ø6, Langloch, Bolzen, Kegel, Kugel, Torus. Für den Trainingsmodus.", "triangles": 183612}]
for k in ["pruefplatte", "flansch", "freiform"]:
    j = json.load(open(f"{d}/{k}.json"))
    items.append({"key": k, "name": j["name"], "file": j["file"], "kind": "Scan-ähnlich (isotropes Netz)", "description": j["description"], "triangles": j["mesh"]["triangles"]})
for it in items:
    it["bytes"] = os.path.getsize(f"{d}/{it['file']}"); it["thumb"] = f"thumb-{it['key']}.jpg"
json.dump(items, open(f"{d}/index.json", "w"), ensure_ascii=False, indent=1); print(len(items))
