# Projector v1.4.0

A local-first project & **team** planner built on plain Markdown + Mermaid gantt
charts. Every project is just a `.md` file in a folder you control — no cloud
account, no subscription, no server. Point it at a synced or shared folder and a
small team can plan, set goals, assign work, and track status together while the
data stays entirely on your own disks.

This is the **first full release** (no longer a pre-release).

## New in v1.4
- **Export to PDF.** Save your boards and timelines as a PDF — pick one project or
  several — straight from the app, and guests can download a PDF of a shared view.
- **Safer local share: PIN + QR invite.** A shared meeting is now gated by a
  **4-digit PIN** (with brute-force lockout), and anyone can join by **scanning a QR
  code** from the host's "Invite" card — no typing long addresses.
- **Automatic update checks.** Projector now asks GitHub for newer releases on
  launch and once a day, and offers a one-click jump to the download page — no
  telemetry, no account. "Later" stops it nagging for that version.
- **Move a task to another project.** The task editor has a Project dropdown when
  editing, so a task added to the wrong project can be moved without copy-paste.
- **Re-tuned colour palette.** The project colour picker is now sorted by hue so
  like colours sit together, and the near-duplicate pastels were spread apart so
  every swatch is easy to tell apart.
- **Clearer Team-view status pills.** The status pill reads clearly as a dropdown:
  To Do / Done use a neutral grey pill, while In Progress keeps its project colour.
- **Shared viewer polish.** The "Live view" indicator now sits next to the meeting
  title on the left of the shared web view.

## Highlights (carried over)
- **Local share over Wi-Fi** — one click spins up a read-only web viewer; anyone on
  the same network watches your board/timeline update live. Nothing leaves your LAN.
- **Kanban, Team, Gantt, and Global views** over the same `.md` files.
- **Workspaces** = ordinary folders you open; profiles split Work / Household / etc.
- Frameless, minimalist UI.

## Downloads
| Platform | File |
|---|---|
| Fedora/RHEL/openSUSE (RPM) | `projector-app-1.4.0.x86_64.rpm` — `sudo rpm -i …` |
| Debian/Ubuntu (DEB) | `projector-app_1.4.0_amd64.deb` — `sudo dpkg -i …` |
| macOS (DMG) | `Projector-1.4.0.dmg` *(added once built on a Mac)* |
| Windows (EXE) | `Projector Setup 1.4.0.exe` *(added once built on a Mac)* |

> These builds are **unsigned**. macOS: right-click → **Open** (or
> `xattr -dr com.apple.quarantine /Applications/Projector.app`). Windows
> SmartScreen: **More info → Run anyway**.
