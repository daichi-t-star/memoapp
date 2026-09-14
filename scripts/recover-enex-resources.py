"""Recover missing resource references using exact MD5 matches in other exports."""
import html
import json
from pathlib import Path
import re
import shutil
import sys

batch = Path(sys.argv[1])
rows = json.loads((batch / "batch-report.json").read_text())
catalog = {}
for row in rows:
    root = Path(row["directory"])
    manifest = json.loads((root / "manifest.json").read_text())
    for filename in manifest["notes"]:
        note = json.loads((root / filename).read_text())
        for attachment in note["attachments"]:
            catalog[attachment["md5"]] = (attachment, root / "resources" / attachment["sha256"])
total = 0
for row in rows:
    root = Path(row["directory"])
    manifest = json.loads((root / "manifest.json").read_text())
    recovered = 0
    for filename in manifest["notes"]:
        note = json.loads((root / filename).read_text())
        old = note["html"]
        def replace(match):
            global total, recovered
            md5 = match.group(1)
            if md5 not in catalog:
                return match.group(0)
            attachment, source = catalog[md5]
            existing = next((a for a in note["attachments"] if a["md5"] == md5), None)
            if not existing:
                existing = dict(attachment, id=f'resource-{note["index"]}-{len(note["attachments"]) + 1}')
                note["attachments"].append(existing)
                target = root / "resources" / existing["sha256"]
                if not target.exists():
                    shutil.copyfile(source, target)
                manifest["resources"] += 1
                manifest["bytes"] += existing["size"]
            rid = existing["id"]
            note["warnings"] = [w for w in note["warnings"] if not (isinstance(w, dict) and w.get("missingResource") == md5)]
            note["warnings"].append("resource-recovered-from-other-notebook")
            recovered += 1
            total += 1
            if existing["type"].startswith("image/"):
                return f'<img data-attachment-id="{rid}" alt="">'
            return f'<span data-file-id="{rid}" data-attachment-id="{rid}">{html.escape(existing["name"])}</span>'
        note["html"] = re.sub(r'<span data-missing-resource="([^"]+)" data-resource-type="[^"]*">.*?</span>', replace, note["html"], flags=re.S)
        if note["html"] != old:
            (root / filename).write_text(json.dumps(note, ensure_ascii=False))
    (root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    if recovered:
        print(json.dumps({"notebook": row["notebook"], "recoveredReferences": recovered}, ensure_ascii=False))
print(json.dumps({"recoveredReferences": total}))
