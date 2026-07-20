async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${method} ${url} failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  getState: () => req('GET', '/api/state'),
  updateSettings: (patch) => req('PUT', '/api/settings', patch),
  resetAll: () => req('POST', '/api/reset'),
  saveProgress: (lessonId, score, xp) => req('POST', '/api/progress', { lessonId, score, xp }),
  placement: (passedLessonIds, xp) => req('POST', '/api/placement', { passedLessonIds, xp }),
};
