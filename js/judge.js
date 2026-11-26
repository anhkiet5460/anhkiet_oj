// ============================================================
// MÁY CHẤM ĐÁM MÂY (PISTON API) — HỖ TRỢ STDIN & FILE I/O
// ============================================================

function normalizeOutput(str) {
  return String(str || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(line => line.trimEnd())
    .join("\n")
    .trim();
}

// Chuẩn bị mã nguồn để đọc được file .OUT nếu bài dùng File I/O
function prepareExecutionPayload(language, sourceCode, inputData, ioType, inputFile, outputFile, timeLimitSec) {
  const isCpp = language === "cpp";
  const files = [];

  if (ioType === "FILE" && inputFile && outputFile) {
    if (isCpp) {
      // Bọc main bằng cơ chế tự động in nội dung outputFile ra stdout sau khi chạy xong (dùng atexit)
      const safeOut = outputFile.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const wrapper = `\n#include <fstream>\n#include <iostream>\n#include <cstdlib>\nstruct __OJ_FileDumper { ~__OJ_FileDumper() { std::ifstream __f("${safeOut}"); if (__f) { std::cout << "__OJ_FILE_OUT_BEGIN__\\n" << __f.rdbuf(); } } } __oj_dumper;\n`;
      files.push({ name: "main.cpp", content: sourceCode + wrapper });
    } else {
      const safeOut = outputFile.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const wrapper = `\nimport atexit as __oj_atexit, os as __oj_os\ndef __oj_dump():\n    if __oj_os.path.exists("${safeOut}"):\n        with open("${safeOut}", "r", encoding="utf-8", errors="ignore") as __f:\n            print("__OJ_FILE_OUT_BEGIN__\\n" + __f.read(), end="")\n__oj_atexit.register(__oj_dump)\n`;
      files.push({ name: "main.py", content: wrapper + "\n" + sourceCode });
    }
    files.push({ name: inputFile, content: inputData || "" });
  } else {
    files.push({ name: isCpp ? "main.cpp" : "main.py", content: sourceCode });
  }

  return {
    language: isCpp ? "c++" : "python",
    version: "*",
    files,
    stdin: ioType === "FILE" ? "" : (inputData || ""),
    run_timeout: Math.min(10000, Math.max(1000, Math.round((Number(timeLimitSec) || 1) * 1000)))
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
  const payload = prepareExecutionPayload(language, sourceCode, inputData, ioType, inputFile, outputFile, timeLimit);
  const res = await fetch(window.APP_CONFIG.PISTON_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Lỗi kết nối máy chấm Piston API.");

  if (data.compile && data.compile.code !== 0) {
    return { status: "CE", output: "", error: data.compile.stderr || data.compile.output || "Lỗi biên dịch" };
  }
  const run = data.run || {};
  if (run.signal === "SIGKILL" || (run.stderr && run.stderr.toLowerCase().includes("timed out"))) {
    return { status: "TLE", output: "", error: "Quá giới hạn thời gian" };
  }
  if (run.code !== 0) {
    return { status: "RTE", output: "", error: run.stderr || `Exit code ${run.code}` };
  }
  const actual = extractActualOutput(run.stdout || "", ioType);
  return { status: "OK", output: actual, error: "" };
}

// Chấm toàn bộ test case cho 1 bài nộp
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
    results.push({ test_name: tc.test_name, status, error: exec.error });

    // Nghỉ nhẹ 250ms tránh vượt quá tốc độ Piston public API
    if (i < testCases.length - 1) await new Promise(r => setTimeout(r, 250));
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
