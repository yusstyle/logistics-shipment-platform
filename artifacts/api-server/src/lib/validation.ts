import type { Response } from "express";

type ValidationIssue = { path: Array<string | number>; message: string };
type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: ValidationIssue[] } };

type RuntimeSchema<T> = {
  safeParse(value: unknown): ParseResult<T>;
};

export function parseRequest<T>(
  schema: RuntimeSchema<T>,
  value: unknown,
  res: Response,
): T | null {
  const result = schema.safeParse(value);
  if (!result.success) {
    res.status(400).json({
      error: "Please check the submitted information.",
      details: result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
    return null;
  }
  return result.data;
}