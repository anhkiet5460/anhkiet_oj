-- ============================================================
-- C++ AI MENTOR — ONLINE JUDGE (OJ) DATABASE SCHEMA (SUPABASE)
-- Chạy toàn bộ script này trong Supabase -> SQL Editor -> Run
-- ============================================================

-- 1. Bảng người dùng (Giáo viên & Học sinh)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  class_name VARCHAR(50) DEFAULT '',
  role VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'teacher', 'student')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Bảng bài tập lập trình
CREATE TABLE IF NOT EXISTS problems (
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
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Bảng bộ Test Case
CREATE TABLE IF NOT EXISTS test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  test_name VARCHAR(60) NOT NULL,
  input_data TEXT NOT NULL DEFAULT '',
  expected_output TEXT NOT NULL DEFAULT '',
  is_sample BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 1
);

-- 4. Bảng lịch sử nộp bài & điểm số
CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

-- Chỉ mục tăng tốc truy vấn
CREATE INDEX IF NOT EXISTS idx_test_cases_problem ON test_cases(problem_id);
CREATE INDEX IF NOT EXISTS idx_submissions_problem ON submissions(problem_id);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id);

-- Tắt RLS cho giai đoạn 1 (Web tĩnh dùng anon key)
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE problems DISABLE ROW LEVEL SECURITY;
ALTER TABLE test_cases DISABLE ROW LEVEL SECURITY;
ALTER TABLE submissions DISABLE ROW LEVEL SECURITY;

-- Tài khoản Quản trị mặc định:
-- Tài khoản: admin | Mật khẩu: admin123 (SHA-256)
INSERT INTO users (username, password_hash, full_name, class_name, role, status)
VALUES (
  'admin',
  '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
  'Quản trị viên (Giáo viên)',
  'Tổ Tin học',
  'admin',
  'active'
) ON CONFLICT (username) DO NOTHING;
