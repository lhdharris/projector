<p align="center">
  <img src="res/projector-icon.svg" width="120" alt="Projector icon">
</p>

<h1 align="center">Projector</h1>

<p align="center">
  <b>Run your team and hit your goals — entirely on your own machines.</b><br>
  A local-first project &amp; team planner built on plain Markdown + Mermaid gantt charts.
</p>

<p align="center">
  <i>No cloud. No account. No subscription. No server.</i>
</p>

---

## Why Projector

Most team-management and goal-setting tools want your data in their cloud and your
card on file. Projector doesn't. Every project is just a **`.md` file in a folder you
control** — readable, diff-able, and yours. Point Projector at a synced or shared
folder and a small team can **plan work, set goals, assign owners, and track status
together** while everything stays on disks you own.

Made for self-hosting and local-org folks who want to run a team without paying for a
cloud service.

## ⚡ Powerful local share

Need to show the team the plan in a meeting — without deploying anything or uploading
your data anywhere? **Share it over your own Wi-Fi in one click.**

- Projector spins up a tiny **read-only web viewer** on your machine. Anyone on the
  **same Wi-Fi network** opens a link in their browser and watches your board or
  timeline **update live** as you work.
- The share screen **names the Wi-Fi network** people need to join, so it's obvious who
  can connect.
- Before anything is exposed, you get a **clear heads-up** that your computer will ask
  for permission to open the firewall — **only for this one shared view** — so the
  password/approval prompt is never a surprise.
- Works across **Linux, macOS, and Windows**, and the phone view is sized to read
  comfortably on a small screen.

Nothing leaves your LAN. Stop sharing and the link goes dead.

## Views

- **Task List (Kanban)** — columns are *status* (To Do / In Progress / Done).
- **Timeline (Gantt)** — a Mermaid gantt rendered from the same file, with clickable bars.
- **Team** — one to-do lane per assignee, so everyone sees their own work.
- **Global** — every project across every workspace, colour-coded, in one view.

All four are different lenses on the **same Markdown files** — edit in the app or in your
own editor; it's just text.

## Workspaces & profiles

- A **workspace** is just an ordinary folder you open. Keep it in Syncthing / a NAS / a
  shared drive and the whole team works off the same files.
- **Profiles** split contexts (e.g. Work / Household), each with its own team roster.

## Install

Download an installer from the [latest release](https://github.com/lhdharris/projector/releases):

| Platform | File |
|---|---|
| Fedora / RHEL / openSUSE | `projector-app-<version>.x86_64.rpm` — `sudo rpm -i …` |
| Debian / Ubuntu | `projector-app_<version>_amd64.deb` — `sudo dpkg -i …` |

> Builds are currently **unsigned** pre-releases. macOS/Windows builds may be added to a
> release later.

## Run from source

```bash
cd electron-app
npm install
npm start
```

---

<p align="center"><sub>Local-first. Your team, your goals, your disks.</sub></p>
