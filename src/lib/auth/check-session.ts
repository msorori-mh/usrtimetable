type ServiceError = { code?: string; status?: number; name?: string };
type SessionServices = {
  getUser: () => PromiseLike<{ data: { user: unknown | null }; error: ServiceError | null }>;
  accessStatus: (signal: AbortSignal) => PromiseLike<{
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

export async function boundedSessionRequest<T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  label: string,
  signal: AbortSignal,
  timeoutMs = 20_000,
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
): Promise<
  { kind: "signed-out" } | { kind: "ready"; passwordRequired: boolean; mfaRequired: boolean }
> {
  const user = await boundedSessionRequest(services.getUser, "التحقق من الهوية", signal, timeoutMs);
  if (user.error) {
    if (user.error.status === 401 || user.error.name === "AuthSessionMissingError")
      return { kind: "signed-out" };
    throw serviceFailure("تعذّر التحقق من الهوية.", user.error);
  }
  if (!user.data.user) return { kind: "signed-out" };
  const requirement = await boundedSessionRequest(
    services.accessStatus,
    "التحقق من متطلبات الدخول",
    signal,
    timeoutMs,
  );
  if (requirement.error) {
    if (requirement.status === 401 || requirement.error.code === "PT401")
      return { kind: "signed-out" };
    throw serviceFailure("تعذّر التحقق من متطلبات الدخول.", requirement.error, requirement.status);
  }
  const access = requirement.data;
  if (
    !access ||
    typeof access !== "object" ||
    !("session_valid" in access) ||
    typeof access.session_valid !== "boolean" ||
    !("password_required" in access) ||
    typeof access.password_required !== "boolean" ||
    !("mfa_required" in access) ||
    typeof access.mfa_required !== "boolean"
  )
    throw new SessionCheckError("استجابة التحقق من متطلبات الدخول غير صالحة. (INVALID_RESPONSE)");
  if (!access.session_valid) return { kind: "signed-out" };
  return {
    kind: "ready",
    passwordRequired: access.password_required,
    mfaRequired: access.mfa_required,
  };
}
