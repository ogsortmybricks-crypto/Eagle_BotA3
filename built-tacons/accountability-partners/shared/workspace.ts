/** The AP learning workspace. Stored in existing, install-isolated Tac-On records. */
export const AP_CATEGORIES = ["Writers' Workshop", "Civilization", "Quest"] as const;
export type ApCategory = { id: number; name: string; archived: boolean };
export type ApAssignment = {
  id: number; week: string; category: string; title: string; description: string;
  dueDate: string; archived: boolean;
};
export type ApCertificate = {
  id: number; assignmentId: number; groupId: number; learnerId: number; learnerName: string;
  checkerId: number; checkerName: string; assignmentTitle: string; category: string; week: string;
  completedDate: string; certifiedAt: string; excellence: boolean; notes: string;
  evidence: string; token: string; revoked: boolean;
};
export type ApProfile = {
  personId: number; attendanceDays: number[];
  absences: { date: string; reason: "sick" | "other"; notes: string }[];
  milestones: { id: string; date: string; title: string; notes: string }[];
};
export type ApWorkspace = {
  canPlan: boolean; canReviewAll: boolean; hasCode: boolean;
  categories: ApCategory[]; assignments: ApAssignment[]; certificates: ApCertificate[];
  profiles: ApProfile[];
};
/** Public attestations intentionally omit private notes, evidence and attendance. */
export type ApPublicCertificate = {
  learnerName: string; checkerName: string; assignmentTitle: string; category: string;
  week: string; completedDate: string; certifiedAt: string; excellence: boolean;
  revoked: boolean; academyName: string;
};
