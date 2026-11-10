import { t } from '@/lib/i18n';

/**
 * Language normalization shared by the chat and the artifact previews.
 *
 * Fence info strings, file extensions and artifact `language` hints all arrive
 * in different shapes (`ts`, `.py`, `language-rust`, `yml`, `Dockerfile`…);
 * `normalizeLanguage` maps them to the Prism language ids registered in
 * `prism.ts` and `languageLabel` gives the pt-BR badge label.
 */

const LANGUAGE_ALIASES: Record<string, string> = {
  /* Markdown / docs */
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',

  /* JavaScript / TypeScript */
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  typescript: 'typescript',

  /* Shells */
  sh: 'bash',
  zsh: 'bash',
  shell: 'bash',
  console: 'bash',
  bash: 'bash',
  ps1: 'powershell',
  pwsh: 'powershell',
  ps: 'powershell',
  powershell: 'powershell',
  bat: 'batch',
  cmd: 'batch',
  dos: 'batch',
  batch: 'batch',

  /* Python and friends */
  py: 'python',
  python: 'python',
  python3: 'python',
  rb: 'ruby',
  ruby: 'ruby',
  rs: 'rust',
  rust: 'rust',
  php: 'php',
  pl: 'perl',
  perl: 'perl',
  r: 'r',
  rscript: 'r',
  lua: 'lua',
  kt: 'kotlin',
  kts: 'kotlin',
  kotlin: 'kotlin',
  java: 'java',
  cs: 'csharp',
  'c#': 'csharp',
  dotnet: 'csharp',
  csharp: 'csharp',
  vb: 'vbnet',
  vbs: 'vbnet',
  vbnet: 'vbnet',
  scala: 'scala',
  dart: 'dart',
  go: 'go',
  golang: 'go',
  swift: 'swift',
  elixir: 'elixir',
  ex: 'elixir',
  exs: 'elixir',
  hs: 'haskell',
  haskell: 'haskell',
  clj: 'clojure',
  cljs: 'clojure',
  clojure: 'clojure',
  elm: 'elm',
  wasm: 'wasm',
  wat: 'wasm',
  objc: 'objectivec',
  'obj-c': 'objectivec',
  objectivec: 'objectivec',

  /* C family */
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  'c++': 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',

  /* Markup */
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  vue: 'markup',
  svelte: 'markup',
  astro: 'markup',
  markup: 'markup',

  /* Data and configuration */
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  jsonl: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  config: 'ini',
  properties: 'ini',
  env: 'ini',
  dotenv: 'ini',
  editorconfig: 'ini',
  dockerfile: 'docker',
  containerfile: 'docker',
  docker: 'docker',
  gitignore: 'git',
  gitattributes: 'git',
  gitconfig: 'git',
  git: 'git',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  mk: 'makefile',
  cmake: 'cmake',
  'cmakelists.txt': 'cmake',
  tf: 'hcl',
  terraform: 'hcl',
  hcl: 'hcl',
  nginx: 'nginx',
  http: 'http',
  diff: 'diff',
  patch: 'diff',
  proto: 'protobuf',
  protobuf: 'protobuf',
  graphql: 'graphql',
  gql: 'graphql',
  sql: 'sql',
  mermaid: 'mermaid',

  /* Plain text */
  txt: 'text',
  text: 'text',
  plain: 'text',
  plaintext: 'text',
};

/**
 * Maps a fence info string, file extension or artifact language hint to the
 * Prism language id used by `<Highlight>`. Unknown values are passed through
 * lowercased (Prism then renders them as plain text).
 */
export function normalizeLanguage(raw?: string | null): string {
  const value = (raw ?? '').trim().toLowerCase().replace(/^language-/, '').replace(/^\./, '');
  if (!value) return 'text';
  return LANGUAGE_ALIASES[value] ?? value;
}

const LANGUAGE_LABELS: Record<string, string> = {
  text: 'Texto',
  markdown: 'Markdown',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  json: 'JSON',
  yaml: 'YAML',
  toml: 'TOML',
  ini: 'INI',
  xml: 'XML',
  markup: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sass: 'Sass',
  less: 'Less',
  sql: 'SQL',
  graphql: 'GraphQL',
  bash: 'Bash',
  powershell: 'PowerShell',
  batch: 'Batch',
  docker: 'Dockerfile',
  makefile: 'Makefile',
  cmake: 'CMake',
  git: 'Git',
  diff: 'Diff',
  hcl: 'HCL',
  nginx: 'Nginx',
  http: 'HTTP',
  python: 'Python',
  ruby: 'Ruby',
  rust: 'Rust',
  php: 'PHP',
  perl: 'Perl',
  r: 'R',
  lua: 'Lua',
  go: 'Go',
  swift: 'Swift',
  kotlin: 'Kotlin',
  java: 'Java',
  csharp: 'C#',
  vbnet: 'VB.NET',
  scala: 'Scala',
  dart: 'Dart',
  c: 'C',
  cpp: 'C++',
  objectivec: 'Objective-C',
  elixir: 'Elixir',
  haskell: 'Haskell',
  clojure: 'Clojure',
  elm: 'Elm',
  wasm: 'WebAssembly',
  protobuf: 'Protobuf',
  mermaid: 'Mermaid',
};

/**
 * Locale label for the language badge (`Python`, `TypeScript`, `Text`, …).
 * Accepts the same raw values as `normalizeLanguage`. Only the plain-text
 * badge is translated; language names stay as their canonical spelling.
 */
export function languageLabel(raw?: string | null): string {
  const id = normalizeLanguage(raw);
  if (!id || id === 'text') return t('common:language.text');
  const label = LANGUAGE_LABELS[id];
  if (label) return label;
  // Unknown ids stay recognizable: capitalize the first letter only.
  return id.charAt(0).toUpperCase() + id.slice(1);
}
