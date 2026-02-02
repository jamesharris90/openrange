# Removing Secrets from Git History (guidance)

This file shows safe steps to scrub sensitive secrets (tokens, keys) from your git history using `git filter-repo` or BFG. **Do this only after rotating exposed tokens.**

Important: These operations rewrite git history and require force-pushing. Coordinate with collaborators.

Option A — using `git filter-repo` (recommended):

1. Install filter-repo:
   - macOS (Homebrew): `brew install git-filter-repo`

2. Create a file `secrets-to-remove.txt` listing strings to remove (one per line). Example:
```
SAXO_TOKEN_VALUE_HERE
iPB-4ci3kYbv3qeSz8MBvg==
```

3. Run filter-repo to remove matching blobs/refs:
```bash
# from repository root
git fetch --all
git checkout --orphan temp-clean-branch
git commit --allow-empty -m "start clean"
# Use filter-repo to remove secrets
git filter-repo --replace-text secrets-to-remove.txt
```

4. Force-push cleaned branches to origin (be careful):
```bash
git push --force --all origin
git push --force --tags origin
```

Option B — using BFG (simpler):

1. Install BFG (https://rtyley.github.io/bfg-repo-cleaner/)
2. Create `secrets.txt` with strings to remove.
3. Run:
```bash
# clone a fresh copy
git clone --mirror git@github.com:YOUR_USER/REPO_NAME.git
cd REPO_NAME.git
bfg --replace-text ../secrets.txt
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push --force
```

Notes & Post-actions:
- Rotate any credentials immediately (revoke old tokens).
- Inform collaborators; they will need to reclone or run `git fetch` + reset their local branches.
- If you want, I can prepare the `secrets.txt` file for you if you provide the exact strings that need removal.
