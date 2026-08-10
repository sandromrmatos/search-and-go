"""Temporary sanity check for the creature dataset (mirrors js/data.js logic)."""
import csv, os, re, sys, json

ROOT = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(ROOT, "Elemental Awakening Creatures.csv")
IMG_DIR = os.path.join(ROOT, "images")

with open(CSV_PATH, newline="", encoding="utf-8-sig") as f:
    rows = list(csv.DictReader(f))

species = []
for r in rows:
    sid = (r.get("id_output") or "").strip()
    if not sid:
        continue
    m = re.search(r"(\d+)\s*$", sid)
    species.append({
        "id": sid,
        "order": int(m.group(1)) if m else 0,
        "name": (r.get("Name") or "").strip(),
        "stage": int(re.search(r"(\d+)", r.get("Stage") or "1").group(1)),
        "type": (r.get("Type") or "").strip(),
        "image": (r.get("Image") or "").strip(),
        "rarity": int(r["Rarity"]) if (r.get("Rarity") or "").strip() else None,
        "evolves_to": (r.get("Evolves to") or "").strip() or None,
        "candy": int(r["Evolution candy"]) if (r.get("Evolution candy") or "").strip() else None,
    })

species.sort(key=lambda s: s["order"])
by_name = {s["name"].lower(): s for s in species}
by_id = {s["id"]: s for s in species}

errors, warnings = [], []

# --- ids unique
if len(by_id) != len(species):
    errors.append("duplicate ids present")

# --- images exist
disk = set(os.listdir(IMG_DIR))
for s in species:
    if s["image"] not in disk:
        errors.append(f'missing image for {s["name"]}: {s["image"]}')

# --- evolution links resolve
evolves_from = {}
for s in species:
    if s["evolves_to"]:
        t = by_name.get(s["evolves_to"].lower())
        if not t:
            errors.append(f'{s["name"]} evolves to unknown "{s["evolves_to"]}"')
        else:
            s["evolves_to_id"] = t["id"]
            if t["id"] in evolves_from:
                errors.append(f'{t["name"]} is the evolution target of two creatures')
            evolves_from[t["id"]] = s["id"]
            if s["candy"] is None:
                errors.append(f'{s["name"]} evolves but has no candy cost')
    else:
        s["evolves_to_id"] = None
        if s["candy"] is not None:
            warnings.append(f'{s["name"]} has candy cost but no evolution target')

# --- families
family_of, family_members = {}, {}
for s in species:
    if s["id"] in evolves_from:
        continue  # not a root
    chain, cur, guard = [], s, 0
    while cur and guard < 12:
        guard += 1
        chain.append(cur["id"])
        family_of[cur["id"]] = s["id"]
        cur = by_id.get(cur["evolves_to_id"]) if cur["evolves_to_id"] else None
    family_members[s["id"]] = chain

for s in species:
    if s["id"] not in family_of:
        errors.append(f'{s["name"]} is not part of any family (evolution loop?)')

# every family root must be stage 1
for root_id in family_members:
    if by_id[root_id]["stage"] != 1:
        errors.append(f'family root {by_id[root_id]["name"]} is not Stage 1')

# stage progression within a family must be 1 -> 2 -> 3
for root_id, chain in family_members.items():
    stages = [by_id[i]["stage"] for i in chain]
    if stages != list(range(1, len(stages) + 1)):
        errors.append(f'family {by_id[root_id]["name"]} has odd stage order: {stages}')

# --- rarity rules
stage1 = [s for s in species if s["stage"] == 1]
for s in species:
    if s["stage"] == 1 and s["rarity"] is None:
        errors.append(f'Stage 1 {s["name"]} has no rarity')
    if s["stage"] != 1 and s["rarity"] is not None:
        warnings.append(f'{s["name"]} (Stage {s["stage"]}) has a rarity value')

pools = {r: [s["name"] for s in stage1 if s["rarity"] == r] for r in range(1, 6)}
for r, pool in pools.items():
    if not pool:
        errors.append(f"no Stage 1 creature with rarity {r}")

print(f"species: {len(species)}  stage1/catchable: {len(stage1)}  families: {len(family_members)}")
print("rarity pool sizes:", {r: len(p) for r, p in pools.items()})
print("types:", sorted({s['type'] for s in species}))
print("multi-stage families:",
      sum(1 for c in family_members.values() if len(c) > 1),
      "· 3-stage families:",
      sum(1 for c in family_members.values() if len(c) == 3))
print("unused images:", sorted(disk - {s["image"] for s in species}))

if warnings:
    print("\nWARNINGS:")
    for w in warnings:
        print("  -", w)
if errors:
    print("\nERRORS:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("\nOK: dataset is consistent with the game rules.")
