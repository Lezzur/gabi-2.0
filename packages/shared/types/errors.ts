export type ApiError = Readonly<{
  code: string;
  message: string;
  field?: string;
  details?: Readonly<Record<string, unknown>>;
  request_id?: string;
}>;

export type ApiErrorResponse = Readonly<{
  error: ApiError;
}>;
