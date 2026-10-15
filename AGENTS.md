# Project agent instructions

## Branch policy

- Use `main` for development, production and default checkouts.
- Commit and push directly to `main`. Do not create feature, development or agent branches.
- Do not create separate Git worktrees unless the user explicitly asks for one.
- Preserve existing work before consolidating or deleting any branch.
- Continue committing each changed file separately.

These instructions are for Codex, Cursor, Antigravity, and any other coding agent that reads `AGENTS.md`.

At the start of every chat or task in this repo, read and apply:

- `C:/Users/prajw/Downloads/Trader/skills/unslop/SKILL.md`
- `C:/Users/prajw/Downloads/Trader/skills/expert-dev/SKILL.md`

Use `unslop` for all user-facing writing. Keep responses direct, plain, specific, and free of obvious AI phrasing.

Use `expert-dev` as the coding-quality router. Before writing, editing, reviewing, or explaining code, follow its routing instructions and read the matching skill from this repo's `skills` folder.

Language and stack skills available in this repo:

- Python: `C:/Users/prajw/Downloads/Trader/skills/python-best-practices/SKILL.md`
- HTML or CSS: `C:/Users/prajw/Downloads/Trader/skills/html-css-best-practices/SKILL.md`
- JavaScript: `C:/Users/prajw/Downloads/Trader/skills/javascript-best-practices/SKILL.md`
- TypeScript: `C:/Users/prajw/Downloads/Trader/skills/typescript-best-practices/SKILL.md`
- React, JSX, or TSX: `C:/Users/prajw/Downloads/Trader/skills/react-tsx-best-practices/SKILL.md`
- SQL, migrations, or database queries: `C:/Users/prajw/Downloads/Trader/skills/sql-best-practices/SKILL.md`
- Shell, Bash, PowerShell, CI scripts, or command automation: `C:/Users/prajw/Downloads/Trader/skills/shell-best-practices/SKILL.md`
- Go: `C:/Users/prajw/Downloads/Trader/skills/go-best-practices/SKILL.md`
- Rust: `C:/Users/prajw/Downloads/Trader/skills/rust-best-practices/SKILL.md`
- Java: `C:/Users/prajw/Downloads/Trader/skills/java-best-practices/SKILL.md`
- C# or .NET: `C:/Users/prajw/Downloads/Trader/skills/csharp-best-practices/SKILL.md`

Design and UI skills available in this repo:

- Frontend UI/UX router: `C:/Users/prajw/Downloads/Trader/skills/frontend-expert/SKILL.md`
- UX flows and product behavior: `C:/Users/prajw/Downloads/Trader/skills/frontend-ux-flow/SKILL.md`
- Visual design, typography, color, depth, backgrounds: `C:/Users/prajw/Downloads/Trader/skills/frontend-visual-design/SKILL.md`
- Layout systems, grids, dashboards, file trees, graphs: `C:/Users/prajw/Downloads/Trader/skills/frontend-layout-systems/SKILL.md`
- Components, controls, states, menus, tabs, sliders, docks: `C:/Users/prajw/Downloads/Trader/skills/frontend-components-states/SKILL.md`
- Motion, transitions, hover, text reveals, trails, cursor effects: `C:/Users/prajw/Downloads/Trader/skills/frontend-motion-interactions/SKILL.md`
- Accessibility, performance, responsive behavior: `C:/Users/prajw/Downloads/Trader/skills/frontend-accessibility-performance/SKILL.md`
- Assets, icons, SVGs, favicons, filters, branding: `C:/Users/prajw/Downloads/Trader/skills/frontend-assets-branding/SKILL.md`
- Browser screenshot and interaction verification: `C:/Users/prajw/Downloads/Trader/skills/frontend-verification/SKILL.md`
- Existing project redesign: `C:/Users/prajw/Downloads/Trader/skills/redesign-skill/SKILL.md`
- Advanced UI motion recipes: `C:/Users/prajw/Downloads/Trader/skills/ui-motion-recipes/SKILL.md`
- GPT taste / high-end UI motion: `C:/Users/prajw/Downloads/Trader/skills/gpt-tasteskill/SKILL.md`

If multiple skills match a task, read the most specific skill first, then the broader one only when it adds useful guidance.
