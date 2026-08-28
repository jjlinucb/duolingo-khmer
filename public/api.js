async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.error || `${method} ${url} failed (${res.status})`);
    e.code = err.code;
    e.status = res.status;
    throw e;
  }
  return res.json();
}

export const api = {
  getUsers: () => req('GET', '/api/users'),
  startSession: (name) => req('POST', '/api/session', { name }),
  logout: () => req('POST', '/api/logout'),
  getState: () => req('GET', '/api/state'),
  updateSettings: (patch) => req('PUT', '/api/settings', patch),
  resetAll: () => req('POST', '/api/reset'),
  saveProgress: (lessonId, score, xp) => req('POST', '/api/progress', { lessonId, score, xp }),
  placement: (passedLessonIds, xp) => req('POST', '/api/placement', { passedLessonIds, xp }),
};

// True when a call failed because there's no valid profile cookie yet —
// callers use this to distinguish "show the profile picker" from a real error.
export function isNoSession(err) {
  return err && err.code === 'no-session';
}
