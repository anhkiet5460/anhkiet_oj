// ============================================================
// MÁY CHẤM ĐÁM MÂY (PISTON API) — ĐÃ SỬA LỖI RUNTIME & FILE I/O
// ============================================================

let _cachedRuntimes = null;

async function resolvePistonRuntime(language) {
  const isCpp = language === "cpp" || language === "c++";
  if (!_cachedRuntimes) {
    try {
      const res = await fetch(window.APP_CONFIG.PISTON_RUNTIMES_URL || "https://emkc.org/api/v2/piston/runtimes");
      if (res.ok) _cachedRuntimes = await res.json();
    } catch {
      _cachedRuntimes = null;
    }
  }
  if (Array.isArray(_cachedRuntimes)) {
    const candidates = isCpp ? ["c++", "cpp", "gcc"] : ["python", "python3"];
    const found = _cachedRuntimes.find(r => candidates.includes(String(r.language).toLowerCase()));
    if (found) return { language: found.language, version: found.version };
  }
  return { language: isCpp ? "c++" : "python", version: "*" };
}

function normalizeOutput(str) {
  return String(str || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(line => line.trimEnd())
    .join("\n")
    .trim();
}

async function prepareExecutionPayload(language, sourceCode, inputData, ioType, inputFile, outputFile, timeLimitSec) {
  const isCpp = language === "cpp" || language === "c++";
  const runtime = await resolvePistonRuntime(language);
  const files = [];

  if (ioType === "FILE" && inputFile && outputFile) {
    const cleanIn = inputFile.trim();
    const cleanOut = outputFile.trim();
    if (isCpp) {
      const safeOut = cleanOut.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const wrapper = `
#include <fstream>
#include <iostream>
struct __OJ_FileDumper {
  ~__OJ_FileDumper() {
    std::ofstream __flush;
    std::cout.flush();
    std::ifstream __f("${safeOut}");
    if (__f) {
      std::cout << "__OJ_FILE_OUT_BEGIN__\\n" << __f.rdbuf();
    }
  }
} __oj_dumper;
`;
      files.push({ name: "main.cpp", content: sourceCode + "\n" + wrapper });
    } else {
      const safeOut = cleanOut.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const wrapper = `import atexit as __oj_atexit, os as __oj_os, sys as __oj_sys
def __oj_dump():
    __oj_sys.stdout.flush()
    if __oj_os.path.exists("${safeOut}"):
        with open("${safeOut}", "r", encoding="utf-8", errors="ignore") as __f:
            print("__OJ_FILE_OUT_BEGIN__\\n" + __f.read(), end="")
__oj_atexit.register(__oj_dump)
`;
      files.push({ name: "main.py", content: wrapper + "\n" + sourceCode });
    }
    files.push({ name: cleanIn, content: inputData || "" });
  } else {
    files.push({ name: isCpp ? "main.cpp" : "main.py", content: sourceCode });
  }

  return {
    language: runtime.language,
    version: runtime.version,
    files,
    stdin: ioType === "FILE" ? "" : (inputData || ""),
    compile_timeout: 10000,
    run_timeout: Math.min(10000, Math.max(1500, Math.round((Number(timeLimitSec) || 1) * 1000)))
  };
}

function extractActualOutput(rawStdout, ioType) {
  if (ioType === "FILE") {
    const marker = "__OJ_FILE_OUT_BEGIN__\n";
    const idx = rawStdout.indexOf(marker);
    if (idx !== -1) return rawStdout.slice(idx + marker.length);
    return "";
  }
  return rawStdout || "";
}

async function runSingleTestOnPiston({ language, sourceCode, inputData, ioType, inputFile, outputFile, timeLimit }) {
  const payload = await prepareExecutionPayload(language, sourceCode, inputData, ioType, inputFile, outputFile, timeLimit);

  let res = null;
  let data = null;
  // Thử tối đa 3 lần nếu Piston API báo quá tải tạm thời (HTTP 429)
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(window.APP_CONFIG.PISTON_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.status === 429 && attempt < 2) {
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
      continue;
    }
    data = await res.json();
    break;
  }

  if (!res || !res.ok) {
    throw new Error((data && data.message) || `Máy chấm phản hồi lỗi HTTP ${res ? res.status : "mạng"}`);
  }

  if (data.compile && data.compile.code !== 0) {
    return {
      status: "CE",
      output: "",
      error: data.compile.stderr || data.compile.output || "Lỗi biên dịch chương trình"
    };
  }

  const run = data.run || {};
  if (run.signal === "SIGKILL" || (run.stderr && run.stderr.toLowerCase().includes("timed out"))) {
    return { status: "TLE", output: "", error: "Quá giới hạn thời gian chạy" };
  }
  if (run.code !== 0) {
    return { status: "RTE", output: "", error: run.stderr || `Lỗi thực thi (Exit code ${run.code})` };
  }

  const actual = extractActualOutput(run.stdout || "", ioType);
  if (ioType === "FILE" && actual === "" && (run.stdout || "") === "") {
    return {
      status: "WA",
      output: "",
      error: `Không tìm thấy dữ liệu trong tệp đầu ra ${outputFile}. Kiểm tra lại lệnh ghi file (freopen).`
    };
  }
  return { status: "OK", output: actual, error: "" };
}

async function gradeSubmission({ problem, testCases, language, sourceCode, onProgress }) {
  const results = [];
  let passed = 0;
  let compileError = null;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    if (onProgress) onProgress(i + 1, testCases.length, tc.test_name);

    const exec = await runSingleTestOnPiston({
      language,
      sourceCode,
      inputData: tc.input_data,
      ioType: problem.io_type,
      inputFile: problem.input_file,
      outputFile: problem.output_file,
      timeLimit: problem.time_limit
    });

    if (exec.status === "CE") {
      compileError = exec.error;
      results.push({ test_name: tc.test_name, status: "CE", error: exec.error });
      break;
    }

    let status = exec.status;
    if (status === "OK") {
      const ok = normalizeOutput(exec.output) === normalizeOutput(tc.expected_output);
      status = ok ? "AC" : "WA";
      if (ok) passed++;
    }
    results.push({ test_name: tc.test_name, status, error: exec.error || "" });

    if (i < testCases.length - 1) await new Promise(r => setTimeout(r, 350));
  }

  const total = testCases.length;
  const maxScore = Number(problem.max_score || 10);
  const score = total > 0 ? Number(((passed / total) * maxScore).toFixed(2)) : 0;

  let overallStatus = "WA";
  if (compileError) overallStatus = "CE";
  else if (total > 0 && passed === total) overallStatus = "AC";
  else if (results.some(r => r.status === "TLE")) overallStatus = "TLE";
  else if (results.some(r => r.status === "RTE")) overallStatus = "RTE";

  return { passed, total, score, maxScore, overallStatus, compileError, results };
}
