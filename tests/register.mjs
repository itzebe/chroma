/** Registers the resolver hook so `npm test` can import route handlers. */
import { register } from "node:module";

register(new URL("./loader.mjs", import.meta.url));
