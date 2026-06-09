# Projector — Mac/Windows export & release brief

**Read this if you are Claude Code (or me) running on the Mac.** The Linux side is
already done: the `v<version>` GitHub release exists with the `.rpm` and `.deb`
attached. Your job here is to build the **`.dmg`** (macOS) and **`.exe`** (Windows)
installers and **upload them to that same existing release**.

> **Current target (update this line each release):** as of **2026-06-09** the live
> release is **`v1.4.3`** — it already has the `.rpm` and `.deb` attached and is
> flagged *Latest*. You're here to add the `.dmg` (and ideally the `.exe`) to it.
> The steps below read the version from `package.json`, so they don't need editing;
> just confirm `node -p "require('./package.json').version"` prints `1.4.3` after
> you pull `main`.

This app is a local-first, Markdown + Mermaid-gantt project planner for self-hosting /
local-org folks who want to run a small **team** off plain `.md` files on their own
disk — no cloud, no subscription.

---

## 0. Facts you need

| Thing | Value |
|---|---|
| Project root | the synced `…/projector-app` folder (contains `electron-app/`, `res/`) |
| App project dir | `projector-app/electron-app` (run all `npm`/`electron-builder` here) |
| Version | read it, don't hardcode: `node -p "require('./package.json').version"` |
| GitHub account | **`lhdharris`** (verify with `gh auth status`) |
| Target repo | **`lhdharris/projector`** — already exists; default branch is **`main`** |
| Release | the **full** release `v<version>` already exists (Linux `.rpm`/`.deb` attached) |
| Output dir | `electron-app/dist/` |

> The repo and the `v<version>` release are already created from the Linux machine.
> Do **not** create the repo or the release — just build the Mac/Windows installers
> and `gh release upload` them onto the existing release.

---

## 1. Prerequisites (install once)

```bash
# Homebrew assumed. Node 18+ and the GitHub CLI:
brew install node gh
gh auth status   # must show you logged in as lhdharris; if not: gh auth login

# Needed to build the Windows .exe on macOS (this is the fragile one — see §3b):
brew install --cask wine-stable
```

## 2. Get a clean, platform-correct checkout

`node_modules` from the Linux machine is **not** reusable — native modules are
per-platform. Pull the latest `main` and reinstall:

```bash
cd "<…>/projector-app"
git checkout main && git pull
cd electron-app
rm -rf node_modules
npm install
```

## 3. Build the installers

Unsigned builds are fine; disable signing so macOS doesn't try to find a certificate:

```bash
export CSC_IDENTITY_AUTO_DISCOVERY=false
```

### a. macOS `.dmg` (native, most reliable)
```bash
npm run dist:mac
```
Produces `dist/Projector-<version>.dmg` (Apple Silicon adds `-arm64`; Intel adds
`-x64`). By default this is **host architecture only** — that's expected.

On an Apple Silicon Mac you can build **both** arches in one go so Intel users are
covered too (the x64 slice runs through Rosetta):
```bash
npm run dist:mac -- --x64 --arm64
```
That yields `Projector-<version>-arm64.dmg` and `Projector-<version>.dmg` (x64).
The glob in §4 already picks up every `*<version>*.dmg`, so both upload.

### b. Windows `.exe` (needs Wine — the flaky step)
```bash
npm run dist:win
```
Produces `dist/Projector Setup <version>.exe` (NSIS, user-level installer).
**If this fails** (common on Apple Silicon — Wine/Rosetta issues): don't fight it.
Skip `.exe` for now and add it later, or build it on a real Windows box / in GitHub
Actions (`windows-latest` runner running `npm run dist:win`).

## 4. Upload the Mac/Windows installers to the existing release

Run from the **project root**:

```bash
cd "<…>/projector-app"
REPO="lhdharris/projector"
VERSION="$(node -p "require('./electron-app/package.json').version")"

cd electron-app
shopt -s nullglob
assets=()
for f in dist/*"$VERSION"*.dmg dist/*"$VERSION"*.exe; do assets+=("$f"); done
printf 'Will upload:\n'; printf '  %s\n' "${assets[@]}"

# add them to the release the Linux machine already published (--clobber re-uploads
# if you're replacing a file)
gh release upload "v$VERSION" "${assets[@]}" --repo "$REPO" --clobber
```

## 5. Sanity check

```bash
gh release view "v$VERSION" --repo "$REPO"
```
Confirm it is **not** flagged Pre-release and lists `.rpm`, `.deb`, `.dmg`, and
`.exe` (if built).

---

## Notes on unsigned builds (tell your users)

These installers are **not code-signed**, so:

- **macOS** will say the app "can't be opened" / is from an unidentified developer.
  Users right-click the app → **Open**, or run
  `xattr -dr com.apple.quarantine /Applications/Projector.app`.
- **Windows** SmartScreen shows "Windows protected your PC" → **More info → Run anyway**.
- **Linux** `.rpm`/`.deb` install normally (`sudo rpm -i …` / `sudo dpkg -i …`).

Signing is a later upgrade (Apple Developer ID + notarization; a Windows Authenticode
cert).
