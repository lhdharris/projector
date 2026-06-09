# Projector v1.4.3

A local-first project & **team** planner built on plain Markdown + Mermaid gantt
charts. Every project is just a `.md` file in a folder you control — no cloud
account, no subscription, no server.

A PDF-export and task-scheduling release on top of v1.4.2.

## PDF export
- **Page numbers on every page.** Exported PDFs now stamp a **`Page X of Y`**
  footer on every physical page, so a printed Team or All-tasks list that flows
  across several pages stays in order and nothing goes missing.
- **"All tasks" page.** A new sub-option of the Team page adds a single
  page-flowing list of **every task in scope with its assignee** on the right —
  handy as a master checklist alongside the per-person breakdown.
- **Overdue tasks carry over on the Team page.** Any incomplete task whose
  deadline has already passed is kept on each person's list (sorted to the top and
  flagged **overdue** in red) instead of silently dropping off once its week ends.
- **Select all / Deselect all** buttons over the project checklist, so picking
  which projects to include is one click when you have many.

## Scheduling
- **"Before another task" start mode.** Alongside "On a date" and "After another
  task", the task editor can now place a task so it **finishes exactly when a
  chosen task starts** — set the duration and the start date is computed back from
  the target. Ideal for prep work that must wrap up before a milestone or handoff.

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
| Fedora/RHEL/openSUSE (RPM) | `projector-app-1.4.3.x86_64.rpm` — `sudo rpm -i …` |
| Debian/Ubuntu (DEB) | `projector-app_1.4.3_amd64.deb` — `sudo dpkg -i …` |
| macOS (DMG) | `Projector-1.4.3.dmg` *(added once built on a Mac)* |
| Windows (EXE) | `Projector Setup 1.4.3.exe` *(added once built on a Mac)* |

> These builds are **unsigned**. macOS: right-click → **Open** (or
> `xattr -dr com.apple.quarantine /Applications/Projector.app`). Windows
> SmartScreen: **More info → Run anyway**.
