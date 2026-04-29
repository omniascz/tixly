type CourseErrorCode =
  | 'COURSE_NOT_FOUND'
  | 'LESSON_NOT_FOUND'
  | 'ENROLLMENT_NOT_FOUND'
  | 'ALREADY_ENROLLED'
  | 'COURSE_FULL'
  | 'ENROLLMENT_EXPIRED'
  | 'LESSON_LOCKED'
  | 'INVALID_PROGRESS';

const HTTP_STATUS: Record<CourseErrorCode, number> = {
  COURSE_NOT_FOUND: 404, LESSON_NOT_FOUND: 404, ENROLLMENT_NOT_FOUND: 404,
  ALREADY_ENROLLED: 409, COURSE_FULL: 409, ENROLLMENT_EXPIRED: 422,
  LESSON_LOCKED: 403, INVALID_PROGRESS: 400,
};

export class CourseError extends Error {
  readonly code: CourseErrorCode;
  readonly statusCode: number;
  constructor(code: CourseErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    this.name = 'CourseError';
  }
  toHttpError() { return { error: this.code, message: this.message, statusCode: this.statusCode }; }
}

export function isCourseError(err: unknown): err is CourseError { return err instanceof CourseError; }
