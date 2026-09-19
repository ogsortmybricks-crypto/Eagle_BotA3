import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, setApiStudio, ApiError } from "./api";
import {
  DEFAULT_SETTINGS,
  type AcademySettings,
  type EffectiveSettings,
} from "@shared/settings";

export type Role = "admin" | "guide" | "secretary" | "learner";

export type Palette = { primary: string; accent: string; surface: string };

export type Studio = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  ageRange: string | null;
  color: string;
  learnerNoun: string | null;
  simpleMode: boolean;
  orderIndex: number;
  archived: boolean;
};

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
  studioId: number | null;
  bio: string | null;
  avatarUrl: string | null;
  nga: string | null;
  /** Granted by an admin. Opens the dev menu and the public dev profile. */
  devStatus: boolean;
  devHandle: string | null;
  active: boolean;
};

type SessionValue = {
  user: SessionUser | null;
  academy: Academy | null;
  settings: AcademySettings;
  permissions: string[];
  currentPositions: { positionId: number; title: string }[];
  /** Studios this person may open. */
  studios: Studio[];
  /** The one they're looking at. Null means all of them at once. */
  studio: Studio | null;
  studioId: number | null;
  canSeeAllStudios: boolean;
  /** Settings with the selected studio's overrides applied. */
  effective: EffectiveSettings | null;
  /** What this studio calls its learners. Falls back to the academy's word. */
  learnerNoun: string;
  /** The stripped-back app, for the learners in a studio that asked for it. */
  simpleMode: boolean;
  /** True when simple mode is only on because an admin is previewing it. */
  simpleModePreview: boolean;
  loading: boolean;
  can: (permission: string) => boolean;
  selectStudio: (studioId: number | null) => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

type MeResponse = {
  user: SessionUser;
  academy: Academy;
  settings: AcademySettings;
  permissions: string[];
  currentPositions: { positionId: number; title: string }[];
  studios: Studio[];
  selectedStudioId: number | null;
  learnerNoun: string;
  canSeeAllStudios: boolean;
  effective: EffectiveSettings | null;
  simpleMode: boolean;
  simpleModePreview: boolean;
};

/** Remembered locally so a reload doesn't flash the wrong studio's rules. */
const STUDIO_KEY = "eagle-bot.studio";

function readStoredStudio(): number | null {
  try {
    const raw = window.localStorage.getItem(STUDIO_KEY);
    if (raw === null || raw === "all") return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // Set before the first request goes out, so /auth/me is already scoped.
  const [studioId, setStudioId] = useState<number | null>(() => {
    const stored = readStoredStudio();
    setApiStudio(stored);
    return stored;
  });

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

  // The server has the last word on which studio this session is in - it knows
  // what the person is allowed to open, and a stale localStorage value would
  // otherwise leave the header and the data disagreeing.
  useEffect(() => {
    if (!data) return;
    if (data.selectedStudioId !== studioId) {
      setStudioId(data.selectedStudioId);
      setApiStudio(data.selectedStudioId);
    }
  }, [data, studioId]);

  const selectStudio = useCallback(
    async (next: number | null) => {
      setStudioId(next);
      setApiStudio(next);
      try {
        window.localStorage.setItem(STUDIO_KEY, next === null ? "all" : String(next));
      } catch {
        // Private browsing. The session still carries it server-side.
      }
      // Switching studio changes every list on screen, so drop the cache
      // rather than trying to work out which queries survive.
      await apiPost("/studios/select", { studioId: next }).catch(() => undefined);
      queryClient.removeQueries();
      await queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const value = useMemo<SessionValue>(() => {
    const permissions = data?.permissions ?? [];
    const studios = data?.studios ?? [];
    const studio = studios.find((entry) => entry.id === studioId) ?? null;
    return {
      user: data?.user ?? null,
      academy: data?.academy ?? null,
      settings: data?.settings ?? DEFAULT_SETTINGS,
      permissions,
      currentPositions: data?.currentPositions ?? [],
      studios,
      studio,
      studioId,
      canSeeAllStudios: data?.canSeeAllStudios ?? false,
      effective: data?.effective ?? null,
      learnerNoun: studio?.learnerNoun ?? data?.learnerNoun ?? data?.academy?.learnerNoun ?? "Hero",
      simpleMode: data?.simpleMode ?? false,
      simpleModePreview: data?.simpleModePreview ?? false,
      loading: isLoading,
      can: (permission: string) => permissions.includes(permission),
      selectStudio,
      refresh: async () => {
        await queryClient.invalidateQueries({ queryKey: ["session"] });
      },
      signOut: async () => {
        await apiPost("/auth/logout");
        queryClient.clear();
        window.location.href = "/";
      },
    };
  }, [data, isLoading, queryClient, studioId, selectStudio]);

  // Paint the academy's palette into the CSS variables Tailwind reads.
  useEffect(() => {
    if (data?.academy?.palette) applyPalette(data.academy.palette);
  }, [data?.academy?.palette]);

  // The selected studio's colour tints studio-specific chrome.
  useEffect(() => {
    const studio = value.studio;
    document.documentElement.style.setProperty("--studio", studio?.color ?? "transparent");
  }, [value.studio]);

  // Compact mode is an academy-wide preference, applied as a root class.
  useEffect(() => {
    document.documentElement.dataset.density = value.settings.display.density;
  }, [value.settings.display.density]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside a SessionProvider");
  return context;
}

/* ------------------------------ formatting -------------------------------- */

/**
 * Dates, in whichever shape the academy asked for. An academy with families in
 * two countries genuinely cares whether 3/4 is March or April.
 */
export function useDateFormat() {
  const { settings } = useSession();
  const format = settings.display.dateFormat;

  return useCallback(
    (value: string | Date | null | undefined, withTime = false): string => {
      if (!value) return "";
      const date = typeof value === "string" ? new Date(value) : value;
      if (Number.isNaN(date.getTime())) return "";

      const time = withTime
        ? ` ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
        : "";
      const pad = (n: number) => String(n).padStart(2, "0");

      switch (format) {
        case "iso":
          return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}${time}`;
        case "us":
          return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}${time}`;
        case "uk":
          return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}${time}`;
        default:
          return withTime ? date.toLocaleString() : date.toLocaleDateString();
      }
    },
    [format],
  );
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
