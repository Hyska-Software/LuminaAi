# Skills embutidas do Lumina

Cada subpasta é uma skill: `SKILL.md` com frontmatter (`name`, `description`) e
instruções para o agente. Pastas podem conter `scripts/` com helpers prontos.

- Contrato e catálogo: `docs/FILES.md` §7.
- As skills são embutidas no binário em tempo de compilação (`include_dir!`) e
  materializadas em `<app-data>/skills-bundled/` na primeira leitura.
- Skills do usuário ficam em `<app-data>/skills/` e vencem as embutidas quando
  têm o mesmo nome.
- Scripts devem usar **somente a biblioteca padrão do Python** (sem pip) e
  seguir a CLI `--spec <arquivo.json> --out <arquivo>`.
