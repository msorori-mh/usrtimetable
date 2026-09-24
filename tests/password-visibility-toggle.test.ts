/** Every sign-in password field offers a show/hide toggle for all users. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const component = readFileSync("src/components/ui/password-input.tsx", "utf8");
const screens = [
  "src/routes/auth.tsx",
  "src/components/mandatory-password-change.tsx",
] as const;

describe("password visibility toggle", () => {
  it("toggles between hidden and visible text and is labelled in Arabic", () => {
    expect(component).toMatch(/type=\{visible \? "text" : "password"\}/);
    expect(component).toMatch(/إظهار كلمة المرور/);
    expect(component).toMatch(/إخفاء كلمة المرور/);
    expect(component).toMatch(/useState\(false\)/); // starts hidden on every mount
  });

  it("never logs or persists the value", () => {
    expect(component).not.toMatch(/console\.|localStorage|sessionStorage|fetch\(/);
  });

  it("is used by every sign-in password field, with no bare password inputs left", () => {
    for (const file of screens) {
      const src = readFileSync(file, "utf8");
      expect(src).toMatch(/<PasswordInput/);
      expect(src).not.toMatch(/type="password"/);
    }
  });
});
