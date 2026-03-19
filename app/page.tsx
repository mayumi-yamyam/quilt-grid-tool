"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type TouchEvent,
} from "react";

const LABEL_SIZE = 28;
const COUNT_SIZE = 16;
const STORAGE_KEY = "quilt-grid-projects-v4";
const MAX_HISTORY = 50;

type GridSize = 40 | 60;
type ToolMode = "paint" | "select" | "pan";

type QuiltProject = {
  id: string;
  name: string;
  palette: string[];
  selectedColor: number;
  grid: number[][];
  gridSize: GridSize;
  zoom: number;
  updatedAt: number;
};

function createGrid(size: number) {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => 0)
  );
}

function cloneGrid(grid: number[][]) {
  return grid.map((row) => [...row]);
}

function resizeGrid(prevGrid: number[][], nextSize: number) {
  return Array.from({ length: nextSize }, (_, rowIndex) =>
    Array.from(
      { length: nextSize },
      (_, colIndex) => prevGrid[rowIndex]?.[colIndex] ?? 0
    )
  );
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createBlankProject(name = "Untitled"): QuiltProject {
  return {
    id: makeId(),
    name,
    palette: [
      "transparent",
      "#ffffff",
      "#d9d9d9",
      "#222222",
      "#c84b31",
    ],
    selectedColor: 2,
    gridSize: 40,
    zoom: 1.4,
    grid: createGrid(40),
    updatedAt: Date.now(),
  };
}

function makeCellKey(row: number, col: number) {
  return `${row}-${col}`;
}

function getTransparentBackground(size = 8) {
  return `repeating-conic-gradient(#e5e5e5 0% 25%, #ffffff 0% 50%) 50% / ${size}px ${size}px`;
}

function getSafeColorValue(color: string) {
  return color === "transparent" ? "#ffffff" : color;
}

export default function Page() {
  const [projects, setProjects] = useState<QuiltProject[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string>("");

  const [gridSize, setGridSize] = useState<GridSize>(40);
  const [palette, setPalette] = useState<string[]>([
    "transparent",
    "#ffffff",
    "#d9d9d9",
    "#222222",
    "#c84b31",
  ]);
  const [selectedColor, setSelectedColor] = useState(2);
  const [grid, setGrid] = useState<number[][]>(createGrid(40));
  const [zoom, setZoom] = useState(1.4);

  const [toolMode, setToolMode] = useState<ToolMode>("paint");
  const [isPainting, setIsPainting] = useState(false);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");

  const [history, setHistory] = useState<number[][][]>([]);
  const [redoStack, setRedoStack] = useState<number[][][]>([]);

  const colorInputRef = useRef<HTMLInputElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const panStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
  });

  const currentProjectName =
    projects.find((p) => p.id === currentProjectId)?.name ?? "Untitled";

  const cellSize = Math.max(8, Math.round(14 * zoom));

  const selectedHex = useMemo(() => {
    return palette[selectedColor] ?? "#000000";
  }, [palette, selectedColor]);

  const activeBounds = useMemo(() => {
    let firstActiveRow: number | null = null;
    let firstActiveCol: number | null = null;

    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        if ((grid[row]?.[col] ?? 0) !== 0) {
          if (firstActiveRow === null || row < firstActiveRow) {
            firstActiveRow = row;
          }
          if (firstActiveCol === null || col < firstActiveCol) {
            firstActiveCol = col;
          }
        }
      }
    }

    return { firstActiveRow, firstActiveCol };
  }, [grid, gridSize]);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      const initial = createBlankProject("Untitled 1");
      setProjects([initial]);
      setCurrentProjectId(initial.id);
      setGridSize(initial.gridSize);
      setPalette(initial.palette);
      setSelectedColor(initial.selectedColor);
      setGrid(initial.grid);
      setZoom(initial.zoom);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as {
        projects?: QuiltProject[];
        currentProjectId?: string;
      };

      if (!parsed.projects || parsed.projects.length === 0) {
        const initial = createBlankProject("Untitled 1");
        setProjects([initial]);
        setCurrentProjectId(initial.id);
        setGridSize(initial.gridSize);
        setPalette(initial.palette);
        setSelectedColor(initial.selectedColor);
        setGrid(initial.grid);
        setZoom(initial.zoom);
        return;
      }

      const loadedProjects = parsed.projects;
      const activeId =
        loadedProjects.find((p) => p.id === parsed.currentProjectId)?.id ??
        loadedProjects[0].id;

      const activeProject = loadedProjects.find((p) => p.id === activeId)!;

      setProjects(loadedProjects);
      setCurrentProjectId(activeId);
      setGridSize(activeProject.gridSize);
      setPalette(
        activeProject.palette?.length
          ? activeProject.palette
          : ["transparent", "#ffffff", "#d9d9d9", "#222222", "#c84b31"]
      );
      setSelectedColor(activeProject.selectedColor ?? 2);
      setGrid(resizeGrid(activeProject.grid, activeProject.gridSize));
      setZoom(activeProject.zoom ?? 1.4);
    } catch (error) {
      console.error("Failed to load saved projects:", error);

      const initial = createBlankProject("Untitled 1");
      setProjects([initial]);
      setCurrentProjectId(initial.id);
      setGridSize(initial.gridSize);
      setPalette(initial.palette);
      setSelectedColor(initial.selectedColor);
      setGrid(initial.grid);
      setZoom(initial.zoom);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;

      if (isMod && event.key.toLowerCase() === "z") {
        event.preventDefault();

        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selectedCells.size === 0) return;

      event.preventDefault();
      pushHistory();

      setGrid((prev) =>
        prev.map((row, rowIndex) =>
          row.map((cell, colIndex) => {
            const key = makeCellKey(rowIndex, colIndex);
            return selectedCells.has(key) ? 0 : cell;
          })
        )
      );

      setSelectedCells(new Set());
      setMessage("Selected cells cleared");
    };

    const releasePointers = () => {
      setIsPainting(false);
      panStateRef.current.active = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mouseup", releasePointers);
    window.addEventListener("touchend", releasePointers);
    window.addEventListener("touchcancel", releasePointers);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mouseup", releasePointers);
      window.removeEventListener("touchend", releasePointers);
      window.removeEventListener("touchcancel", releasePointers);
    };
  }, [grid, selectedCells]);

  const persistProjects = (
    nextProjects: QuiltProject[],
    nextCurrentProjectId: string
  ) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        projects: nextProjects,
        currentProjectId: nextCurrentProjectId,
      })
    );
    setProjects(nextProjects);
    setCurrentProjectId(nextCurrentProjectId);
  };

  const clearHistoryStacks = () => {
    setHistory([]);
    setRedoStack([]);
  };

  const pushHistory = () => {
    setHistory((prev) => {
      const next = [...prev, cloneGrid(grid)];
      return next.slice(-MAX_HISTORY);
    });
    setRedoStack([]);
  };

  const handleUndo = () => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;

      const last = prev[prev.length - 1];
      setRedoStack((redo) => [cloneGrid(grid), ...redo].slice(0, MAX_HISTORY));
      setGrid(cloneGrid(last));
      setSelectedCells(new Set());
      setMessage("Undo");

      return prev.slice(0, -1);
    });
  };

  const handleRedo = () => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;

      const next = prev[0];
      setHistory((hist) => [...hist, cloneGrid(grid)].slice(-MAX_HISTORY));
      setGrid(cloneGrid(next));
      setSelectedCells(new Set());
      setMessage("Redo");

      return prev.slice(1);
    });
  };

  const buildCurrentProject = (
    overrides?: Partial<QuiltProject>
  ): QuiltProject => ({
    id: currentProjectId || makeId(),
    name:
      projects.find((p) => p.id === currentProjectId)?.name ??
      overrides?.name ??
      "Untitled",
    palette,
    selectedColor,
    grid,
    gridSize,
    zoom,
    updatedAt: Date.now(),
    ...overrides,
  });

  const saveCurrentProjectState = () => {
    if (!currentProjectId) return;

    const updatedProject = buildCurrentProject({
      id: currentProjectId,
      name: currentProjectName,
      updatedAt: Date.now(),
    });

    const nextProjects = projects.map((project) =>
      project.id === currentProjectId ? updatedProject : project
    );

    persistProjects(nextProjects, currentProjectId);
  };

  const loadProjectToCanvas = (project: QuiltProject) => {
    setCurrentProjectId(project.id);
    setGridSize(project.gridSize);
    setPalette(project.palette);
    setSelectedColor(
      Math.min(project.selectedColor, Math.max(project.palette.length - 1, 0))
    );
    setGrid(resizeGrid(project.grid, project.gridSize));
    setZoom(project.zoom ?? 1.4);
    setSelectedCells(new Set());
    setIsPainting(false);
    clearHistoryStacks();
    setMessage(`Loaded: ${project.name}`);
  };

  const paintCell = (rowIndex: number, colIndex: number) => {
    setGrid((prev) => {
      if (prev[rowIndex]?.[colIndex] === selectedColor) return prev;

      return prev.map((row, r) =>
        row.map((cell, c) => (r === rowIndex && c === colIndex ? selectedColor : cell))
      );
    });
  };

  const selectSingleCell = (rowIndex: number, colIndex: number) => {
    const next = new Set<string>();
    next.add(makeCellKey(rowIndex, colIndex));
    setSelectedCells(next);
  };

  const addCellToSelection = (rowIndex: number, colIndex: number) => {
    setSelectedCells((prev) => {
      const key = makeCellKey(rowIndex, colIndex);
      if (prev.has(key)) return prev;

      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  const handleCellMouseDown = (
    rowIndex: number,
    colIndex: number,
    event?: MouseEvent<HTMLButtonElement>
  ) => {
    if (toolMode === "pan") return;

    pushHistory();

    if (toolMode === "paint") {
      setIsPainting(true);
      paintCell(rowIndex, colIndex);
      return;
    }

    setIsPainting(true);

    if (event && (event.metaKey || event.ctrlKey)) {
      addCellToSelection(rowIndex, colIndex);
    } else {
      selectSingleCell(rowIndex, colIndex);
    }
  };

  const handleCellMouseEnter = (rowIndex: number, colIndex: number) => {
    if (!isPainting) return;
    if (toolMode === "pan") return;

    if (toolMode === "paint") {
      paintCell(rowIndex, colIndex);
      return;
    }

    addCellToSelection(rowIndex, colIndex);
  };

  const handleTouchCell = (rowIndex: number, colIndex: number) => {
    if (toolMode === "pan") return;

    if (toolMode === "paint") {
      paintCell(rowIndex, colIndex);
      return;
    }

    addCellToSelection(rowIndex, colIndex);
  };

  const handleTouchStartCell = (rowIndex: number, colIndex: number) => {
    if (toolMode === "pan") return;

    pushHistory();
    setIsPainting(true);

    if (toolMode === "paint") {
      paintCell(rowIndex, colIndex);
      return;
    }

    selectSingleCell(rowIndex, colIndex);
  };

  const handleScrollerTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (toolMode !== "pan") return;

    const touch = event.touches[0];
    if (!touch || !scrollerRef.current) return;

    panStateRef.current = {
      active: true,
      startX: touch.clientX,
      startY: touch.clientY,
      startScrollLeft: scrollerRef.current.scrollLeft,
      startScrollTop: scrollerRef.current.scrollTop,
    };
  };

  const handleScrollerTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (toolMode === "pan") {
      const touch = event.touches[0];
      if (!touch || !scrollerRef.current || !panStateRef.current.active) return;

      event.preventDefault();

      const dx = touch.clientX - panStateRef.current.startX;
      const dy = touch.clientY - panStateRef.current.startY;

      scrollerRef.current.scrollLeft = panStateRef.current.startScrollLeft - dx;
      scrollerRef.current.scrollTop = panStateRef.current.startScrollTop - dy;
      return;
    }

    if (!isPainting) return;

    const touch = event.touches[0];
    if (!touch) return;

    const element = document.elementFromPoint(
      touch.clientX,
      touch.clientY
    ) as HTMLElement | null;

    if (!element) return;

    const cell = element.closest("[data-cell]") as HTMLElement | null;
    if (!cell) return;

    event.preventDefault();

    const rowAttr = cell.getAttribute("data-row");
    const colAttr = cell.getAttribute("data-col");
    if (rowAttr === null || colAttr === null) return;

    const rowIndex = Number(rowAttr);
    const colIndex = Number(colAttr);

    if (Number.isNaN(rowIndex) || Number.isNaN(colIndex)) return;

    handleTouchCell(rowIndex, colIndex);
  };

  const handleReset = () => {
    pushHistory();
    setGrid(createGrid(gridSize));
    setSelectedCells(new Set());
    setMessage("Grid reset");
  };

  const handlePaletteChange = (index: number, value: string) => {
    setPalette((prev) => prev.map((color, i) => (i === index ? value : color)));
  };

  const handleAddColor = () => {
    setPalette((prev) => {
      const next = [...prev, "#88aaff"];
      setSelectedColor(next.length - 1);
      return next;
    });
  };

  const handleRemoveSelectedColor = () => {
    const index = selectedColor;
    if (palette.length <= 2) return;
    if (index === 0) return;

    pushHistory();

    setPalette((prevPalette) => {
      const nextPalette = prevPalette.filter((_, i) => i !== index);

      setGrid((prevGrid) =>
        prevGrid.map((row) =>
          row.map((cell) => {
            if (cell === index) return 0;
            if (cell > index) return cell - 1;
            return cell;
          })
        )
      );

      setSelectedColor((prevSelected) => {
        if (prevSelected === index) return 1;
        if (prevSelected > index) return prevSelected - 1;
        return prevSelected;
      });

      return nextPalette;
    });

    setMessage("Selected color deleted");
  };

  const handleGridSizeChange = (nextSize: GridSize) => {
    pushHistory();
    setGridSize(nextSize);
    setGrid((prev) => resizeGrid(prev, nextSize));
    setSelectedCells(new Set());
    setMessage(`Grid changed to ${nextSize}×${nextSize}`);
  };

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(3, Number((prev + 0.2).toFixed(1))));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(0.6, Number((prev - 0.2).toFixed(1))));
  };

  const handleExportJpg = () => {
    const exportCell = 14;
    const scale = 4;
    const canvas = document.createElement("canvas");
    const width = gridSize * exportCell;
    const height = gridSize * exportCell;

    canvas.width = width * scale;
    canvas.height = height * scale;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const colorIndex = grid[row]?.[col] ?? 0;
        if (colorIndex === 0) continue;
        ctx.fillStyle = palette[colorIndex] ?? "#ffffff";
        ctx.fillRect(col * exportCell, row * exportCell, exportCell, exportCell);
      }
    }

    const safeName =
      currentProjectName.replace(/[^\w\-]+/g, "_").toLowerCase() || "quilt-grid";

    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${safeName}-${gridSize}x${gridSize}.jpg`;
    link.click();

    setMessage("JPG exported");
  };

  const handleSaveAs = () => {
    const defaultName = `Untitled ${projects.length + 1}`;
    const name = window.prompt("Save as", defaultName)?.trim();
    if (!name) return;

    const newProject = buildCurrentProject({
      id: makeId(),
      name,
      updatedAt: Date.now(),
    });

    const nextProjects = [newProject, ...projects];
    persistProjects(nextProjects, newProject.id);
    setMessage(`Saved as: ${name}`);
  };

  const handleUpdateSave = () => {
    if (!currentProjectId) return;
    saveCurrentProjectState();
    setMessage(`Updated: ${currentProjectName}`);
  };

  const handleRenameProject = (projectId: string) => {
    const target = projects.find((p) => p.id === projectId);
    if (!target) return;

    const nextName = window.prompt("Rename project", target.name)?.trim();
    if (!nextName) return;

    const nextProjects = projects.map((project) =>
      project.id === projectId
        ? { ...project, name: nextName, updatedAt: Date.now() }
        : project
    );

    persistProjects(nextProjects, projectId);
    setMessage(`Renamed to: ${nextName}`);
  };

  const handleDeleteProject = (projectId: string) => {
    if (projects.length <= 1) {
      window.alert("At least one canvas is needed.");
      return;
    }

    const target = projects.find((p) => p.id === projectId);
    if (!target) return;

    const ok = window.confirm(`Delete "${target.name}"?`);
    if (!ok) return;

    const nextProjects = projects.filter((p) => p.id !== projectId);
    const nextActiveId =
      currentProjectId === projectId ? nextProjects[0].id : currentProjectId;

    persistProjects(nextProjects, nextActiveId);

    const nextActiveProject = nextProjects.find((p) => p.id === nextActiveId)!;
    loadProjectToCanvas(nextActiveProject);
    setMessage(`Deleted: ${target.name}`);
  };

  const handleNewCanvas = () => {
    const nextNumber = projects.length + 1;
    const newProject = createBlankProject(`Untitled ${nextNumber}`);
    const nextProjects = [newProject, ...projects];
    persistProjects(nextProjects, newProject.id);
    loadProjectToCanvas(newProject);
    setMessage(`New canvas: ${newProject.name}`);
  };

  useEffect(() => {
    if (!currentProjectId) return;
    saveCurrentProjectState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette, selectedColor, zoom]);

  return (
    <main
      className="min-h-screen bg-white text-black p-4 sm:p-6 select-none"
      onMouseUp={() => {
        setIsPainting(false);
        panStateRef.current.active = false;
      }}
      onMouseLeave={() => {
        setIsPainting(false);
        panStateRef.current.active = false;
      }}
    >
      <div className="mx-auto max-w-7xl">
        <h1 className="mb-4 text-2xl font-bold">Quilt Grid Tool</h1>

        <div className="mb-4 rounded-xl border border-gray-300 bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button
              onClick={handleNewCanvas}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-black"
            >
              New canvas
            </button>

            <button
              onClick={handleSaveAs}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-black"
            >
              Save as
            </button>

            <button
              onClick={handleUpdateSave}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-black"
            >
              Update save
            </button>

            <button
              onClick={handleReset}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-black"
            >
              Reset grid
            </button>

            <button
              onClick={handleExportJpg}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-black"
            >
              Export JPG
            </button>

            <div className="w-full sm:ml-auto sm:w-auto rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-black">
              Current: {currentProjectName}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {projects.map((project) => {
              const isActive = project.id === currentProjectId;
              return (
                <div
                  key={project.id}
                  className={`flex items-center gap-1 rounded-lg border px-2 py-1 ${
                    isActive
                      ? "border-black bg-gray-100"
                      : "border-gray-300 bg-white"
                  }`}
                >
                  <button
                    onClick={() => loadProjectToCanvas(project)}
                    className="max-w-[180px] truncate text-sm text-black"
                    title={project.name}
                  >
                    {project.name}
                  </button>

                  <button
                    onClick={() => handleRenameProject(project.id)}
                    className="rounded px-1 text-xs text-gray-600 hover:bg-gray-100"
                    title="Rename"
                  >
                    ✎
                  </button>

                  <button
                    onClick={() => handleDeleteProject(project.id)}
                    className="rounded px-1 text-xs text-gray-600 hover:bg-gray-100"
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <button
            onClick={handleUndo}
            className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-black"
          >
            Undo
          </button>

          <button
            onClick={handleRedo}
            className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-black"
          >
            Redo
          </button>

          <button
            onClick={handleAddColor}
            className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-black"
          >
            Add color
          </button>

          <div className="flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-black">
            <span>Tool</span>
            <button
              onClick={() => {
                setToolMode("paint");
                setSelectedCells(new Set());
              }}
              className={`rounded border px-3 py-1 ${
                toolMode === "paint" ? "border-black" : "border-gray-300"
              }`}
            >
              Paint
            </button>
            <button
              onClick={() => setToolMode("select")}
              className={`rounded border px-3 py-1 ${
                toolMode === "select" ? "border-black" : "border-gray-300"
              }`}
            >
              Select
            </button>
            <button
              onClick={() => {
                setToolMode("pan");
                setSelectedCells(new Set());
              }}
              className={`rounded border px-3 py-1 ${
                toolMode === "pan" ? "border-black" : "border-gray-300"
              }`}
            >
              Pan
            </button>
          </div>

          <div className="flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-black">
            <span>Grid</span>
            <button
              onClick={() => handleGridSizeChange(40)}
              className={`rounded border px-3 py-1 ${
                gridSize === 40 ? "border-black" : "border-gray-300"
              }`}
            >
              40×40
            </button>
            <button
              onClick={() => handleGridSizeChange(60)}
              className={`rounded border px-3 py-1 ${
                gridSize === 60 ? "border-black" : "border-gray-300"
              }`}
            >
              60×60
            </button>
          </div>

          <div className="flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-black">
            <span>Zoom</span>
            <button
              onClick={handleZoomOut}
              className="rounded border border-gray-300 px-3 py-1"
            >
              −
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              onClick={handleZoomIn}
              className="rounded border border-gray-300 px-3 py-1"
            >
              +
            </button>
          </div>

          <div className="flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-black">
            <span>Selected</span>
            <button
              onClick={() => {
                if (selectedHex !== "transparent") {
                  colorInputRef.current?.click();
                }
              }}
              className="h-7 w-7 rounded border overflow-hidden"
              style={{
                background:
                  selectedHex === "transparent"
                    ? getTransparentBackground(10)
                    : selectedHex,
              }}
              title="Edit selected color"
            />
            <span>{selectedHex}</span>
          </div>

          <button
            onClick={() => {
              if (selectedHex !== "transparent") {
                colorInputRef.current?.click();
              }
            }}
            className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-black"
          >
            Edit selected color
          </button>

          <button
            onClick={handleRemoveSelectedColor}
            className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-black"
          >
            Delete selected color
          </button>

          <input
            ref={colorInputRef}
            type="color"
            value={getSafeColorValue(selectedHex)}
            onChange={(e) => handlePaletteChange(selectedColor, e.target.value)}
            className="sr-only"
          />

          {message && (
            <div className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-black">
              {message}
            </div>
          )}
        </div>

        <div className="mb-4 text-sm text-gray-600">
          Paint は塗る、Select は複数選択、Pan はスマホで画面を動かす用です。Undo は ⌘Z / Ctrl+Z、Redo は Shift+⌘Z / Ctrl+Shift+Z。
        </div>

        <div className="mb-6 rounded-xl border border-gray-300 bg-white p-3">
          <div className="flex flex-wrap gap-2">
            {palette.map((color, index) => {
              const isTransparent = index === 0;
              const isSelected = selectedColor === index;

              return (
                <button
                  key={`${color}-${index}`}
                  onClick={() => setSelectedColor(index)}
                  className={`h-8 w-8 rounded border relative ${
                    isSelected
                      ? "border-black ring-2 ring-black/20"
                      : "border-gray-300"
                  }`}
                  style={{
                    background: isTransparent
                      ? getTransparentBackground(10)
                      : color,
                  }}
                  aria-label={`select-color-${index}`}
                  title={isTransparent ? "Transparent" : `Color ${index + 1}`}
                />
              );
            })}
          </div>
        </div>

        <div
          ref={scrollerRef}
          className="overflow-auto rounded border border-gray-300 bg-white p-3"
          onTouchStart={handleScrollerTouchStart}
          onTouchMove={handleScrollerTouchMove}
          style={{
            touchAction: toolMode === "pan" ? "none" : "auto",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `${LABEL_SIZE}px ${COUNT_SIZE}px repeat(${gridSize}, ${cellSize}px)`,
              gridTemplateRows: `${LABEL_SIZE}px ${COUNT_SIZE}px repeat(${gridSize}, ${cellSize}px)`,
              width: "fit-content",
            }}
          >
            <div
              style={{
                width: LABEL_SIZE,
                height: LABEL_SIZE,
                backgroundColor: "#f5f5f5",
                borderRight: "1px solid #d4d4d4",
                borderBottom: "1px solid #d4d4d4",
              }}
            />
            <div
              style={{
                width: COUNT_SIZE,
                height: LABEL_SIZE,
                backgroundColor: "#fafafa",
                borderRight: "1px solid #d4d4d4",
                borderBottom: "1px solid #d4d4d4",
              }}
            />

            {Array.from({ length: gridSize }, (_, colIndex) => (
              <div
                key={`col-label-${colIndex}`}
                style={{
                  width: cellSize,
                  height: LABEL_SIZE,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  backgroundColor: "#f5f5f5",
                  borderRight: "1px solid #d4d4d4",
                  borderBottom: "1px solid #d4d4d4",
                  color: "#000",
                }}
              >
                {colIndex + 1}
              </div>
            ))}

            <div
              style={{
                width: LABEL_SIZE,
                height: COUNT_SIZE,
                backgroundColor: "#fafafa",
                borderRight: "1px solid #d4d4d4",
                borderBottom: "1px solid #d4d4d4",
              }}
            />
            <div
              style={{
                width: COUNT_SIZE,
                height: COUNT_SIZE,
                backgroundColor: "#fafafa",
                borderRight: "1px solid #d4d4d4",
                borderBottom: "1px solid #d4d4d4",
              }}
            />

            {Array.from({ length: gridSize }, (_, colIndex) => {
              const count =
                activeBounds.firstActiveCol !== null &&
                colIndex >= activeBounds.firstActiveCol
                  ? colIndex - activeBounds.firstActiveCol + 1
                  : "";

              return (
                <div
                  key={`col-count-${colIndex}`}
                  style={{
                    width: cellSize,
                    height: COUNT_SIZE,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9,
                    color: "#666",
                    backgroundColor: "#fafafa",
                    borderRight: "1px solid #e5e5e5",
                    borderBottom: "1px solid #d4d4d4",
                  }}
                >
                  {count}
                </div>
              );
            })}

            {Array.from({ length: gridSize }, (_, rowIndex) => (
              <div key={`row-${rowIndex}`} style={{ display: "contents" }}>
                <div
                  style={{
                    width: LABEL_SIZE,
                    height: cellSize,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    backgroundColor: "#f5f5f5",
                    borderRight: "1px solid #d4d4d4",
                    borderBottom: "1px solid #d4d4d4",
                    color: "#000",
                  }}
                >
                  {rowIndex + 1}
                </div>

                <div
                  style={{
                    width: COUNT_SIZE,
                    height: cellSize,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9,
                    color: "#666",
                    backgroundColor: "#fafafa",
                    borderRight: "1px solid #d4d4d4",
                    borderBottom: "1px solid #d4d4d4",
                  }}
                >
                  {activeBounds.firstActiveRow !== null &&
                  rowIndex >= activeBounds.firstActiveRow
                    ? rowIndex - activeBounds.firstActiveRow + 1
                    : ""}
                </div>

                {Array.from({ length: gridSize }, (_, colIndex) => {
                  const colorIndex = grid[rowIndex]?.[colIndex] ?? 0;
                  const cellKey = makeCellKey(rowIndex, colIndex);
                  const isSelected = selectedCells.has(cellKey);
                  const displayColor = palette[colorIndex] ?? "transparent";

                  return (
                    <button
                      key={cellKey}
                      data-cell={cellKey}
                      data-row={rowIndex}
                      data-col={colIndex}
                      onMouseDown={(e) =>
                        handleCellMouseDown(rowIndex, colIndex, e)
                      }
                      onMouseEnter={() =>
                        handleCellMouseEnter(rowIndex, colIndex)
                      }
                      onTouchStart={() =>
                        handleTouchStartCell(rowIndex, colIndex)
                      }
                      className="border-0 p-0 relative"
                      style={{
                        width: cellSize,
                        height: cellSize,
                        borderRight: "1px solid #d4d4d4",
                        borderBottom: "1px solid #d4d4d4",
                        background:
                          displayColor === "transparent"
                            ? getTransparentBackground(8)
                            : displayColor,
                        outline: isSelected ? "2px solid #2563eb" : "none",
                        outlineOffset: isSelected ? "-2px" : "0px",
                      }}
                      aria-label={`cell-${rowIndex}-${colIndex}`}
                      draggable={false}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}