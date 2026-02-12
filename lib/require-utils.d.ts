/** @deprecated Not used by the Trio algorithm pipeline. Candidate for removal. */
interface RequireUtils {
  safeRequire(path: string): unknown;
  safeLoadFile(path: string): unknown;
  requireWithTimestamp(path: string): unknown;
}

declare const requireUtils: RequireUtils;
export = requireUtils;
