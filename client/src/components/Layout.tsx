import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  BookOpen,
  Gavel,
  LayoutDashboard,
  LogOut,
  Menu,
  Shield,
  Users,
  Vote,
  X,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { Avatar, Chip } from "./ui";

const NAV = [
  { href: "/wiki", label: "Wiki", icon: BookOpen, permission: "wiki.read" },
  { href: "/town-hall", label: "Town Hall", icon: Gavel, permission: "meetings.read" },
  { href: "/elections", label: "Elections", icon: Vote, permission: "elections.read" },
  { href: "/positions", label: "Positions", icon: Shield, permission: "positions.read" },
  { href: "/people", label: "People", icon: Users, permission: "wiki.read" },
  { href: "/admin", label: "Admin", icon: LayoutDashboard, permission: "status.read" },
] as const;

export function Layout({ children }: { children: ReactNode }) {
  const { user, academy, can, signOut } = useSession();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!user || !academy) return <>{children}</>;

  const items = NAV.filter((item) => can(item.permission));

  const nav = (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = location === item.href || location.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-brand-50 text-brand-700"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-gray-200 bg-white lg:flex">
        <div className="flex items-center gap-3 border-b border-gray-200 px-5 py-4">
          {academy.logoUrl ? (
            <img src={academy.logoUrl} alt="" className="h-9 w-9 rounded-lg object-contain" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              {academy.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-gray-900">{academy.name}</div>
            <div className="text-xs text-gray-500">Eagle Bot</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">{nav}</div>

        <div className="border-t border-gray-200 p-3">
          <Link
            href={`/people/${user.id}`}
            className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-gray-100"
          >
            <Avatar name={user.name} src={user.avatarUrl} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-gray-900">{user.name}</div>
              <Chip tone="brand" className="mt-0.5">
                {user.role}
              </Chip>
            </div>
          </Link>
          <button onClick={signOut} className="btn-ghost mt-1 w-full justify-start px-2 text-xs">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 lg:hidden">
          <div className="flex items-center gap-2.5">
            {academy.logoUrl ? (
              <img src={academy.logoUrl} alt="" className="h-8 w-8 rounded-lg object-contain" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">
                {academy.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <span className="text-sm font-bold text-gray-900">{academy.name}</span>
          </div>
          <button
            onClick={() => setMobileOpen((open) => !open)}
            className="btn-ghost p-2"
            aria-label="Menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </header>

        {mobileOpen && (
          <div className="border-b border-gray-200 bg-white p-3 lg:hidden">
            {nav}
            <div className="mt-2 border-t border-gray-200 pt-2">
              <Link
                href={`/people/${user.id}`}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600"
              >
                <Avatar name={user.name} src={user.avatarUrl} size={24} /> {user.name}
              </Link>
              <button onClick={signOut} className="btn-ghost w-full justify-start px-3 text-sm">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
