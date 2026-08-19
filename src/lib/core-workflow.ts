export type CoreWorkflowStageId = "prepare" | "build" | "review" | "publish";

export type CoreWorkflowStageStatus = "complete" | "active" | "blocked";

export interface CoreWorkflowStageDefinition {
  id: CoreWorkflowStageId;
  order: number;
  titleAr: string;
  descriptionAr: string;
  href: "/data-onboarding" | "/schedule-builder" | "/schedule-versions" | "/published-schedules";
}

export interface CoreWorkflowFacts {
  hasActiveCollege: boolean;
  readinessPercent: number | null;
  blockerCount: number | null;
  scheduleVersionCount: number;
  publishedVersionCount: number;
}

export interface CoreWorkflowStageState extends CoreWorkflowStageDefinition {
  status: CoreWorkflowStageStatus;
  statusLabelAr: string;
}

export interface CoreWorkflowState {
  stages: CoreWorkflowStageState[];
  nextStage: CoreWorkflowStageState;
}

export const CORE_WORKFLOW_STAGES: readonly CoreWorkflowStageDefinition[] = [
  {
    id: "prepare",
    order: 1,
    titleAr: "جهّز البيانات",
    descriptionAr: "أكمل البيانات الأساسية وأصلح الحواجز من مكان واحد.",
    href: "/data-onboarding",
  },
  {
    id: "build",
    order: 2,
    titleAr: "ابنِ الجدول",
    descriptionAr: "وزّع المحاضرات يدويًا أو بمساعدة الجدولة التلقائية.",
    href: "/schedule-builder",
  },
  {
    id: "review",
    order: 3,
    titleAr: "راجع واعتمد",
    descriptionAr: "راجع التعارضات والجودة ثم نفّذ انتقالات الاعتماد الآمنة.",
    href: "/schedule-versions",
  },
  {
    id: "publish",
    order: 4,
    titleAr: "انشر وشارك",
    descriptionAr: "اعرض الجداول المنشورة والتقارير الرسمية بعد الاعتماد.",
    href: "/published-schedules",
  },
] as const;

const STATUS_LABEL_AR: Record<CoreWorkflowStageStatus, string> = {
  complete: "مكتمل",
  active: "الخطوة الحالية",
  blocked: "بانتظار الخطوة السابقة",
};

/**
 * Presentation-only workflow summary.
 *
 * This helper never authorizes a lifecycle transition and never replaces the
 * server-side readiness, conflict, RBAC, RLS, or publish gates.
 */
export function resolveCoreWorkflow(facts: CoreWorkflowFacts): CoreWorkflowState {
  const readinessKnown = facts.readinessPercent !== null && facts.blockerCount !== null;
  const preparationComplete =
    facts.hasActiveCollege &&
    readinessKnown &&
    facts.readinessPercent === 100 &&
    facts.blockerCount === 0;

  const statusById: Record<CoreWorkflowStageId, CoreWorkflowStageStatus> = {
    prepare: preparationComplete ? "complete" : "active",
    build: !preparationComplete
      ? "blocked"
      : facts.scheduleVersionCount > 0
        ? "complete"
        : "active",
    review:
      facts.scheduleVersionCount === 0
        ? "blocked"
        : facts.publishedVersionCount > 0
          ? "complete"
          : "active",
    publish:
      facts.scheduleVersionCount === 0
        ? "blocked"
        : facts.publishedVersionCount > 0
          ? "complete"
          : "active",
  };

  const stages = CORE_WORKFLOW_STAGES.map((stage) => ({
    ...stage,
    status: statusById[stage.id],
    statusLabelAr: STATUS_LABEL_AR[statusById[stage.id]],
  }));

  const nextStage = stages.find((stage) => stage.status === "active") ?? stages[stages.length - 1];

  return { stages, nextStage };
}
