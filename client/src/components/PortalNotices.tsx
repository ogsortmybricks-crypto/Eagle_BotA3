/**
 * Notices from the dev portal.
 *
 * The one channel the people maintaining Eagle Bot have to every academy
 * running it - "the market is down for an hour", "this Tac-On has been pulled".
 * Dismissals are remembered in the browser, so a notice interrupts once rather
 * than every morning.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { apiGet } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Banner } from "./ui";

type Notice = {
  id: number;
  title: string;
  body: string;
  tone: "info" | "warning" | "release";
  audience: "everyone" | "admins" | "devs";
};

const DISMISSED_KEY = "eagle-bot.portal-notices";

function readDismissed(): number[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}

export function PortalNotices() {
  const { user, can } = useSession();
  const [dismissed, setDismissed] = useState<number[]>(readDismissed);

  const query = useQuery<{ notices: Notice[] }>({
    queryKey: ["portal-notices-active"],
    queryFn: () => apiGet("/portal/notices/active"),
    staleTime: 5 * 60_000,
    retry: false,
    enabled: Boolean(user),
  });

  const dismiss = (id: number) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next.slice(-50)));
    } catch {
      // Private browsing. It'll show again next time, which is no disaster.
    }
  };

  const visible = (query.data?.notices ?? []).filter((notice) => {
    if (dismissed.includes(notice.id)) return false;
    if (notice.audience === "admins") return can("academy.manage");
    if (notice.audience === "devs") return can("tacons.develop");
    return true;
  });

  if (visible.length === 0) return null;

  return (
    <div className="mb-5 space-y-2">
      {visible.map((notice) => (
        <Banner
          key={notice.id}
          tone={notice.tone === "warning" ? "warning" : notice.tone === "release" ? "success" : "info"}
          title={notice.title}
          action={
            <button
              onClick={() => dismiss(notice.id)}
              className="btn-ghost p-1"
              aria-label="Dismiss notice"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          }
        >
          {notice.body}
        </Banner>
      ))}
    </div>
  );
}
