/**
 * `prismjs/components/*` are language definition scripts without type
 * declarations. They mutate the global `Prism` instance (see `prism-global.ts`)
 * and export nothing, so a shorthand ambient module is enough.
 */
declare module 'prismjs/components/*';
