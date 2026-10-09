const RUN_ORDER = ['AM', 'MIDDAY', 'PM'];

/**
 * @param {string} type
 */
export function runTypeLabel(type) {
  if (type === 'MIDDAY') return 'Midday';
  return type;
}

/**
 * @param {string[]} types
 */
export function joinRunLabels(types) {
  const labels = types.map(runTypeLabel);
  if (labels.length <= 1) return labels[0] || '';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}

/**
 * Routes this driver holds that share an AM, Midday, or PM run with the route
 * just assigned. Types are only the runs that appear on more than one route.
 * @param {Array<{ id: string, name: string, types: string[] }>} routes
 * @param {string} focusId
 * @returns {{ types: string[], routes: Array<{ id: string, name: string, types: string[] }> } | null}
 */
export function duplicateRunRoutes(routes, focusId) {
  const focus = routes.find((route) => route.id === focusId);
  if (!focus) return null;
  const focusTypes = RUN_ORDER.filter((type) => focus.types?.includes(type));
  const types = focusTypes.filter((type) =>
    routes.some((route) => route.id !== focusId && route.types?.includes(type))
  );
  if (!types.length) return null;
  const duplicated = routes
    .filter((route) => route.types?.some((type) => types.includes(type)))
    .map((route) => ({
      id: route.id,
      name: route.name,
      types: RUN_ORDER.filter((type) => route.types.includes(type) && types.includes(type)),
    }));
  const focusRoute = duplicated.find((route) => route.id === focusId);
  const others = duplicated.filter((route) => route.id !== focusId);
  return { types, routes: focusRoute ? [focusRoute, ...others] : others };
}
