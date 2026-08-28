const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("assistantOverlay", {
  onState(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback(state || {});
    ipcRenderer.on("assistant-overlay:state", listener);
    return () => ipcRenderer.removeListener("assistant-overlay:state", listener);
  },
  action(input = {}) {
    ipcRenderer.send("assistant-overlay:action", input);
  },
  move(dx = 0, dy = 0) {
    ipcRenderer.send("assistant-overlay:move", { dx: Number(dx || 0), dy: Number(dy || 0) });
  },
  setIgnoreMouseEvents(ignore) {
    ipcRenderer.send("assistant-overlay:set-mouse-events", { ignore: Boolean(ignore) });
  }
});
