(function exposeRequestGuard(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RequestGuard = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  function snapshot(value) {
    return JSON.stringify(value);
  }

  function createRequestGuard() {
    const generations = new Map();

    return {
      begin(key, context) {
        const generation = (generations.get(key) || 0) + 1;
        generations.set(key, generation);
        return Object.freeze({ key, generation, context: snapshot(context) });
      },

      isCurrent(request, currentContext) {
        return Boolean(
          request
          && generations.get(request.key) === request.generation
          && request.context === snapshot(currentContext)
        );
      },
    };
  }

  return { createRequestGuard };
});
