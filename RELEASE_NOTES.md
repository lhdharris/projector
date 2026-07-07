# Projector v1.6.1

A local-first project & **team** planner built on plain Markdown + Mermaid gantt
charts. Every project is just a `.md` file in a folder you control — no cloud
account, no subscription, no server.

A bug-fix release: it repairs a case where a project's timeline could stop
rendering with an **`Invalid date`** error.

## Fixes
- **Timeline no longer breaks with an `Invalid date` error.** A task with no
  explicit start date (meaning "start when the previous task ends") could, over
  repeated saves, have its internal id shuffled into the start slot — corrupting
  the `.md` file so the chart refused to render. The reader and writer that convert
  between the chart and the file are fixed so such tasks are stored unambiguously
  (as an explicit "after the previous task") and round-trip cleanly. Projects that
  were already affected render correctly again once the bad line is corrected.

## Highlights (carried over from v1.4–v1.6)
- **Export to PDF** — a Forecast section (focused Timeline + per-member Team
  checklist) and a Global section (all tasks, plus a full-length landscape
  Timeline with a range control).
- **Focus the Timeline on a single team member** on the per-project and Global
  timelines.
- **Drag a bar's edge to reschedule** on the per-project and Global timelines.
- **"Today" filter** narrows the boards to what's live today plus anything overdue.
- **Snappier Timeline switching** — the rendered chart is reused when nothing
  affecting it has changed.
- **Automatic update checks**, **move a task to another project**, and a re-tuned
  colour palette.
- **Kanban, Team, Gantt, and Global views** over the same `.md` files.
- Frameless, minimalist UI.

## Downloads
| Platform | File |
|---|---|
| Fedora/RHEL/openSUSE (RPM) | `projector-app-1.6.1.x86_64.rpm` — `sudo rpm -i …` |
| Debian/Ubuntu (DEB) | `projector-app_1.6.1_amd64.deb` — `sudo dpkg -i …` |
| macOS (DMG) | `Projector-1.6.1.dmg` (Intel) / `Projector-1.6.1-arm64.dmg` (Apple Silicon) |
| Windows (EXE) | `Projector Setup 1.6.1.exe` |

> These builds are **unsigned**. macOS: right-click → **Open** (or
> `xattr -dr com.apple.quarantine /Applications/Projector.app`). Windows
> SmartScreen: **More info → Run anyway**.
