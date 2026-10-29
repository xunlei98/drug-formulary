export class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.offline = status === 0;
    Object.assign(this, extra);
  }
}

const listeners = new Set();
export const onUnauthorized = (fn) => listeners.add(fn);

export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'x-requested-with': 'formulary', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No connection');
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  if (res.status === 401 && url !== '/api/login') for (const fn of listeners) fn();
  throw new ApiError(res.status, data.error || 'Something went wrong', data);
}

export const get = (url) => api('GET', url);
export const post = (url, body = {}) => api('POST', url, body);
export const put = (url, body = {}) => api('PUT', url, body);
export const patch = (url, body = {}) => api('PATCH', url, body);
export const del = (url) => api('DELETE', url);
