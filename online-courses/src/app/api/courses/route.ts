import { NextRequest, NextResponse } from 'next/server';
import { createCourse, listCourses, type CourseDB, type CourseStatus } from '../../../services/course.service.js';
import { isCourseError } from '../../../lib/course-errors.js';
export interface CourseDeps { db: CourseDB }
function getDeps(ctx?: { deps?: CourseDeps }): CourseDeps { if (ctx?.deps) return ctx.deps; throw new Error('Not configured.'); }

export async function GET(req: NextRequest, ctx?: { deps?: CourseDeps }) {
  const deps = getDeps(ctx);
  const p = req.nextUrl.searchParams;
  return NextResponse.json({ courses: await listCourses(p.get('category') ?? undefined, (p.get('status') as CourseStatus) ?? undefined, deps.db) });
}
export async function POST(req: NextRequest, ctx?: { deps?: CourseDeps }) {
  const deps = getDeps(ctx);
  try { return NextResponse.json(await createCourse(await req.json(), deps.db), { status: 201 }); }
  catch (err) { if (isCourseError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode }); throw err; }
}
