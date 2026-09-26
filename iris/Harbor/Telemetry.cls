Class Harbor.Telemetry Extends %RegisteredObject
{
/// Linux host metrics, collected inside IRIS by Embedded Python. No subprocesses.
ClassMethod Read() As %String [ Language = python ]
{
    import json, os, time, platform
    from pathlib import Path
    result = {"sampledAt": time.time(), "platform": platform.system(), "scope": "IRIS host (container host metrics are not container limits)"}
    if platform.system() == "Linux":
        mem = {}
        for line in Path("/proc/meminfo").read_text().splitlines():
            key, value = line.split(":", 1)
            mem[key] = int(value.strip().split()[0]) * 1024
        result["memory"] = {"total": mem.get("MemTotal", 0), "available": mem.get("MemAvailable", 0)}
        cpu = [int(v) for v in Path("/proc/stat").read_text().splitlines()[0].split()[1:9]]
        result["cpu"] = {"totalTicks": sum(cpu), "idleTicks": cpu[3] + cpu[4], "logicalCount": os.cpu_count(), "loadAverage": list(os.getloadavg())}
        result["uptimeSeconds"] = float(Path("/proc/uptime").read_text().split()[0])
    else:
        result["notice"] = "Detailed memory and CPU counters are available on Linux; use the native IRIS dashboard on other platforms."
    import iris
    directory = str(iris.system.Util.ManagerDirectory())
    import shutil
    usage = shutil.disk_usage(directory)
    result["disk"] = {"path": directory, "total": usage.total, "free": usage.free, "used": usage.used}
    return json.dumps(result)
}

/// Fixed log allowlist, bounded tail, no client-supplied filesystem paths.
ClassMethod Logs(source As %String = "messages", limit As %Integer = 200) As %String [ Language = python ]
{
    import json, iris, re
    from pathlib import Path
    names = {"messages": "messages.log", "alerts": "alerts.log"}
    if source not in names:
        raise ValueError("Unknown log source")
    limit = max(1, min(int(limit), 500))
    path = Path(str(iris.system.Util.ManagerDirectory())) / names[source]
    if not path.is_file():
        return json.dumps({"source": source, "lines": [], "notice": "This log file has not been created on this instance."})
    with path.open("rb") as handle:
        handle.seek(0, 2)
        size = handle.tell()
        start = max(0, size - 1048576)
        handle.seek(start)
        if start:
            handle.readline()
        lines = handle.read(1048576).decode("utf-8", "replace").splitlines()[-limit:]
    # Best-effort masking only: operational logs must still be treated as sensitive.
    lines = [re.sub(r"(?i)(password|token|secret)([=: ]+)(\S+)", r"\1\2[redacted]", line) for line in lines]
    return json.dumps({"source": source, "lines": lines, "bytes": size, "bounded": True})
}
}
