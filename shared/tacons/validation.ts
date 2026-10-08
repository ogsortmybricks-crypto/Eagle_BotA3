import type { Diagnostic } from "./types";

/** Authoritative compiler response. Validation never publishes a listing. */
export type TaconValidation = {
  ok: boolean;
  diagnostics: Diagnostic[];
  manifest: { slug: string; name: string; version: string } | null;
};