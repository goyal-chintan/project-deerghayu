function splitPath(path) {
  return String(path || '/')
    .split('?')[0]
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean);
}

function matchRoute(route, location) {
  if (route === '*') return {};

  const routeSegments = splitPath(route);
  const locationSegments = splitPath(location);
  if (routeSegments.length !== locationSegments.length) return null;

  const params = {};
  for (let index = 0; index < routeSegments.length; index += 1) {
    const routeSegment = routeSegments[index];
    const locationSegment = locationSegments[index];

    if (routeSegment.startsWith(':')) {
      params[routeSegment.slice(1)] = decodeURIComponent(locationSegment);
    } else if (routeSegment.toLowerCase() !== locationSegment.toLowerCase()) {
      return null;
    }
  }

  return params;
}

export function resolveRoute(routes, location) {
  for (const [route, component] of Object.entries(routes || {})) {
    const params = matchRoute(route, location);
    if (params === null) continue;

    return {
      component,
      params: Object.keys(params).length ? params : null,
      route,
    };
  }

  return { component: null, params: null, route: null };
}
