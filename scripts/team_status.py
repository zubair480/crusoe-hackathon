"""Read all owners' latest Git handoffs without touching worktree or index."""
import argparse
import subprocess
import sys

OWNERS = {
    "isaac": "codex/isaac-plaud-intake",
    "sunny": "codex/sunny-crusoe-analysis",
    "ali": "codex/ali-repair-coordination",
    "zubair": "codex/zubair-app-integration",
}


def git(*args):
    result = subprocess.run(
        ["git", *args], capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=60,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f"git {args[0]} failed")
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local", action="store_true", help="Show cached remote refs; possibly stale")
    args = parser.parse_args()
    failed = False
    print("OFFLINE CACHED SNAPSHOT (may be stale)" if args.local else "LIVE REMOTE HANDOFFS")
    for owner, branch in OWNERS.items():
        print(f"\n--- {owner.upper()} | {branch} ---")
        try:
            ref = f"refs/remotes/origin/{branch}"
            if not args.local:
                # FETCH_HEAD refers to this exact fetch; no checkout/index mutation.
                git("fetch", "--no-tags", "origin", f"refs/heads/{branch}")
                ref = "FETCH_HEAD"
            commit = git("rev-parse", "--verify", ref)
            print(git("show", "-s", "--format=commit %H%ncommitted %cI", commit))
            print(git("show", f"{commit}:docs/handoffs/{owner}.md"))
        except (RuntimeError, subprocess.TimeoutExpired) as exc:
            failed = True
            print(f"UNAVAILABLE: {exc}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
