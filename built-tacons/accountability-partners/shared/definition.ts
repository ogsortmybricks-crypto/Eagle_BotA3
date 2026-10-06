import type { Manifest } from "../../../shared/tacons/types";

export const EXTENSION_ID = "accountability-partners";
export type PartnersDef = {
  name: string;
  title: string;
  core: string[];
  evidence: string[];
  required: number;
  due: number | null;
  trios: boolean;
  managers: string[];
};
export type PartnersWidget = { kind: "partners"; partners: string };
export type PartnersConfiguration = { partners: PartnersDef[] };

/** Read both new extension manifests and already-installed earlier versions. */
export function partnerDefinitions(manifest: Manifest): PartnersDef[] {
  const configuration = manifest.extensions?.[EXTENSION_ID] as PartnersConfiguration | undefined;
  if (configuration) return configuration.partners;
  return (manifest as unknown as { partners?: PartnersDef[] }).partners ?? [];
}
export function partnerWidget(value: unknown): PartnersWidget | null {
  if (!value || typeof value !== "object") return null;
  const widget = value as Record<string, unknown>;
  if (widget.kind === "extension") {
    if (widget.extension !== EXTENSION_ID) return null;
    return partnerWidget(widget.config);
  }
  return widget.kind === "partners" && typeof widget.partners === "string"
    ? { kind: "partners", partners: widget.partners } : null;
}
