type ServiceError = { code?: string; status?: number; name?: string };
type SessionServices = {
  getUser: () => PromiseLike<{ data: { user: unknown | null }; error: ServiceError | null }>;
  passwordRequirement: (signal: AbortSignal) => PromiseLike<{
    data: unknown;
    error: ServiceError | null;
    status?: number;
  }>;
};

export class SessionCheckError extends Error {}

function serviceFailure(label: string, error?: ServiceError | null, status?: number) {
  // Never display backend messages, details, JWTs or user metadata.
  const code = error?.code && /^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(error.code) ? error.code : null;
  const http = status ?? error?.status;
  const reference = [code, http && http >= 400 && http <= 599 ? `HTTP ${http}` : null]
    .filter(Boolean)
    .join(" / ");
  return new SessionCheckError(`${label}${reference ? ` (${reference})` : ""}`);
}

async function bounded<T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  label: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  const request = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  try {
    return await new Promise<T>((resolve, reject) => {
      onAbort = () => {
        reject(new SessionCheckError("أُلغي التحقق من الجلسة."));
        request.abort();
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => {
        reject(new SessionCheckError(`انتهت مهلة ${label}. أعد المحاولة. (TIMEOUT)`));
        request.abort();
      }, timeoutMs);
      // Promise.resolve also handles synchronous exceptions and thenable RPCs.
      void Promise.resolve()
        .then(() => {
          if (request.signal.aborted) throw new SessionCheckError("أُلغي التحقق من الجلسة.");
          return operation(request.signal);
        })
        .then(resolve, () => reject(serviceFailure(`تعذّر ${label}.`)));
    });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

/** No cached-session fallback: both remote checks must succeed before access. */
export async function checkAuthenticatedSession(
  services: SessionServices,
  signal: AbortSignal,
  timeoutMs = 20_000,
): Promise<{ kind: "signed-out" } | { kind: "ready"; passwordRequired: boolean }> {
  const user = await bounded(services.getUser, "التحقق من الهوية", signal, timeoutMs);
  if (user.error) {
    if (user.error.status === 401 || user.error.name === "AuthSessionMissingError")
      return { kind: "signed-out" };
    throw serviceFailure("تعذّر التحقق من الهوية.", user.error);
  }
  if (!user.data.user) return { kind: "signed-out" };
  const requirement = await bounded(
    services.passwordRequirement,
    "التحقق من متطلبات كلمة المرور",
    signal,
    timeoutMs,
  );
  if (requirement.error)
    throw serviceFailure(
      "تعذّر التحقق من متطلبات كلمة المرور.",
      requirement.error,
      requirement.status,
    );
  if (typeof requirement.data !== "boolean")
    throw new SessionCheckError(
      "استجابة التحقق من متطلبات كلمة المرور غير صالحة. (INVALID_RESPONSE)",
    );
  return { kind: "ready", passwordRequired: requirement.data };
}
