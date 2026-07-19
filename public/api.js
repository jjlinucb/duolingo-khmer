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
  getCards: () => req('GET', '/api/cards'),
  createCard: (card) => req('POST', '/api/cards', card),
  updateCard: (id, patch) => req('PUT', `/api/cards/${id}`, patch),
  deleteCard: (id) => req('DELETE', `/api/cards/${id}`),
  getDue: () => req('GET', '/api/reviews/due'),
  gradeReview: (cardId, grade) => req('POST', '/api/reviews', { cardId, grade }),
};
