/**
 * Test-only bridge for running Bun-authored unit tests through Vitest when the
 * Bun binary is unavailable. The production application never imports this.
 */
import { describe, expect, it, test, vi } from "vitest";

type MockModuleFactory = (() => unknown) | Record<string, unknown>;

const mock = Object.assign(
  <T extends (...args: never[]) => unknown>(implementation?: T) => vi.fn(implementation),
  {
    module(id: string, factory: MockModuleFactory) {
      vi.doMock(id, typeof factory === "function" ? factory : () => factory);
    },
    restore() {
      vi.restoreAllMocks();
      vi.resetModules();
    },
  },
);

export { describe, expect, it, mock, test };
