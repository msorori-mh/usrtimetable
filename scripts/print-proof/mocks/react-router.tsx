/**
 * Full-shell print proof — routing primitives only.
 *
 * The fixture mounts the REAL AppLayout component (its real wrappers, real mobile
 * header, real context bar). AppLayout needs `Link`, `useNavigate` and
 * `useRouterState`; a full router with the app's route tree would need the whole
 * app graph. Only navigation is stubbed here — every element, class name and
 * nesting level rendered by AppLayout stays the real thing.
 */
import type { ReactNode } from "react";

export function Link(props: {
  to?: string;
  params?: unknown;
  children?: ReactNode;
  [key: string]: unknown;
}) {
  const { to, params: _params, children, ...rest } = props;
  return (
    <a href={typeof to === "string" ? to : "#"} {...(rest as Record<string, unknown>)}>
      {children}
    </a>
  );
}

export function useNavigate() {
  return () => {};
}

export function useRouterState<T>(opts: {
  select: (s: { location: { pathname: string } }) => T;
}): T {
  return opts.select({ location: { pathname: "/timetable/print-proof-version/print" } });
}
