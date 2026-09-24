import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createTeachingAssignmentV2,
  deactivateTeachingAssignmentV2,
  listTeachingAssignmentWorkspace,
  previewInstructorWorkloadAfterAssignment,
  updateTeachingAssignmentV2,
} from "@/lib/academic-delivery/teaching-assignments-v2-service";
import { mapAssignmentRpcError } from "@/lib/academic-delivery/teaching-assignments-v2";
import type { WorkspaceFilters } from "@/lib/academic-delivery/teaching-assignments-v2";

export function teachingAssignmentWorkspaceKey(filters: WorkspaceFilters) {
  return ["teaching-assignment-workspace-v2", filters] as const;
}

export function useTeachingAssignmentWorkspace(filters: WorkspaceFilters | null) {
  return useQuery({
    queryKey: filters
      ? teachingAssignmentWorkspaceKey(filters)
      : ["teaching-assignment-workspace-v2", "idle"],
    enabled: !!filters?.collegeId,
    queryFn: () => listTeachingAssignmentWorkspace(filters!),
  });
}

export function useWorkloadPreview(input: {
  instructorId: string | null;
  deliveryGroupId: string | null;
  assignedComponentHours: number | null;
  assignmentId?: string | null;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: [
      "teaching-assignment-workload-preview",
      input.instructorId,
      input.deliveryGroupId,
      input.assignedComponentHours,
      input.assignmentId,
    ],
    enabled: (input.enabled ?? true) && !!input.instructorId && !!input.deliveryGroupId,
    queryFn: () =>
      previewInstructorWorkloadAfterAssignment({
        instructorId: input.instructorId!,
        deliveryGroupId: input.deliveryGroupId!,
        assignedComponentHours: input.assignedComponentHours,
        assignmentId: input.assignmentId,
      }),
  });
}

function mutationErrorToast(e: Error) {
  const mapped = mapAssignmentRpcError(e.message);
  toast.error(mapped.message);
}

export function useCreateTeachingAssignmentV2(filters: WorkspaceFilters | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTeachingAssignmentV2,
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error("فشل الإسناد");
        return;
      }
      toast.success(
        result.action === "requested"
          ? "أُرسل طلب التكليف إلى الكلية الأصلية"
          : result.action === "reactivated"
            ? "أُعيد تفعيل الإسناد"
            : "تم إنشاء الإسناد",
      );
      if (filters) {
        void qc.invalidateQueries({
          queryKey: teachingAssignmentWorkspaceKey(filters),
        });
      }
      void qc.invalidateQueries({
        queryKey: ["teaching-assignment-workload-preview"],
      });
      void qc.invalidateQueries({ queryKey: ["faculty-teaching-requests"] });
    },
    onError: mutationErrorToast,
  });
}

export function useUpdateTeachingAssignmentV2(filters: WorkspaceFilters | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateTeachingAssignmentV2,
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error("فشل تحديث الإسناد");
        return;
      }
      toast.success(
        result.action === "requested"
          ? "أُرسل طلب تعديل التكليف إلى الكلية الأصلية"
          : "تم تحديث ساعات الإسناد",
      );
      if (filters) {
        void qc.invalidateQueries({
          queryKey: teachingAssignmentWorkspaceKey(filters),
        });
      }
      void qc.invalidateQueries({
        queryKey: ["teaching-assignment-workload-preview"],
      });
      void qc.invalidateQueries({ queryKey: ["faculty-teaching-requests"] });
    },
    onError: mutationErrorToast,
  });
}

export function useDeactivateTeachingAssignmentV2(filters: WorkspaceFilters | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deactivateTeachingAssignmentV2,
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error("فشل تعطيل الإسناد");
        return;
      }
      toast.success("تم تعطيل الإسناد (محفوظ للتاريخ)");
      if (filters) {
        void qc.invalidateQueries({
          queryKey: teachingAssignmentWorkspaceKey(filters),
        });
      }
      void qc.invalidateQueries({
        queryKey: ["teaching-assignment-workload-preview"],
      });
      void qc.invalidateQueries({ queryKey: ["faculty-teaching-requests"] });
    },
    onError: mutationErrorToast,
  });
}
