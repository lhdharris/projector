# Projector v1.6.0

A local-first project & **team** planner built on plain Markdown + Mermaid gantt
charts. Every project is just a `.md` file in a folder you control — no cloud
account, no subscription, no server.

A feature release: **Export to PDF is completely redesigned**, the **Timeline can
now focus on one team member**, and the local Wi-Fi share has been retired for now.

## Export to PDF — redesigned
The export dialog is reorganised into two clear sections, driven by the same
project checklist:

- **Forecast** — pick a span (default 7 days) that feeds two pages:
  - a focused **Timeline** of that window, with an optional **upcoming milestones**
    list you can bound to a number of weeks (or leave blank for all upcoming), and
  - a **Team** page listing each member's tasks for the window as a dated checklist,
    with overdue carry-overs kept and flagged.
- **Global** — two independent pages:
  - **All tasks** — every task across the selected projects in one long list, with an
    option to include completed tasks (off by default), and
  - **Timeline** — the landscape, full-length, one-month-per-page chart, now with a
    range control: the **whole timeline**, an explicit **start → end** range, or a
    **start date → the last task**. The forecast window is highlighted where it falls.

## Timeline
- **Focus the Timeline on a single team member.** A new filter on the per-project
  and Global timelines narrows the chart to one person's tasks (defaults to "All
  team members"), so you can see just one lane of work end to end.

## Fixes
- **Export to PDF is reliable again.** Repeat exports no longer silently fail or
  leave the button stuck on "Exporting…"; every PDF renders in a single reused
  background window, which is also noticeably faster once warmed up.

## Removed
- **Local share over Wi-Fi has been removed for now.** The read-only LAN meeting
  viewer (PIN + QR) is gone from this build while it's reworked. Your projects are
  unaffected — they're still just `.md` files on disk, and export to PDF covers
  sharing a snapshot in the meantime.

## Highlights (carried over from v1.4–v1.5)
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
| Fedora/RHEL/openSUSE (RPM) | `projector-app-1.6.0.x86_64.rpm` — `sudo rpm -i …` |
| Debian/Ubuntu (DEB) | `projector-app_1.6.0_amd64.deb` — `sudo dpkg -i …` |
| macOS (DMG) | `Projector-1.6.0.dmg` (Intel) / `Projector-1.6.0-arm64.dmg` (Apple Silicon) |
| Windows (EXE) | `Projector Setup 1.6.0.exe` |

> These builds are **unsigned**. macOS: right-click → **Open** (or
> `xattr -dr com.apple.quarantine /Applications/Projector.app`). Windows
> SmartScreen: **More info → Run anyway**.
