/**
 * Visibility rules for the delivery-groups diagnostic page.
 *
 * `is_obsolete` is the source of truth for historical/cancelled groups.
 * The default view shows only operational (non-obsolete) groups; obsolete
 * rows appear only when the user explicitly opts in, and they stay
 * visually marked and non-assignable.
 */

export type ObsoleteFlagRow = { is_obsolete?: boolean | null };

export function isOperationalDeliveryGroup<T extends ObsoleteFlagRow>(row: T): boolean {
  return row.is_obsolete !== true;
}

export function splitDeliveryGroupsByObsolescence<T extends ObsoleteFlagRow>(rows: T[]): {
  operational: T[];
  obsolete: T[];
} {
  const operational: T[] = [];
  const obsolete: T[] = [];
  for (const row of rows) {
    (isOperationalDeliveryGroup(row) ? operational : obsolete).push(row);
  }
  return { operational, obsolete };
}

/** Rows visible in the list for the given "show historical" toggle. */
export function visibleDeliveryGroups<T extends ObsoleteFlagRow>(
  rows: T[],
  showObsolete: boolean,
): T[] {
  return showObsolete ? rows : rows.filter(isOperationalDeliveryGroup);
}
