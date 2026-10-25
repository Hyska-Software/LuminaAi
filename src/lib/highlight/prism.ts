/**
 * Single shared Prism instance with the extra grammars used by Lumina.
 *
 * `prism-react-renderer` embeds a Prism build (markup, css, clike, javascript,
 * jsx, typescript, tsx, json, yaml, markdown, python, rust, go, sql, c, cpp,
 * swift, kotlin, objectivec, …) and exports it. The language scripts below are
 * loaded on top of that instance; grammars that are already bundled are not
 * re-registered (see the list in the comment block).
 *
 * Import order matters: `prism-global` must run before any grammar file, and a
 * language definition must come before the languages that extend it.
 */
import './prism-global';

/* php extends markup-templating; vbnet extends basic; scala extends java. */
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-basic';
import 'prismjs/components/prism-java';

/* Shells and terminals */
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-batch';

/* Stylesheets (css is bundled by prism-react-renderer; these extend it) */
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-sass';
import 'prismjs/components/prism-less';

/* Config, build and infra files */
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-makefile';
import 'prismjs/components/prism-cmake';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-git';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-hcl';
import 'prismjs/components/prism-nginx';
import 'prismjs/components/prism-http';

/* Languages */
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-vbnet';
import 'prismjs/components/prism-scala';
import 'prismjs/components/prism-dart';
import 'prismjs/components/prism-lua';
import 'prismjs/components/prism-perl';
import 'prismjs/components/prism-r';
import 'prismjs/components/prism-elixir';
import 'prismjs/components/prism-haskell';
import 'prismjs/components/prism-clojure';
import 'prismjs/components/prism-elm';
import 'prismjs/components/prism-protobuf';
import 'prismjs/components/prism-wasm';

/* Diagrams (Mermaid fallback code cards) */
import 'prismjs/components/prism-mermaid';

import { Prism } from './prism-global';

/** Shared Prism instance used by every code block in the app. */
export const prism = Prism;

export { Prism };
