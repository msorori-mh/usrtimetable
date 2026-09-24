export const PASSWORD_POLICY_AR =
  "٨ أحرف على الأقل؛ يمكن أن تكون حروفًا فقط أو أرقامًا فقط أو خليطًا، دون اشتراط رموز خاصة.";

export function validPersonalPassword(value: string): boolean {
  return Array.from(value).length >= 8 && new TextEncoder().encode(value).length <= 72;
}

export function requiresInitialPassword(role: string): boolean {
  return role !== "super_admin";
}
