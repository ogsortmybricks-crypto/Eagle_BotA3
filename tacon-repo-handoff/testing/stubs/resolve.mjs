const stub = new URL("./pdf-parse.mjs", import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === "pdf-parse") return { url: stub, shortCircuit: true };
  return next(specifier, context);
}
