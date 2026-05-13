import { describe, it, expect, vi } from 'vitest';
import { createCourse, getCourse, listCourses, publishCourse, addLesson, listLessons } from '../services/course.service.js';
import { enroll, getEnrollment, listEnrollments, updateProgress, getProgress } from '../services/enrollment.service.js';
import { CourseError, isCourseError } from '../lib/course-errors.js';

function makeDb(rows: unknown[][] = []) {
  let idx = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve({ rows: rows[idx++] ?? [] })),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

const COURSE = { id: 'c1', promoterId: 'p1', title: 'TypeScript Masterclass', description: 'Deep dive', category: 'programming', priceHellers: 299900, maxStudents: 50, accessDays: 365, thumbnailUrl: null, status: 'published' as const, createdAt: new Date() };
const LESSON = { id: 'l1', courseId: 'c1', title: 'Intro', type: 'video' as const, contentUrl: 'https://stream/1', durationMinutes: 15, sortOrder: 1, isFreePreview: true };
const ENROLLMENT = { id: 'e1', courseId: 'c1', userId: 'u1', status: 'active' as const, enrolledAt: new Date(), expiresAt: new Date(Date.now() + 365 * 86400000), completedAt: null, progressPercent: 0 };

// ---------------------------------------------------------------------------
// Course CRUD
// ---------------------------------------------------------------------------
describe('Course CRUD', () => {
  it('creates a course', async () => {
    const db = makeDb([[COURSE]]);
    const r = await createCourse({ promoterId: 'p1', title: 'TypeScript Masterclass', category: 'programming', priceHellers: 299900 }, db);
    expect(r.title).toBe('TypeScript Masterclass');
  });

  it('gets course with counts', async () => {
    const db = makeDb([[{ ...COURSE, lessonCount: 10, enrollmentCount: 25 }]]);
    const r = await getCourse('c1', db);
    expect(r.lessonCount).toBe(10);
    expect(r.enrollmentCount).toBe(25);
  });

  it('throws COURSE_NOT_FOUND', async () => {
    const db = makeDb([[]]);
    await expect(getCourse('missing', db)).rejects.toThrow(CourseError);
  });

  it('lists published courses by default', async () => {
    const db = makeDb([[COURSE]]);
    await listCourses(undefined, undefined, db);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain("status = 'published'");
  });

  it('filters by category', async () => {
    const db = makeDb([[COURSE]]);
    await listCourses('programming', undefined, db);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('category = $1');
  });

  it('publishes a draft course', async () => {
    const db = makeDb([[{ ...COURSE, status: 'published' }]]);
    const r = await publishCourse('c1', db);
    expect(r.status).toBe('published');
  });

  it('throws when publishing non-draft', async () => {
    const db = makeDb([[]]);
    await expect(publishCourse('c1', db)).rejects.toThrow(CourseError);
  });
});

// ---------------------------------------------------------------------------
// Lesson CRUD
// ---------------------------------------------------------------------------
describe('Lesson CRUD', () => {
  it('adds a lesson', async () => {
    const db = makeDb([[LESSON]]);
    const r = await addLesson({ courseId: 'c1', title: 'Intro', type: 'video', sortOrder: 1 }, db);
    expect(r.title).toBe('Intro');
    expect(r.isFreePreview).toBe(true);
  });

  it('lists lessons sorted by order', async () => {
    const db = makeDb([[LESSON]]);
    const r = await listLessons('c1', db);
    expect(r).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------
describe('Enrollment', () => {
  it('enrolls a user', async () => {
    const db = makeDb([
      [{ max_students: 50, access_days: 365, status: 'published' }], // course
      [],  // not already enrolled
      [{ cnt: 10 }], // capacity check
      [ENROLLMENT], // insert
    ]);
    const r = await enroll('c1', 'u1', db);
    expect(r.status).toBe('active');
    expect(r.progressPercent).toBe(0);
  });

  it('throws ALREADY_ENROLLED', async () => {
    const db = makeDb([
      [{ max_students: null, access_days: 365, status: 'published' }],
      [{ id: 'existing' }], // already enrolled
    ]);
    await expect(enroll('c1', 'u1', db)).rejects.toThrow(CourseError);
  });

  it('throws COURSE_FULL when at capacity', async () => {
    const db = makeDb([
      [{ max_students: 10, access_days: 365, status: 'published' }],
      [], // not enrolled
      [{ cnt: 10 }], // at capacity
    ]);
    await expect(enroll('c1', 'u1', db)).rejects.toThrow(CourseError);
  });

  it('throws COURSE_NOT_FOUND for unpublished course', async () => {
    const db = makeDb([[{ max_students: null, access_days: 365, status: 'draft' }]]);
    await expect(enroll('c1', 'u1', db)).rejects.toThrow(CourseError);
  });

  it('skips capacity check when maxStudents is null', async () => {
    const db = makeDb([
      [{ max_students: null, access_days: 365, status: 'published' }],
      [], // not enrolled
      // no capacity query needed
      [ENROLLMENT],
    ]);
    const r = await enroll('c1', 'u1', db);
    expect(r.status).toBe('active');
    // Only 3 queries: course, existing check, insert (no capacity check)
    expect(db.query).toHaveBeenCalledTimes(3);
  });

  it('gets enrollment with course title', async () => {
    const db = makeDb([[{ ...ENROLLMENT, courseTitle: 'TypeScript Masterclass' }]]);
    const r = await getEnrollment('e1', db);
    expect(r.courseTitle).toBe('TypeScript Masterclass');
  });

  it('lists enrollments for user', async () => {
    const db = makeDb([[ENROLLMENT]]);
    const r = await listEnrollments('u1', db);
    expect(r).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------
describe('Progress tracking', () => {
  it('updates lesson progress', async () => {
    const progress = { id: 'lp1', enrollmentId: 'e1', lessonId: 'l1', completed: true, watchedSeconds: 900, lastAccessedAt: new Date() };
    const db = makeDb([
      [{ ...ENROLLMENT, courseTitle: 'TS' }], // getEnrollment
      [progress], // upsert progress
      [{ total: 5, done: 1 }], // recalculate
    ]);
    const r = await updateProgress('e1', 'l1', 900, true, db);
    expect(r.completed).toBe(true);
    expect(r.watchedSeconds).toBe(900);
    // progress_percent should be updated
    expect(db.execute).toHaveBeenCalledOnce();
    const params = db.execute.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(20); // 1/5 = 20%
  });

  it('throws ENROLLMENT_EXPIRED for expired enrollment', async () => {
    const expired = { ...ENROLLMENT, expiresAt: new Date('2020-01-01'), courseTitle: 'X' };
    const db = makeDb([[expired]]);
    await expect(updateProgress('e1', 'l1', 100, false, db)).rejects.toThrow(CourseError);
  });

  it('throws INVALID_PROGRESS for negative watchedSeconds', async () => {
    const db = makeDb([[{ ...ENROLLMENT, courseTitle: 'X' }]]);
    await expect(updateProgress('e1', 'l1', -1, false, db)).rejects.toThrow(CourseError);
  });

  it('gets progress for enrollment', async () => {
    const progress = { id: 'lp1', enrollmentId: 'e1', lessonId: 'l1', completed: false, watchedSeconds: 300, lastAccessedAt: new Date(), lessonTitle: 'Intro' };
    const db = makeDb([[progress]]);
    const r = await getProgress('e1', db);
    expect(r).toHaveLength(1);
    expect(r[0].lessonTitle).toBe('Intro');
  });

  it('auto-completes enrollment at 100%', async () => {
    const progress = { id: 'lp1', enrollmentId: 'e1', lessonId: 'l1', completed: true, watchedSeconds: 900, lastAccessedAt: new Date() };
    const db = makeDb([
      [{ ...ENROLLMENT, courseTitle: 'TS' }],
      [progress],
      [{ total: 1, done: 1 }], // all lessons done
    ]);
    await updateProgress('e1', 'l1', 900, true, db);
    const params = db.execute.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(100); // 100%
    const sql = db.execute.mock.calls[0][0] as string;
    expect(sql).toContain("'completed'");
  });
});

// ---------------------------------------------------------------------------
// CourseError
// ---------------------------------------------------------------------------
describe('CourseError', () => {
  it('maps codes correctly', () => {
    expect(new CourseError('COURSE_FULL').statusCode).toBe(409);
    expect(new CourseError('LESSON_LOCKED').statusCode).toBe(403);
    expect(new CourseError('ENROLLMENT_EXPIRED').statusCode).toBe(422);
  });
  it('type guard works', () => {
    expect(isCourseError(new CourseError('COURSE_NOT_FOUND'))).toBe(true);
    expect(isCourseError(new Error())).toBe(false);
  });
});
