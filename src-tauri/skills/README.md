# Bundled Zylara skills

Each subfolder is a skill: a `SKILL.md` with frontmatter (`name`, `description`)
and instructions for the agent. Folders may contain `scripts/` with ready-made
helpers.

- Contract and catalog: `docs/FILES.md` §7.
- Skills are embedded in the binary at compile time (`include_dir!`) and
  materialized into `<app-data>/skills-bundled/` on first read.
- User skills live in `<app-data>/skills/` and take precedence over bundled
  ones with the same name.
- Scripts must use **only the Python standard library** (no pip) and follow
  the `--spec <file.json> --out <file>` CLI.
