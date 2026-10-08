"""Move known redundant CDP text files into a verified evidence directory.

Only explicitly COMPLETED packages with authoritative 文案.txt are eligible.
Dry run by default; images and caption bytes are never rewritten.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path

EXTRAS = {"三平台文案.txt", "小红书文案.txt", "HR方案决策版.txt",
          "抖音口播脚本.txt", "全量生成记录.txt"}

def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def run(root, execute=False):
    root = Path(root).resolve(strict=True)
    evidence_root = root / "_内部台账与历史数据" / "生产证据"
    results = []
    for package in sorted(root.iterdir()):
        if not package.is_dir() or package.is_symlink() or not package.name.startswith("20"):
            continue
        manifest = package / "manifest.json"
        caption = package / "文案.txt"
        try:
            before = manifest.read_bytes()
            data = json.loads(before.decode("utf-8-sig"))
        except (OSError, ValueError):
            continue
        if data.get("lifecycleStatus") != "COMPLETED" or not caption.is_file() or caption.is_symlink():
            continue
        extras = [p for p in package.iterdir() if p.name in EXTRAS and p.is_file() and not p.is_symlink()]
        if not extras:
            continue
        evidence = evidence_root / package.name
        # Resolve the final target before any move, including pre-existing junctions.
        target = evidence.resolve()
        if not target.is_relative_to(root) or target.is_relative_to(package):
            raise ValueError("Evidence destination escaped boundary")
        hashes = {p.name: digest(p) for p in extras}
        caption_sha = digest(caption)
        receipt = {"package": str(package), "evidence": str(target), "movedFiles": hashes,
                   "captionSha256": caption_sha, "execute": execute}
        if execute:
            if manifest.read_bytes() != before:
                raise RuntimeError("Package changed since inspection")
            evidence.mkdir(parents=True, exist_ok=True)
            for p in extras:
                dest = evidence / p.name
                if dest.exists() and digest(dest) != hashes[p.name]:
                    raise RuntimeError("Evidence conflict: " + str(dest))
            backup = evidence / "manifest.before-copy-cleanup.json"
            if not backup.exists():
                with backup.open("xb") as f:
                    f.write(before)
            for p in extras:
                dest = evidence / p.name
                if digest(p) != hashes[p.name]:
                    raise RuntimeError("Source changed: " + str(p))
                if dest.exists():
                    # Duplicate evidence is preserved; no deletion is necessary.
                    raise RuntimeError("Evidence file already exists; manual reconciliation required")
                p.rename(dest)
                if digest(dest) != hashes[p.name]:
                    raise RuntimeError("Evidence verification failed")
            if digest(caption) != caption_sha:
                raise RuntimeError("Authoritative caption changed")
            data.update(deliveryLayout="flat-images-manifest-copy-v1", copyPath=str(caption),
                        evidencePath=str(target))
            temp = package / "manifest.copy-cleanup.tmp"
            with temp.open("x", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(temp, manifest)
            (evidence / "copy-cleanup-receipt.json").write_text(
                json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
        results.append(receipt)
    return {"execute": execute, "packages": len(results),
            "extraFiles": sum(len(x["movedFiles"]) for x in results), "results": results}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    print(json.dumps(run(args.root, args.execute), ensure_ascii=False))
