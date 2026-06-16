# Projector v1.4.5

A local-first project & **team** planner built on plain Markdown + Mermaid gantt
charts. Every project is just a `.md` file in a folder you control — no cloud
account, no subscription, no server.

A focus-and-timeline release on top of v1.4.4.

## Focus on today
- **"Today" filter on the boards.** A new **Today** pill next to *New Task* narrows
  the Task List and Team views to just what's **live today** plus anything **overdue
  and not done** — so you open the app and see exactly what needs attention now,
  without the long tail. Click it again to show everything. It tints in the same red
  as the timeline's today-line while active, and remembers its on/off state between
  sessions. The filter is hidden on the Timeline, where the whole span is the point.

## Timeline
- **Drag a bar's edge to reschedule.** Gantt bars now have grab zones at each end.
  Drag the **right edge** to lengthen or shorten a task's duration; drag the **left
  edge** to move its start while keeping the end fixed. Changes snap to whole days
  and are written straight back to the project's `.md` — no editor round-trip. Works
  on both the per-project and Global timelines. (Milestones and relative
  "after another task" starts keep their non-draggable edge.)

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
| Fedora/RHEL/openSUSE (RPM) | `projector-app-1.4.5.x86_64.rpm` — `sudo rpm -i …` |
| Debian/Ubuntu (DEB) | `projector-app_1.4.5_amd64.deb` — `sudo dpkg -i …` |
| macOS (DMG) | `Projector-1.4.5.dmg` *(added once built on a Mac)* |
| Windows (EXE) | `Projector Setup 1.4.5.exe` *(added once built on a Mac)* |

> These builds are **unsigned**. macOS: right-click → **Open** (or
> `xattr -dr com.apple.quarantine /Applications/Projector.app`). Windows
> SmartScreen: **More info → Run anyway**.
