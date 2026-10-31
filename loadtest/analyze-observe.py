#!/usr/bin/env python3
"""loadtest.sh observe가 기록한 TSV에서 CPU 용량 근거를 뽑는다. 자세한 사용법은 loadtest/README.md

  python loadtest/analyze-observe.py results/observe-normal.tsv
  python loadtest/analyze-observe.py results/observe-peak.tsv --from 14:05:00 --to 14:25:00

docker stats의 CPU%는 코어 하나가 100%라서 100으로 나눈 값을 vCPU로 읽는다. 컨테이너 vCPU의 합이
호스트 1 vCPU를 넘으면 컨테이너 한도 합(2.0)이 실제로 겹쳤다는 뜻이다. 호스트가 1 vCPU라 합이 1.0을 넘는 구간은
CPU를 나눠 쓰느라 서로 느려진 구간이다.
"""
import argparse
import csv
import statistics
import sys
from collections import defaultdict

# docker-compose.yml의 cpus 한도. 이름에 포함된 글자로 찾으므로 긴 이름을 먼저 둔다
LIMITS = [
    ("server-mock", 0.20),
    ("server", 0.40),
    ("ai", 0.60),
    ("osrm", 0.30),
    ("postgres", 0.30),
    ("nginx", 0.10),
    ("valkey", 0.10),
]
HOST_VCPU = 1.0


def limit_of(name):
    for key, limit in LIMITS:
        if key in name:
            return limit
    return None


def seconds(hms):
    h, m, s = (int(x) for x in hms.split(":"))
    return h * 3600 + m * 60 + s


def percentile(values, q):
    ordered = sorted(values)
    if not ordered:
        return float("nan")
    index = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return ordered[index]


def number(text):
    try:
        return float(text.strip().rstrip("%"))
    except ValueError:
        return None


def read(path, start, end):
    per_time = defaultdict(dict)  # 시각 -> {컨테이너: vCPU}
    host = {}  # 시각 -> (host_cpu%, steal%)
    extras = {}  # 시각 -> (avail_mb, swap_mb, load1)
    with open(path, newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            when = row["time"]
            if start is not None and seconds(when) < start:
                continue
            if end is not None and seconds(when) > end:
                continue
            cpu = number(row["cpu"])
            if cpu is None:
                continue
            per_time[when][row["container"]] = cpu / 100
            host_cpu, steal = number(row.get("host_cpu") or "-"), number(row.get("host_steal") or "-")
            if host_cpu is not None:
                host[when] = (host_cpu, steal if steal is not None else 0.0)
            extras[when] = (number(row["avail_mb"]), number(row["swap_used_mb"]), number(row["load1"]))
    return per_time, host, extras


def main():
    sys.stdout.reconfigure(encoding="utf-8")  # Windows 콘솔(cp949)에서도 한글이 깨지지 않게 한다
    parser = argparse.ArgumentParser(description="observe TSV의 CPU 용량 요약")
    parser.add_argument("tsv")
    parser.add_argument("--from", dest="start", help="HH:MM:SS 이후만")
    parser.add_argument("--to", dest="end", help="HH:MM:SS 이전만")
    args = parser.parse_args()

    per_time, host, extras = read(
        args.tsv,
        seconds(args.start) if args.start else None,
        seconds(args.end) if args.end else None,
    )
    if not per_time:
        sys.exit("기록이 없다. 시간 범위와 파일을 확인한다")

    times = sorted(per_time, key=seconds)
    totals = [sum(per_time[t].values()) for t in times]

    print(f"기록 {len(times)}개 ({times[0]} ~ {times[-1]})")
    print()
    print("컨테이너별 CPU(vCPU)")
    print(f"{'컨테이너':<24}{'평균':>7}{'p95':>7}{'최대':>7}{'한도':>7}{'한도 대비 최대':>14}")
    containers = sorted({name for row in per_time.values() for name in row})
    for name in containers:
        series = [per_time[t].get(name, 0.0) for t in times]
        limit = limit_of(name)
        ratio = f"{max(series) / limit * 100:.0f}%" if limit else "-"
        limit_text = f"{limit:.2f}" if limit else "-"
        print(
            f"{name:<24}{statistics.mean(series):>7.2f}{percentile(series, 0.95):>7.2f}"
            f"{max(series):>7.2f}{limit_text:>7}{ratio:>14}"
        )

    over = sum(1 for total in totals if total > HOST_VCPU)
    near = sum(1 for total in totals if total > HOST_VCPU * 0.8)
    print()
    print("컨테이너 CPU 합(vCPU)")
    print(f"  평균 {statistics.mean(totals):.2f}, p95 {percentile(totals, 0.95):.2f}, 최대 {max(totals):.2f}")
    print(f"  호스트 {HOST_VCPU:.0f} vCPU 초과 기록 {over}개 ({over / len(totals) * 100:.1f}%), 0.8 초과 {near}개 ({near / len(totals) * 100:.1f}%)")
    print(f"  한도 합 {sum(limit for _, limit in LIMITS):.1f} 대비 최대 합 {max(totals) / sum(limit for _, limit in LIMITS) * 100:.0f}%")

    if host:
        busy = [host[t][0] for t in times if t in host]
        steal = [host[t][1] for t in times if t in host]
        saturated = sum(1 for value in busy if value >= 95)
        print()
        print("호스트 전체(/proc/stat)")
        print(f"  CPU 사용률 평균 {statistics.mean(busy):.0f}%, p95 {percentile(busy, 0.95):.0f}%, 최대 {max(busy):.0f}%")
        print(f"  95% 이상(포화) 기록 {saturated}개 ({saturated / len(busy) * 100:.1f}%)")
        print(f"  steal 평균 {statistics.mean(steal):.1f}%, 최대 {max(steal):.1f}%")
    else:
        print()
        print("호스트 CPU 열이 없다(옛 observe 기록). 컨테이너 합으로만 판단한다")

    avail = [extras[t][0] for t in times if extras[t][0] is not None]
    swap = [extras[t][1] for t in times if extras[t][1] is not None]
    load = [extras[t][2] for t in times if extras[t][2] is not None]
    print()
    print("메모리, 부하")
    print(f"  사용 가능 메모리 최소 {min(avail):.0f}MB, 스왑 사용 최대 {max(swap):.0f}MB, load1 최대 {max(load):.2f}")

    # 합이 가장 컸던 시각과 그때의 구성: 한도가 겹쳤다면 어느 컨테이너들이 함께 올랐는지 보인다
    peak_time = times[totals.index(max(totals))]
    print()
    print(f"합이 가장 컸던 {peak_time}")
    for name, value in sorted(per_time[peak_time].items(), key=lambda item: -item[1]):
        print(f"  {name:<24}{value:>6.2f}")


if __name__ == "__main__":
    main()
