#!/usr/bin/env python3
"""Sample specified app + attributed webview PIDs; never include the robot JVM."""

import argparse
import json
import subprocess
import time


def cpu_seconds(text):
    parts = text.split(":")
    return sum(float(value) * 60**i for i, value in enumerate(reversed(parts)))


def sample(pids):
    result = subprocess.run(
        ["ps", "-o", "pid=,rss=,time=", "-p", ",".join(map(str, pids))],
        capture_output=True,
        text=True,
        check=True,
    )
    rows = [line.split() for line in result.stdout.splitlines() if line.strip()]
    if len(rows) != len(pids):
        raise RuntimeError(
            "A measured process exited; choose the current app/webview PIDs"
        )
    return {
        int(pid): {"rssKiB": int(rss), "cpuSeconds": cpu_seconds(cpu)}
        for pid, rss, cpu in rows
    }


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--pids", type=int, nargs="+", required=True)
parser.add_argument("--seconds", type=int, default=60)
args = parser.parse_args()
start = time.monotonic()
first = sample(args.pids)
peak_rss = sum(row["rssKiB"] for row in first.values())
while time.monotonic() - start < args.seconds:
    time.sleep(min(1, args.seconds - (time.monotonic() - start)))
    last = sample(args.pids)
    peak_rss = max(peak_rss, sum(row["rssKiB"] for row in last.values()))
elapsed = time.monotonic() - start
cpu = sum(last[pid]["cpuSeconds"] - first[pid]["cpuSeconds"] for pid in first)
print(
    json.dumps(
        {
            "pids": args.pids,
            "seconds": round(elapsed, 2),
            "peakResidentMiB": round(peak_rss / 1024, 2),
            "averageCpuPercentOfOneCore": round(cpu / elapsed * 100, 2),
        },
        indent=2,
    )
)
