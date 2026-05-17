import { useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  Clipboard,
  Download,
  Eraser,
  FileInput,
  Grid2X2,
  PaintBucket,
  RotateCcw,
} from 'lucide-react'
import './App.css'

type CellSymbol = 'W' | 'R' | 'G' | 'B' | 'X'
type BoardName = 'initial' | 'target'
type Grid = CellSymbol[][]

type StageJson = {
  gridSize: number
  initial: Array<{ cells: CellSymbol[] }>
  target: Array<{ cells: CellSymbol[] }>
}

const symbols: CellSymbol[] = ['W', 'R', 'G', 'B', 'X']

const cellMeta: Record<
  CellSymbol,
  { label: string; short: string; className: string }
> = {
  W: { label: 'White', short: 'W', className: 'cell-white' },
  R: { label: 'Red', short: 'R', className: 'cell-red' },
  G: { label: 'Green', short: 'G', className: 'cell-green' },
  B: { label: 'Blue', short: 'B', className: 'cell-blue' },
  X: { label: 'Blocker', short: 'X', className: 'cell-blocker' },
}

const sampleStage: StageJson = {
  gridSize: 5,
  initial: [
    { cells: ['X', 'X', 'W', 'X', 'X'] },
    { cells: ['X', 'X', 'W', 'X', 'X'] },
    { cells: ['W', 'W', 'W', 'W', 'W'] },
    { cells: ['X', 'X', 'W', 'X', 'X'] },
    { cells: ['X', 'X', 'W', 'X', 'X'] },
  ],
  target: [
    { cells: ['X', 'X', 'R', 'X', 'X'] },
    { cells: ['X', 'X', 'R', 'X', 'X'] },
    { cells: ['G', 'G', 'R', 'G', 'G'] },
    { cells: ['X', 'X', 'R', 'X', 'X'] },
    { cells: ['X', 'X', 'R', 'X', 'X'] },
  ],
}

function rowsToGrid(rows: StageJson['initial']): Grid {
  return rows.map((row) => [...row.cells])
}

function gridToRows(grid: Grid): StageJson['initial'] {
  return grid.map((cells) => ({ cells: [...cells] }))
}

function makeGrid(size: number, source?: Grid): Grid {
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => source?.[row]?.[col] ?? 'W'),
  )
}

function resizeGrid(grid: Grid, size: number): Grid {
  return makeGrid(size, grid)
}

function validateStageJson(value: unknown): StageJson {
  if (!value || typeof value !== 'object') {
    throw new Error('JSON root must be an object.')
  }

  const candidate = value as Partial<StageJson>
  const parsedGridSize = candidate.gridSize
  if (!Number.isInteger(parsedGridSize) || parsedGridSize === undefined || parsedGridSize <= 0) {
    throw new Error('gridSize must be a positive integer.')
  }

  const gridSize = parsedGridSize
  return {
    gridSize,
    initial: validateRows(candidate.initial, gridSize, 'initial'),
    target: validateRows(candidate.target, gridSize, 'target'),
  }
}

function validateRows(
  rows: unknown,
  gridSize: number,
  fieldName: 'initial' | 'target',
): StageJson['initial'] {
  if (!Array.isArray(rows)) {
    throw new Error(`${fieldName} must be an array.`)
  }

  if (rows.length !== gridSize) {
    throw new Error(`${fieldName} row count must match gridSize.`)
  }

  return rows.map((row, rowIndex) => {
    if (!row || typeof row !== 'object' || !Array.isArray((row as { cells?: unknown }).cells)) {
      throw new Error(`${fieldName}[${rowIndex}].cells must be an array.`)
    }

    const cells = (row as { cells: unknown[] }).cells
    if (cells.length !== gridSize) {
      throw new Error(`${fieldName}[${rowIndex}].cells length must match gridSize.`)
    }

    return {
      cells: cells.map((cell, colIndex) => {
        const symbol = String(cell).trim().toUpperCase()
        if (!symbols.includes(symbol as CellSymbol)) {
          throw new Error(
            `${fieldName}[${rowIndex}][${colIndex}] has unsupported symbol "${String(cell)}".`,
          )
        }
        return symbol as CellSymbol
      }),
    }
  })
}

function getDownloadName(stageName: string): string {
  const safeName = stageName.trim().replace(/[\\/:*?"<>|]+/g, '-')
  return `${safeName || 'Stage'}.json`
}

function formatStageJson(stage: StageJson): string {
  const formatRows = (rows: StageJson['initial']) =>
    rows
      .map(
        (row) =>
          `    { "cells": [${row.cells.map((cell) => JSON.stringify(cell)).join(', ')}] }`,
      )
      .join(',\n')

  return [
    '{',
    `  "gridSize": ${stage.gridSize},`,
    '  "initial": [',
    formatRows(stage.initial),
    '  ],',
    '  "target": [',
    formatRows(stage.target),
    '  ]',
    '}',
  ].join('\n')
}

function App() {
  const [stageName, setStageName] = useState('Stage01')
  const [gridSize, setGridSize] = useState(sampleStage.gridSize)
  const [initialGrid, setInitialGrid] = useState<Grid>(() => rowsToGrid(sampleStage.initial))
  const [targetGrid, setTargetGrid] = useState<Grid>(() => rowsToGrid(sampleStage.target))
  const [brush, setBrush] = useState<CellSymbol>('W')
  const [activeBoard, setActiveBoard] = useState<BoardName>('initial')
  const [isPainting, setIsPainting] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const [feedback, setFeedback] = useState('Ready')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const stageJson = useMemo<StageJson>(
    () => ({
      gridSize,
      initial: gridToRows(initialGrid),
      target: gridToRows(targetGrid),
    }),
    [gridSize, initialGrid, targetGrid],
  )

  const jsonText = useMemo(() => formatStageJson(stageJson), [stageJson])
  const isValid = !importError

  const updateGridSize = (nextSize: number) => {
    const safeSize = Math.min(12, Math.max(1, nextSize || 1))
    setGridSize(safeSize)
    setInitialGrid((grid) => resizeGrid(grid, safeSize))
    setTargetGrid((grid) => resizeGrid(grid, safeSize))
    setFeedback(`Grid resized to ${safeSize} x ${safeSize}`)
  }

  const paintCell = (board: BoardName, row: number, col: number) => {
    const setter = board === 'initial' ? setInitialGrid : setTargetGrid
    setter((grid) =>
      grid.map((line, rowIndex) =>
        rowIndex === row
          ? line.map((cell, colIndex) => (colIndex === col ? brush : cell))
          : line,
      ),
    )
    setActiveBoard(board)
  }

  const fillBoard = (board: BoardName) => {
    const filled = makeGrid(gridSize).map((row) => row.map(() => brush))
    if (board === 'initial') {
      setInitialGrid(filled)
    } else {
      setTargetGrid(filled)
    }
    setActiveBoard(board)
    setFeedback(`${board === 'initial' ? 'Initial' : 'Target'} filled with ${brush}`)
  }

  const clearBoard = (board: BoardName) => {
    if (board === 'initial') {
      setInitialGrid(makeGrid(gridSize))
    } else {
      setTargetGrid(makeGrid(gridSize))
    }
    setActiveBoard(board)
    setFeedback(`${board === 'initial' ? 'Initial' : 'Target'} cleared`)
  }

  const copyInitialToTarget = () => {
    setTargetGrid(initialGrid.map((row) => [...row]))
    setActiveBoard('target')
    setFeedback('Initial copied to Target')
  }

  const resetSample = () => {
    setStageName('Stage01')
    setGridSize(sampleStage.gridSize)
    setInitialGrid(rowsToGrid(sampleStage.initial))
    setTargetGrid(rowsToGrid(sampleStage.target))
    setImportText('')
    setImportError('')
    setFeedback('Stage01 sample restored')
  }

  const applyImportText = (text: string, importedName?: string) => {
    try {
      const parsed = validateStageJson(JSON.parse(text))
      setGridSize(parsed.gridSize)
      setInitialGrid(rowsToGrid(parsed.initial))
      setTargetGrid(rowsToGrid(parsed.target))
      setImportError('')
      setImportText(text)
      if (importedName) {
        setStageName(importedName.replace(/\.json$/i, ''))
      }
      setFeedback('Imported JSON is valid')
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Import failed.')
      setFeedback('Import blocked')
    }
  }

  const handleFileImport = async (file: File | undefined) => {
    if (!file) {
      return
    }

    const text = await file.text()
    applyImportText(text, file.name)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const copyJson = async () => {
    await navigator.clipboard.writeText(jsonText)
    setFeedback('JSON copied to clipboard')
  }

  const downloadJson = () => {
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = getDownloadName(stageName)
    link.click()
    URL.revokeObjectURL(url)
    setFeedback(`${link.download} downloaded`)
  }

  return (
    <main className="app-shell" onPointerUp={() => setIsPainting(false)}>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <Grid2X2 size={20} />
          </div>
          <div>
            <h1>Stage JSON Editor</h1>
            <p>Unity ManualFloodColor stage builder</p>
          </div>
        </div>

        <label className="field stage-field">
          <span>Stage Name</span>
          <input
            value={stageName}
            onChange={(event) => setStageName(event.target.value)}
            aria-label="Stage name"
          />
        </label>

        <label className="field size-field">
          <span>Grid Size</span>
          <input
            type="number"
            min="1"
            max="12"
            value={gridSize}
            onChange={(event) => updateGridSize(Number(event.target.value))}
            aria-label="Grid size"
          />
        </label>

        <div className="toolbar-actions">
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void handleFileImport(event.target.files?.[0])}
          />
          <button type="button" className="button secondary" onClick={() => fileInputRef.current?.click()}>
            <FileInput size={16} />
            Import
          </button>
          <button type="button" className="button secondary" disabled={!isValid} onClick={() => void copyJson()}>
            <Clipboard size={16} />
            Copy JSON
          </button>
          <button type="button" className="button primary" disabled={!isValid} onClick={downloadJson}>
            <Download size={16} />
            Download
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="tool-panel" aria-label="Editing tools">
          <div className="panel-heading">
            <span>Palette</span>
            <strong>{brush}</strong>
          </div>
          <div className="palette-grid" role="list" aria-label="Cell symbol palette">
            {symbols.map((symbol) => (
              <button
                key={symbol}
                type="button"
                className={`swatch ${cellMeta[symbol].className} ${brush === symbol ? 'selected' : ''}`}
                onClick={() => setBrush(symbol)}
                aria-pressed={brush === symbol}
              >
                <span>{cellMeta[symbol].short}</span>
                <small>{cellMeta[symbol].label}</small>
              </button>
            ))}
          </div>

          <div className="tool-section">
            <span className="section-label">Brush Mode</span>
            <div className="segmented" role="group" aria-label="Active board">
              <button
                type="button"
                className={activeBoard === 'initial' ? 'active' : ''}
                onClick={() => setActiveBoard('initial')}
              >
                Initial
              </button>
              <button
                type="button"
                className={activeBoard === 'target' ? 'active' : ''}
                onClick={() => setActiveBoard('target')}
              >
                Target
              </button>
            </div>
            <button type="button" className="wide-action" onClick={() => fillBoard(activeBoard)}>
              <PaintBucket size={16} />
              Fill active board
            </button>
            <button type="button" className="wide-action" onClick={() => clearBoard(activeBoard)}>
              <Eraser size={16} />
              Clear active board
            </button>
            <button type="button" className="wide-action" onClick={copyInitialToTarget}>
              <Clipboard size={16} />
              Initial to Target
            </button>
            <button type="button" className="wide-action subtle" onClick={resetSample}>
              <RotateCcw size={16} />
              Restore sample
            </button>
          </div>

          <div className="status-box">
            <div className="status-line valid">
              <CheckCircle2 size={16} />
              <span>Valid</span>
            </div>
            <p>{feedback}</p>
          </div>
        </aside>

        <section className="board-area" aria-label="Stage boards">
          <EditableBoard
            title="Initial"
            board="initial"
            grid={initialGrid}
            isActive={activeBoard === 'initial'}
            isPainting={isPainting}
            onActivate={() => setActiveBoard('initial')}
            onPaint={paintCell}
            onStartPaint={() => setIsPainting(true)}
          />
          <EditableBoard
            title="Target"
            board="target"
            grid={targetGrid}
            isActive={activeBoard === 'target'}
            isPainting={isPainting}
            onActivate={() => setActiveBoard('target')}
            onPaint={paintCell}
            onStartPaint={() => setIsPainting(true)}
          />
        </section>

        <aside className="json-panel" aria-label="JSON Preview">
          <div className="panel-heading">
            <span>JSON Preview</span>
            <strong>{gridSize} x {gridSize}</strong>
          </div>
          <pre>{jsonText}</pre>
          <div className="import-box">
            <label htmlFor="importText">Paste JSON</label>
            <textarea
              id="importText"
              value={importText}
              placeholder="Paste Stage01.json or Stage02.json here"
              onChange={(event) => setImportText(event.target.value)}
            />
            <button type="button" className="button secondary" onClick={() => applyImportText(importText)}>
              Apply pasted JSON
            </button>
            {importError ? <p className="error-message">{importError}</p> : null}
          </div>
        </aside>
      </section>
    </main>
  )
}

function EditableBoard({
  title,
  board,
  grid,
  isActive,
  isPainting,
  onActivate,
  onPaint,
  onStartPaint,
}: {
  title: string
  board: BoardName
  grid: Grid
  isActive: boolean
  isPainting: boolean
  onActivate: () => void
  onPaint: (board: BoardName, row: number, col: number) => void
  onStartPaint: () => void
}) {
  return (
    <article className={`board-card ${isActive ? 'active' : ''}`} onPointerDown={onActivate}>
      <div className="board-header">
        <div>
          <h2>{title}</h2>
          <p>{grid.length} rows / {grid[0]?.length ?? 0} columns</p>
        </div>
        <span>{isActive ? 'Active' : 'Click to edit'}</span>
      </div>
      <div
        className="stage-grid"
        style={{ '--grid-size': grid.length } as React.CSSProperties}
        role="grid"
        aria-label={`${title} board`}
      >
        {grid.map((row, rowIndex) =>
          row.map((cell, colIndex) => (
            <button
              key={`${rowIndex}-${colIndex}`}
              type="button"
              className={`stage-cell ${cellMeta[cell].className}`}
              onPointerDown={(event) => {
                event.preventDefault()
                onStartPaint()
                onPaint(board, rowIndex, colIndex)
              }}
              onPointerEnter={() => {
                if (isPainting) {
                  onPaint(board, rowIndex, colIndex)
                }
              }}
              role="gridcell"
              aria-label={`${title} row ${rowIndex + 1} column ${colIndex + 1}: ${cellMeta[cell].label}`}
            >
              {cell}
            </button>
          )),
        )}
      </div>
    </article>
  )
}

export default App
