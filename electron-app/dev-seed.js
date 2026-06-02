// Dev-only demo content.
//
// The unpackaged dev build runs against a separate `projector-dev` userData dir
// (see main.js), so it starts with no workspaces linked and nothing to look at.
// To make dev usable out of the box — and to survive a wiped /tmp or a fresh
// config — main.js seeds a persistent demo workspace with these sample projects
// whenever dev has no existing workspace. Each is a normal Projector .md file:
// a fenced ```mermaid gantt block (the source of truth) carrying a status mix
// (done / active / future), assignees as `section`s, an `after` dependency, the
// in-block profile/colour comments, and two profiles plus one unprofiled project.
//
// This module is never bundled into packaged builds: it is not listed in
// package.json `build.files`, and main.js only require()s it behind an
// `app.isPackaged` guard.

const fs = require('fs');
const path = require('path');

const PROJECTS = {
  'website-relaunch.md': `# Website Relaunch

A demo project for testing the dev build. Edit or delete freely — this is throwaway test data.

\`\`\`mermaid
gantt
    dateFormat YYYY-MM-DD
    title Website Relaunch
    %% projector:profile Work
    %% projector:color #a0c4ff
    section Alice
    Content audit            :done, audit, 2026-05-05, 5d
    Wireframes               :done, wire, after audit, 6d
    Visual design            :active, design, after wire, 8d
    section Bob
    CMS setup                :done, cms, 2026-05-12, 4d
    Template build           :active, tmpl, after cms, 10d
    Launch checklist         :launch, after design, 3d
\`\`\`
`,

  'mobile-app-v2.md': `# Mobile App v2

\`\`\`mermaid
gantt
    dateFormat YYYY-MM-DD
    title Mobile App v2
    %% projector:profile Work
    %% projector:color #bdb2ff
    section Alice
    API integration          :active, api, 2026-05-25, 9d
    section Bob
    Beta testing             :beta, after api, 7d
    section Unassigned
    Backlog grooming         :groom, 2026-06-15, 2d
\`\`\`
`,

  'house-move.md': `# House Move

\`\`\`mermaid
gantt
    dateFormat YYYY-MM-DD
    title House Move
    %% projector:profile Household
    %% projector:color #fbc4ab
    section Sam
    Get quotes from movers   :done, quotes, 2026-05-20, 3d
    Book moving company      :active, book, after quotes, 2d
    Pack kitchen             :pack, 2026-06-08, 4d
    section Jordan
    Change of address        :addr, 2026-06-05, 1d
    Set up utilities         :util, after addr, 3d
\`\`\`
`,

  'quarterly-goals.md': `# Quarterly Goals

\`\`\`mermaid
gantt
    dateFormat YYYY-MM-DD
    title Quarterly Goals
    %% projector:color #caffbf
    section Alice
    Define OKRs              :done, okr, 2026-05-01, 3d
    Hiring plan              :active, hire, 2026-05-28, 10d
    section Unassigned
    Team offsite             :offsite, 2026-06-20, 2d
\`\`\`
`,

  // A deliberately large project: ~27 tasks across five assignees so the Timeline
  // overflows the window vertically (and horizontally), exercising scrolling.
  'annual-conference.md': `# Annual Conference 2026

A large demo project so the Timeline overflows vertically — use it to test scrolling.

\`\`\`mermaid
gantt
    dateFormat YYYY-MM-DD
    title Annual Conference 2026
    %% projector:profile Work
    %% projector:color #d7bfff
    section Alice
    Define theme             :done, theme, 2026-04-01, 7d
    Call for papers          :done, cfp, after theme, 14d
    Review submissions       :active, review, after cfp, 21d
    Build schedule           :sched, after review, 10d
    Publish agenda           :pubag, after sched, 3d
    Conference day           :milestone, confday, after pubag, 0d
    section Bob
    Shortlist venues         :done, venue1, 2026-04-05, 10d
    Site visits              :done, visit, after venue1, 8d
    Sign contract            :done, contract, after visit, 5d
    AV and staging plan      :active, av, 2026-05-25, 12d
    Final walkthrough        :walk, after av, 2d
    section Carol
    Brand and logo           :done, brand, 2026-04-10, 9d
    Launch website           :active, web, after brand, 14d
    Social campaign          :social, after web, 30d
    Email blasts             :email, 2026-06-20, 20d
    Press outreach           :press, after web, 18d
    section Dave
    Sponsor prospectus       :done, prosp, 2026-04-15, 7d
    Outreach round 1         :active, out1, after prosp, 20d
    Confirm gold sponsors    :gold, after out1, 14d
    Sponsor assets           :assets, after gold, 7d
    Onsite branding          :brand2, after assets, 5d
    section Erin
    Catering RFP             :done, cater, 2026-05-01, 10d
    Choose caterer           :active, caterc, after cater, 5d
    Badges and lanyards      :badge, 2026-06-25, 14d
    Volunteer roster         :vol, 2026-07-01, 10d
    Travel and hotel blocks  :travel, 2026-05-20, 21d
    Registration desk plan   :regdesk, after badge, 4d
\`\`\`
`,
};

// Write each sample project into `dir`, skipping any that already exist so a
// re-seed never clobbers edits the user made to the demo data.
module.exports = function seedDemoWorkspace(dir) {
  for (const [name, content] of Object.entries(PROJECTS)) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) continue;
    fs.writeFileSync(file, content, 'utf8');
  }
};
