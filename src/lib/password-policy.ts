export const PASSWORD_POLICY_AR = "٨ أحرف على الأقل، وتحتوي على حروف ومعها أرقام أو رموز.";

export function validPersonalPassword(value: string): boolean {
  return (
    Array.from(value).length >= 8 &&
    new TextEncoder().encode(value).length <= 72 &&
    /\p{L}/u.test(value) &&
    /[\p{N}\p{P}\p{S}]/u.test(value)
  );
}

export function requiresInitialPassword(role: string): boolean {
  return role !== "super_admin";
}
