"""Extract every ENEX in a folder, then convert (no network or application writes)."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

source, destination = map(Path, sys.argv[1:3])
destination.mkdir(parents=True, exist_ok=True)
results = []
for enex in sorted(source.glob("*.enex")):
    directory = destination / hashlib.sha256(enex.name.encode()).hexdigest()[:12]
    extraction = subprocess.run([sys.executable, "scripts/extract-enex.py", str(enex), str(directory)], capture_output=True, text=True) if not (directory / "manifest.json").exists() else None
    if extraction and extraction.returncode:
        results.append({"notebook": enex.stem, "directory": str(directory), "error": extraction.stderr[-500:]})
        print(json.dumps(results[-1], ensure_ascii=False), flush=True)
        continue
    conversion = subprocess.run(["node", "--import", "tsx", "scripts/convert-enex.ts", str(directory)], capture_output=True, text=True)
    result = {"notebook": enex.stem, "directory": str(directory)}
    if conversion.returncode:
        result["error"] = conversion.stderr[-700:]
    else:
        report = json.loads((directory / "report.json").read_text())
        result.update({key: report[key] for key in ("notes", "resources", "bytes")})
        result["warningNotes"] = len(report["warnings"])
    results.append(result)
    print(json.dumps(result, ensure_ascii=False), flush=True)
(destination / "batch-report.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
