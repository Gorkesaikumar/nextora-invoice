export class ApiError extends Error {
  constructor(status, message, code, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields || [];
  }
}

let csrfToken = null;
let onUnauthenticated = () => {};

export const setCsrfToken = value => { csrfToken = value; };
export const setUnauthenticatedHandler = handler => { onUnauthenticated = handler; };

async function request(method, path, payload, { raw = false, signal, silent = false } = {}) {
  // Use Electron IPC bridge if available (desktop build)
  if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.request) {
    const headers = {};
    if (payload !== undefined) headers['content-type'] = 'application/json';
    if (csrfToken && !['GET', 'HEAD'].includes(method)) headers['x-csrf-token'] = csrfToken;
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const result = await window.electronAPI.request({ method, path, headers, body });
    if (result.status === 401) {
      if (!silent) onUnauthenticated();
      throw new ApiError(401, 'Your session has ended. Please sign in again.', 'UNAUTHENTICATED');
    }
    const isBase64 = result.headers && result.headers['x-encoded'] === 'base64';
    if (raw) {
      if (result.status < 200 || result.status >= 300) throw new ApiError(result.status, 'The request failed.', 'REQUEST_FAILED');
      if (isBase64 && result.body) {
        const bytes = Uint8Array.from(atob(result.body), c => c.charCodeAt(0));
        return new Response(bytes, { status: result.status, headers: result.headers });
      }
      return new Response(result.body, { status: result.status, headers: result.headers });
    }
    let data = null;
    try { data = result.body ? JSON.parse(result.body) : null; } catch { data = null; }
    if (result.status < 200 || result.status >= 300) {
      throw new ApiError(result.status, data?.error || 'Something went wrong. Please try again.',
        data?.code || 'REQUEST_FAILED', data?.fields);
    }
    return data;
  }

  const headers = { 'sec-fetch-site': 'same-origin' };
  if (payload !== undefined) headers['content-type'] = 'application/json';
  if (csrfToken && !['GET', 'HEAD'].includes(method)) headers['x-csrf-token'] = csrfToken;

  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    signal,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  if (response.status === 401) {
    if (!silent) onUnauthenticated();
    throw new ApiError(401, 'Your session has ended. Please sign in again.', 'UNAUTHENTICATED');
  }
  if (raw) {
    if (!response.ok) throw new ApiError(response.status, 'The request failed.', 'REQUEST_FAILED');
    return response;
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    throw new ApiError(response.status, data?.error || 'Something went wrong. Please try again.',
      data?.code || 'REQUEST_FAILED', data?.fields);
  }
  return data;
}

export const api = {
  get: path => request('GET', path),
  probe: path => request('GET', path, undefined, { silent: true }),
  post: (path, payload) => request('POST', path, payload ?? {}),
  put: (path, payload) => request('PUT', path, payload),
  patch: (path, payload) => request('PATCH', path, payload),
  delete: path => request('DELETE', path),
  /** Opens a PDF response in a preview window/tab (or triggers a native Save dialog / download). */
  async openDocument(path, { download = false } = {}) {
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.openDocument) {
      const result = await window.electronAPI.openDocument({ path, download });
      if (!result?.ok) {
        if (result?.status === 401) onUnauthenticated();
        throw new ApiError(result?.status || 500, result?.error || 'Could not open document.', 'DOCUMENT_FAILED');
      }
      return result;
    }
    const response = await request('GET', path, undefined, { raw: true });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    if (download) {
      const link = document.createElement('a');
      link.href = url;
      link.download = filenameFrom(response) || 'document.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } else {
      window.open(url, '_blank', 'noopener');
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { ok: true };
  },
  async backupDatabase() {
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.backupDatabase) {
      const result = await window.electronAPI.backupDatabase({ csrfToken });
      if (!result?.ok) throw new ApiError(400, result?.error || 'Backup failed.', 'BACKUP_FAILED');
      return result;
    }
    throw new ApiError(400, 'Native file dialog is only available in the desktop application.', 'DESKTOP_ONLY');
  },
  async restoreDatabase() {
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.restoreDatabase) {
      const result = await window.electronAPI.restoreDatabase({ csrfToken });
      if (!result?.ok) throw new ApiError(400, result?.error || 'Restore failed.', 'RESTORE_FAILED');
      return result;
    }
    throw new ApiError(400, 'Native file dialog is only available in the desktop application.', 'DESKTOP_ONLY');
  },
  async getDocumentJson(path) {
    return request('GET', path);
  },
};

function filenameFrom(response) {
  const header = response.headers.get('content-disposition') || '';
  const match = /filename="([^"]+)"/.exec(header);
  return match ? match[1] : null;
}

export const query = params => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== '' && value !== null && value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};
