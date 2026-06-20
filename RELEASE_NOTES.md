# Projector v1.5.0

A local-first project & **team** planner built on plain Markdown + Mermaid gantt
charts. Every project is just a `.md` file in a folder you control — no cloud
account, no subscription, no server.

A polish release on top of v1.4.6 — a faster Timeline and a tidier New Task form.

## Timeline
- **Snappier Timeline switching.** Opening the Timeline used to re-render the whole
  Mermaid chart every time — parse, layout, and sanitise all on the main thread —
  which could stutter or briefly freeze the window on a large project. The rendered
  chart is now reused when nothing affecting it has changed, so switching back to the
  Timeline is effectively instant. Editing a task, recolouring, or resizing a bar
  still redraws as before.

## New Task
- **Reordered the "Starts" placement options.** The dropdown now reads *On a date →
  Before a date → After another task → Before another task*, grouping the two
  date-based choices and the two task-relative choices together.

## Highlights (carried over from v1.4)
- **Drag a bar's edge to reschedule** on the per-project and Global timelines.
- **"Today" filter** narrows the boards to what's live today plus anything overdue.
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
| Fedora/RHEL/openSUSE (RPM) | `projector-app-1.5.0.x86_64.rpm` — `sudo rpm -i …` |
| Debian/Ubuntu (DEB) | `projector-app_1.5.0_amd64.deb` — `sudo dpkg -i …` |
| macOS (DMG) | `Projector-1.5.0.dmg` (Intel) / `Projector-1.5.0-arm64.dmg` (Apple Silicon) |
| Windows (EXE) | `Projector Setup 1.5.0.exe` |

> These builds are **unsigned**. macOS: right-click → **Open** (or
> `xattr -dr com.apple.quarantine /Applications/Projector.app`). Windows
> SmartScreen: **More info → Run anyway**.
