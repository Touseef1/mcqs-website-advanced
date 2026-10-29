type ErrorPayload = Record<string, unknown>;

export class ApiResponseError extends Error {
  readonly response: { status: number; data: unknown };

  constructor(status: number, data: unknown, fallback: string) {
    super(getErrorMessage({ response: { status, data } }, fallback));
    this.name = "ApiResponseError";
    this.response = { status, data };
  }
}

export class ConfirmationCancelledError extends Error {
  constructor() {
    super("The action was cancelled.");
    this.name = "ConfirmationCancelledError";
  }
}

export function isConfirmationCancelled(error: unknown) {
  return error instanceof ConfirmationCancelledError;
}

function record(value: unknown): ErrorPayload | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ErrorPayload : null;
}

function safeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const message = value.trim();
  if (!message || message === "[object Object]") return null;
  return message;
}

function messagesFromValidation(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const item = record(entry);
      return [safeText(item?.message ?? item?.msg ?? entry)].filter((message): message is string => Boolean(message));
    });
  }
  const fields = record(value);
  if (!fields) return [];
  return Object.entries(fields).flatMap(([field, fieldValue]) => {
    const messages = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
    return messages.flatMap((entry) => {
      const item = record(entry);
      const message = safeText(item?.message ?? item?.msg ?? entry);
      return message ? [`${field}: ${message}`] : [];
    });
  });
}

function groupedResultErrors(data: ErrorPayload): string[] {
  if (!Array.isArray(data.results)) return [];
  const grouped = new Map<string, number>();
  for (const entry of data.results) {
    const item = record(entry);
    if (item?.ok !== false) continue;
    const reason = safeText(item.error);
    if (!reason) continue;
    grouped.set(reason, (grouped.get(reason) ?? 0) + 1);
  }
  return [...grouped].map(([reason, count]) => count > 1 ? `${reason} (${count} MCQs)` : reason);
}

function statusMessage(status: number, fallback: string) {
  if (status === 401) return "Your session has expired. Please sign in and try again.";
  if (status === 403) return "You do not have permission to do that.";
  if (status === 404) return "The requested item could not be found. Refresh the page and try again.";
  if (status === 408 || status === 504) return "The request timed out. Please try again.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status >= 500) return "Something went wrong on our end. Please try again.";
  return fallback;
}

/** Resolve API, validation, network, and unexpected errors to a readable message. */
export function getErrorMessage(error: unknown, fallback = "The request could not be completed. Please try again.") {
  if (isConfirmationCancelled(error)) return "";
  const outer = record(error);
  const response = record(outer?.response);
  const data = record(response?.data) ?? record(outer?.data) ?? outer;

  if (data) {
    const resultErrors = groupedResultErrors(data);
    if (resultErrors.length) return resultErrors.join("\n");
    const apiMessage = safeText(data.error) ?? safeText(data.message);
    if (apiMessage) return apiMessage;
    const validation = messagesFromValidation(data.errors ?? data.fieldErrors ?? data.validationErrors ?? data.issues);
    if (validation.length) return validation.join("\n");
  }

  const status = typeof response?.status === "number" ? response.status : typeof outer?.status === "number" ? outer.status : null;
  if (status !== null) return statusMessage(status, fallback);

  const errorName = safeText(outer?.name);
  const message = safeText(outer?.message);
  const code = safeText(outer?.code);
  if (errorName === "TimeoutError" || errorName === "AbortError" || code === "ETIMEDOUT" || code === "ECONNABORTED") {
    return "The request timed out. Please try again.";
  }
  if (errorName === "TypeError" || /failed to fetch|networkerror|network request failed/i.test(message ?? "")) {
    return "Network connection problem. Check your connection and try again.";
  }
  return message ?? fallback;
}

export async function parseApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiResponseError(response.status, data, fallback);
  if (data === null) throw new Error("The server returned an unreadable response. Please try again.");
  return data as T;
}
