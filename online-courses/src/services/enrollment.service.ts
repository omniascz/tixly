/**
 * Enrollment + progress tracking for online courses.
 */
import { CourseError } from '../lib/course-errors.js';
import type { CourseDB } from './course.service.js';

export type EnrollmentStatus = 'active' | 'completed' | 'expired' | 'refunded';

export interface Enrollment {
  id: string;
  courseId: string;
  userId: string;
  status: EnrollmentStatus;
  enrolledAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
  progressPercent: number;
  courseTitle?: string;
}

export interface LessonProgress {
  id: string;
  enrollmentId: string;
  lessonId: string;
  completed: boolean;
  watchedSeconds: number;
  lastAccessedAt: Date;
  lessonTitle?: string;
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

export async function enroll(
  courseId: string, userId: string, db: CourseDB,
): Promise<Enrollment> {
  // 1. Check course exists + capacity
  const { rows: courseRows } = await db.query<{ max_students: number | null; access_days: number; status: string }>(
    `SELECT max_students, access_days, status FROM courses.courses WHERE id = $1`,
    [courseId],
  );
  if (!courseRows[0] || courseRows[0].status !== 'published') throw new CourseError('COURSE_NOT_FOUND');

  const course = courseRows[0];

  // 2. Check not already enrolled
  const { rows: existing } = await db.query<{ id: string }>(
    `SELECT id FROM courses.enrollments
     WHERE course_id = $1 AND user_id = $2 AND status = 'active'`,
    [courseId, userId],
  );
  if (existing.length > 0) throw new CourseError('ALREADY_ENROLLED');

  // 3. Check capacity
  if (course.max_students !== null) {
    const { rows: countRows } = await db.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM courses.enrollments
       WHERE course_id = $1 AND status = 'active'`,
      [courseId],
    );
    if (countRows[0].cnt >= course.max_students) throw new CourseError('COURSE_FULL');
  }

  // 4. Create enrollment
  const expiresAt = new Date(Date.now() + course.access_days * 86400000);
  const { rows } = await db.query<Enrollment>(
    `INSERT INTO courses.enrollments (course_id, user_id, expires_at)
     VALUES ($1,$2,$3)
     RETURNING id, course_id AS "courseId", user_id AS "userId", status,
               enrolled_at AS "enrolledAt", expires_at AS "expiresAt",
               completed_at AS "completedAt", progress_percent AS "progressPercent"`,
    [courseId, userId, expiresAt.toISOString()],
  );
  return rows[0];
}

export async function getEnrollment(enrollmentId: string, db: CourseDB): Promise<Enrollment> {
  const { rows } = await db.query<Enrollment>(
    `SELECT e.id, e.course_id AS "courseId", e.user_id AS "userId", e.status,
            e.enrolled_at AS "enrolledAt", e.expires_at AS "expiresAt",
            e.completed_at AS "completedAt", e.progress_percent AS "progressPercent",
            c.title AS "courseTitle"
     FROM courses.enrollments e
     JOIN courses.courses c ON c.id = e.course_id
     WHERE e.id = $1`,
    [enrollmentId],
  );
  if (!rows[0]) throw new CourseError('ENROLLMENT_NOT_FOUND');
  return rows[0];
}

export async function listEnrollments(userId: string, db: CourseDB): Promise<Enrollment[]> {
  const { rows } = await db.query<Enrollment>(
    `SELECT e.id, e.course_id AS "courseId", e.user_id AS "userId", e.status,
            e.enrolled_at AS "enrolledAt", e.expires_at AS "expiresAt",
            e.completed_at AS "completedAt", e.progress_percent AS "progressPercent",
            c.title AS "courseTitle"
     FROM courses.enrollments e
     JOIN courses.courses c ON c.id = e.course_id
     WHERE e.user_id = $1 ORDER BY e.enrolled_at DESC`,
    [userId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Lesson progress
// ---------------------------------------------------------------------------

export async function updateProgress(
  enrollmentId: string,
  lessonId: string,
  watchedSeconds: number,
  completed: boolean,
  db: CourseDB,
): Promise<LessonProgress> {
  // Validate enrollment is active
  const enrollment = await getEnrollment(enrollmentId, db);
  if (enrollment.status !== 'active') throw new CourseError('ENROLLMENT_EXPIRED');
  if (new Date(enrollment.expiresAt) < new Date()) throw new CourseError('ENROLLMENT_EXPIRED');

  if (watchedSeconds < 0) throw new CourseError('INVALID_PROGRESS');

  // Upsert progress
  const { rows } = await db.query<LessonProgress>(
    `INSERT INTO courses.lesson_progress (enrollment_id, lesson_id, watched_seconds, completed)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (enrollment_id, lesson_id) DO UPDATE SET
       watched_seconds = GREATEST(courses.lesson_progress.watched_seconds, EXCLUDED.watched_seconds),
       completed = EXCLUDED.completed OR courses.lesson_progress.completed,
       last_accessed_at = NOW()
     RETURNING id, enrollment_id AS "enrollmentId", lesson_id AS "lessonId",
               completed, watched_seconds AS "watchedSeconds",
               last_accessed_at AS "lastAccessedAt"`,
    [enrollmentId, lessonId, watchedSeconds, completed],
  );

  // Recalculate overall progress
  const { rows: totalRows } = await db.query<{ total: number; done: number }>(
    `SELECT
       (SELECT COUNT(*)::int FROM courses.lessons WHERE course_id = $1) AS total,
       (SELECT COUNT(*)::int FROM courses.lesson_progress
        WHERE enrollment_id = $2 AND completed = true) AS done`,
    [enrollment.courseId, enrollmentId],
  );

  const total = totalRows[0]?.total ?? 1;
  const done = totalRows[0]?.done ?? 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  await db.execute(
    `UPDATE courses.enrollments SET progress_percent = $1,
       completed_at = CASE WHEN $1 = 100 THEN NOW() ELSE completed_at END,
       status = CASE WHEN $1 = 100 THEN 'completed' ELSE status END
     WHERE id = $2`,
    [percent, enrollmentId],
  );

  return rows[0];
}

export async function getProgress(enrollmentId: string, db: CourseDB): Promise<LessonProgress[]> {
  const { rows } = await db.query<LessonProgress>(
    `SELECT lp.id, lp.enrollment_id AS "enrollmentId", lp.lesson_id AS "lessonId",
            lp.completed, lp.watched_seconds AS "watchedSeconds",
            lp.last_accessed_at AS "lastAccessedAt",
            l.title AS "lessonTitle"
     FROM courses.lesson_progress lp
     JOIN courses.lessons l ON l.id = lp.lesson_id
     WHERE lp.enrollment_id = $1
     ORDER BY l.sort_order`,
    [enrollmentId],
  );
  return rows;
}
