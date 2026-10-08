// Maps `pdf-parse` to a stub when the engine checkout doesn't have it installed.
// Only loaded by testing/sandbox, and only when node_modules/pdf-parse is missing.
import { register } from "node:module";

register("./resolve.mjs", import.meta.url);
