// The sandbox academy's people. One of each kind of viewer a Tac-On has to
// behave correctly for. Shared by the seeder and the HTTP client.

export const SANDBOX_ACADEMY = "Tac-On Sandbox";
export const SANDBOX_DOMAIN = "tacon-sandbox.invalid";

export const STUDIOS = [
  { slug: "launchpad", name: "Launchpad" },
  { slug: "middle", name: "Middle Studio" },
];

/** `studio: null` means not placed in a studio (sees every studio, as admins do). */
export const PERSONAS = [
  { key: "admin", name: "Ada Admin", role: "admin", studio: null, dev: true, learnerAdmin: false },
  { key: "learneradmin", name: "Lee Learner-Admin", role: "admin", studio: "launchpad", dev: false, learnerAdmin: true },
  { key: "guide", name: "Gus Guide", role: "guide", studio: "launchpad", dev: false, learnerAdmin: false },
  { key: "secretary", name: "Sam Secretary", role: "secretary", studio: "launchpad", dev: false, learnerAdmin: false },
  { key: "learner1", name: "Lia Learner", role: "learner", studio: "launchpad", dev: false, learnerAdmin: false },
  { key: "learner2", name: "Leo Learner", role: "learner", studio: "launchpad", dev: false, learnerAdmin: false },
  { key: "learner3", name: "Mia Middle", role: "learner", studio: "middle", dev: false, learnerAdmin: false },
  { key: "dev", name: "Dev Learner", role: "learner", studio: "launchpad", dev: true, learnerAdmin: false },
];

export function personaEmail(key) {
  return `${key}@${SANDBOX_DOMAIN}`;
}
