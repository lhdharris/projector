# Projector v1.4.2

A local-first project & **team** planner built on plain Markdown + Mermaid gantt
charts. Every project is just a `.md` file in a folder you control — no cloud
account, no subscription, no server.

A Timeline-readability and rescheduling release on top of v1.4.1.

## Timeline & Gantt
- **A faint gridline on every day.** Weekly- and monthly-tick charts now draw a
  light rule on each unlabelled day, so you can see exactly where a day falls
  between the dated ticks instead of guessing.
- **Bars and titles sit centred in their rows.** Task bars, labels and milestone
  diamonds are now vertically centred in each row band rather than riding high
  with dead space below — so single-task bands and dense charts both read cleanly.
- **Weekday labels on weekly charts.** In the weekly-tick regime the bottom axis
  now reads **`Sun 07`, `Sun 14`, …** (weekday + day) instead of repeating the
  month that's already in the sticky top header — confirming that each gridline
  lands on a Sunday week boundary.

## Import / Duplicate with new dates
- **Anchor the new timeline on any fixed point.** "Import as…" and "Duplicate
  with new dates…" now let you choose what stays put: the **project start date**,
  the **project end date**, or **a specific task** (e.g. a milestone). Pick the
  anchor, set its date, and every other task shifts by the same offset — durations
  and relative ("after") gaps are preserved, so you can rebase a whole plan around
  the one date that's actually fixed.

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
| Fedora/RHEL/openSUSE (RPM) | `projector-app-1.4.2.x86_64.rpm` — `sudo rpm -i …` |
| Debian/Ubuntu (DEB) | `projector-app_1.4.2_amd64.deb` — `sudo dpkg -i …` |
| macOS (DMG) | `Projector-1.4.2.dmg` *(added once built on a Mac)* |
| Windows (EXE) | `Projector Setup 1.4.2.exe` *(added once built on a Mac)* |

> These builds are **unsigned**. macOS: right-click → **Open** (or
> `xattr -dr com.apple.quarantine /Applications/Projector.app`). Windows
> SmartScreen: **More info → Run anyway**.
