/**
 * The engine requests in ENGINE-REQUESTS.md that can be checked without a
 * database: what compiles, what it compiles to, and how expressions evaluate.
 *
 *     npx tsx --test shared/tacons/engine-requests.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "./compile";
import { evaluate, matches, type EvalContext, type Row } from "./expr";
import type { ComputeDef, FormWidget, ListWidget, Manifest, Widget } from "./types";

function wrap(body: string): string {
  return `tacon test-tacon {
  name "Test"
  version 1.0.0
  about "A test."
  ${body}
}
`;
}

function ok(body: string): Manifest {
  const result = compile(wrap(body));
  const errors = result.diagnostics.filter((entry) => entry.severity === "error");
  assert.deepEqual(errors, [], `expected it to compile:\n${body}`);
  return result.manifest!;
}

function fails(body: string, message: RegExp) {
  const result = compile(wrap(body));
  assert.equal(result.ok, false, `expected an error:\n${body}`);
  assert.ok(
    result.diagnostics.some((entry) => entry.severity === "error" && message.test(entry.message)),
    `expected an error matching ${message}, got ${JSON.stringify(result.diagnostics)}`,
  );
}

function ctx(overrides: Partial<EvalContext> = {}, rows: Record<string, Row[]> = {}): EvalContext {
  return {
    me: { id: 7, name: "Ava" },
    event: {},
    setting: {},
    row: null,
    rowAliases: [],
    records: (source) => rows[source.join(".")] ?? [],
    compute: () => undefined,
    positions: {},
    ...overrides,
  };
}

function ask(manifest: Manifest, name: string): ComputeDef["expr"] {
  return manifest.computes.find((entry) => entry.name === name)!.expr;
}

const PAGE = `page home { note "hi" }`;

test("ER-001: id and byId work in where, totals and columns", () => {
  const manifest = ok(`
    store log { field steps number }
    ask mine sum of log.steps where log.byId is me.id
    ask floor highest of log.id
    page home { list log {
columns steps, id, byId, by, created
where log.id above my.floor
} }
  `);
  const rows = { log: [{ id: 1, byId: 7, steps: 3 }, { id: 2, byId: 8, steps: 5 }, { id: 3, byId: 7, steps: 4 }] };
  assert.equal(evaluate(ask(manifest, "mine"), ctx({}, rows)), 7);
  assert.equal(evaluate(ask(manifest, "floor"), ctx({}, rows)), 3);
});

test("ER-003: arithmetic groups left to right", () => {
  const manifest = ok(`
    ask a 10 minus 3 plus 2
    ask b 12 divided by 2 times 3
    ${PAGE}
  `);
  assert.equal(evaluate(ask(manifest, "a"), ctx()), 9);
  assert.equal(evaluate(ask(manifest, "b"), ctx()), 18);
});

test("ER-004: {...} in titles and labels, and name of", () => {
  const manifest = ok(`
    store call { field partner person }
    ask my_ap 42
    page partner {
      title "Calls with {name of my.my_ap}"
      stat "Week {my.my_ap}" 1
      list call {
        title "Posted for {my.my_ap}"
        columns partner
      }
    }
  `);
  const page = manifest.pages[0];
  assert.ok(page.titleTemplate);
  const people = new Map([[42, "Ben"]]);
  const context = ctx({
    compute: (path) => (path[0] === "my_ap" ? 42 : undefined),
    personName: (id) => people.get(Number(id)),
  });
  assert.equal(evaluate(page.titleTemplate!, context), "Calls with Ben");
  const stat = page.widgets[0] as Extract<Widget, { kind: "stat" }>;
  assert.equal(evaluate(stat.labelTemplate!, context), "Week 42");
  const list = page.widgets[1] as ListWidget;
  assert.equal(evaluate(list.titleTemplate!, context), "Posted for 42");
});

test("ER-005: show to position \"Title\"", () => {
  const manifest = ok(`page appeals {
show to position "Town Hall Leader", admin
note "x"
}`);
  assert.deepEqual(manifest.pages[0].showTo, ["studio-position:town hall leader", "admin"]);
  assert.deepEqual(manifest.studioPositions, ["Town Hall Leader"]);
  assert.ok(manifest.needs.includes("positions.read"));
});

test("ER-006: group by created.week, day", () => {
  const manifest = ok(`
    store call {
field note text
field day date
}
    page home { list call {
group by created.week, day
columns note
} }
  `);
  const list = manifest.pages[0].widgets[0] as ListWidget;
  assert.deepEqual(list.groupBy, [
    { field: "created", part: "week" },
    { field: "created", part: "day" },
  ]);
  fails(`store call { field note text }  page home { list call { group by note.week } }`, /Only date fields/);
});

test("ER-007: today, this_week_start and comparing dates", () => {
  const manifest = ok(`
    store call { field note text }
    ask this_week count of call where call.created above this_week_start
    ask today_count count of call where call.created is today
    ${PAGE}
  `);
  const rows = {
    call: [
      { id: 1, created: "2026-10-12T14:00:00.000Z" },
      { id: 2, created: "2026-10-09T14:00:00.000Z" },
      { id: 3, created: "2026-10-13T01:30:00.000Z" }, // 21:30 on the 12th in New York
    ],
  };
  const context = ctx(
    { clock: { today: "2026-10-12", this_week_start: "2026-10-11" }, timeZone: "America/New_York" },
    rows,
  );
  assert.equal(evaluate(ask(manifest, "this_week"), context), 2);
  assert.equal(evaluate(ask(manifest, "today_count"), context), 2);
});

test("ER-008: show if and celebrate", () => {
  const manifest = ok(`
    ask ff_pair 2
    page home {
      celebrate "You've both earned Fun Friday!" { show if my.ff_pair above 1 }
      note "Not yet" { show if my.ff_pair below 2 }
    }
  `);
  const [party, note] = manifest.pages[0].widgets;
  assert.equal(party.kind, "celebrate");
  const context = ctx({ compute: () => 2 });
  assert.equal(matches(party.showIf!, context), true);
  assert.equal(matches(note.showIf!, context), false);
});

test("ER-009: allow remove own", () => {
  const manifest = ok(`
    store goal { field text text }
    page home { list goal {
where goal.byId is me.id
allow remove own
} }
  `);
  const list = manifest.pages[0].widgets[0] as ListWidget;
  assert.equal(list.removeOwn, true);
  assert.deepEqual(list.allowRemove, []);
  const mixed = ok(`store goal { field text text }  page home { list goal { allow remove admin, own } }`);
  assert.deepEqual((mixed.pages[0].widgets[0] as ListWidget).allowRemove, ["admin"]);
});

test("ER-010: confirm, confirm with code, and set", () => {
  const manifest = ok(`
    store call {
field note text
field day text
field who person
}
    page home {
      form "Sign" {
        into call
        ask note
        set day weekday
        set who: me.id
        confirm with code "Sign this AP Call?"
      }
    }
  `);
  const form = manifest.pages[0].widgets[0] as FormWidget;
  assert.equal(form.confirmCode, true);
  assert.equal(form.confirm, "Sign this AP Call?");
  assert.deepEqual(form.sets?.map((entry) => entry.field), ["day", "who"]);
  fails(`store c { field a text }  page home { form "x" {
into c
ask a
set a "b"
} }`, /both asked and set/);
});

test("ER-011: link columns and open record", () => {
  const manifest = ok(`
    store call {
field note text
field day date
}
    page home { list call { columns note, link } }
    calendar call {
on day
open record note, by, created
}
  `);
  assert.ok((manifest.pages[0].widgets[0] as ListWidget).columns.includes("link"));
  assert.deepEqual(manifest.calendars![0].openRecord, ["note", "by", "created"]);
  fails(`page home { list from people { columns name, link } }`, /own store/);
});

test("ER-012: choice from a store", () => {
  const manifest = ok(`
    ask week 3
    store mark { field assignment choice from assignment.title where assignment.week is my.week required }
    store assignment {
field title text
field week number
}
    ${PAGE}
  `);
  const field = manifest.stores[0].fields[0];
  assert.deepEqual(field.from?.store, ["assignment"]);
  assert.equal(field.from?.field, "title");
  assert.equal(field.required, true);
  assert.ok(field.from?.where);
  fails(`store mark { field a choice from nope.title }  ${PAGE}`, /no store called "nope"/);
});

test("ER-013: min, max, any of and if", () => {
  const manifest = ok(`
    store call { field day text }
    ask left max of 0 and setting.calls_needed minus my.days
    ask monday any of call where call.day is "Monday"
    ask word if my.days above 2 then "Done" else "Keep going"
    ask capped min of 5 and 2 plus 9
    ${PAGE}
  `);
  const context = ctx(
    { setting: { calls_needed: 3 }, compute: (path) => (path[0] === "days" ? 5 : undefined) },
    { call: [{ id: 1, day: "Monday" }, { id: 2, day: "Monday" }] },
  );
  assert.equal(evaluate(ask(manifest, "left"), context), 0);
  assert.equal(evaluate(ask(manifest, "monday"), context), 1);
  assert.equal(evaluate(ask(manifest, "word"), context), "Done");
  assert.equal(evaluate(ask(manifest, "capped"), context), 5);
});

test("ER-015: progress", () => {
  const manifest = ok(`
    ask days 2
    setting calls_needed {
type number
default 3
}
    page home { progress "Calls this week" my.days of setting.calls_needed }
  `);
  const bar = manifest.pages[0].widgets[0] as Extract<Widget, { kind: "progress" }>;
  const context = ctx({ setting: { calls_needed: 3 }, compute: () => 2 });
  assert.equal(evaluate(bar.value, context), 2);
  assert.equal(evaluate(bar.goal, context), 3);
  ok(`page home { progress "Total" sum of entry.n out of 10 }  store entry { field n number }`);
});

test("ER-017: repeated where lines are joined with and", () => {
  const manifest = ok(`
    store outing {
field kind choice local, overnight
field place text
field day date
}
    calendar outing {
      on day
      where outing.kind is "overnight"
      where outing.place contains "camp"
    }
    page home { list outing {
where outing.kind is "local"
where outing.place contains "park"
} }
  `);
  assert.equal(manifest.calendars![0].where?.all.length, 2);
  assert.equal((manifest.pages[0].widgets[0] as ListWidget).where?.all.length, 2);
});

test("ER-018: reading through a choice from field", () => {
  const manifest = ok(`
    store assignment {
      field title text
      field block text
      field day text
    }
    store finished {
      field assignment choice from assignment.title, assignment.block
      field block text
    }
    ask done_early count of finished where finished.assignment.day is not "Friday"
    page home {
      form "I finished it" {
        into finished
        ask assignment
        set block finished.assignment.block
      }
      list finished {
        columns assignment, assignment.day
        group by assignment.block
      }
    }
  `);
  const field = manifest.stores[1].fields[0];
  assert.deepEqual(field.from?.also, ["block"]);
  const assignments: Row[] = [
    { id: 1, title: "Draft 2", block: "Quest", day: "Monday" },
    { id: 2, title: "Draft 2", block: "Civilization", day: "Friday" },
  ];
  const finished: Row[] = [{ id: 10, assignment: 1 }, { id: 11, assignment: 2 }];
  const through: EvalContext["through"] = (store, name, id, rest) => {
    if (store !== "finished" || name !== "assignment") return undefined;
    const row = assignments.find((entry) => entry.id === Number(id));
    return { value: row?.[rest[0]] };
  };
  assert.equal(evaluate(ask(manifest, "done_early"), ctx({ through }, { finished })), 1);
  const list = manifest.pages[0].widgets[1] as ListWidget;
  assert.deepEqual(list.columns, ["assignment", "assignment.day"]);
  assert.deepEqual(list.groupBy, [{ field: "assignment.block", part: null }]);

  // The request's own snippet, where `assignment` isn't a `choice from` field, now says so.
  fails(
    `store finished {
      field assignment text
    }
    ask done_early count of finished where finished.assignment.day is not "Friday"
    ${PAGE}`,
    /isn't a `choice from` field/,
  );
  fails(
    `store assignment {
      field title text
    }
    store finished {
      field assignment choice from assignment.title
    }
    ask x count of finished where finished.assignment.dya is "Monday"
    ${PAGE}`,
    /has no field called "dya"/,
  );
});

test("ER-019: list values with each, a progress column, and totals", () => {
  const manifest = ok(`
    store core_goal {
      field steps number
    }
    store core_log {
      field steps number
      field subject text
    }
    page board {
      list from people {
        columns name, goal, done
        where row.role is "learner"
        value goal sum of core_goal.steps where core_goal.byId is each.id and core_goal.created above this_week_start
        value done sum of core_log.steps where core_log.byId is each.id and core_log.created above this_week_start
        progress done of goal
        total goal, done
      }
      list core_log {
        columns subject, steps
        group by by, subject
        total steps
      }
    }
  `);
  const board = manifest.pages[0].widgets[0] as ListWidget;
  assert.deepEqual(board.columns, ["name", "goal", "done", "progress"]);
  assert.deepEqual(board.progress, { value: "done", goal: "goal" });
  assert.deepEqual(board.totals, ["goal", "done"]);
  const logs = {
    core_log: [
      { id: 1, byId: 7, steps: 2, created: "2026-10-12T15:00:00.000Z" },
      { id: 2, byId: 7, steps: 1, created: "2026-10-12T16:00:00.000Z" },
      { id: 3, byId: 8, steps: 5, created: "2026-10-12T16:00:00.000Z" },
      { id: 4, byId: 7, steps: 9, created: "2026-10-01T16:00:00.000Z" },
    ],
  };
  const done = board.values!.find((entry) => entry.name === "done")!.expr;
  const context = ctx({ clock: { this_week_start: "2026-10-11" }, each: { id: 7 } }, logs);
  assert.equal(evaluate(done, context), 3);
  fails(
    `store log {
      field steps number
    }
    page home {
      list log {
        columns steps
        progress done of goal
      }
    }`,
    /There's no "done" for the bar/,
  );
});
