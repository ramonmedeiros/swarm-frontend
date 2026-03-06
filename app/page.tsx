"use client";

import { useState, useCallback, useEffect } from "react";

const API_URL = "https://swarm-git-56261926654.europe-west1.run.app/v1/tasks";

interface FileEntry {
  name: string;
  kind: "file" | "directory";
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  children?: FileEntry[];
}

export default function Home() {
  const [input, setInput] = useState("What can you tell about Cristiano Ronaldo 10 child");
  const [maxSteps, setMaxSteps] = useState(4);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rootDir, setRootDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [fileTree, setFileTree] = useState<FileEntry[]>([]);
  const [selectedFileContent, setSelectedFileContent] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loadingDir, setLoadingDir] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);

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

  const loadDir = useCallback(async (dirHandle: FileSystemDirectoryHandle, path = ""): Promise<FileEntry[]> => {
    const entries: FileEntry[] = [];
    const dir = dirHandle as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };
    for await (const [name, handle] of dir.entries()) {
      entries.push({
        name,
        kind: handle.kind === "directory" ? "directory" : "file",
        handle: handle as FileSystemFileHandle | FileSystemDirectoryHandle,
      });
    }
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }, []);

  const pickFolder = useCallback(async () => {
    if (!("showDirectoryPicker" in window)) {
      setError("File system access is not supported in this browser (use Chrome/Edge).");
      return;
    }
    setLoadingDir(true);
    setError(null);
    try {
      const handle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
      setRootDir(handle);
      const tree = await loadDir(handle);
      setFileTree(tree);
      setExpandedDirs(new Set([handle.name]));
      setSelectedFileContent(null);
      setSelectedFileName(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(e instanceof Error ? e.message : "Failed to open folder");
      }
    } finally {
      setLoadingDir(false);
    }
  }, [loadDir]);

  const toggleDir = useCallback(async (entry: FileEntry, path: string) => {
    if (entry.kind !== "directory") return;
    const key = path || entry.name;
    const next = new Set(expandedDirs);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      if (!(entry as FileEntry & { children?: FileEntry[] }).children) {
        const children = await loadDir(entry.handle as FileSystemDirectoryHandle, key);
        setFileTree((prev) => patchTree(prev, path, entry.name, children));
      }
    }
    setExpandedDirs(next);
  }, [expandedDirs, loadDir]);

  const openFile = useCallback(async (entry: FileEntry) => {
    if (entry.kind !== "file") return;
    setLoadingFile(true);
    setSelectedFileName(entry.name);
    try {
      const file = await (entry.handle as FileSystemFileHandle).getFile();
      const text = await file.text();
      setSelectedFileContent(text);
    } catch (e) {
      setSelectedFileContent(`Error reading file: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setLoadingFile(false);
    }
  }, []);

  function patchTree(tree: FileEntry[], path: string, name: string, children: FileEntry[]): FileEntry[] {
    if (!path) {
      return tree.map((e) => (e.name === name && e.kind === "directory" ? { ...e, children } : e));
    }
    const [head, ...rest] = path.split("/").filter(Boolean);
    return tree.map((e) => {
      if (e.name !== head || e.kind !== "directory") return e;
      return { ...e, children: patchTree(e.children || [], rest.join("/"), name, children) };
    });
  }

  async function loadChildren(entry: FileEntry, path: string): Promise<FileEntry[]> {
    if (entry.kind !== "directory") return [];
    return loadDir(entry.handle as FileSystemDirectoryHandle, path);
  }

  const renderTree = (entries: FileEntry[], basePath = "") =>
    entries.map((entry) => {
      const path = basePath ? `${basePath}/${entry.name}` : entry.name;
      const key = path;
      const isExpanded = expandedDirs.has(key);
      if (entry.kind === "directory") {
        return (
          <div key={key} className="select-none">
            <button
              type="button"
              onClick={() => toggleDir(entry, basePath)}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-white/10 w-full"
            >
              <span className="text-amber-400">{isExpanded ? "▼" : "▶"}</span>
              <span className="text-blue-300">📁 {entry.name}</span>
            </button>
            {isExpanded && (
              <div className="ml-4 border-l border-white/20 pl-1">
                <TreeChildren entry={entry} basePath={path} loadChildren={loadChildren} loadDir={loadDir} expandedDirs={expandedDirs} setExpandedDirs={setExpandedDirs} setFileTree={setFileTree} openFile={openFile} patchTree={patchTree} />
              </div>
            )}
          </div>
        );
      }
      return (
        <button
          key={key}
          type="button"
          onClick={() => openFile(entry)}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-white/10 w-full"
        >
          <span className="w-3" />
          <span className="text-emerald-300">📄 {entry.name}</span>
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

      {/* Right panel: File system */}
      <div className="flex w-1/2 flex-col overflow-hidden">
        <div className="border-b border-slate-700 bg-slate-800/50 px-4 py-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">File system</h2>
          <button
            type="button"
            onClick={pickFolder}
            disabled={loadingDir}
            className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-600 disabled:opacity-60"
          >
            {loadingDir ? "Opening…" : "Open folder"}
          </button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-64 shrink-0 overflow-auto border-r border-slate-700 bg-slate-800/30 p-2">
            {!rootDir ? (
              <p className="text-sm text-slate-500 p-2">Click &quot;Open folder&quot; to browse files.</p>
            ) : (
              renderTree(fileTree)
            )}
          </div>
          <div className="flex-1 flex flex-col min-w-0 bg-slate-900">
            {selectedFileName && (
              <>
                <div className="border-b border-slate-700 px-3 py-2 text-sm font-medium text-slate-400 truncate">
                  {selectedFileName}
                </div>
                <pre className="flex-1 overflow-auto p-3 text-xs text-slate-300 whitespace-pre-wrap break-words">
                  {loadingFile ? "Loading…" : selectedFileContent ?? ""}
                </pre>
              </>
            )}
            {!selectedFileName && (
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

function TreeChildren({
  entry,
  basePath,
  loadChildren,
  loadDir,
  expandedDirs,
  setExpandedDirs,
  setFileTree,
  openFile,
  patchTree,
}: {
  entry: FileEntry;
  basePath: string;
  loadChildren: (entry: FileEntry, path: string) => Promise<FileEntry[]>;
  loadDir: (dir: FileSystemDirectoryHandle, path: string) => Promise<FileEntry[]>;
  expandedDirs: Set<string>;
  setExpandedDirs: React.Dispatch<React.SetStateAction<Set<string>>>;
  setFileTree: React.Dispatch<React.SetStateAction<FileEntry[]>>;
  openFile: (entry: FileEntry) => void;
  patchTree: (tree: FileEntry[], path: string, name: string, children: FileEntry[]) => FileEntry[];
}) {
  const [children, setChildren] = useState<FileEntry[]>(entry.children ?? []);
  const [loaded, setLoaded] = useState(Boolean(entry.children?.length));

  useEffect(() => {
    if (entry.children?.length) {
      setChildren(entry.children);
      setLoaded(true);
    }
  }, [entry.children]);

  useEffect(() => {
    if (entry.kind !== "directory" || loaded) return;
    loadDir(entry.handle as FileSystemDirectoryHandle, basePath).then((c) => {
      setChildren(c);
      setLoaded(true);
      setFileTree((prev) => patchTree(prev, basePath.split("/").slice(0, -1).join("/"), entry.name, c));
    });
  }, [entry, basePath, loaded, loadDir, setFileTree, patchTree]);

  return (
    <>
      {children.map((e) => {
        const path = `${basePath}/${e.name}`;
        const isExpanded = expandedDirs.has(path);
        if (e.kind === "directory") {
          return (
            <div key={path} className="select-none">
              <button
                type="button"
                onClick={() => {
                  setExpandedDirs((s) => {
                    const next = new Set(s);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  });
                }}
                className="flex items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-white/10 w-full"
              >
                <span className="text-amber-400">{isExpanded ? "▼" : "▶"}</span>
                <span className="text-blue-300">📁 {e.name}</span>
              </button>
              {isExpanded && (
                <div className="ml-4 border-l border-white/20 pl-1">
                  <TreeChildren
                    entry={e}
                    basePath={path}
                    loadChildren={loadChildren}
                    loadDir={loadDir}
                    expandedDirs={expandedDirs}
                    setExpandedDirs={setExpandedDirs}
                    setFileTree={setFileTree}
                    openFile={openFile}
                    patchTree={patchTree}
                  />
                </div>
              )}
            </div>
          );
        }
        return (
          <button
            key={path}
            type="button"
            onClick={() => openFile(e)}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-white/10 w-full"
          >
            <span className="w-3" />
            <span className="text-emerald-300">📄 {e.name}</span>
          </button>
        );
      })}
    </>
  );
}
