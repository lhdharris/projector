# Projector v1.4.1

A local-first project & **team** planner built on plain Markdown + Mermaid gantt
charts. Every project is just a `.md` file in a folder you control — no cloud
account, no subscription, no server.

A polish-and-fixes release on top of v1.4.0 — mostly around long project titles,
the Team view, and the toolbar.

## Fixes & improvements
- **Rename a project from the sidebar.** Right-click a project → **Rename…** to
  retitle it; the change is written to both the heading and the Timeline title so
  every view stays in sync.
- **Long project titles behave everywhere.** In the global **Timeline**, an
  over-wide project title now wraps onto a second line instead of spilling across
  the bars; in the **sidebar** a long title truncates with an ellipsis and shows
  the full name on hover, and can no longer stretch the sidebar wider.
- **Team view eases members off, not out.** When someone runs out of tasks in a
  project's Team view their column now greys out for a few seconds before
  disappearing — drop a task back on them within that window and they stay.
  "Delete team member" is still immediate.
- **Toolbar title stays clear of the zoom controls.** On a narrow window the
  centred project title no longer slides under the +/- zoom buttons.
- **Tidier project menu.** The redundant "— none —" profile entry is gone; the
  Profile section only appears once you actually have profiles.

## Highlights (carried over from v1.4)
- **Export to PDF**, **PIN + QR-gated local share**, **automatic update checks**,
  **move a task to another project**, and a re-tuned colour palette.
- **Local share over Wi-Fi** — one click spins up a read-only web viewer; anyone
  on the same network watches your board/timeline update live. Nothing leaves your
  LAN.
- **Kanban, Team, Gantt, and Global views** over the same `.md` files.
- Frameless, minimalist UI.

## Downloads
| Platform | File |
|---|---|
| Fedora/RHEL/openSUSE (RPM) | `projector-app-1.4.1.x86_64.rpm` — `sudo rpm -i …` |
| Debian/Ubuntu (DEB) | `projector-app_1.4.1_amd64.deb` — `sudo dpkg -i …` |
| macOS (DMG) | `Projector-1.4.1.dmg` *(added once built on a Mac)* |
| Windows (EXE) | `Projector Setup 1.4.1.exe` *(added once built on a Mac)* |

> These builds are **unsigned**. macOS: right-click → **Open** (or
> `xattr -dr com.apple.quarantine /Applications/Projector.app`). Windows
> SmartScreen: **More info → Run anyway**.
