# Projector — Mac export & release brief

**Read this if you are Claude Code (or me) running on the Mac.** The Linux side is
done: the `.rpm` is already built. Your job here is to produce the **`.dmg`**
(macOS), **`.exe`** (Windows), and **`.deb`** (Debian/Ubuntu) installers, then
publish **all four** to GitHub as a **pre-release**.

This app is a local-first, Markdown + Mermaid-gantt project planner. The release
is for self-hosting / local-org folks who want to run and even manage a small
**team** off plain `.md` files on their own disk — no cloud, no subscription. The
release notes at the bottom say exactly that.

---

## 0. Facts you need

| Thing | Value |
|---|---|
| Project root | the synced `…/projector-app` folder (contains `electron-app/`, `res/`) |
| App project dir | `projector-app/electron-app` (run all `npm`/`electron-builder` here) |
| Version | read it, don't hardcode: `node -p "require('./package.json').version"` (currently `1.1.2`) |
| GitHub account | **`lhdharris`** (verify with `gh auth status`) |
| Target repo | **`lhdharris/projector`** — does **not exist yet**, you will create it |
| Output dir | `electron-app/dist/` |

> ⚠️ The `package.json` `homepage` was pointed at a non-existent `louisharris/projector`;
> I changed it to `lhdharris/projector` to match the authenticated account. If you
> actually intend a different owner/repo, change `REPO` in step 4 **and** the
> `homepage` field, and keep them in sync.

---

## 1. Prerequisites (install once)

```bash
# Homebrew assumed. Node 18+ and the GitHub CLI:
brew install node gh
gh auth status   # must show you logged in as lhdharris; if not: gh auth login

# Needed to build the .deb on macOS (electron-builder shells out to these):
brew install dpkg fakeroot

# Needed to build the Windows .exe on macOS (this is the fragile one — see §3c):
brew install --cask wine-stable
```

## 2. Get a clean, platform-correct checkout

`node_modules` from the Linux machine is **not** reusable — native modules are
per-platform. Reinstall:

```bash
cd "<…>/projector-app/electron-app"
rm -rf node_modules
npm install
```

## 3. Build the installers

Unsigned builds are fine for a pre-release; disable signing so macOS doesn't try
to find a certificate:

```bash
export CSC_IDENTITY_AUTO_DISCOVERY=false
```

### a. macOS `.dmg` (native, most reliable)
```bash
npm run dist:mac
```
Produces `dist/Projector-<version>.dmg` (Apple Silicon adds `-arm64`; Intel adds
`-x64`). This is the host architecture only — that's expected.

### b. Debian/Ubuntu `.deb`
```bash
npm run dist:deb
```
Produces `dist/projector-app_<version>_amd64.deb`. Needs `dpkg` + `fakeroot` from §1.

### c. Windows `.exe` (needs Wine — the flaky step)
```bash
npm run dist:win
```
Produces `dist/Projector Setup <version>.exe` (NSIS, user-level installer).
**If this fails** (common on Apple Silicon — Wine/Rosetta issues): don't fight it.
Either skip `.exe` for now and add it later, or build it on a real Windows box /
in GitHub Actions (`windows-latest` runner running `npm run dist:win`), then
`gh release upload v<version> "Projector Setup <version>.exe"`.

*(Shortcut: `npm run dist:all-on-mac` runs all three at once — but if Wine breaks
it aborts the batch, so the one-by-one order above is safer.)*

## 4. Bring the Linux `.rpm` alongside the rest

The `.rpm` was built on the Linux machine at
`electron-app/dist/projector-app-<version>.x86_64.rpm`.

- If your Sync folder propagates `dist/`, it's **already there** — nothing to do.
- If not, copy it from the Linux box into `electron-app/dist/`, or add it to the
  release afterward with `gh release upload v<version> <path-to>.rpm`.

> `dist/` also contains older `1.1.0` / `1.1.1` rpms. The upload command in §5
> globs **by current version**, so those are ignored automatically.

## 5. Publish to GitHub as a pre-release

Run from the **project root** (the `projector-app` folder, not `electron-app`):

```bash
cd "<…>/projector-app"
REPO="lhdharris/projector"
VERSION="$(node -p "require('./electron-app/package.json').version")"

# --- one-time: turn this into a git repo and create it on GitHub ---
if [ ! -d .git ]; then
  git init -b main
  git add -A
  git commit -m "Projector v$VERSION"
fi
if ! gh repo view "$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --public --source=. --remote=origin --push
else
  git push -u origin main
fi

# --- gather only this version's installers (handles the space in the .exe name) ---
cd electron-app
shopt -s nullglob
assets=()
for f in dist/*"$VERSION"*.dmg dist/*"$VERSION"*.exe dist/*"$VERSION"*.deb dist/*"$VERSION"*.rpm; do
  assets+=("$f")
done
printf 'Will upload:\n'; printf '  %s\n' "${assets[@]}"

# --- create the pre-release ---
gh release create "v$VERSION" "${assets[@]}" \
  --repo "$REPO" \
  --title "Projector v$VERSION" \
  --prerelease \
  --notes-file ../RELEASE_NOTES.md
```

If the tag `v<version>` already exists, either bump `version` in
`electron-app/package.json` and rebuild, or delete the old release/tag first
(`gh release delete v<version> --cleanup-tag`).

The release notes file `RELEASE_NOTES.md` sits next to this file in the project
root — edit it before publishing if you want.

## 6. Sanity check

```bash
gh release view "v$VERSION" --repo "$REPO"
```
Confirm it's flagged **Pre-release** and lists `.dmg`, `.exe` (if built), `.deb`,
and `.rpm`.

---

## Notes on unsigned builds (tell your users)

These installers are **not code-signed**, so:

- **macOS** will say the app "can't be opened" / is from an unidentified
  developer. Users right-click the app → **Open**, or run
  `xattr -dr com.apple.quarantine /Applications/Projector.app`.
- **Windows** SmartScreen shows "Windows protected your PC" → **More info → Run anyway**.
- **Linux** `.rpm`/`.deb` install normally (`sudo rpm -i …` / `sudo dpkg -i …`).

Signing is a later upgrade (Apple Developer ID + notarization; a Windows
Authenticode cert). Not needed to ship a pre-release.
