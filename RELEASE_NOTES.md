# Projector v1.2.0 (pre-release)

A local-first project & **team** planner built on plain Markdown + Mermaid
gantt charts. Every project is just a `.md` file in a folder you control — no
cloud account, no subscription, no server. Point it at a synced or shared folder
and a small team can plan, set goals, assign work, and track status together
while the data stays entirely on your own disks.

Made for self-hosting and local-org folks who want to run a team without paying
for a cloud service.

## New in v1.2 — Powerful local share
- **Share a live, read-only view over your own Wi-Fi.** One click spins up a tiny
  local web viewer; anyone on the **same Wi-Fi network** can open it in a browser
  and watch your board/timeline update live — no accounts, nothing leaves your LAN.
- The share screen now **names the Wi-Fi network** guests must join, so it's clear
  who can connect.
- A clear **heads-up before the firewall prompt**: Projector tells you it's about
  to ask for permission to open the firewall *for this shared view only*, before
  the password/approval dialog appears.
- **Cross-platform firewall handling** for Linux, macOS, and Windows.
- The phone view is **~20% larger** so shared boards/timelines are easier to read.
- Toolbar tidy-up: **New Task** is the leftmost button; **Share** sits next to the
  window controls.

## Highlights
- **Kanban, Team, and Gantt views** over the same `.md` files — columns are
  status; the Team view gives each assignee their own to-do lane.
- **Global view** across every project/workspace, colour-coded.
- **Workspaces** = ordinary folders you open; profiles let you split Work /
  Household / etc.
- Frameless, minimalist UI.

## Downloads
| Platform | File |
|---|---|
| Fedora/RHEL/openSUSE (RPM) | `projector-app-1.2.0.x86_64.rpm` |
| Debian/Ubuntu (DEB) | `projector-app_1.2.0_amd64.deb` |

> macOS `.dmg` and Windows `.exe` builds aren't part of this Linux pre-release —
> they can be added to the release later.

> These builds are **unsigned**. Linux: `sudo rpm -i …` / `sudo dpkg -i …`.

This is a **pre-release** — expect rough edges; feedback welcome.
