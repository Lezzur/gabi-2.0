export type CursorPageRequest = {
  cursor?: string;
  limit?: number;
};

export type CursorPageMeta = Readonly<{
  next_cursor: string | null;
  has_more: boolean;
}>;

export type CursorPageResponse<T> = Readonly<{
  data: ReadonlyArray<T>;
  pagination: CursorPageMeta;
  meta: Readonly<{ request_id: string }>;
}>;
