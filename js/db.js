// ============================================================
// LỚP TRUY XUẤT DỮ LIỆU SUPABASE & QUẢN LÝ PHIÊN ĐĂNG NHẬP
// ============================================================

let _supabaseClient = null;

function isConfigured() {
  const cfg = window.APP_CONFIG || {};
  return cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("YOUR_SUPABASE") &&
    !cfg.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
}

function getDB() {
  if (!isConfigured()) {
    throw new Error("Chưa cấu hình SUPABASE_URL và SUPABASE_ANON_KEY trong tệp js/config.js");
  }
  if (!_supabaseClient) {
    _supabaseClient = window.supabase.createClient(
      window.APP_CONFIG.SUPABASE_URL,
      window.APP_CONFIG.SUPABASE_ANON_KEY
    );
  }
  return _supabaseClient;
}

async function hashPassword(plainText) {
  const data = new TextEncoder().encode(plainText);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

const SESSION_KEY = "oj_current_user_v2";

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function setCurrentUser(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

function logoutUser() {
  localStorage.removeItem(SESSION_KEY);
  window.location.href = "index.html";
}

function requireRole(allowedRoles) {
  const user = getCurrentUser();
  if (!user) {
    window.location.href = "index.html";
    return null;
  }
  if (!allowedRoles.includes(user.role)) {
    window.location.href = user.role === "student" ? "student.html" : "teacher.html";
    return null;
  }
  return user;
}

// --- NGƯỜI DÙNG (AUTH, ĐĂNG KÝ GV/HS & QUẢN LÝ) ---
async function apiRegisterAccount({ username, password, full_name, class_name, role }) {
  const db = getDB();
  const cleanUser = username.trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,30}$/.test(cleanUser)) {
    throw new Error("Tên đăng nhập chỉ gồm chữ thường, số, dấu chấm/gạch dưới (3–30 ký tự).");
  }
  const safeRole = role === "teacher" ? "teacher" : "student";
  const initialStatus = safeRole === "teacher" ? "pending" : "active";
  const password_hash = await hashPassword(password);

  const { data, error } = await db
    .from("users")
    .insert([{
      username: cleanUser,
      password_hash,
      full_name: full_name.trim(),
      class_name: class_name.trim(),
      role: safeRole,
      status: initialStatus
    }])
    .select("id, username, full_name, class_name, role, status")
    .single();

  if (error) {
    if (error.code === "23505") throw new Error("Tên đăng nhập này đã tồn tại.");
    throw new Error(error.message);
  }
  return data;
}

async function apiLogin(username, password) {
  const db = getDB();
  const cleanUser = username.trim().toLowerCase();
  const password_hash = await hashPassword(password);
  const { data, error } = await db
    .from("users")
    .select("id, username, full_name, class_name, role, status")
    .eq("username", cleanUser)
    .eq("password_hash", password_hash)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Sai tên đăng nhập hoặc mật khẩu.");
  if (data.status === "pending") {
    throw new Error("Tài khoản Giáo viên đang chờ Admin phê duyệt. Vui lòng thử lại sau khi được duyệt.");
  }
  if (data.status === "locked") {
    throw new Error("Tài khoản đã bị khóa. Vui lòng liên hệ Quản trị viên.");
  }
  return data;
}

async function apiUpdateOwnProfile(userId, { full_name, class_name, newPassword }) {
  const db = getDB();
  const patch = {
    full_name: full_name.trim(),
    class_name: class_name.trim()
  };
  if (newPassword && newPassword.trim().length > 0) {
    if (newPassword.trim().length < 6) {
      throw new Error("Mật khẩu mới phải có tối thiểu 6 ký tự.");
    }
    patch.password_hash = await hashPassword(newPassword.trim());
  }
  const { data, error } = await db
    .from("users")
    .update(patch)
    .eq("id", userId)
    .select("id, username, full_name, class_name, role, status")
    .single();
  if (error) throw new Error(error.message);
  setCurrentUser(data);
  return data;
}

async function apiListUsers() {
  const db = getDB();
  const { data, error } = await db
    .from("users")
    .select("id, username, full_name, class_name, role, status, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function apiCreateUserByAdmin({ username, password, full_name, class_name, role }) {
  const db = getDB();
  const cleanUser = username.trim().toLowerCase();
  const password_hash = await hashPassword(password);
  const { data, error } = await db
    .from("users")
    .insert([{ username: cleanUser, password_hash, full_name: full_name.trim(), class_name: class_name.trim(), role, status: "active" }])
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("Tên đăng nhập đã tồn tại.");
    throw new Error(error.message);
  }
  return data;
}

async function apiUpdateUser(id, patch) {
  const db = getDB();
  const { error } = await db.from("users").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

async function apiResetUserPassword(id, newPassword) {
  const password_hash = await hashPassword(newPassword);
  await apiUpdateUser(id, { password_hash });
}

async function apiDeleteUser(id) {
  const db = getDB();
  const { error } = await db.from("users").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// --- BÀI TẬP & TEST CASE ---
async function apiListProblems(onlyPublished = false) {
  const db = getDB();
  let query = db.from("problems").select("*").order("created_at", { ascending: false });
  if (onlyPublished) query = query.eq("is_published", true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

async function apiGetTestCases(problemId) {
  const db = getDB();
  const { data, error } = await db
    .from("test_cases")
    .select("*")
    .eq("problem_id", problemId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function apiSaveProblemWithTests(problemPayload, testCases, existingId = null) {
  const db = getDB();
  let problemId = existingId;
  if (existingId) {
    const { error } = await db.from("problems").update(problemPayload).eq("id", existingId);
    if (error) throw new Error(error.message);
    const { error: delErr } = await db.from("test_cases").delete().eq("problem_id", existingId);
    if (delErr) throw new Error(delErr.message);
  } else {
    const { data, error } = await db.from("problems").insert([problemPayload]).select("id").single();
    if (error) {
      if (error.code === "23505") throw new Error("Mã bài tập này đã tồn tại.");
      throw new Error(error.message);
    }
    problemId = data.id;
  }

  if (testCases.length > 0) {
    const rows = testCases.map((tc, idx) => ({
      problem_id: problemId,
      test_name: tc.test_name || `Test ${idx + 1}`,
      input_data: tc.input_data ?? "",
      expected_output: tc.expected_output ?? "",
      is_sample: !!tc.is_sample,
      sort_order: idx + 1
    }));
    const { error: tcErr } = await db.from("test_cases").insert(rows);
    if (tcErr) throw new Error(tcErr.message);
  }
  return problemId;
}

async function apiDeleteProblem(id) {
  const db = getDB();
  const { error } = await db.from("problems").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// --- BÀI NỘP & ĐIỂM CAO NHẤT ---
async function apiCreateSubmission(subPayload) {
  const db = getDB();
  const { data, error } = await db.from("submissions").insert([subPayload]).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

async function apiListSubmissionsByUser(userId) {
  const db = getDB();
  const { data, error } = await db
    .from("submissions")
    .select("id, problem_id, language, source_code, passed_tests, total_tests, score, max_score, status, details_json, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function apiListAllSubmissions() {
  const db = getDB();
  const { data, error } = await db
    .from("submissions")
    .select(`
      id, problem_id, user_id, language, source_code, passed_tests, total_tests, score, max_score, status, details_json, created_at,
      users ( full_name, class_name, username ),
      problems ( code, title, topic, difficulty, max_score )
    `)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

function computeHighestScoreBoard(submissions) {
  const bestMap = new Map();
  for (const sub of submissions) {
    const key = `${sub.user_id}__${sub.problem_id}`;
    const prev = bestMap.get(key);
    const curScore = Number(sub.score || 0);
    if (!prev || curScore > Number(prev.score || 0)) {
      bestMap.set(key, sub);
    }
  }
  return Array.from(bestMap.values());
}

function renderMarkdownWithMath(containerEl, mdText) {
  containerEl.innerHTML = window.marked ? marked.parse(mdText || "") : (mdText || "");
  if (window.renderMathInElement) {
    renderMathInElement(containerEl, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
        { left: "\\[", right: "\\]", display: true }
      ],
      throwOnError: false
    });
  }
}

function escapeHtml(str = "") {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
