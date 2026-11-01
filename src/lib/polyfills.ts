/**
 * Promise.try is used by pdf.js while dispatching worker messages. Node 22
 * (used by CI) and older WebKit builds do not implement it yet; the app must
 * degrade gracefully instead of failing PDF previews.
 *
 * ES2025: Promise.try(fn, ...args) calls fn synchronously and wraps the result
 * (or thrown error) in a promise.
 */
type PromiseTry = <T>(
  callback: (...args: unknown[]) => T | PromiseLike<T>,
  ...args: unknown[]
) => Promise<T>;

const promiseWithTry = Promise as unknown as { try?: PromiseTry };

if (typeof promiseWithTry.try !== 'function') {
  promiseWithTry.try = <T>(
    callback: (...args: unknown[]) => T | PromiseLike<T>,
    ...args: unknown[]
  ) =>
    new Promise<T>((resolve, reject) => {
      try {
        resolve(callback(...args));
      } catch (error) {
        reject(error);
      }
    });
}

export {};
