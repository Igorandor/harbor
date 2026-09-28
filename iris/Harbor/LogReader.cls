Class Harbor.LogReader Extends %RegisteredObject
{
/// Enumerate a fixed family of ordinary log files. No caller-supplied path is accepted.
ClassMethod Catalog() As %String [ Language = python ]
{
    import json, os, re, iris
    from pathlib import Path
    root = Path(str(iris.system.Util.ManagerDirectory())).resolve()
    allowed = re.compile(r"^(?:(messages|alerts)\.log(?:[._-][0-9][0-9._-]{0,39})?|(messages)\.old_[0-9][0-9._-]{0,39})$")
    files = []
    examined = 0
    with os.scandir(root) as entries:
        for entry in entries:
            examined += 1
            if examined > 10000:
                break
            match = allowed.fullmatch(entry.name)
            if not match or entry.is_symlink() or not entry.is_file(follow_symlinks=False):
                continue
            details = entry.stat(follow_symlinks=False)
            files.append({"id": entry.name, "source": match.group(1) or match.group(2), "bytes": details.st_size, "modifiedAt": details.st_mtime, "active": entry.name in ("messages.log", "alerts.log")})
            if len(files) >= 100:
                break
    files.sort(key=lambda item: (not item["active"], -item["modifiedAt"], item["id"]))
    return json.dumps({"files": files, "limited": examined > 10000 or len(files) >= 100, "notice": "Reads messages.log, alerts.log, numeric .log rotations and messages.old_Date files in the manager directory. Compressed archives are not read."})
}

/// Read a previous byte window. Every read is capped before parsing lines.
ClassMethod Window(file As %String, offset As %String = "", snapshot As %String = "", identity As %String = "", limit As %Integer = 200) As %String [ Language = python ]
{
    import json, os, re, hashlib, iris
    from pathlib import Path
    allowed = re.compile(r"^(?:(messages|alerts)\.log(?:[._-][0-9][0-9._-]{0,39})?|(messages)\.old_[0-9][0-9._-]{0,39})$")
    if not allowed.fullmatch(file):
        return json.dumps({"error": "Unknown log file", "status": 400})
    root = Path(str(iris.system.Util.ManagerDirectory())).resolve()
    path = root / file
    if path.is_symlink() or not path.is_file() or path.resolve().parent != root:
        return json.dumps({"error": "The selected log is no longer available", "status": 404})
    for number in (offset, snapshot):
        if number and (not number.isdigit() or len(number) > 16):
            return json.dumps({"error": "Invalid log window", "status": 400})
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as stream:
        details = os.fstat(stream.fileno())
        size = details.st_size
        prefix = stream.read(min(size, 64))
        stamp = hashlib.sha256((str(details.st_dev) + ":" + str(details.st_ino)).encode() + b":" + prefix).hexdigest()
        if identity and identity != stamp:
            return json.dumps({"error": "The log was replaced or rotated. Start a new view", "status": 409})
        bound = int(snapshot) if snapshot else size
        end = int(offset) if offset else bound
        if bound > size or end > bound:
            return json.dumps({"error": "The log was truncated. Start a new view", "status": 409})
        budget = 262144
        start = max(0, end - budget)
        stream.seek(start)
        content = stream.read(min(budget, end - start))
        scanned = len(content)
        skipped = 0
        if start:
            boundary = content.find(b"\n")
            if boundary < 0:
                return json.dumps({"file": file, "identity": stamp, "snapshotBytes": bound, "currentBytes": size, "start": start, "end": end, "scannedBytes": scanned, "lines": [], "olderOffset": start if start > 0 else None, "notice": "No complete line exists in this 256 KiB window. A long partial line was omitted."})
            skipped = boundary + 1
            content = content[skipped:]
        pieces = content.splitlines(keepends=True)
        maximum = max(1, min(int(limit), 500))
        earlier = pieces[:-maximum]
        chosen = pieces[-maximum:]
        position = start + skipped + sum(len(piece) for piece in earlier)
        first = position
        lines = []
        for piece in chosen:
            text = piece.rstrip(b"\r\n").decode("utf-8", "replace")
            clipped = len(text) > 16384
            if clipped:
                text = text[:16384] + " [line clipped]"
            text = re.sub(r"(?i)(password|token|secret)([=: ]+)(\S+)", r"\1\2[redacted]", text)
            lines.append({"offset": position, "text": text, "clipped": clipped})
            position += len(piece)
        if os.fstat(stream.fileno()).st_size < bound:
            return json.dumps({"error": "The log changed during reading. Start a new view", "status": 409})
        return json.dumps({"file": file, "identity": stamp, "snapshotBytes": bound, "currentBytes": size, "start": first, "end": end, "scannedBytes": scanned, "lines": lines, "olderOffset": first if first > 0 else None, "notice": "Search applies to this page. Log text may contain sensitive operational data."})
}
}
