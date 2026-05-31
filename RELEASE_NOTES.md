# Projector v1.1.3 (pre-release)

A local-first project & **team** planner built on plain Markdown + Mermaid
gantt charts. Every project is just a `.md` file in a folder you control — no
cloud account, no subscription, no server. Point it at a synced or shared folder
and a small team can plan, assign work, and track status together while the data
stays entirely on your own disks.

Made for self-hosting and local-org folks who want to run a team without paying
for a cloud service.

## Highlights
- **Kanban, Team, and Gantt views** over the same `.md` files — columns are
  status; the Team view gives each assignee their own to-do lane.
- **Global view** across every project/workspace, colour-coded.
- **Workspaces** = ordinary folders you open; profiles let you split Work /
  Household / etc.
- Frameless, minimalist UI.

## Fixed in this build
- **Team view** no longer jumps back to the leftmost column when you change a
  task's status — your horizontal scroll position is kept.
- **Gantt** charts for short projects now stretch to fill the window instead of
  rendering as a cramped sliver; longer projects still keep their day scale and
  scroll.
- **Gantt** title no longer overlaps the red "today" marker.

## Downloads
| Platform | File |
|---|---|
| macOS | `Projector-1.1.3*.dmg` |
| Windows | `Projector Setup 1.1.3.exe` |
| Debian/Ubuntu | `projector-app_1.1.3_amd64.deb` |
| Fedora/RHEL (RPM) | `projector-app-1.1.3.x86_64.rpm` |

> These builds are **unsigned**. macOS: right-click → Open (or
> `xattr -dr com.apple.quarantine /Applications/Projector.app`). Windows
> SmartScreen: More info → Run anyway. Linux: `sudo rpm -i …` / `sudo dpkg -i …`.

This is a **pre-release** — expect rough edges; feedback welcome.
