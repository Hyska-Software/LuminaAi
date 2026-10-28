/**
 * Raw colored SVGs from `material-icon-theme` (MIT — https://github.com/material-extensions/vscode-material-icon-theme).
 *
 * Imported with Vite's `?raw` so only the marks mapped in `src/lib/fileIcons.ts`
 * enter the bundle (no icon font, no CDN request, works offline inside Tauri).
 * Files are the **colored** variants (per-type brand colors), unlike the mono
 * model marks; the file tree renders them inline and never tints them.
 *
 * Keep the keys in sync with `FILE_ICON_KEYS` (`src/lib/fileIcons.ts`); the
 * asset type below makes a missing/extraneous key a compile error and the unit
 * tests assert both sides cover exactly the same set.
 */
import type { FileIconKey } from './fileIcons';

import icon3dSvg from 'material-icon-theme/icons/3d.svg?raw';
import assemblySvg from 'material-icon-theme/icons/assembly.svg?raw';
import astroSvg from 'material-icon-theme/icons/astro.svg?raw';
import audioSvg from 'material-icon-theme/icons/audio.svg?raw';
import babelSvg from 'material-icon-theme/icons/babel.svg?raw';
import bunSvg from 'material-icon-theme/icons/bun.svg?raw';
import cSvg from 'material-icon-theme/icons/c.svg?raw';
import changelogSvg from 'material-icon-theme/icons/changelog.svg?raw';
import clojureSvg from 'material-icon-theme/icons/clojure.svg?raw';
import cmakeSvg from 'material-icon-theme/icons/cmake.svg?raw';
import coffeeSvg from 'material-icon-theme/icons/coffee.svg?raw';
import conductSvg from 'material-icon-theme/icons/conduct.svg?raw';
import consoleSvg from 'material-icon-theme/icons/console.svg?raw';
import contributingSvg from 'material-icon-theme/icons/contributing.svg?raw';
import cppSvg from 'material-icon-theme/icons/cpp.svg?raw';
import csharpSvg from 'material-icon-theme/icons/csharp.svg?raw';
import cssSvg from 'material-icon-theme/icons/css.svg?raw';
import dartSvg from 'material-icon-theme/icons/dart.svg?raw';
import databaseSvg from 'material-icon-theme/icons/database.svg?raw';
import diffSvg from 'material-icon-theme/icons/diff.svg?raw';
import dllSvg from 'material-icon-theme/icons/dll.svg?raw';
import dockerSvg from 'material-icon-theme/icons/docker.svg?raw';
import documentSvg from 'material-icon-theme/icons/document.svg?raw';
import editorconfigSvg from 'material-icon-theme/icons/editorconfig.svg?raw';
import elixirSvg from 'material-icon-theme/icons/elixir.svg?raw';
import erlangSvg from 'material-icon-theme/icons/erlang.svg?raw';
import eslintSvg from 'material-icon-theme/icons/eslint.svg?raw';
import exeSvg from 'material-icon-theme/icons/exe.svg?raw';
import fileSvg from 'material-icon-theme/icons/file.svg?raw';
import fontSvg from 'material-icon-theme/icons/font.svg?raw';
import fsharpSvg from 'material-icon-theme/icons/fsharp.svg?raw';
import gitSvg from 'material-icon-theme/icons/git.svg?raw';
import githubActionsWorkflowSvg from 'material-icon-theme/icons/github-actions-workflow.svg?raw';
import gitlabSvg from 'material-icon-theme/icons/gitlab.svg?raw';
import goSvg from 'material-icon-theme/icons/go.svg?raw';
import goModSvg from 'material-icon-theme/icons/go-mod.svg?raw';
import gradleSvg from 'material-icon-theme/icons/gradle.svg?raw';
import graphqlSvg from 'material-icon-theme/icons/graphql.svg?raw';
import groovySvg from 'material-icon-theme/icons/groovy.svg?raw';
import hSvg from 'material-icon-theme/icons/h.svg?raw';
import haskellSvg from 'material-icon-theme/icons/haskell.svg?raw';
import hppSvg from 'material-icon-theme/icons/hpp.svg?raw';
import htmlSvg from 'material-icon-theme/icons/html.svg?raw';
import imageSvg from 'material-icon-theme/icons/image.svg?raw';
import javaSvg from 'material-icon-theme/icons/java.svg?raw';
import javascriptSvg from 'material-icon-theme/icons/javascript.svg?raw';
import jsconfigSvg from 'material-icon-theme/icons/jsconfig.svg?raw';
import jsonSvg from 'material-icon-theme/icons/json.svg?raw';
import juliaSvg from 'material-icon-theme/icons/julia.svg?raw';
import justSvg from 'material-icon-theme/icons/just.svg?raw';
import keySvg from 'material-icon-theme/icons/key.svg?raw';
import kotlinSvg from 'material-icon-theme/icons/kotlin.svg?raw';
import lessSvg from 'material-icon-theme/icons/less.svg?raw';
import libSvg from 'material-icon-theme/icons/lib.svg?raw';
import licenseSvg from 'material-icon-theme/icons/license.svg?raw';
import lockSvg from 'material-icon-theme/icons/lock.svg?raw';
import logSvg from 'material-icon-theme/icons/log.svg?raw';
import luaSvg from 'material-icon-theme/icons/lua.svg?raw';
import makefileSvg from 'material-icon-theme/icons/makefile.svg?raw';
import markdownSvg from 'material-icon-theme/icons/markdown.svg?raw';
import mdxSvg from 'material-icon-theme/icons/mdx.svg?raw';
import nginxSvg from 'material-icon-theme/icons/nginx.svg?raw';
import nimSvg from 'material-icon-theme/icons/nim.svg?raw';
import nodejsSvg from 'material-icon-theme/icons/nodejs.svg?raw';
import npmSvg from 'material-icon-theme/icons/npm.svg?raw';
import ocamlSvg from 'material-icon-theme/icons/ocaml.svg?raw';
import pdfSvg from 'material-icon-theme/icons/pdf.svg?raw';
import perlSvg from 'material-icon-theme/icons/perl.svg?raw';
import phpSvg from 'material-icon-theme/icons/php.svg?raw';
import pnpmSvg from 'material-icon-theme/icons/pnpm.svg?raw';
import postcssSvg from 'material-icon-theme/icons/postcss.svg?raw';
import powerpointSvg from 'material-icon-theme/icons/powerpoint.svg?raw';
import powershellSvg from 'material-icon-theme/icons/powershell.svg?raw';
import prettierSvg from 'material-icon-theme/icons/prettier.svg?raw';
import prismaSvg from 'material-icon-theme/icons/prisma.svg?raw';
import protoSvg from 'material-icon-theme/icons/proto.svg?raw';
import pythonSvg from 'material-icon-theme/icons/python.svg?raw';
import pythonMiscSvg from 'material-icon-theme/icons/python-misc.svg?raw';
import rSvg from 'material-icon-theme/icons/r.svg?raw';
import reactSvg from 'material-icon-theme/icons/react.svg?raw';
import reactTsSvg from 'material-icon-theme/icons/react_ts.svg?raw';
import readmeSvg from 'material-icon-theme/icons/readme.svg?raw';
import rollupSvg from 'material-icon-theme/icons/rollup.svg?raw';
import rubySvg from 'material-icon-theme/icons/ruby.svg?raw';
import rustSvg from 'material-icon-theme/icons/rust.svg?raw';
import sassSvg from 'material-icon-theme/icons/sass.svg?raw';
import scalaSvg from 'material-icon-theme/icons/scala.svg?raw';
import settingsSvg from 'material-icon-theme/icons/settings.svg?raw';
import shaderSvg from 'material-icon-theme/icons/shader.svg?raw';
import soliditySvg from 'material-icon-theme/icons/solidity.svg?raw';
import stylusSvg from 'material-icon-theme/icons/stylus.svg?raw';
import svelteSvg from 'material-icon-theme/icons/svelte.svg?raw';
import svgSvg from 'material-icon-theme/icons/svg.svg?raw';
import swiftSvg from 'material-icon-theme/icons/swift.svg?raw';
import tableSvg from 'material-icon-theme/icons/table.svg?raw';
import tailwindcssSvg from 'material-icon-theme/icons/tailwindcss.svg?raw';
import tauriSvg from 'material-icon-theme/icons/tauri.svg?raw';
import texSvg from 'material-icon-theme/icons/tex.svg?raw';
import tomlSvg from 'material-icon-theme/icons/toml.svg?raw';
import tsconfigSvg from 'material-icon-theme/icons/tsconfig.svg?raw';
import tuneSvg from 'material-icon-theme/icons/tune.svg?raw';
import typescriptSvg from 'material-icon-theme/icons/typescript.svg?raw';
import typescriptDefSvg from 'material-icon-theme/icons/typescript-def.svg?raw';
import videoSvg from 'material-icon-theme/icons/video.svg?raw';
import vitestSvg from 'material-icon-theme/icons/vitest.svg?raw';
import viteSvg from 'material-icon-theme/icons/vite.svg?raw';
import vueSvg from 'material-icon-theme/icons/vue.svg?raw';
import webassemblySvg from 'material-icon-theme/icons/webassembly.svg?raw';
import webpackSvg from 'material-icon-theme/icons/webpack.svg?raw';
import wordSvg from 'material-icon-theme/icons/word.svg?raw';
import xmlSvg from 'material-icon-theme/icons/xml.svg?raw';
import yamlSvg from 'material-icon-theme/icons/yaml.svg?raw';
import yarnSvg from 'material-icon-theme/icons/yarn.svg?raw';
import zigSvg from 'material-icon-theme/icons/zig.svg?raw';
import zipSvg from 'material-icon-theme/icons/zip.svg?raw';

/** SVG source per bundled file-type mark. */
export const FILE_ICON_SVG: Readonly<Record<FileIconKey, string>> = {
  '3d': icon3dSvg,
  assembly: assemblySvg,
  astro: astroSvg,
  audio: audioSvg,
  babel: babelSvg,
  bun: bunSvg,
  c: cSvg,
  changelog: changelogSvg,
  clojure: clojureSvg,
  cmake: cmakeSvg,
  coffee: coffeeSvg,
  conduct: conductSvg,
  console: consoleSvg,
  contributing: contributingSvg,
  cpp: cppSvg,
  csharp: csharpSvg,
  css: cssSvg,
  dart: dartSvg,
  database: databaseSvg,
  diff: diffSvg,
  dll: dllSvg,
  docker: dockerSvg,
  document: documentSvg,
  editorconfig: editorconfigSvg,
  elixir: elixirSvg,
  erlang: erlangSvg,
  eslint: eslintSvg,
  exe: exeSvg,
  file: fileSvg,
  font: fontSvg,
  fsharp: fsharpSvg,
  git: gitSvg,
  'github-actions-workflow': githubActionsWorkflowSvg,
  gitlab: gitlabSvg,
  go: goSvg,
  'go-mod': goModSvg,
  gradle: gradleSvg,
  graphql: graphqlSvg,
  groovy: groovySvg,
  h: hSvg,
  haskell: haskellSvg,
  hpp: hppSvg,
  html: htmlSvg,
  image: imageSvg,
  java: javaSvg,
  javascript: javascriptSvg,
  jsconfig: jsconfigSvg,
  json: jsonSvg,
  julia: juliaSvg,
  just: justSvg,
  key: keySvg,
  kotlin: kotlinSvg,
  less: lessSvg,
  lib: libSvg,
  license: licenseSvg,
  lock: lockSvg,
  log: logSvg,
  lua: luaSvg,
  makefile: makefileSvg,
  markdown: markdownSvg,
  mdx: mdxSvg,
  nginx: nginxSvg,
  nim: nimSvg,
  nodejs: nodejsSvg,
  npm: npmSvg,
  ocaml: ocamlSvg,
  pdf: pdfSvg,
  perl: perlSvg,
  php: phpSvg,
  pnpm: pnpmSvg,
  postcss: postcssSvg,
  powerpoint: powerpointSvg,
  powershell: powershellSvg,
  prettier: prettierSvg,
  prisma: prismaSvg,
  proto: protoSvg,
  python: pythonSvg,
  'python-misc': pythonMiscSvg,
  r: rSvg,
  react: reactSvg,
  react_ts: reactTsSvg,
  readme: readmeSvg,
  rollup: rollupSvg,
  ruby: rubySvg,
  rust: rustSvg,
  sass: sassSvg,
  scala: scalaSvg,
  settings: settingsSvg,
  shader: shaderSvg,
  solidity: soliditySvg,
  stylus: stylusSvg,
  svelte: svelteSvg,
  svg: svgSvg,
  swift: swiftSvg,
  table: tableSvg,
  tailwindcss: tailwindcssSvg,
  tauri: tauriSvg,
  tex: texSvg,
  toml: tomlSvg,
  tsconfig: tsconfigSvg,
  tune: tuneSvg,
  typescript: typescriptSvg,
  'typescript-def': typescriptDefSvg,
  video: videoSvg,
  vitest: vitestSvg,
  vite: viteSvg,
  vue: vueSvg,
  webassembly: webassemblySvg,
  webpack: webpackSvg,
  word: wordSvg,
  xml: xmlSvg,
  yaml: yamlSvg,
  yarn: yarnSvg,
  zig: zigSvg,
  zip: zipSvg,
};
