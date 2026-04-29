-- Migration 097: Online courses vertical
CREATE SCHEMA IF NOT EXISTS courses;

CREATE TABLE courses.courses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id    UUID NOT NULL,
  title          VARCHAR(300) NOT NULL,
  description    TEXT,
  category       VARCHAR(100) NOT NULL,
  price_hellers  INTEGER NOT NULL CHECK (price_hellers >= 0),
  max_students   INTEGER,
  access_days    INTEGER NOT NULL DEFAULT 365,
  thumbnail_url  TEXT,
  status         VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE courses.lessons (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id        UUID NOT NULL REFERENCES courses.courses(id),
  title            VARCHAR(300) NOT NULL,
  type             VARCHAR(20) NOT NULL CHECK (type IN ('video','live_stream','text','quiz')),
  content_url      TEXT,
  duration_minutes INTEGER,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  is_free_preview  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE courses.enrollments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id        UUID NOT NULL REFERENCES courses.courses(id),
  user_id          UUID NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','expired','refunded')),
  enrolled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL,
  completed_at     TIMESTAMPTZ,
  progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  UNIQUE(course_id, user_id)
);

CREATE TABLE courses.lesson_progress (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id   UUID NOT NULL REFERENCES courses.enrollments(id),
  lesson_id       UUID NOT NULL REFERENCES courses.lessons(id),
  completed       BOOLEAN NOT NULL DEFAULT FALSE,
  watched_seconds INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(enrollment_id, lesson_id)
);

CREATE INDEX ON courses.enrollments (user_id, status);
CREATE INDEX ON courses.lessons (course_id, sort_order);
