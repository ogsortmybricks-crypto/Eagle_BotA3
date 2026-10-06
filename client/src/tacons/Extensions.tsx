import type { ReactNode } from "react";
import { useLocation } from "wouter";
import type { ViewExtension } from "@shared/tacons/extensions";
import type { RenderTarget } from "./Renderer";
import { extensions as clientExtensions } from "../../../built-tacons/extensions.client.generated";

export type ClientExtension = {
  id: string;
  render(props: { data: unknown; target: RenderTarget }): ReactNode;
  publicPages: {
    path: string;
    render(params: Record<string, string>): ReactNode;
  }[];
};

export function matchExtensionPath(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const patternParts = pattern === "/" ? [] : pattern.slice(1).split("/");
  const pathParts = pathname === "/" ? [] : pathname.slice(1).split("/");
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index];
    const actual = pathParts[index];
    if (expected.startsWith(":")) {
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        return null;
      }
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

export function ExtensionView({
  extension,
  data,
  target,
}: ViewExtension & { target: RenderTarget }) {
  const implementation = clientExtensions.find((entry) => entry.id === extension);
  if (!implementation) return <p role="alert">This Tac-On needs an engine extension that isn't available. Update the engine before using it.</p>;
  return implementation.render({ data, target });
}

export function usePublicExtensionPage(): ReactNode | null {
  const [location] = useLocation();
  for (const extension of clientExtensions) {
    for (const page of extension.publicPages) {
      const params = matchExtensionPath(page.path, location);
      if (params) return page.render(params);
    }
  }
  return null;
}
