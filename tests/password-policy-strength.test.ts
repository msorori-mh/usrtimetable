import { describe, expect, test } from "bun:test";
import {
  PASSWORD_MAX_BYTES,
  describePasswordIssues,
  passwordPolicyIssues,
  requiresInitialPassword,
  validPersonalPassword,
} from "../src/lib/password-policy";

describe("M-3 new-password policy", () => {
  test("rejects short passwords that the previous 8-character rule accepted", () => {
    for (const value of ["abcdefgh", "Personal12!", "k9#Lm2vQ", "ابجدهوزح"])
      expect(passwordPolicyIssues(value)).toContain("too_short");
  });

  test("caps the password at 72 UTF-8 bytes (Arabic letters are 2 bytes)", () => {
    const arabic = "شمسٌ تشرق على صنعاء القديمة";
    expect(new TextEncoder().encode(arabic).length).toBeLessThanOrEqual(PASSWORD_MAX_BYTES);
    expect(validPersonalPassword(arabic)).toBe(true);
    const tooLong = "ق".repeat(30) + "ز".repeat(7);
    expect(Array.from(tooLong).length).toBe(37);
    expect(passwordPolicyIssues(tooLong)).toContain("too_long");
    expect(passwordPolicyIssues("Tq9#xLm2!vRz".repeat(7))).toContain("too_long");
  });

  test("rejects a single repeated character and short repeated patterns", () => {
    expect(passwordPolicyIssues("aaaaaaaaaaaa")).toContain("single_character");
    expect(passwordPolicyIssues("١١١١١١١١١١١١")).toContain("single_character");
    expect(passwordPolicyIssues("abababababab")).toContain("repeated_pattern");
    expect(passwordPolicyIssues("xyzqxyzqxyzq")).toContain("repeated_pattern");
  });

  test("rejects simple numeric, alphabetic and keyboard sequences", () => {
    for (const value of [
      "123456789012",
      "0987654321098",
      "abcdefghijklm",
      "qwertyuiopasdf",
      "asdfghjklzxcvb",
      "1qaz2wsx3edc4rfv",
      "abc123def456",
      "٠١٢٣٤٥٦٧٨٩٠١",
      "ابتثجحخدذرزس",
    ])
      expect(passwordPolicyIssues(value)).toContain("simple_sequence");
  });

  test("rejects passwords containing the email local part or the owner's name", () => {
    expect(
      passwordPolicyIssues("Mohammed.Ali-2026x", { email: "mohammed.ali@example.edu" }),
    ).toContain("contains_email");
    expect(passwordPolicyIssues("zz-msalem-Blue7", { email: "msalem@example.edu" })).toContain(
      "contains_email",
    );
    expect(passwordPolicyIssues("قمرأحمدالجديد٢٠٢٦", { name: "د. أحمد الحسني" })).toContain(
      "contains_name",
    );
    expect(passwordPolicyIssues("SaraTeal#River9", { name: "Sara Khaled" })).toContain(
      "contains_name",
    );
    // Same password without the context is acceptable.
    expect(validPersonalPassword("SaraTeal#River9")).toBe(true);
  });

  test("rejects very common passwords, including padded and leetspeak forms", () => {
    for (const value of [
      "password1234",
      "P@ssw0rd2026!",
      "Welcome12345",
      "admin@123456",
      "iloveyou2026",
      "Qwerty!23456",
    ])
      expect(passwordPolicyIssues(value)).toContain("common_password");
  });

  test("accepts strong passwords without requiring special characters", () => {
    for (const value of [
      "correct horse battery staple",
      "Tq9xLm2vRzKp",
      "سماء زرقاء فوق الجبال",
      "BlueRiver7Mango",
      "my-teal-kettle-sings",
    ])
      expect(passwordPolicyIssues(value, { email: "user@example.edu", name: "Test User" })).toEqual(
        [],
      );
  });

  test("lists every failed rule in Arabic", () => {
    const issues = passwordPolicyIssues("aaaa");
    expect(issues).toEqual(["too_short", "single_character"]);
    const text = describePasswordIssues(issues);
    expect(text).toContain("أقل من 12 حرفًا");
    expect(text).toContain("حرف واحد مكرر");
    expect(describePasswordIssues([])).toBe("");
  });

  test("super admins remain exempt from the initial-password flow", () => {
    expect(requiresInitialPassword("super_admin")).toBe(false);
    expect(requiresInitialPassword("college_dean")).toBe(true);
  });
});
