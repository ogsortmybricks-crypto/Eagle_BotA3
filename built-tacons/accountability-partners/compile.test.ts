import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { compile } from "../../shared/tacons/compile";
import { weekStanding, weekStart } from "../../shared/tacons/partners";

const source = readFileSync(new URL("./accountability-partners.tacon", import.meta.url), "utf8");

test("Accountability Partners compiles with its subjects, weekly minimum and Friday rule", () => {
  const result = compile(source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  if (!result.ok) return;
  assert.deepEqual(result.manifest.partners, [{
    name: "ap",
    title: "Accountability Partners",
    core: ["Math", "Reading"],
    evidence: ["Writers' Workshop", "Civilization", "Quest"],
    required: 3,
    due: 5,
    trios: true,
    managers: ["admin", "guide"],
  }]);
  assert.ok(result.manifest.pages[0].widgets.some((w) => w.kind === "partners" && w.partners === "ap"));
});

test("partners widgets cannot reference missing partners", () => {
  const result = compile('tacon bad-ap {\n name "Bad"\n version 1.0.0\n page p { partners missing }\n}');
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.message.includes("no partners")));
});

test("partners settings are checked", () => {
  for (const edit of ["required 0", "required 8", "required 2.5"]) {
    assert.equal(compile(source.replace("required 3", edit)).ok, false, edit);
  }
  assert.equal(compile(source.replace("due friday", "due someday")).ok, false);
  assert.equal(compile(source.replace("managers admin, guide", "managers everyone")).ok, false);
  assert.equal(compile(source.replace('core "Math", "Reading"', 'core "Math", "Math"')).ok, false);
  assert.equal(compile(source.replace("    trios true\n", "    trios true\n    colour blue\n")).ok, false);
});

test("managers may name a position declared later in the file", () => {
  const edited = source
    .replace("managers admin, guide", "managers admin, ap_captain")
    .replace(/\n}\s*$/, '\n  position ap_captain { title "AP Captain" }\n}\n');
  const result = compile(edited);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.manifest?.partners?.[0].managers, ["admin", "position:ap_captain"]);
});

test("weeks start on Monday", () => {
  assert.equal(weekStart("2026-10-05"), "2026-10-05"); // Monday
  assert.equal(weekStart("2026-10-09"), "2026-10-05"); // Friday
  assert.equal(weekStart("2026-10-11"), "2026-10-05"); // Sunday
});

test("weekly standing follows the 3-days-including-Friday rule", () => {
  const week = "2026-10-05";
  const base = { required: 3, due: 5, week };
  // Three days but no Friday yet, on Thursday: still possible.
  let standing = weekStanding({ ...base, days: ["2026-10-05", "2026-10-06", "2026-10-07"], today: "2026-10-08" });
  assert.equal(standing.status, "on-pace");
  assert.match(standing.summary, /Friday/);
  // Friday passed without a Friday check-in: missed, however many days.
  standing = weekStanding({ ...base, days: ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"], today: "2026-10-10" });
  assert.equal(standing.status, "missed");
  // Three including Friday: met.
  standing = weekStanding({ ...base, days: ["2026-10-05", "2026-10-07", "2026-10-09"], today: "2026-10-09" });
  assert.equal(standing.status, "met");
  // Nothing by Thursday: only Thursday and Friday left for three check-ins.
  standing = weekStanding({ ...base, days: [], today: "2026-10-08" });
  assert.equal(standing.status, "behind");
  // Duplicate days count once; other weeks don't count.
  standing = weekStanding({ ...base, days: ["2026-10-05", "2026-10-05", "2026-09-30"], today: "2026-10-05" });
  assert.equal(standing.done, 1);
});
