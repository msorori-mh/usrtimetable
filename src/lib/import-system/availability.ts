import type { ImportAvailability, ImportDefinition } from "./contracts";

export function isComingSoon(availability: ImportAvailability): boolean {
  return availability === "coming_soon";
}

/** True when the unified canonical pipeline can execute imports (PR6+). */
export function canCanonicalExecute(definition: ImportDefinition): boolean {
  if (isComingSoon(definition.availability)) {
    return false;
  }
  if (definition.availability === "deprecated" || definition.availability === "internal") {
    return false;
  }
  return definition.capabilities.canonicalExecution;
}
