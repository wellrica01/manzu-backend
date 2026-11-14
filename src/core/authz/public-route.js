// src/core/authz/public-route.js
// publicRoute(reason) - middleware tag that marks a route as intentionally
// unauthenticated. Doc 1 S4.2: "if a public route has no reason [the CI test
// fails]". The reason is required at definition time, so a route with no
// justification cannot exist.
//
// The returned middleware is a passthrough. Its only purpose is the `.policy`
// property the CI test reads.

function publicRoute(reason) {
  if (!reason || typeof reason !== 'string' || reason.trim().length < 8) {
    throw new TypeError(
      'publicRoute(reason): reason is required and must be at least 8 characters'
    );
  }
  const middleware = function publicRoutePassthrough(req, res, next) {
    return next();
  };
  middleware.policy = Object.freeze({ type: 'public', reason });
  return middleware;
}

module.exports = { publicRoute };