const DEV_ALLOWLIST = ['pjpell077@gmail.com'];

export function isDevAccount(user: any): boolean {
  if (!user) return false;
  const email = user.email || user.claims?.email;
  return DEV_ALLOWLIST.includes(email);
}

export function requireDev(req: any, res: any, next: any) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ ok: false, error: 'Unauthenticated' });
  }
  if (!isDevAccount(req.user)) {
    console.log(`[dev-tools] 403 — ${req.user?.email || req.user?.claims?.email || 'unknown'} not in dev allowlist`);
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }
  next();
}
