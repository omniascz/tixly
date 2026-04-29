/**
 * Online courses — course + lesson management.
 */
import { CourseError } from '../lib/course-errors.js';

export interface CourseDB {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export type CourseStatus = 'draft' | 'published' | 'archived';
export type LessonType = 'video' | 'live_stream' | 'text' | 'quiz';

export interface CourseInput {
  promoterId: string;
  title: string;
  description?: string;
  category: string;
  priceHellers: number;
  maxStudents?: number;
  accessDays?: number;       // how many days access after enrollment
  thumbnailUrl?: string;
}

export interface Course {
  id: string;
  promoterId: string;
  title: string;
  description: string | null;
  category: string;
  priceHellers: number;
  maxStudents: number | null;
  accessDays: number;
  thumbnailUrl: string | null;
  status: CourseStatus;
  lessonCount?: number;
  enrollmentCount?: number;
  createdAt: Date;
}

export interface LessonInput {
  courseId: string;
  title: string;
  type: LessonType;
  contentUrl?: string;         // video URL or stream URL
  durationMinutes?: number;
  sortOrder: number;
  isFreePreview?: boolean;
}

export interface Lesson {
  id: string;
  courseId: string;
  title: string;
  type: LessonType;
  contentUrl: string | null;
  durationMinutes: number | null;
  sortOrder: number;
  isFreePreview: boolean;
}

// ---------------------------------------------------------------------------
// Course CRUD
// ---------------------------------------------------------------------------

export async function createCourse(input: CourseInput, db: CourseDB): Promise<Course> {
  const { rows } = await db.query<Course>(
    `INSERT INTO courses.courses
       (promoter_id, title, description, category, price_hellers, max_students, access_days, thumbnail_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, promoter_id AS "promoterId", title, description, category,
               price_hellers AS "priceHellers", max_students AS "maxStudents",
               access_days AS "accessDays", thumbnail_url AS "thumbnailUrl",
               status, created_at AS "createdAt"`,
    [input.promoterId, input.title, input.description ?? null, input.category,
     input.priceHellers, input.maxStudents ?? null, input.accessDays ?? 365, input.thumbnailUrl ?? null],
  );
  return rows[0];
}

export async function getCourse(id: string, db: CourseDB): Promise<Course> {
  const { rows } = await db.query<Course>(
    `SELECT c.id, c.promoter_id AS "promoterId", c.title, c.description, c.category,
            c.price_hellers AS "priceHellers", c.max_students AS "maxStudents",
            c.access_days AS "accessDays", c.thumbnail_url AS "thumbnailUrl",
            c.status, c.created_at AS "createdAt",
            (SELECT COUNT(*)::int FROM courses.lessons l WHERE l.course_id = c.id) AS "lessonCount",
            (SELECT COUNT(*)::int FROM courses.enrollments e WHERE e.course_id = c.id AND e.status = 'active') AS "enrollmentCount"
     FROM courses.courses c WHERE c.id = $1`,
    [id],
  );
  if (!rows[0]) throw new CourseError('COURSE_NOT_FOUND');
  return rows[0];
}

export async function listCourses(
  category: string | undefined, status: CourseStatus | undefined, db: CourseDB,
): Promise<Course[]> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (category) { params.push(category); conds.push(`category = $${params.length}`); }
  if (status) { params.push(status); conds.push(`status = $${params.length}`); }
  else { conds.push("status = 'published'"); }

  const { rows } = await db.query<Course>(
    `SELECT id, promoter_id AS "promoterId", title, description, category,
            price_hellers AS "priceHellers", max_students AS "maxStudents",
            access_days AS "accessDays", thumbnail_url AS "thumbnailUrl",
            status, created_at AS "createdAt"
     FROM courses.courses ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
     ORDER BY created_at DESC`,
    params,
  );
  return rows;
}

export async function publishCourse(courseId: string, db: CourseDB): Promise<Course> {
  const { rows } = await db.query<Course>(
    `UPDATE courses.courses SET status = 'published'
     WHERE id = $1 AND status = 'draft'
     RETURNING id, promoter_id AS "promoterId", title, description, category,
               price_hellers AS "priceHellers", max_students AS "maxStudents",
               access_days AS "accessDays", thumbnail_url AS "thumbnailUrl",
               status, created_at AS "createdAt"`,
    [courseId],
  );
  if (!rows[0]) throw new CourseError('COURSE_NOT_FOUND');
  return rows[0];
}

// ---------------------------------------------------------------------------
// Lesson CRUD
// ---------------------------------------------------------------------------

export async function addLesson(input: LessonInput, db: CourseDB): Promise<Lesson> {
  const { rows } = await db.query<Lesson>(
    `INSERT INTO courses.lessons
       (course_id, title, type, content_url, duration_minutes, sort_order, is_free_preview)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, course_id AS "courseId", title, type, content_url AS "contentUrl",
               duration_minutes AS "durationMinutes", sort_order AS "sortOrder",
               is_free_preview AS "isFreePreview"`,
    [input.courseId, input.title, input.type, input.contentUrl ?? null,
     input.durationMinutes ?? null, input.sortOrder, input.isFreePreview ?? false],
  );
  return rows[0];
}

export async function listLessons(courseId: string, db: CourseDB): Promise<Lesson[]> {
  const { rows } = await db.query<Lesson>(
    `SELECT id, course_id AS "courseId", title, type, content_url AS "contentUrl",
            duration_minutes AS "durationMinutes", sort_order AS "sortOrder",
            is_free_preview AS "isFreePreview"
     FROM courses.lessons WHERE course_id = $1 ORDER BY sort_order`,
    [courseId],
  );
  return rows;
}
