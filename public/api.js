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
  getUsers: () => req('GET', '/api/users'),
  createUser: (name, avatar) => req('POST', '/api/users', { name, avatar }),
  updateUser: (id, patch) => req('PUT', `/api/users/${id}`, patch),
  getProgress: (userId) => req('GET', `/api/progress/${userId}`),
  saveProgress: (userId, lessonId, score, xp) =>
    req('POST', '/api/progress', { userId, lessonId, score, xp }),
  getCards: () => req('GET', '/api/cards'),
  createCard: (card) => req('POST', '/api/cards', card),
  updateCard: (id, patch) => req('PUT', `/api/cards/${id}`, patch),
  deleteCard: (id) => req('DELETE', `/api/cards/${id}`),
  getDue: (userId) => req('GET', `/api/reviews/${userId}/due`),
  gradeReview: (userId, cardId, grade) => req('POST', '/api/reviews', { userId, cardId, grade }),
};
