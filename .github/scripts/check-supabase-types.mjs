// CI helper for "Check Supabase types match the migrations".
//
// Usage: node check-supabase-types.mjs <committed types.ts> <generated types.ts> <out dir>
//
// The committed file is generated against the hosted project, which adds an
// `__InternalSupabase` block (the PostgREST version, used by supabase-js for
// typing). `supabase gen types --local` in CI doesn't emit it, so it's
// dropped from both sides before comparing — it describes the server, not the
// schema.
//
// Writes to <out dir>:
//   committed.normalised.ts / generated.normalised.ts — what the workflow diffs
//   types.ts — the file to commit on a mismatch: the generated schema with the
//              committed file's __InternalSupabase block kept, so committing it
//              doesn't change how the client is typed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [committedPath, generatedPath, outDir] = process.argv.slice(2);
if (!committedPath || !generatedPath || !outDir) {
  console.error("usage: check-supabase-types.mjs <committed> <generated> <out dir>");
  process.exit(2);
}

// The two comment lines the generator puts above it, then the block itself.
const INTERNAL_BLOCK =
  /^[ \t]*\/\/ Allows to automatically instantiate[^\n]*\n[ \t]*\/\/ instead of createClient[^\n]*\n[ \t]*__InternalSupabase: \{[\s\S]*?\n[ \t]*\};\n/m;

const committed = readFileSync(committedPath, "utf8");
const generated = readFileSync(generatedPath, "utf8");
const strip = (s) => s.replace(INTERNAL_BLOCK, "");

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "committed.normalised.ts"), strip(committed));
writeFileSync(join(outDir, "generated.normalised.ts"), strip(generated));

const block = committed.match(INTERNAL_BLOCK)?.[0];
const anchor = "export type Database = {\n";
const fixed =
  block && generated.includes(anchor) && !INTERNAL_BLOCK.test(generated)
    ? generated.replace(anchor, anchor + block)
    : generated;
writeFileSync(join(outDir, "types.ts"), fixed);
