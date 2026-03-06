"use client";

import { useState, useCallback } from "react";

const API_URL = "https://swarm-git-56261926654.europe-west1.run.app/v1/tasks";
const MEMORY_API_BASE = "https://swarm-git-56261926654.europe-west1.run.app/v1/memory";

interface MemoryNode {
  name: string;
  kind: "file" | "directory";
  path?: string;
  children?: MemoryNode[];
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
  const [response, setResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memoryTree, setMemoryTree] = useState<MemoryNode[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [selectedMemoryPath, setSelectedMemoryPath] = useState<string | null>(null);
  const [selectedMemoryContent, setSelectedMemoryContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const runTask = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, max_steps: maxSteps }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`HTTP ${res.status}: ${JSON.stringify(data, null, 2)}`);
        setResponse(JSON.stringify(data, null, 2));
      } else {
        setResponse(JSON.stringify(data, null, 2));
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
    try {
      const res = await fetch(`${MEMORY_API_BASE}/files`);
      const text = await res.text();
      let paths: string[] = [];
      if (text.startsWith("data:")) {
        const line = text.split("\n").find((l) => l.startsWith("data:"));
        const json = line ? line.replace(/^data:\s*/, "").trim() : text;
        paths = JSON.parse(json) as string[];
      } else {
        paths = JSON.parse(text) as string[];
      }
      if (!Array.isArray(paths)) paths = [];
      const tree = pathsToTree(paths);
      setMemoryTree(tree);
      if (tree.length > 0) setExpandedDirs(new Set([tree[0].name]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load memory files");
      setMemoryTree([]);
    } finally {
      setMemoryLoading(false);
    }
  }, []);

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
              className="flex items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-white/10 w-full"
            >
              <span className="text-amber-400">{isExpanded ? "▼" : "▶"}</span>
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
          className="flex items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-white/10 w-full"
        >
          <span className="w-3" />
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
            <div className="border-b border-slate-700 px-3 py-2 text-sm font-medium text-slate-400">Response</div>
            <pre className="flex-1 overflow-auto p-3 text-xs text-slate-300 whitespace-pre-wrap break-words">
              {response ?? (loading ? "…" : "Run a task to see the JSON response here.")}
            </pre>
          </div>
        </div>
      </div>

      {/* Right panel: File inspector */}
      <div className="flex w-1/2 flex-col overflow-hidden">
        <div className="border-b border-slate-700 bg-slate-800/50 px-4 py-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">File inspector</h2>
          <button
            type="button"
            onClick={loadMemoryFiles}
            disabled={memoryLoading}
            className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-600 disabled:opacity-60"
          >
            {memoryLoading ? "Loading…" : "Load memory files"}
          </button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-64 shrink-0 overflow-auto border-r border-slate-700 bg-slate-800/30 p-2">
            {memoryTree.length === 0 && !memoryLoading ? (
              <p className="text-sm text-slate-500 p-2">Load memory files to see the list.</p>
            ) : (
              renderMemoryTree(memoryTree)
            )}
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
