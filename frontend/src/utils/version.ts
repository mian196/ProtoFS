declare const __APP_VERSION__: string | undefined;

/**
 * Returns the centralized application version.
 * Sourced dynamically from root package.json via Vite `define`.
 */
export function getAppVersion(): string {
  if (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) {
    return __APP_VERSION__;
  }
  return '0.4.2';
}
