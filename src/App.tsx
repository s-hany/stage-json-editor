import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Brush,
  CheckCircle2,
  Clipboard,
  CopyPlus,
  Download,
  Eraser,
  FileInput,
  FolderOpen,
  Grid2X2,
  MousePointer2,
  PaintBucket,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
} from 'lucide-react'
import './App.css'

type ColorSymbol = 'W' | 'R' | 'G' | 'B'
type BaseCellSymbol = ColorSymbol | 'X' | 'LR' | 'LG' | 'LB' | 'LW'
type CellSymbol = BaseCellSymbol | `LW${number}`
type BrushSymbol = ColorSymbol | 'X'
type BoardName = 'initial' | 'target'
type Direction = 'left' | 'up' | 'right'
type Grid = CellSymbol[][]
type EditorMode = 'select' | 'paint'

type CellKind = 'normal' | 'blocker' | 'lock'

type CellState = {
  kind: CellKind
  color: ColorSymbol
  locked: boolean
  remaining: number
}

type SelectedCell = {
  board: BoardName
  row: number
  col: number
}

type ColorAssignment = Record<Direction, Exclude<ColorSymbol, 'W'>>

type StageJson = {
  gridSize: number
  initial: Array<{ cells: CellSymbol[] }>
  target: Array<{ cells: CellSymbol[] }>
}

type StageDraft = StageJson & {
  id: string
  name: string
  updatedAt: string
}

const DRAFT_STORAGE_KEY = 'stage-json-editor:drafts:v1'
const brushSymbols: BrushSymbol[] = ['W', 'R', 'G', 'B', 'X']
const colorSymbols: ColorSymbol[] = ['W', 'R', 'G', 'B']
const lockedColorSymbols: Array<Exclude<ColorSymbol, 'W'>> = ['R', 'G', 'B']
const initialAssignment: ColorAssignment = { left: 'R', up: 'B', right: 'G' }
const shortcutBrushes: Record<string, BrushSymbol> = {
  '1': 'W',
  '2': 'R',
  '3': 'G',
  '4': 'B',
  '5': 'X',
}

const cellMeta: Record<
  BrushSymbol | 'LOCK',
  { label: string; short: string; className: string }
> = {
  W: { label: 'White', short: 'W', className: 'cell-white' },
  R: { label: 'Red', short: 'R', className: 'cell-red' },
  G: { label: 'Green', short: 'G', className: 'cell-green' },
  B: { label: 'Blue', short: 'B', className: 'cell-blue' },
  X: { label: 'Blocker', short: 'X', className: 'cell-blocker' },
  LOCK: { label: 'Lock', short: 'L', className: 'cell-lock' },
}

const sampleStage: StageJson = {
  gridSize: 5,
  initial: [
    { cells: ['W', 'W', 'W', 'W', 'W'] },
    { cells: ['W', 'W', 'W', 'W', 'W'] },
    { cells: ['W', 'W', 'LW2', 'LW7', 'W'] },
    { cells: ['W', 'W', 'W', 'W', 'W'] },
    { cells: ['W', 'W', 'W', 'W', 'W'] },
  ],
  target: [
    { cells: ['W', 'W', 'W', 'W', 'W'] },
    { cells: ['W', 'W', 'W', 'W', 'W'] },
    { cells: ['W', 'W', 'LG', 'W', 'W'] },
    { cells: ['W', 'W', 'W', 'W', 'W'] },
    { cells: ['W', 'W', 'W', 'W', 'W'] },
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

function replaceGridCell(grid: Grid, row: number, col: number, symbol: CellSymbol): Grid {
  return grid.map((line, rowIndex) =>
    rowIndex === row
      ? line.map((cell, colIndex) => (colIndex === col ? symbol : cell))
      : line,
  )
}

function fillGrid(size: number, symbol: CellSymbol): Grid {
  return makeGrid(size).map((row) => row.map(() => symbol))
}

function normalizeCellSymbol(value: unknown): CellSymbol {
  const symbol = String(value).trim().toUpperCase()

  if (symbol === 'W' || symbol === 'R' || symbol === 'G' || symbol === 'B' || symbol === 'X') {
    return symbol
  }

  if (symbol === 'LR' || symbol === 'LG' || symbol === 'LB') {
    return symbol
  }

  if (symbol === 'LW') {
    return 'LW'
  }

  const lockMatch = /^LW([1-9]\d*)$/.exec(symbol)
  if (lockMatch) {
    return symbol as CellSymbol
  }

  throw new Error(`unsupported symbol "${String(value)}"`)
}

function parseCellSymbol(symbol: CellSymbol): CellState {
  if (symbol === 'X') {
    return { kind: 'blocker', color: 'W', locked: false, remaining: 0 }
  }

  if (symbol === 'LR' || symbol === 'LG' || symbol === 'LB') {
    return { kind: 'lock', color: symbol.slice(1) as Exclude<ColorSymbol, 'W'>, locked: true, remaining: 0 }
  }

  if (symbol === 'LW' || symbol.startsWith('LW')) {
    const countText = symbol.slice(2)
    return {
      kind: 'lock',
      color: 'W',
      locked: false,
      remaining: countText ? Number(countText) : 1,
    }
  }

  return { kind: 'normal', color: symbol as ColorSymbol, locked: false, remaining: 0 }
}

function cellStateToSymbol(cell: CellState): CellSymbol {
  if (cell.kind === 'blocker') {
    return 'X'
  }

  if (cell.kind === 'lock') {
    if (cell.locked) {
      const color = cell.color === 'W' ? 'R' : cell.color
      return `L${color}` as CellSymbol
    }

    const count = Math.max(1, Math.floor(cell.remaining || 1))
    return count === 1 ? 'LW' : (`LW${count}` as CellSymbol)
  }

  return cell.color
}

function gridToPreviewGrid(grid: Grid): CellState[][] {
  return grid.map((row) => row.map((cell) => ({ ...parseCellSymbol(cell) })))
}

function clonePreviewGrid(grid: CellState[][]): CellState[][] {
  return grid.map((row) => row.map((cell) => ({ ...cell })))
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
        try {
          return normalizeCellSymbol(cell)
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'unsupported symbol'
          throw new Error(`${fieldName}[${rowIndex}][${colIndex}] has ${detail}.`, { cause: error })
        }
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

function createDraftId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function stageToDraft(stage: StageJson, stageName: string, id = createDraftId()): StageDraft {
  return {
    id,
    name: stageName.trim() || 'Untitled Stage',
    updatedAt: new Date().toISOString(),
    gridSize: stage.gridSize,
    initial: gridToRows(rowsToGrid(stage.initial)),
    target: gridToRows(rowsToGrid(stage.target)),
  }
}

function readDraftsFromStorage(): StageDraft[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.flatMap((draft): StageDraft[] => {
      if (!draft || typeof draft !== 'object') {
        return []
      }

      try {
        const value = draft as Partial<StageDraft>
        const validated = validateStageJson(value)
        return [
          {
            id: typeof value.id === 'string' ? value.id : createDraftId(),
            name: typeof value.name === 'string' && value.name.trim() ? value.name : 'Untitled Stage',
            updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
            ...validated,
          },
        ]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

function writeDraftsToStorage(drafts: StageDraft[]) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts))
  } catch {
    // Storage can fail in private mode or when quota is full; editing should still work.
  }
}

function formatDraftTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'unknown'
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getCellClass(symbol: CellSymbol): string {
  const cell = parseCellSymbol(symbol)

  if (cell.kind === 'blocker') {
    return cellMeta.X.className
  }

  if (cell.kind === 'lock') {
    return `${cellMeta[cell.color].className} cell-lock ${cell.locked ? 'lock-locked' : 'lock-unlocked'}`
  }

  return cellMeta[cell.color].className
}

function getCellLabel(symbol: CellSymbol): string {
  const cell = parseCellSymbol(symbol)
  if (cell.kind === 'lock') {
    return cell.locked ? `Locked ${cell.color}` : `Unlocked white lock ${cell.remaining}`
  }
  return cell.kind === 'blocker' ? 'Blocker' : cellMeta[cell.color].label
}

function applyFlowCell(cell: CellState, color: Exclude<ColorSymbol, 'W'>): boolean {
  if (cell.kind === 'blocker') {
    return true
  }

  if (cell.kind === 'lock') {
    if (cell.locked) {
      return true
    }

    cell.color = color
    cell.remaining -= 1

    if (cell.remaining <= 0) {
      cell.remaining = 0
      cell.locked = true
    }

    return false
  }

  cell.color = color
  return false
}

function paintPreviewGrid(
  grid: CellState[][],
  direction: Direction,
  color: Exclude<ColorSymbol, 'W'>,
): CellState[][] {
  const next = clonePreviewGrid(grid)
  const size = next.length

  if (direction === 'left') {
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (applyFlowCell(next[row][col], color)) break
      }
    }
  }

  if (direction === 'right') {
    for (let row = 0; row < size; row += 1) {
      for (let col = size - 1; col >= 0; col -= 1) {
        if (applyFlowCell(next[row][col], color)) break
      }
    }
  }

  if (direction === 'up') {
    for (let col = 0; col < size; col += 1) {
      for (let row = 0; row < size; row += 1) {
        if (applyFlowCell(next[row][col], color)) break
      }
    }
  }

  return next
}

function rotateAssignmentClockwise(assignment: ColorAssignment): ColorAssignment {
  return {
    left: assignment.right,
    up: assignment.left,
    right: assignment.up,
  }
}

function rotateAssignmentCounterClockwise(assignment: ColorAssignment): ColorAssignment {
  return {
    left: assignment.up,
    up: assignment.right,
    right: assignment.left,
  }
}

function previewMatchesTarget(previewGrid: CellState[][], targetGrid: Grid): boolean {
  if (previewGrid.length !== targetGrid.length) {
    return false
  }

  return previewGrid.every((row, rowIndex) =>
    row.every((cell, colIndex) => {
      const target = parseCellSymbol(targetGrid[rowIndex][colIndex])
      if (cell.kind !== target.kind) {
        return false
      }
      if (cell.kind === 'blocker') {
        return true
      }
      return cell.color === target.color
    }),
  )
}

function App() {
  const [stageName, setStageName] = useState('StageLockSample')
  const [gridSize, setGridSize] = useState(sampleStage.gridSize)
  const [initialGrid, setInitialGrid] = useState<Grid>(() => rowsToGrid(sampleStage.initial))
  const [targetGrid, setTargetGrid] = useState<Grid>(() => rowsToGrid(sampleStage.target))
  const [editMode, setEditMode] = useState<EditorMode>('select')
  const [brush, setBrush] = useState<BrushSymbol>('W')
  const [activeBoard, setActiveBoard] = useState<BoardName>('initial')
  const [selectedCell, setSelectedCell] = useState<SelectedCell>({ board: 'initial', row: 0, col: 0 })
  const [isPainting, setIsPainting] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const [feedback, setFeedback] = useState('Ready')
  const [previewGrid, setPreviewGrid] = useState<CellState[][]>(() => gridToPreviewGrid(initialGrid))
  const [previewHistory, setPreviewHistory] = useState<CellState[][][]>([])
  const [assignment, setAssignment] = useState<ColorAssignment>(initialAssignment)
  const [drafts, setDrafts] = useState<StageDraft[]>(() => readDraftsFromStorage())
  const [activeDraftId, setActiveDraftId] = useState('')
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
  const selectedSymbol = selectedCell.board === 'initial'
    ? initialGrid[selectedCell.row]?.[selectedCell.col]
    : targetGrid[selectedCell.row]?.[selectedCell.col]
  const selectedState = parseCellSymbol(selectedSymbol ?? 'W')
  const previewMatched = useMemo(
    () => previewMatchesTarget(previewGrid, targetGrid),
    [previewGrid, targetGrid],
  )
  const isValid = !importError
  const activeDraft = drafts.find((draft) => draft.id === activeDraftId)

  const markEdited = (message: string) => {
    setImportError('')
    setFeedback(message)
  }

  const resetPreviewTo = (grid: Grid) => {
    setPreviewGrid(gridToPreviewGrid(grid))
    setPreviewHistory([])
  }

  const updateGridSize = (nextSize: number) => {
    const safeSize = Math.min(12, Math.max(1, nextSize || 1))
    const nextInitial = resizeGrid(initialGrid, safeSize)
    const nextTarget = resizeGrid(targetGrid, safeSize)
    setGridSize(safeSize)
    setInitialGrid(nextInitial)
    setTargetGrid(nextTarget)
    resetPreviewTo(nextInitial)
    setSelectedCell((cell) => ({
      ...cell,
      row: Math.min(cell.row, safeSize - 1),
      col: Math.min(cell.col, safeSize - 1),
    }))
    markEdited(`Grid resized to ${safeSize} x ${safeSize}`)
  }

  const updateGridCell = (board: BoardName, row: number, col: number, symbol: CellSymbol) => {
    if (board === 'initial') {
      const nextGrid = replaceGridCell(initialGrid, row, col, symbol)
      setInitialGrid(nextGrid)
      resetPreviewTo(nextGrid)
      return
    }

    setTargetGrid((grid) => replaceGridCell(grid, row, col, symbol))
  }

  const paintCell = (board: BoardName, row: number, col: number) => {
    updateGridCell(board, row, col, brush)
    setActiveBoard(board)
    setSelectedCell({ board, row, col })
    markEdited(`${board === 'initial' ? 'Initial' : 'Target'} ${row + 1},${col + 1} set to ${brush}`)
  }

  const fillBoard = (board: BoardName) => {
    const filled = fillGrid(gridSize, brush)
    if (board === 'initial') {
      setInitialGrid(filled)
      resetPreviewTo(filled)
    } else {
      setTargetGrid(filled)
    }
    setActiveBoard(board)
    markEdited(`${board === 'initial' ? 'Initial' : 'Target'} filled with ${brush}`)
  }

  const clearBoard = (board: BoardName) => {
    const cleared = makeGrid(gridSize)
    if (board === 'initial') {
      setInitialGrid(cleared)
      resetPreviewTo(cleared)
    } else {
      setTargetGrid(cleared)
    }
    setActiveBoard(board)
    markEdited(`${board === 'initial' ? 'Initial' : 'Target'} cleared`)
  }

  const copyInitialToTarget = () => {
    setTargetGrid(initialGrid.map((row) => [...row]))
    setActiveBoard('target')
    markEdited('Initial copied to Target')
  }

  const resetSample = () => {
    setStageName('StageLockSample')
    setGridSize(sampleStage.gridSize)
    const nextInitial = rowsToGrid(sampleStage.initial)
    setInitialGrid(nextInitial)
    setTargetGrid(rowsToGrid(sampleStage.target))
    resetPreviewTo(nextInitial)
    setSelectedCell({ board: 'initial', row: 0, col: 0 })
    setAssignment(initialAssignment)
    setActiveDraftId('')
    setImportText('')
    setImportError('')
    setFeedback('Lock sample restored')
  }

  const updateSelectedCell = (state: CellState) => {
    const symbol = cellStateToSymbol(state)
    updateGridCell(selectedCell.board, selectedCell.row, selectedCell.col, symbol)
    markEdited(`Selected cell set to ${symbol}`)
  }

  const applyImportText = (text: string, importedName?: string) => {
    try {
      const parsed = validateStageJson(JSON.parse(text))
      const nextInitial = rowsToGrid(parsed.initial)
      setGridSize(parsed.gridSize)
      setInitialGrid(nextInitial)
      setTargetGrid(rowsToGrid(parsed.target))
      resetPreviewTo(nextInitial)
      setSelectedCell({ board: 'initial', row: 0, col: 0 })
      setActiveDraftId('')
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

  const runPreview = (direction: Direction) => {
    setPreviewHistory((history) => [...history, clonePreviewGrid(previewGrid)])
    setPreviewGrid((grid) => paintPreviewGrid(grid, direction, assignment[direction]))
    setFeedback(`Preview ${direction.toUpperCase()} painted with ${assignment[direction]}`)
  }

  const resetPreview = () => {
    setPreviewGrid(gridToPreviewGrid(initialGrid))
    setPreviewHistory([])
    setFeedback('Preview reset to Initial')
  }

  const undoPreview = () => {
    setPreviewHistory((history) => {
      const previous = history[history.length - 1]
      if (!previous) {
        return history
      }
      setPreviewGrid(previous)
      setFeedback('Preview undo')
      return history.slice(0, -1)
    })
  }

  const saveDraft = () => {
    const existingId = activeDraftId && drafts.some((draft) => draft.id === activeDraftId)
      ? activeDraftId
      : createDraftId()
    const nextDraft = stageToDraft(stageJson, stageName, existingId)

    setDrafts((current) => {
      const withoutCurrent = current.filter((draft) => draft.id !== existingId)
      return [nextDraft, ...withoutCurrent].slice(0, 24)
    })
    setActiveDraftId(existingId)
    setFeedback(`${nextDraft.name} saved as draft`)
  }

  const duplicateDraft = () => {
    const nextName = `${stageName.trim() || 'Untitled Stage'} copy`
    const nextDraft = stageToDraft(stageJson, nextName)
    setDrafts((current) => [nextDraft, ...current].slice(0, 24))
    setActiveDraftId(nextDraft.id)
    setStageName(nextName)
    setFeedback(`${nextName} duplicated as draft`)
  }

  const loadDraft = (draftId: string) => {
    const draft = drafts.find((item) => item.id === draftId)
    if (!draft) {
      setFeedback('Draft not found')
      return
    }

    const nextInitial = rowsToGrid(draft.initial)
    setStageName(draft.name)
    setGridSize(draft.gridSize)
    setInitialGrid(nextInitial)
    setTargetGrid(rowsToGrid(draft.target))
    resetPreviewTo(nextInitial)
    setSelectedCell({ board: 'initial', row: 0, col: 0 })
    setActiveBoard('initial')
    setActiveDraftId(draft.id)
    setImportError('')
    setImportText('')
    setFeedback(`${draft.name} loaded`)
  }

  const deleteDraft = (draftId: string) => {
    const draft = drafts.find((item) => item.id === draftId)
    setDrafts((current) => current.filter((item) => item.id !== draftId))
    if (activeDraftId === draftId) {
      setActiveDraftId('')
    }
    setFeedback(draft ? `${draft.name} deleted` : 'Draft deleted')
  }

  useEffect(() => {
    writeDraftsToStorage(drafts)
  }, [drafts])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName
      const isTyping =
        target?.isContentEditable ||
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        tagName === 'SELECT'

      if (isTyping) {
        return
      }

      const key = event.key.toLowerCase()

      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault()
        setPreviewHistory((history) => {
          const previous = history[history.length - 1]
          if (!previous) {
            setFeedback('Preview undo has no history')
            return history
          }

          setPreviewGrid(previous)
          setFeedback('Preview undo')
          return history.slice(0, -1)
        })
        return
      }

      if (key === 'v') {
        event.preventDefault()
        setEditMode('select')
        setFeedback('Select mode')
        return
      }

      if (key === 'b') {
        event.preventDefault()
        setEditMode('paint')
        setFeedback('Paint mode')
        return
      }

      if (key === 'q') {
        event.preventDefault()
        setAssignment((current) => rotateAssignmentCounterClockwise(current))
        setFeedback('Preview colors rotated counter-clockwise')
        return
      }

      if (key === 'e') {
        event.preventDefault()
        setAssignment((current) => rotateAssignmentClockwise(current))
        setFeedback('Preview colors rotated clockwise')
        return
      }

      const shortcutBrush = shortcutBrushes[event.key]
      if (shortcutBrush) {
        event.preventDefault()
        setBrush(shortcutBrush)
        setEditMode('paint')
        setFeedback(`Brush set to ${shortcutBrush}`)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <main className="app-shell" onPointerUp={() => setIsPainting(false)} onPointerLeave={() => setIsPainting(false)}>
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
          <div className="tool-section first">
            <span className="section-label">Edit Mode</span>
            <div className="segmented mode-switch" role="group" aria-label="Edit mode">
              <button
                type="button"
                className={editMode === 'select' ? 'active' : ''}
                onClick={() => {
                  setEditMode('select')
                  setFeedback('Select mode')
                }}
              >
                <MousePointer2 size={15} />
                Select
              </button>
              <button
                type="button"
                className={editMode === 'paint' ? 'active' : ''}
                onClick={() => {
                  setEditMode('paint')
                  setFeedback('Paint mode')
                }}
              >
                <Brush size={15} />
                Paint
              </button>
            </div>
            <p className="shortcut-hint">V select / B paint / 1-5 brush / Q,E preview / Ctrl+Z undo</p>
          </div>
          <div className="palette-grid" role="list" aria-label="Cell symbol palette">
            {brushSymbols.map((symbol, index) => (
              <button
                key={symbol}
                type="button"
                className={`swatch ${cellMeta[symbol].className} ${brush === symbol ? 'selected' : ''}`}
                onClick={() => {
                  setBrush(symbol)
                  setFeedback(`Brush set to ${symbol}`)
                }}
                aria-pressed={brush === symbol}
              >
                <span>{cellMeta[symbol].short}</span>
                <small>{index + 1} / {cellMeta[symbol].label}</small>
              </button>
            ))}
          </div>

          <div className="tool-section">
            <span className="section-label">Active Board</span>
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
            <button type="button" className="wide-action subtle" onClick={resetSample}>
              <RotateCcw size={16} />
              Restore lock sample
            </button>
          </div>

          <CellInspector
            selectedCell={selectedCell}
            selectedSymbol={selectedSymbol ?? 'W'}
            selectedState={selectedState}
            onChange={updateSelectedCell}
          />

          <DraftsPanel
            drafts={drafts}
            activeDraft={activeDraft}
            onSave={saveDraft}
            onDuplicate={duplicateDraft}
            onLoad={loadDraft}
            onDelete={deleteDraft}
          />

          <div className="status-box">
            <div className={`status-line ${isValid ? 'valid' : 'invalid'}`}>
              <CheckCircle2 size={16} />
              <span>{isValid ? 'Valid' : 'Invalid'}</span>
            </div>
            <p>{feedback}</p>
          </div>
        </aside>

        <section className="board-area" aria-label="Stage boards">
          <EditableBoard
            title="Initial"
            board="initial"
            grid={initialGrid}
            selectedCell={selectedCell}
            isActive={activeBoard === 'initial'}
            isPainting={isPainting}
            editMode={editMode}
            brush={brush}
            onActivate={() => setActiveBoard('initial')}
            onFill={() => fillBoard('initial')}
            onClear={() => clearBoard('initial')}
            onPaint={paintCell}
            onSelect={(row, col) => setSelectedCell({ board: 'initial', row, col })}
            onStartPaint={() => setIsPainting(true)}
          />
          <EditableBoard
            title="Target"
            board="target"
            grid={targetGrid}
            selectedCell={selectedCell}
            isActive={activeBoard === 'target'}
            isPainting={isPainting}
            editMode={editMode}
            brush={brush}
            onActivate={() => setActiveBoard('target')}
            onFill={() => fillBoard('target')}
            onClear={() => clearBoard('target')}
            onCopyInitial={copyInitialToTarget}
            onPaint={paintCell}
            onSelect={(row, col) => setSelectedCell({ board: 'target', row, col })}
            onStartPaint={() => setIsPainting(true)}
          />

          <PreviewPanel
            previewGrid={previewGrid}
            assignment={assignment}
            matched={previewMatched}
            canUndo={previewHistory.length > 0}
            onRun={runPreview}
            onUndo={undoPreview}
            onReset={resetPreview}
            onRotateClockwise={() => setAssignment((current) => rotateAssignmentClockwise(current))}
            onRotateCounterClockwise={() => setAssignment((current) => rotateAssignmentCounterClockwise(current))}
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
              placeholder="Paste Stage01.json, Stage03 copy.json, or LW/LW2/LR/LG/LB stage JSON here"
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

function DraftsPanel({
  drafts,
  activeDraft,
  onSave,
  onDuplicate,
  onLoad,
  onDelete,
}: {
  drafts: StageDraft[]
  activeDraft: StageDraft | undefined
  onSave: () => void
  onDuplicate: () => void
  onLoad: (draftId: string) => void
  onDelete: (draftId: string) => void
}) {
  const selectedId = activeDraft?.id ?? drafts[0]?.id ?? ''

  return (
    <div className="drafts-panel">
      <div className="panel-heading compact">
        <span>Drafts</span>
        <strong>{drafts.length}</strong>
      </div>
      <div className="draft-actions">
        <button type="button" className="wide-action" onClick={onSave}>
          <Save size={16} />
          Save Draft
        </button>
        <button type="button" className="wide-action" onClick={onDuplicate}>
          <CopyPlus size={16} />
          Duplicate
        </button>
      </div>

      {drafts.length > 0 ? (
        <div className="draft-list">
          <label className="field inline-field">
            <span>Saved Draft</span>
            <select value={selectedId} onChange={(event) => onLoad(event.target.value)}>
              {drafts.map((draft) => (
                <option key={draft.id} value={draft.id}>
                  {draft.name} / {draft.gridSize}x{draft.gridSize}
                </option>
              ))}
            </select>
          </label>
          {activeDraft ? (
            <p className="draft-meta">Current: {activeDraft.name} / {formatDraftTime(activeDraft.updatedAt)}</p>
          ) : (
            <p className="draft-meta">Select a draft to load it.</p>
          )}
          <div className="draft-actions">
            <button
              type="button"
              className="wide-action"
              disabled={!selectedId}
              onClick={() => onLoad(selectedId)}
            >
              <FolderOpen size={16} />
              Load
            </button>
            <button
              type="button"
              className="wide-action danger"
              disabled={!selectedId}
              onClick={() => onDelete(selectedId)}
            >
              <Trash2 size={16} />
              Delete
            </button>
          </div>
        </div>
      ) : (
        <p className="draft-empty">No drafts yet. Save the current stage to keep it in this browser.</p>
      )}
    </div>
  )
}

function CellInspector({
  selectedCell,
  selectedSymbol,
  selectedState,
  onChange,
}: {
  selectedCell: SelectedCell
  selectedSymbol: CellSymbol
  selectedState: CellState
  onChange: (state: CellState) => void
}) {
  const setKind = (kind: CellKind) => {
    if (kind === 'blocker') {
      onChange({ kind: 'blocker', color: 'W', locked: false, remaining: 0 })
      return
    }

    if (kind === 'lock') {
      onChange({ kind: 'lock', color: 'W', locked: false, remaining: 1 })
      return
    }

    onChange({ kind: 'normal', color: selectedState.color, locked: false, remaining: 0 })
  }

  return (
    <div className="inspector-panel">
      <div className="panel-heading compact">
        <span>Inspector</span>
        <strong>{selectedSymbol}</strong>
      </div>
      <p className="selection-label">
        {selectedCell.board} / row {selectedCell.row + 1} / col {selectedCell.col + 1}
      </p>

      <span className="section-label">Cell Type</span>
      <div className="segmented triple" role="group" aria-label="Selected cell type">
        {(['normal', 'blocker', 'lock'] as CellKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            className={selectedState.kind === kind ? 'active' : ''}
            onClick={() => setKind(kind)}
          >
            {kind}
          </button>
        ))}
      </div>

      {selectedState.kind === 'normal' ? (
        <label className="field inline-field">
          <span>Color</span>
          <select
            value={selectedState.color}
            onChange={(event) =>
              onChange({ kind: 'normal', color: event.target.value as ColorSymbol, locked: false, remaining: 0 })
            }
          >
            {colorSymbols.map((color) => (
              <option key={color} value={color}>{cellMeta[color].label}</option>
            ))}
          </select>
        </label>
      ) : null}

      {selectedState.kind === 'lock' ? (
        <>
          <span className="section-label">Lock State</span>
          <div className="segmented" role="group" aria-label="Lock state">
            <button
              type="button"
              className={!selectedState.locked ? 'active' : ''}
              onClick={() => onChange({ kind: 'lock', color: 'W', locked: false, remaining: Math.max(1, selectedState.remaining || 1) })}
            >
              Unlocked
            </button>
            <button
              type="button"
              className={selectedState.locked ? 'active' : ''}
              onClick={() => onChange({ kind: 'lock', color: selectedState.color === 'W' ? 'R' : selectedState.color, locked: true, remaining: 0 })}
            >
              Locked
            </button>
          </div>

          {selectedState.locked ? (
            <label className="field inline-field">
              <span>Locked Color</span>
              <select
                value={selectedState.color === 'W' ? 'R' : selectedState.color}
                onChange={(event) =>
                  onChange({ kind: 'lock', color: event.target.value as Exclude<ColorSymbol, 'W'>, locked: true, remaining: 0 })
                }
              >
                {lockedColorSymbols.map((color) => (
                  <option key={color} value={color}>{cellMeta[color].label}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field inline-field">
              <span>Remaining</span>
              <input
                type="number"
                min="1"
                max="99"
                value={Math.max(1, selectedState.remaining || 1)}
                onChange={(event) =>
                  onChange({
                    kind: 'lock',
                    color: 'W',
                    locked: false,
                    remaining: Math.max(1, Math.floor(Number(event.target.value) || 1)),
                  })
                }
              />
            </label>
          )}
        </>
      ) : null}
    </div>
  )
}

function EditableBoard({
  title,
  board,
  grid,
  selectedCell,
  isActive,
  isPainting,
  editMode,
  brush,
  onActivate,
  onFill,
  onClear,
  onCopyInitial,
  onPaint,
  onSelect,
  onStartPaint,
}: {
  title: string
  board: BoardName
  grid: Grid
  selectedCell: SelectedCell
  isActive: boolean
  isPainting: boolean
  editMode: EditorMode
  brush: BrushSymbol
  onActivate: () => void
  onFill: () => void
  onClear: () => void
  onCopyInitial?: () => void
  onPaint: (board: BoardName, row: number, col: number) => void
  onSelect: (row: number, col: number) => void
  onStartPaint: () => void
}) {
  const handleCellPointerDown = (row: number, col: number) => {
    onSelect(row, col)

    if (editMode === 'paint') {
      onStartPaint()
      onPaint(board, row, col)
    }
  }

  const handleCellPointerEnter = (row: number, col: number) => {
    if (editMode === 'paint' && isPainting) {
      onSelect(row, col)
      onPaint(board, row, col)
    }
  }

  return (
    <article className={`board-card ${isActive ? 'active' : ''} mode-${editMode}`} onPointerDown={onActivate}>
      <div className="board-header">
        <div>
          <h2>{title}</h2>
          <p>{grid.length} rows / {grid[0]?.length ?? 0} columns</p>
        </div>
        <span>{isActive ? `${editMode} / ${brush}` : 'Click to edit'}</span>
      </div>
      <div className="board-tools" aria-label={`${title} quick actions`}>
        <button type="button" className="mini-action" onClick={onFill}>
          <PaintBucket size={15} />
          Fill {brush}
        </button>
        <button type="button" className="mini-action" onClick={onClear}>
          <Eraser size={15} />
          Clear
        </button>
        {onCopyInitial ? (
          <button type="button" className="mini-action" onClick={onCopyInitial}>
            <Clipboard size={15} />
            Initial to Target
          </button>
        ) : null}
      </div>
      <div
        className="stage-grid"
        style={{ '--grid-size': grid.length } as React.CSSProperties}
        role="grid"
        aria-label={`${title} board`}
      >
        {grid.map((row, rowIndex) =>
          row.map((cell, colIndex) => {
            const isSelected = selectedCell.board === board && selectedCell.row === rowIndex && selectedCell.col === colIndex
            return (
              <button
                key={`${rowIndex}-${colIndex}`}
                type="button"
                className={`stage-cell ${getCellClass(cell)} ${isSelected ? 'selected-cell' : ''}`}
                onPointerDown={(event) => {
                  event.preventDefault()
                  handleCellPointerDown(rowIndex, colIndex)
                }}
                onPointerEnter={() => handleCellPointerEnter(rowIndex, colIndex)}
                role="gridcell"
                aria-label={`${title} row ${rowIndex + 1} column ${colIndex + 1}: ${getCellLabel(cell)}`}
              >
                <span>{cell}</span>
              </button>
            )
          }),
        )}
      </div>
    </article>
  )
}

function PreviewPanel({
  previewGrid,
  assignment,
  matched,
  canUndo,
  onRun,
  onUndo,
  onReset,
  onRotateClockwise,
  onRotateCounterClockwise,
}: {
  previewGrid: CellState[][]
  assignment: ColorAssignment
  matched: boolean
  canUndo: boolean
  onRun: (direction: Direction) => void
  onUndo: () => void
  onReset: () => void
  onRotateClockwise: () => void
  onRotateCounterClockwise: () => void
}) {
  return (
    <article className="board-card preview-card">
      <div className="board-header">
        <div>
          <h2>Preview</h2>
          <p>Unity-style Left / Up / Right flow from Initial</p>
        </div>
        <span className={matched ? 'match-ok' : 'match-wait'}>{matched ? 'Matches target' : 'Not matched'}</span>
      </div>

      <div className="preview-controls">
        <button type="button" className="button secondary" onClick={onRotateCounterClockwise}>
          <Undo2 size={16} />
          Q rotate
        </button>
        <div className="assignment-strip" aria-label="Color assignment">
          <span>Left {assignment.left}</span>
          <span>Up {assignment.up}</span>
          <span>Right {assignment.right}</span>
        </div>
        <button type="button" className="button secondary" onClick={onRotateClockwise}>
          <Redo2 size={16} />
          E rotate
        </button>
      </div>

      <div className="preview-actions">
        <button type="button" className="button primary" onClick={() => onRun('left')}>Left / {assignment.left}</button>
        <button type="button" className="button primary" onClick={() => onRun('up')}>Up / {assignment.up}</button>
        <button type="button" className="button primary" onClick={() => onRun('right')}>Right / {assignment.right}</button>
        <button type="button" className="button secondary" disabled={!canUndo} onClick={onUndo}>Undo</button>
        <button type="button" className="button secondary" onClick={onReset}>Reset</button>
      </div>

      <div
        className="stage-grid preview-grid"
        style={{ '--grid-size': previewGrid.length } as React.CSSProperties}
        role="grid"
        aria-label="Preview board"
      >
        {previewGrid.map((row, rowIndex) =>
          row.map((cell, colIndex) => {
            const symbol = cellStateToSymbol(cell)
            return (
              <div
                key={`${rowIndex}-${colIndex}`}
                className={`stage-cell preview-cell ${getCellClass(symbol)}`}
                role="gridcell"
                aria-label={`Preview row ${rowIndex + 1} column ${colIndex + 1}: ${getCellLabel(symbol)}`}
              >
                <span>{cell.kind === 'lock' && !cell.locked ? `L${cell.remaining}` : symbol}</span>
              </div>
            )
          }),
        )}
      </div>
    </article>
  )
}

export default App
