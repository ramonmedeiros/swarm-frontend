"use client";

import { useState, useCallback, useEffect } from "react";

const API_URL = "https://swarm-git-56261926654.europe-west1.run.app/v1/tasks";
const MEMORY_API_BASE = "https://swarm-git-56261926654.europe-west1.run.app/v1/memory";

interface MemoryNode {
  name: string;
  kind: "file" | "directory";
  path?: string;
  children?: MemoryNode[];
}

interface TraceStep {
  step: number;
  agent: string;
  output: string;
  done: boolean;
}

interface TaskResult {
  task_id: string;
  output: string;
  trace: TraceStep[];
}

function pathsToTree(paths: string[]): MemoryNode[] {
  const byPath: Record<string, MemoryNode> = {};
  for (const p of paths) {
    const segments = p.split("/").filter(Boolean);
    for (let i = 0; i < segments.length; i++) {
      const segmentPath = segments.slice(0, i + 1).join("/");
      if (byPath[segmentPath]) continue;
      byPath[segmentPath] = {
        name: segments[i],
        kind: i === segments.length - 1 ? "file" : "directory",
        ...(i === segments.length - 1 ? { path: p } : {}),
        children: i === segments.length - 1 ? undefined : [],
      };
    }
  }
  for (const p of Object.keys(byPath)) {
    const segments = p.split("/").filter(Boolean);
    if (segments.length <= 1) continue;
    const parentPath = segments.slice(0, -1).join("/");
    const parent = byPath[parentPath];
    const child = byPath[p];
    if (parent?.children && child && !parent.children.some((c) => c.name === child.name))
      parent.children!.push(child);
  }
  const rootPaths = Object.keys(byPath).filter((p) => p.indexOf("/") === -1);
  const rootNodes = rootPaths.map((p) => byPath[p]).filter(Boolean);
  rootNodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return rootNodes;
}

export default function Home() {
  const [input, setInput] = useState("What can you tell about Cristiano Ronaldo 10 child");
  const [maxSteps, setMaxSteps] = useState(4);
  const [loading, setLoading] = useState(false);
  const [taskResult, setTaskResult] = useState<TaskResult | null>(null);
  const [rawResponse, setRawResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memoryTree, setMemoryTree] = useState<MemoryNode[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [selectedMemoryPath, setSelectedMemoryPath] = useState<string | null>(null);
  const [selectedMemoryContent, setSelectedMemoryContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [showRawJson, setShowRawJson] = useState(false);

  const runTask = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTaskResult(null);
    setRawResponse(null);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, max_steps: maxSteps }),
      });
      const data = await res.json().catch(() => ({}));
      const raw = JSON.stringify(data, null, 2);
      if (!res.ok) {
        setError(`HTTP ${res.status}: ${raw}`);
        setRawResponse(raw);
      } else {
        const hasTaskResult =
          data &&
          typeof data.task_id === "string" &&
          typeof data.output === "string" &&
          Array.isArray(data.trace);
        if (hasTaskResult) {
          setTaskResult(data as TaskResult);
        } else {
          setRawResponse(raw);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [input, maxSteps]);

  const loadMemoryFiles = useCallback(async () => {
    setMemoryLoading(true);
    setError(null);
    setSelectedMemoryPath(null);
    setSelectedMemoryContent(null);
    setMemoryTree([]);
    const accumulatedPaths = new Set<string>();
    try {
      const res = await fetch(`${MEMORY_API_BASE}/files`);
      if (!res.body) {
        throw new Error("Response has no body");
      }
      const decoder = new TextDecoderStream();
      const streamReader = res.body.pipeThrough(decoder).getReader();
      let buffer = "";
      const processLines = (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let json: string;
          if (trimmed.startsWith("data:")) {
            json = trimmed.replace(/^data:\s*/, "").trim();
          } else {
            json = trimmed;
          }
          if (!json) continue;
          try {
            const parsed = JSON.parse(json) as unknown;
            const newPaths = Array.isArray(parsed) ? (parsed as string[]) : [parsed as string];
            if (newPaths.length > 0) {
              newPaths.forEach((p) => typeof p === "string" && accumulatedPaths.add(p));
              const tree = pathsToTree(Array.from(accumulatedPaths));
              setMemoryTree(tree);
            }
          } catch {
            // skip malformed JSON lines
          }
        }
      };
      while (true) {
        const { done, value } = await streamReader.read();
        if (done) break;
        processLines(value ?? "");
      }
      if (buffer.trim()) processLines("\n");
      if (accumulatedPaths.size > 0) {
        const tree = pathsToTree(Array.from(accumulatedPaths));
        setMemoryTree(tree);
        if (tree.length > 0) setExpandedDirs((prev) => new Set([...prev, tree[0].name]));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load memory files");
      setMemoryTree([]);
    } finally {
      setMemoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMemoryFiles();
  }, [loadMemoryFiles]);

  const openMemoryFile = useCallback(async (path: string) => {
    setContentLoading(true);
    setSelectedMemoryPath(path);
    setSelectedMemoryContent(null);
    try {
      const res = await fetch(`${MEMORY_API_BASE}/content/${path}`);
      const text = await res.text();
      if (!res.ok) {
        setSelectedMemoryContent(`Error ${res.status}: ${text}`);
      } else {
        setSelectedMemoryContent(text);
      }
    } catch (e) {
      setSelectedMemoryContent(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setContentLoading(false);
    }
  }, []);

  const closeMemoryFile = useCallback(() => {
    setSelectedMemoryPath(null);
    setSelectedMemoryContent(null);
  }, []);

  const toggleMemoryDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const renderMemoryTree = (nodes: MemoryNode[], basePath = "") =>
    nodes.map((node) => {
      const path = basePath ? `${basePath}/${node.name}` : node.name;
      const isExpanded = expandedDirs.has(path);
      if (node.kind === "directory") {
        return (
          <div key={path} className="select-none">
            <button
              type="button"
              onClick={() => toggleMemoryDir(path)}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-white/10 w-full whitespace-nowrap"
            >
              <span className="text-amber-400 shrink-0">{isExpanded ? "▼" : "▶"}</span>
              <span className="text-blue-300">📁 {node.name}</span>
            </button>
            {isExpanded && node.children && node.children.length > 0 && (
              <div className="ml-4 border-l border-white/20 pl-1">
                {renderMemoryTree(node.children, path)}
              </div>
            )}
          </div>
        );
      }
      return (
        <button
          key={path}
          type="button"
          onClick={() => node.path && openMemoryFile(node.path)}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-white/10 w-full whitespace-nowrap"
        >
          <span className="w-3 shrink-0" />
          <span className="text-emerald-300">📄 {node.name}</span>
        </button>
      );
    });

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-900 text-slate-100">
      {/* Left panel: API */}
      <div className="flex w-1/2 flex-col border-r border-slate-700 overflow-hidden">
        <div className="border-b border-slate-700 bg-slate-800/50 px-4 py-3">
          <h2 className="text-lg font-semibold text-white">Swarm Task</h2>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Input</label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              placeholder="Task input..."
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Max steps</label>
            <input
              type="number"
              min={1}
              max={100}
              value={maxSteps}
              onChange={(e) => setMaxSteps(Number(e.target.value) || 4)}
              className="w-full max-w-[120px] rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>
          <button
            type="button"
            onClick={runTask}
            disabled={loading}
            className="flex items-center justify-center gap-2 self-start rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-400 disabled:opacity-60"
          >
            {loading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
                Running…
              </>
            ) : (
              "Run task"
            )}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-slate-700 bg-slate-800/50">
            <div className="border-b border-slate-700 px-3 py-2 text-sm font-medium text-slate-400 flex items-center justify-between">
              Response
              {taskResult && (
                <button
                  type="button"
                  onClick={() => setShowRawJson((v) => !v)}
                  className="text-xs font-normal text-amber-400 hover:text-amber-300"
                >
                  {showRawJson ? "Hide" : "Show"} raw JSON
                </button>
              )}
            </div>
            <div className="flex-1 overflow-auto p-3 min-h-0">
              {loading && (
                <p className="text-sm text-slate-400">…</p>
              )}
              {!loading && taskResult && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-500">Task ID:</span>
                    <code className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                      {taskResult.task_id}
                    </code>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(taskResult.task_id)}
                      className="text-xs text-amber-400 hover:text-amber-300"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="rounded-lg border border-slate-600 bg-slate-800/80 p-3">
                    <div className="text-xs font-medium text-slate-400 mb-1">Output</div>
                    <pre className="text-sm text-slate-200 whitespace-pre-wrap break-words">
                      {taskResult.output}
                    </pre>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-slate-400 mb-2">Trace</div>
                    <div className="space-y-3 border-l-2 border-slate-600 pl-4">
                      {taskResult.trace.map((s) => (
                        <div key={s.step} className="relative">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-xs font-medium text-amber-400">Step {s.step}</span>
                            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
                              {s.agent}
                            </span>
                            {s.done && (
                              <span className="text-xs text-emerald-400">Final</span>
                            )}
                          </div>
                          <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words bg-slate-800/50 rounded p-2">
                            {s.output}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                  {showRawJson && (
                    <details open className="mt-2">
                      <summary className="text-xs text-slate-500 cursor-pointer mb-1">Raw JSON</summary>
                      <pre className="p-2 text-xs text-slate-400 whitespace-pre-wrap break-words rounded bg-slate-900 border border-slate-700">
                        {JSON.stringify(taskResult, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              )}
              {!loading && !taskResult && rawResponse !== null && (
                <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words">
                  {rawResponse}
                </pre>
              )}
              {!loading && !taskResult && rawResponse === null && (
                <p className="text-sm text-slate-500">Run a task to see the response here.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right panel: File inspector */}
      <div className="flex w-1/2 flex-col overflow-hidden">
        <div className="border-b border-slate-700 bg-slate-800/50 px-4 py-3">
          <h2 className="text-lg font-semibold text-white">File inspector</h2>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-64 shrink-0 overflow-auto border-r border-slate-700 bg-slate-800/30">
            <div className="inline-block min-w-full p-2">
              {memoryLoading && memoryTree.length === 0 ? (
                <p className="text-sm text-slate-500 p-2">Loading…</p>
              ) : memoryTree.length === 0 ? (
                <p className="text-sm text-slate-500 p-2">No memory files</p>
              ) : (
                renderMemoryTree(memoryTree)
              )}
            </div>
          </div>
          <div className="flex-1 flex flex-col min-w-0 bg-slate-900">
            {selectedMemoryPath ? (
              <>
                <div className="border-b border-slate-700 px-3 py-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeMemoryFile}
                    className="rounded px-2 py-1 text-sm font-medium text-slate-300 hover:bg-white/10"
                  >
                    Back
                  </button>
                  <span className="text-sm font-medium text-slate-400 truncate">{selectedMemoryPath}</span>
                </div>
                <pre className="flex-1 overflow-auto p-3 text-xs text-slate-300 whitespace-pre-wrap break-words">
                  {contentLoading ? "Loading…" : selectedMemoryContent ?? ""}
                </pre>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-slate-500 text-sm">
                Select a file to view its contents
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
