-- ============================================================
-- C++ AI MENTOR — ONLINE JUDGE (OJ) DATABASE SCHEMA v2
-- Chạy toàn bộ script này trong Supabase -> SQL Editor -> Run
-- ============================================================

-- 1. Bảng người dùng (Admin, Giáo viên, Học sinh)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  class_name VARCHAR(80) DEFAULT '',
  role VARCHAR(20) NOT NULL DEFAULT 'student',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cập nhật ràng buộc nếu bảng đã tồn tại từ bản v1
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'teacher', 'student'));

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'pending', 'locked'));

-- 2. Bảng bài tập lập trình
CREATE TABLE IF NOT EXISTS public.problems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(30) UNIQUE NOT NULL,
  title TEXT NOT NULL,
  topic VARCHAR(100) DEFAULT 'Cơ bản',
  difficulty VARCHAR(30) DEFAULT 'Dễ' CHECK (difficulty IN ('Dễ', 'Trung bình', 'Khó')),
  max_score NUMERIC(6,2) NOT NULL DEFAULT 10.0,
  content_md TEXT NOT NULL,
  io_type VARCHAR(10) NOT NULL DEFAULT 'STDIN' CHECK (io_type IN ('STDIN', 'FILE')),
  input_file VARCHAR(80) DEFAULT '',
  output_file VARCHAR(80) DEFAULT '',
  time_limit NUMERIC(5,2) NOT NULL DEFAULT 1.0,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Bảng bộ Test Case
CREATE TABLE IF NOT EXISTS public.test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id UUID NOT NULL REFERENCES public.problems(id) ON DELETE CASCADE,
  test_name VARCHAR(60) NOT NULL,
  input_data TEXT NOT NULL DEFAULT '',
  expected_output TEXT NOT NULL DEFAULT '',
  is_sample BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 1
);

-- 4. Bảng lịch sử nộp bài & điểm số
CREATE TABLE IF NOT EXISTS public.submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id UUID NOT NULL REFERENCES public.problems(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  language VARCHAR(20) NOT NULL DEFAULT 'cpp',
  source_code TEXT NOT NULL,
  passed_tests INT NOT NULL DEFAULT 0,
  total_tests INT NOT NULL DEFAULT 0,
  score NUMERIC(6,2) NOT NULL DEFAULT 0,
  max_score NUMERIC(6,2) NOT NULL DEFAULT 10.0,
  status VARCHAR(20) NOT NULL DEFAULT 'WA',
  details_json JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_test_cases_problem ON public.test_cases(problem_id);
CREATE INDEX IF NOT EXISTS idx_submissions_problem ON public.submissions(problem_id);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON public.submissions(user_id);

-- Tắt RLS và cấp toàn quyền truy cập cho API web tĩnh
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.problems DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_cases DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions DISABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Tài khoản Quản trị mặc định: admin / admin123
INSERT INTO public.users (username, password_hash, full_name, class_name, role, status)
VALUES (
  'admin',
  '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
  'Quản trị viên Hệ thống',
  'Ban Quản trị',
  'admin',
  'active'
) ON CONFLICT (username) DO UPDATE
SET password_hash = EXCLUDED.password_hash, role = 'admin', status = 'active';
