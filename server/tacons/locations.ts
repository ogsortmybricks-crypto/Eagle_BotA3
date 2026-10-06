/** Shared target addressing for core widgets and package-owned extensions. */
import { z } from "zod";
import { positionAudience, type Manifest, type PageDef, type PanelDef, type PositionDef } from "@shared/tacons";

export function validLocation(location: { page?: string; panel?: string; position?: string }) {
  return Number(Boolean(location.page)) + Number(Boolean(location.panel)) + Number(Boolean(location.position)) === 1;
}
export function findWidget(manifest: Manifest, location: { page?: string; panel?: string; position?: string }, index: number) {
  if (!validLocation(location) || !Number.isSafeInteger(index) || index < 0) return null;
  let owners: (PageDef | PanelDef | PositionDef)[];
  if (location.page) owners = manifest.pages.filter(owner => owner.name === location.page);
  else if (location.position) owners = manifest.positions.filter(owner => owner.name === location.position);
  else owners = manifest.panels.filter(owner => owner.host === location.panel);
  if (owners.length !== 1) return null;
  const owner = owners[0];
  const widget = owner.widgets[index];
  const audience = "showTo" in owner ? owner.showTo : [positionAudience(owner.name)];
  return widget ? { widget, audience } : null;
}
export const locationShape = z.object({
  page: z.string().max(60).optional(),
  panel: z.string().max(60).optional(),
  position: z.string().max(60).optional(),
});
