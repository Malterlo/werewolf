function registerRoutes(app) {
  app.get('/health', (_req, res) => res.json({ ok: true }));
}

export { registerRoutes };
