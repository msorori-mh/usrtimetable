import type { ReactNode } from "react";

/**
 * A running table header reserves its own height on every physical page.
 * Keep the outer body row splittable; the detail tables control their own rows.
 * On screen these structural wrappers are transparent.
 */
export function RepeatingPrintHeader({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <table className="report-page-frame" role="presentation">
      <thead className="report-page-header">
        <tr>
          <td>{header}</td>
        </tr>
      </thead>
      <tbody className="report-page-content">
        <tr>
          <td>{children}</td>
        </tr>
      </tbody>
    </table>
  );
}
