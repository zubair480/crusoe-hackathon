# Central team coordination

This GitHub repository is the shared workspace. Code lives on four owner branches; each branch has its owner's current handoff. Read the live links below, not the initial placeholder files on main.

| Owner | Latest status on their branch | Scope |
|---|---|---|
| Isaac | [Live handoff](https://github.com/zubair480/crusoe-hackathon/blob/codex/isaac-plaud-intake/docs/handoffs/isaac.md) | Plaud and evidence intake |
| Sunny | [Live handoff](https://github.com/zubair480/crusoe-hackathon/blob/codex/sunny-crusoe-analysis/docs/handoffs/sunny.md) | Crusoe and comparison |
| Ali | [Live handoff](https://github.com/zubair480/crusoe-hackathon/blob/codex/ali-repair-coordination/docs/handoffs/ali.md) | Repair execution and follow-up |
| Zubair | [Live handoff](https://github.com/zubair480/crusoe-hackathon/blob/codex/zubair-app-integration/docs/handoffs/zubair.md) | App, Excel, reports and integration |

## Read all four statuses with one command

```bash
python scripts/team_status.py
```

This reads GitHub branch heads into Git's object database and prints each current handoff, its branch commit, and commit time. It never switches your branch, stages files, merges code, or modifies your worktree. Network errors are reported, not silently replaced with stale statuses. GitHub write/read access must already be configured. `python scripts/team_status.py --local` is available for an explicitly offline snapshot and clearly labels that snapshot.

## Every agent's update rhythm

Read all four statuses at startup and before an integration change. Update your own handoff after a working milestone, immediately when blocked, before pausing, and approximately every 10 minutes during active work. This is an agent instruction, not a background service; stopped agents do not update automatically.

Include UTC update time, current task, latest pushed implementation commit, exported function signatures, owned paths, completed checks, actual integration modes, blockers, next step, and requests addressed to a named teammate. Report uncommitted work as uncommitted. Never describe a local-only change as available to others.

Commit coherent code separately, then publish your status. The following example is for Isaac; substitute your name and exact branch. First inspect `git status` and `git diff --cached`. If anything is already staged, preserve it and complete or coordinate that work before making a status-only commit; do not silently include or unstage another task's files.

```bash
git branch --show-current
git status --short
git diff --cached --stat
git add -- docs/handoffs/isaac.md
git diff --cached
git commit -m "Update Isaac integration handoff"
git push origin HEAD:refs/heads/codex/isaac-plaud-intake
```

Verify the current branch matches your owner branch before committing or pushing. If there is no changed status, do not create an empty commit. If a push is rejected, fetch and inspect the divergence; merge your remote branch when appropriate and rerun checks. Never force-push to resolve a collision. Each person uses their own clone.

## Dependencies and integration

- Zubair owns the shared contract and root workspace/lockfile. Publish contract-change requests in your handoff with the proposed fields and who is affected. Zubair records the accepted version in the integration guide and pushes it; all affected owners acknowledge adoption in their status.
- A request in GitHub is not an instant message. Teammates must read statuses on the cadence above. For an urgent blocker, tell the human owner as well.
- Keep working against shared fixtures and injected adapters while a dependency is unavailable; record the integration gap.
- Open a PR into main when a usable increment passes its checks. Never merge teammates' unfinished branches wholesale. Zubair coordinates review and integration; a live handoff is not approval to merge.
- After an accepted merge, run `git fetch origin` and `git merge origin/main` from your owner branch. Resolve conflicts with the owner of the affected path and rerun relevant checks.
- The static index above always links to branch status. Main's handoff copies can lag until PRs merge; do not mistake them for the live board.
