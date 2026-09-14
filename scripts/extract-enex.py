"""One-time local ENEX extraction. Private output must stay outside public/dist."""
import argparse
import base64
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import xml.etree.ElementTree as ET
from urllib.parse import unquote_to_bytes


def extract(source, destination):
    os.umask(0o077)
    source, destination = Path(source).resolve(), Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=False)
    (destination / "resources").mkdir()
    manifest = {"source": str(source), "notebook": source.stem, "notes": [], "resources": 0, "bytes": 0}
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    manifest["sourceSha256"] = digest.hexdigest()
    # Some legacy web clips refer to resources absent from their note. Recover
    # exact matching bytes from another note when the export contains them.
    global_resources = {}
    scan_root = None
    for event, element in ET.iterparse(source, events=("start", "end")):
        if scan_root is None:
            scan_root = element
        if event != "end" or element.tag != "note":
            continue
        for resource in element.findall("resource"):
            data = base64.b64decode("".join(resource.findtext("data", "").split()), validate=True)
            md5, sha = hashlib.md5(data).hexdigest(), hashlib.sha256(data).hexdigest()
            (destination / "resources" / sha).write_bytes(data)
            mime = resource.findtext("mime", "application/octet-stream")
            global_resources[md5] = {"name": resource.findtext("resource-attributes/file-name") or md5 + (mimetypes.guess_extension(mime) or ".bin"), "type": "image/jpeg" if mime == "image/jpg" else mime, "size": len(data), "md5": md5, "sha256": sha}
        element.clear()
        scan_root.clear()
    root = None
    for event, element in ET.iterparse(source, events=("start", "end")):
        if root is None:
            root = element
            manifest["exportedAt"] = root.get("export-date")
        if event != "end" or element.tag != "note":
            continue
        index = len(manifest["notes"]) + 1
        attachments, hashes = [], {}
        for resource in element.findall("resource"):
            data = base64.b64decode("".join(resource.findtext("data", "").split()), validate=True)
            md5 = hashlib.md5(data).hexdigest()
            sha = hashlib.sha256(data).hexdigest()
            mime = resource.findtext("mime", "application/octet-stream")
            if mime == "image/jpg":
                mime = "image/jpeg"
            name = resource.findtext("resource-attributes/file-name") or md5 + (mimetypes.guess_extension(mime) or ".bin")
            rid = f"resource-{index}-{len(attachments) + 1}"
            path = destination / "resources" / sha
            if not path.exists():
                path.write_bytes(data)
            attachment = {"id": rid, "name": name, "type": mime, "size": len(data), "md5": md5, "sha256": sha}
            attachments.append(attachment)
            hashes[md5] = attachment
            manifest["resources"] += 1
            manifest["bytes"] += len(data)
        enml = element.findtext("content", "").strip()
        body = ET.fromstring(enml)
        warnings = []
        for node in body.iter():
            if node.tag == "en-note":
                node.tag = "div"
            elif node.tag == "en-media":
                attachment = hashes.get(node.get("hash", "").lower())
                if not attachment and node.get("hash", "").lower() in global_resources:
                    attachment = dict(global_resources[node.get("hash").lower()], id=f"resource-{index}-{len(attachments) + 1}")
                    attachments.append(attachment)
                    hashes[attachment["md5"]] = attachment
                    manifest["resources"] += 1
                    manifest["bytes"] += attachment["size"]
                    warnings.append("resource-recovered-from-another-note")
                if not attachment:
                    warnings.append({"missingResource": node.get("hash"), "type": node.get("type")})
                    label = node.get("alt") or node.get("type") or "添付ファイル"
                    missing_hash, missing_type = node.get("hash", ""), node.get("type", "")
                    node.tag = "span"
                    node.attrib.clear()
                    node.set("data-missing-resource", missing_hash)
                    node.set("data-resource-type", missing_type)
                    node.text = f"[元のENEXにデータがありません: {label}]"
                    continue
                node.set("data-attachment-id", attachment["id"])
                if attachment["type"] in ("image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/bmp"):
                    node.tag = "img"
                    if not node.get("alt"):
                        node.set("alt", "")
                    node.set("title", attachment["name"])
                else:
                    node.tag = "span"
                    node.set("data-file-id", attachment["id"])
                    node.text = attachment["name"]
            elif node.tag == "en-todo":
                checked = node.get("checked") == "true"
                node.tag = "input"
                node.attrib.clear()
                node.set("type", "checkbox")
                if checked:
                    node.set("checked", "checked")
            elif node.tag == "en-crypt":
                node.tag = "span"
                node.text = "[Evernoteの暗号化された本文: " + (node.text or "") + "]"
                warnings.append("encrypted-content-needs-Evernote-decryption")
            elif node.tag == "img" and node.get("src", "").startswith("data:image/"):
                header, encoded = node.get("src").split(",", 1)
                mime = header[5:].split(";")[0]
                data = base64.b64decode(encoded) if ";base64" in header else unquote_to_bytes(encoded)
                sha, md5 = hashlib.sha256(data).hexdigest(), hashlib.md5(data).hexdigest()
                rid = f"resource-{index}-{len(attachments) + 1}"
                (destination / "resources" / sha).write_bytes(data)
                attachments.append({"id": rid, "name": f"embedded-{md5}" + (mimetypes.guess_extension(mime) or ".img"), "type": mime, "size": len(data), "md5": md5, "sha256": sha})
                manifest["resources"] += 1
                manifest["bytes"] += len(data)
                manifest["embeddedImages"] = manifest.get("embeddedImages", 0) + 1
                node.attrib.pop("src")
                node.set("data-attachment-id", rid)
        html = ET.tostring(body, encoding="unicode", method="html")
        note = {
            "index": index, "title": element.findtext("title", ""), "html": html,
            "created": element.findtext("created"), "updated": element.findtext("updated"),
            "tags": [tag.text or "" for tag in element.findall("tag")],
            "attachments": attachments, "warnings": warnings,
        }
        name = f"note-{index:04}.json"
        (destination / name).write_text(json.dumps(note, ensure_ascii=False), encoding="utf-8")
        manifest["notes"].append(name)
        element.clear()
        root.clear()
    (destination / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"notes": len(manifest["notes"]), "resources": manifest["resources"], "bytes": manifest["bytes"], "output": str(destination)}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("destination")
    args = parser.parse_args()
    extract(args.source, args.destination)
