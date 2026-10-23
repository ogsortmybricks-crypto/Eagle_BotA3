/**
 * The studio's Contract history as a commit graph.
 *
 * Every processed Town Hall is a commit. The ones pushed into the wiki form
 * the main line, newest at the top. A run still waiting for approvals - or
 * one that was closed or replaced - branches off the commit that was the
 * head of the main line when it was made, the way a pull request branches
 * off `main`. Nothing proposed is ever lost from the history.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { GitBranch } from "lucide-react";
import { apiGet } from "@/lib/api";
import { useDateFormat, useSession } from "@/lib/session";
import { Chip } from "@/components/ui";
import { RUN_STATUS_LABEL, RUN_STATUS_TONE, type GraphNode } from "./types";

const ROW = 56;
const LANE = 18;
const PAD = 12;
const COLORS: Record<GraphNode["status"], string> = {
  pushed: "#059669",
  pending: "#d97706",
  closed: "#dc2626",
  superseded: "#9ca3af",
};

type Placed = GraphNode & { row: number; lane: number; baseRow: number | null };

/**
 * Lanes, git-log style: pushed runs on lane 0; every other run on the lowest
 * lane free from its own row down to the row of the commit it branched from.
 */
export function layout(nodes: GraphNode[]): { placed: Placed[]; lanes: number } {
  const rowOf = new Map(nodes.map((node, row) => [node.id, row]));
  const taken: [number, number][][] = [];
  const placed = nodes.map((node, row): Placed => {
    const baseRow = node.baseRunId !== null ? (rowOf.get(node.baseRunId) ?? null) : null;
    if (node.status === "pushed") return { ...node, row, lane: 0, baseRow };
    const bottom = baseRow ?? nodes.length;
    let lane = 1;
    while ((taken[lane] ?? []).some(([from, to]) => row <= to && bottom >= from)) lane += 1;
    (taken[lane] ??= []).push([row, bottom]);
    return { ...node, row, lane, baseRow };
  });
  return { placed, lanes: Math.max(1, taken.length) };
}

const x = (lane: number) => PAD + lane * LANE;
const y = (row: number) => row * ROW + ROW / 2;

export function RunGraph() {
  const { studioId } = useSession();
  const formatDate = useDateFormat();
  const query = useQuery<{ nodes: GraphNode[]; approvalsRequired: number }>({
    queryKey: ["town-hall-graph", studioId],
    queryFn: () => apiGet("/town-hall/runs/graph"),
  });
  const nodes = query.data?.nodes ?? [];
  if (nodes.length === 0) return null;

  const { placed, lanes } = layout(nodes);
  const width = x(lanes) + PAD / 2;
  const height = nodes.length * ROW;
  const pushed = placed.filter((node) => node.status === "pushed");
  const waiting = placed.filter((node) => node.status === "pending").length;

  return (
    <div className="card mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <GitBranch className="h-4 w-4 text-brand-600" /> Contract history
        </h2>
        <span className="text-xs text-gray-500">
          {waiting > 0 ? `${waiting} waiting for approval · ` : ""}
          each run needs {query.data?.approvalsRequired ?? 3} approvals before it's pushed
        </span>
      </div>
      <div className="relative overflow-x-auto">
        <svg width={width} height={height} className="absolute left-0 top-0" aria-hidden="true">
          {/* The main line: pushed runs, newest to oldest. */}
          {pushed.slice(1).map((node, index) => (
            <line
              key={`main-${node.id}`}
              x1={x(0)}
              y1={y(pushed[index].row)}
              x2={x(0)}
              y2={y(node.row)}
              stroke={COLORS.pushed}
              strokeWidth={2}
            />
          ))}
          {/* A pushed run whose parent is older than this page still has a line down. */}
          {pushed.length > 0 && (
            <line x1={x(0)} y1={y(pushed[pushed.length - 1].row)} x2={x(0)} y2={height} stroke={COLORS.pushed} strokeWidth={2} strokeDasharray="3 3" />
          )}
          {/* Branches: from the commit each run started from, up to the run. */}
          {placed
            .filter((node) => node.status !== "pushed")
            .map((node) => {
              const fromY = node.baseRow !== null ? y(node.baseRow) : height;
              // An S-curve out of the main line, then straight up to the run.
              const bend = Math.min(ROW / 2, fromY - y(node.row));
              const path = `M ${x(0)} ${fromY} C ${x(0)} ${fromY - bend / 2}, ${x(node.lane)} ${fromY - bend / 2}, ${x(node.lane)} ${fromY - bend} L ${x(node.lane)} ${y(node.row)}`;
              return (
                <path
                  key={`branch-${node.id}`}
                  d={path}
                  fill="none"
                  stroke={COLORS[node.status]}
                  strokeWidth={2}
                  strokeDasharray={node.status === "pending" ? undefined : "4 3"}
                />
              );
            })}
          {placed.map((node) => (
            <circle
              key={`dot-${node.id}`}
              cx={x(node.lane)}
              cy={y(node.row)}
              r={6}
              fill={node.status === "pushed" || node.status === "pending" ? COLORS[node.status] : "white"}
              stroke={COLORS[node.status]}
              strokeWidth={2.5}
            />
          ))}
        </svg>
        <ol style={{ paddingLeft: width }}>
          {placed.map((node) => (
            <li key={node.id} style={{ height: ROW }} className="flex items-center border-b border-gray-100 last:border-0">
              <Link
                href={`/town-hall/${node.meetingId}`}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1 hover:bg-gray-50"
              >
                <span className="font-mono text-xs text-gray-400">#{node.id}</span>
                <span className="truncate text-sm font-medium text-gray-900">{node.meetingTitle}</span>
                <Chip tone={RUN_STATUS_TONE[node.status]}>{RUN_STATUS_LABEL[node.status]}</Chip>
                <span className="w-full truncate text-xs text-gray-500 sm:w-auto">
                  <span className="text-emerald-700">+{node.counts.created}</span>{" "}
                  <span className="text-amber-700">~{node.counts.amended}</span>{" "}
                  <span className="text-red-700">−{node.counts.repealed}</span>
                  {" · "}
                  {node.status === "pending"
                    ? `${node.approvals} of ${node.approvalsRequired} approvals${node.changesRequested ? `, ${node.changesRequested} asking for changes` : ""}`
                    : node.status === "pushed"
                      ? `pushed ${formatDate(node.pushedAt ?? node.createdAt)}`
                      : formatDate(node.createdAt)}
                  {node.submittedBy ? ` · ${node.submittedBy}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
