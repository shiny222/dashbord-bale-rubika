// Thin fetch wrapper for the dashboard API. Always sends credentials
// (session cookie), parses the { success, data | error } envelope and
// normalizes failures into ApiError.

export class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const options = { method, headers: {}, credentials: 'same-origin', signal };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, options);
  } catch {
    throw new ApiError('NETWORK', 'Cannot reach the dashboard server.');
  }
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (res.status === 401 && payload && payload.error === 'AUTH_REQUIRED') {
    throw new ApiError('AUTH_REQUIRED', 'Session expired. Please log in again.', res.status);
  }
  if (!res.ok || !payload || payload.success !== true) {
    throw new ApiError(
      (payload && payload.error) || 'ERROR',
      (payload && payload.message) || `Request failed (${res.status}).`,
      res.status,
    );
  }
  return payload.data;
}
