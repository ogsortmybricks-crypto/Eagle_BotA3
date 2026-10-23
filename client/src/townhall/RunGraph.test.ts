import assert from "node:assert/strict";
import { test } from "node:test";
import { layout } from "./RunGraph";
import type { GraphNode } from "./types";

const node = (id: number, status: GraphNode["status"], baseRunId: number | null): GraphNode => ({
  id, status, baseRunId, meetingId: id, meetingTitle: `Meeting ${id}`, replacesRunId: null, submittedBy: null,
  createdAt: "", pushedAt: null, approvals: 0, approvalsRequired: 3, changesRequested: 0,
  counts: { created: 0, amended: 0, repealed: 0 },
});

test("pushed runs share the main lane; branches take the lowest free lane", () => {
  // Newest first: 6 pending off 4, 5 pending off 4 (overlaps 6), 4 pushed, 3 closed off 1, 2 pushed, 1 pushed.
  const { placed, lanes } = layout([
    node(6, "pending", 4),
    node(5, "pending", 4),
    node(4, "pushed", 2),
    node(3, "closed", 1),
    node(2, "pushed", 1),
    node(1, "pushed", null),
  ]);
  const lane = Object.fromEntries(placed.map((entry) => [entry.id, entry.lane]));
  assert.deepEqual(lane, { 6: 1, 5: 2, 4: 0, 3: 1, 2: 0, 1: 0 });
  assert.equal(lanes, 3);
  assert.equal(placed.find((entry) => entry.id === 3)!.baseRow, 5);
});
