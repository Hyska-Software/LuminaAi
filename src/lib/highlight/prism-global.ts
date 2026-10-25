import { Prism } from 'prism-react-renderer';

/**
 * `prismjs/components/*` are plain scripts: they read and write a global
 * `Prism`. `prism-react-renderer` bundles its own Prism build and exports that
 * instance, so we install it in the global scope **before** importing any
 * grammar. This way the extra grammars extend the exact same instance used by
 * `<Highlight prism={prism}>` instead of pulling a second Prism copy into the
 * bundle (and the whole thing works in Vitest, where dependencies are loaded
 * out-of-band).
 */
const prismGlobal = globalThis as typeof globalThis & { Prism?: typeof Prism };
prismGlobal.Prism = Prism;

// Vitest's jsdom environment keeps `window` apart from the module realm; mirror
// the assignment so grammars loaded from either scope find the instance.
if (typeof window !== 'undefined') {
  const prismWindow = window as Window & { Prism?: typeof Prism };
  prismWindow.Prism = Prism;
}

export { Prism };
