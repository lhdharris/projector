# Projector v1.4.4

A local-first project & **team** planner built on plain Markdown + Mermaid gantt
charts. Every project is just a `.md` file in a folder you control — no cloud
account, no subscription, no server.

A PDF-export, ordering, and scheduling refinement release on top of v1.4.3.

## PDF export
- **Upcoming milestones with your forecast.** The Forecast page now lists **every
  forthcoming milestone** across the included projects (any date from today on, not
  just those inside the forecast window). It folds in as a section right under the
  forecast when there's room, and spills onto its own page when there isn't.
- **Matching forecast footer.** The Forecast page footer now reads exactly like the
  Team page footer — generated-date and scope on the left, attribution on the right,
  under a single thin rule.
- **Cleaner overdue tasks on the Team page.** Instead of a separate "overdue" badge,
  an overdue carry-over now shows its **name in italic red** and its **date bracketed
  in red** — the urgency reads at a glance without the extra chip.

## Ordering
- **"Next up" first, everywhere.** Kanban columns and Team columns now sort by
  **soonest deadline first**, so the most imminent work sits at the top and the
  farthest-out at the bottom. The Team view additionally **pins critical tasks to the
  top** and **sinks Done to the bottom**.

## Scheduling
- **"Before a date" start mode.** Alongside "On a date", "After another task", and
  "Before another task", you can now place a task so it **finishes on a chosen date** —
  set the duration and the start is computed back from that deadline. Milestones land
  exactly on the date.

## Export dialog
- **Pick projects across every profile.** The Export-to-PDF project checklist now lists
  projects from **all profiles**, grouped under a header per profile (plus "No profile"),
  so a single PDF can span more than one profile. The active profile's projects are
  pre-checked; the rest are one click away.

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
| Fedora/RHEL/openSUSE (RPM) | `projector-app-1.4.4.x86_64.rpm` — `sudo rpm -i …` |
| Debian/Ubuntu (DEB) | `projector-app_1.4.4_amd64.deb` — `sudo dpkg -i …` |
| macOS (DMG) | `Projector-1.4.4.dmg` *(added once built on a Mac)* |
| Windows (EXE) | `Projector Setup 1.4.4.exe` *(added once built on a Mac)* |

> These builds are **unsigned**. macOS: right-click → **Open** (or
> `xattr -dr com.apple.quarantine /Applications/Projector.app`). Windows
> SmartScreen: **More info → Run anyway**.
