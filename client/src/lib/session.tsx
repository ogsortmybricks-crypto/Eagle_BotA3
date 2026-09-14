import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, ApiError } from "./api";

export type Role = "admin" | "guide" | "secretary" | "learner";

export type Palette = { primary: string; accent: string; surface: string };

export type Academy = {
  id: number;
  name: string;
  emailDomain: string;
  logoUrl: string | null;
  palette: Palette;
  guidesCanVote: boolean;
  learnerNoun: string;
};

export type SessionUser = {
  id: number;
  academyId: number;
  email: string;
  name: string;
  role: Role;
  studio: string | null;
  bio: string | null;
  avatarUrl: string | null;
  nga: string | null;
  active: boolean;
};

type SessionValue = {
  user: SessionUser | null;
  academy: Academy | null;
  permissions: string[];
  currentPositions: { positionId: number; title: string }[];
  loading: boolean;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

type MeResponse = {
  user: SessionUser;
  academy: Academy;
  permissions: string[];
  currentPositions: { positionId: number; title: string }[];
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<MeResponse | null>({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        return await apiGet<MeResponse>("/auth/me");
      } catch (error) {
        // 401 is the normal signed-out state, not a failure worth retrying.
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 30_000,
  });

  const value = useMemo<SessionValue>(() => {
    const permissions = data?.permissions ?? [];
    return {
      user: data?.user ?? null,
      academy: data?.academy ?? null,
      permissions,
      currentPositions: data?.currentPositions ?? [],
      loading: isLoading,
      can: (permission: string) => permissions.includes(permission),
      refresh: async () => {
        await queryClient.invalidateQueries({ queryKey: ["session"] });
      },
      signOut: async () => {
        await apiPost("/auth/logout");
        queryClient.clear();
        window.location.href = "/";
      },
    };
  }, [data, isLoading, queryClient]);

  // Paint the academy's palette into the CSS variables Tailwind reads.
  useEffect(() => {
    if (data?.academy?.palette) applyPalette(data.academy.palette);
  }, [data?.academy?.palette]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside a SessionProvider");
  return context;
}

/* ------------------------------ theming ---------------------------------- */

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

/** Mixes toward white (t<0) or black (t>0) to build a scale from one colour. */
function shade([r, g, b]: [number, number, number], t: number): string {
  const mix = (channel: number) =>
    Math.round(t < 0 ? channel + (255 - channel) * -t : channel * (1 - t));
  return `${mix(r)} ${mix(g)} ${mix(b)}`;
}

export function applyPalette(palette: Palette) {
  const root = document.documentElement;
  const primary = hexToRgb(palette.primary);
  const accent = hexToRgb(palette.accent);
  const surface = hexToRgb(palette.surface);

  const steps: [string, number][] = [
    ["50", -0.92],
    ["100", -0.84],
    ["200", -0.68],
    ["300", -0.46],
    ["400", -0.22],
    ["500", 0],
    ["600", 0.14],
    ["700", 0.3],
    ["800", 0.45],
    ["900", 0.6],
  ];
  for (const [name, t] of steps) {
    root.style.setProperty(`--brand-${name}`, shade(primary, t));
  }
  root.style.setProperty("--accent-400", shade(accent, -0.2));
  root.style.setProperty("--accent-500", shade(accent, 0));
  root.style.setProperty("--accent-600", shade(accent, 0.15));
  root.style.setProperty("--surface", surface.join(" "));
}
