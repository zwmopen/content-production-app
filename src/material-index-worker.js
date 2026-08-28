const { parentPort, workerData } = require("worker_threads");
const {
  runMaterialGlobalIndexRefresh,
  getMaterialGlobalIndexJobStatus
} = require("./server");

let settled = false;
const finish = (status) => {
  if (settled) return;
  settled = true;
  parentPort.postMessage({ type: "status", status });
  parentPort.close();
};

try {
  runMaterialGlobalIndexRefresh(workerData || {});
  const timer = setInterval(() => {
    const status = getMaterialGlobalIndexJobStatus();
    if (status.status === "running") return;
    clearInterval(timer);
    finish(status);
  }, 100);
} catch (error) {
  finish({
    status: "failed",
    completedAt: new Date().toISOString(),
    currentCategory: "",
    error: error.message || String(error)
  });
}
