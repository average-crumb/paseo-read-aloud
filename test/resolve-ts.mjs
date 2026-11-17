// Lets Node's test runner load the plugin's extensionless TypeScript imports ("../shared/text"),
// which Paseo's bundler resolves on its own. Test-only; not shipped with the plugin.
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        try {
          return await next(specifier, context);
        } catch (error) {
          if (specifier.startsWith(".") && !/\\.[cm]?[jt]sx?$/.test(specifier)) {
            return next(specifier + ".ts", context);
          }
          throw error;
        }
      }
    `),
);
