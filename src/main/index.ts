import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from 'electron'
import type { MenuItemConstructorOptions, MessageBoxOptions, OpenDialogOptions } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import exifr from 'exifr'
import sharp from 'sharp'

const require = createRequire(import.meta.url)
const ffprobeStatic = require('ffprobe-static') as { path?: string }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.join(__dirname, '../preload/index.mjs')
const rendererIndex = path.join(__dirname, '../renderer/index.html')
const metadataDirName = '.photodesk'
const metadataFileName = 'metadata.json'
const catalogFileName = 'catalog.json'
const appSettingsFileName = 'settings.json'

type MetadataCategory = 'tags' | 'people' | 'locations' | 'statuses'
type BulkMetadataCategory = 'tags' | 'people' | 'locations'

type NodeKind = 'folder' | 'image' | 'video' | 'other'

interface FileNode {
  id: string
  path: string
  parentPath: string | null
  name: string
  extension: string
  kind: NodeKind
  size: number
  createdAt: string
  modifiedAt: string
  customMetadata?: CustomMetadata
  children?: FileNode[]
}

interface FolderSelectionResult {
  rootPath: string
  tree: FileNode
}

interface AppSettings {
  lastRootPath?: string
}

interface CustomMetadata {
  title?: string
  description?: string
  tags?: string[]
  people?: string[]
  locations?: string[]
  rating?: number
  favorite?: boolean
  status?: string
  dateTaken?: string
  locationName?: string
  latitude?: number | null
  longitude?: number | null
  notes?: string
}

type MetadataStore = Record<string, CustomMetadata>

interface MetadataSuggestions {
  tags: string[]
  people: string[]
  locations: string[]
  statuses: string[]
}

interface MetadataUsageCounts {
  tags: Record<string, number>
  people: Record<string, number>
  locations: Record<string, number>
  statuses: Record<string, number>
}

interface MetadataCatalogData {
  catalog: MetadataSuggestions
  used: MetadataSuggestions
  suggestions: MetadataSuggestions
  counts: MetadataUsageCounts
}

interface ViewerState {
  rootPath: string
  files: string[]
  currentPath: string
}

interface SaveEditsPayload {
  rootPath: string
  originalPath: string
  fileName: string
  createdAt?: string
  modifiedAt?: string
  metadata: CustomMetadata
  rotationDegrees?: number
}

interface PastePayload {
  paths: string[]
  targetDir: string
  operation: 'copy' | 'cut'
}

interface BulkMetadataAddPayload {
  rootPath: string
  paths: string[]
  category: BulkMetadataCategory
  values: string[]
}

interface BulkMetadataUpdatePayload {
  rootPath: string
  paths: string[]
  category: BulkMetadataCategory
  addValues: string[]
  removeValues: string[]
}

let mainWindow: BrowserWindow | null = null
let activeRootPath: string | null = null
const viewerStates = new Map<number, ViewerState>()
const viewerCloseAllowed = new Set<number>()
const viewerClosePrompting = new Set<number>()

const imageExtensions = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
  '.tif',
  '.tiff',
  '.avif',
  '.heic',
  '.heif',
  '.dng',
  '.raw',
  '.cr2',
  '.nef',
  '.arw',
  '.orf',
  '.rw2'
])

const rotatableImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.avif'])

const videoExtensions = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.avi',
  '.mkv',
  '.webm',
  '.wmv',
  '.mts',
  '.m2ts',
  '.3gp'
])

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Photo Desk',
    backgroundColor: '#f6f7f8',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(rendererIndex)
  }

  return win
}

function buildApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Choisir le dossier de reference...',
          accelerator: 'CommandOrControl+O',
          click: async () => {
            mainWindow?.show()
            mainWindow?.focus()
            try {
              const selection = await chooseReferenceFolder()
              if (selection) {
                mainWindow?.webContents.send('app:reference-folder-selected', selection)
              }
            } catch (error) {
              await showMessageBox({
                type: 'error',
                title: 'Ouverture impossible',
                message: "Impossible d'ouvrir le dossier de reference.",
                detail: error instanceof Error ? error.message : String(error)
              })
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Quitter',
          role: 'quit'
        }
      ]
    },
    {
      label: 'Edition',
      submenu: [
        { label: 'Annuler', role: 'undo' },
        { label: 'Retablir', role: 'redo' },
        { type: 'separator' },
        { label: 'Couper', role: 'cut' },
        { label: 'Copier', role: 'copy' },
        { label: 'Coller', role: 'paste' },
        { label: 'Tout selectionner', role: 'selectAll' }
      ]
    },
    {
      label: 'Organisation',
      submenu: [
        {
          label: 'Gerer les tags, personnes et lieux...',
          accelerator: 'CommandOrControl+Shift+G',
          click: () => {
            mainWindow?.show()
            mainWindow?.focus()
            mainWindow?.webContents.send('app:open-metadata-manager')
          }
        }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Recharger', role: 'reload' },
        { label: 'Taille reelle', role: 'resetZoom' },
        { label: 'Zoom avant', role: 'zoomIn' },
        { label: 'Zoom arriere', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Plein ecran', role: 'togglefullscreen' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createViewerWindow(state: ViewerState): BrowserWindow {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'Visionneuse - Photo Desk',
    backgroundColor: '#111316',
    parent: mainWindow ?? undefined,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  viewerStates.set(win.webContents.id, state)

  win.once('ready-to-show', () => win.show())
  win.on('close', (event) => {
    if (viewerCloseAllowed.has(win.id)) {
      return
    }

    event.preventDefault()
    if (viewerClosePrompting.has(win.id)) {
      return
    }

    viewerClosePrompting.add(win.id)
    try {
      win.webContents.send('viewer:attempt-close')
    } catch {
      viewerCloseAllowed.add(win.id)
      viewerClosePrompting.delete(win.id)
      win.close()
    }
  })

  win.on('closed', () => {
    viewerStates.delete(win.webContents.id)
    viewerCloseAllowed.delete(win.id)
    viewerClosePrompting.delete(win.id)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/viewer`)
  } else {
    win.loadFile(rendererIndex, { hash: '/viewer' })
  }

  return win
}

function showOpenDialog(options: OpenDialogOptions) {
  return mainWindow ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options)
}

function showMessageBox(options: MessageBoxOptions) {
  return mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options)
}

function getKind(filePath: string, isDirectory: boolean): NodeKind {
  if (isDirectory) return 'folder'
  const extension = path.extname(filePath).toLowerCase()
  if (imageExtensions.has(extension)) return 'image'
  if (videoExtensions.has(extension)) return 'video'
  return 'other'
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function toStoreKey(rootPath: string, filePath: string): string {
  return path.relative(rootPath, filePath).replace(/\\/g, '/')
}

function metadataFilePath(rootPath: string): string {
  return path.join(rootPath, metadataDirName, metadataFileName)
}

function catalogFilePath(rootPath: string): string {
  return path.join(rootPath, metadataDirName, catalogFileName)
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function appSettingsFilePath(): string {
  return path.join(app.getPath('userData'), appSettingsFileName)
}

async function readAppSettings(): Promise<AppSettings> {
  const filePath = appSettingsFilePath()
  if (!(await pathExists(filePath))) {
    return {}
  }

  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as AppSettings
  } catch {
    return {}
  }
}

async function writeAppSettings(settings: AppSettings): Promise<void> {
  const filePath = appSettingsFilePath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8')
}

async function saveLastReferenceFolder(rootPath: string): Promise<void> {
  await writeAppSettings({
    ...(await readAppSettings()),
    lastRootPath: rootPath
  })
}

async function readMetadataStore(rootPath: string): Promise<MetadataStore> {
  const filePath = metadataFilePath(rootPath)
  if (!(await pathExists(filePath))) {
    return {}
  }

  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as MetadataStore
  } catch {
    return {}
  }
}

async function writeMetadataStore(rootPath: string, store: MetadataStore): Promise<void> {
  const dir = path.join(rootPath, metadataDirName)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(metadataFilePath(rootPath), `${JSON.stringify(store, null, 2)}\n`, 'utf-8')
}

function emptyMetadataSuggestions(): MetadataSuggestions {
  return {
    tags: [],
    people: [],
    locations: [],
    statuses: []
  }
}

function emptyUsageCounts(): MetadataUsageCounts {
  return {
    tags: {},
    people: {},
    locations: {},
    statuses: {}
  }
}

async function readMetadataCatalog(rootPath: string): Promise<MetadataSuggestions> {
  const filePath = catalogFilePath(rootPath)
  if (!(await pathExists(filePath))) {
    return emptyMetadataSuggestions()
  }

  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return cleanCatalog(JSON.parse(raw) as Partial<MetadataSuggestions>)
  } catch {
    return emptyMetadataSuggestions()
  }
}

async function writeMetadataCatalog(rootPath: string, catalog: MetadataSuggestions): Promise<void> {
  const dir = path.join(rootPath, metadataDirName)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(catalogFilePath(rootPath), `${JSON.stringify(cleanCatalog(catalog), null, 2)}\n`, 'utf-8')
}

function cleanCatalog(catalog: Partial<MetadataSuggestions>): MetadataSuggestions {
  return {
    tags: sortSuggestionValues(uniqueMetadataValues(catalog.tags ?? [])),
    people: sortSuggestionValues(uniqueMetadataValues(catalog.people ?? [])),
    locations: sortSuggestionValues(uniqueMetadataValues(catalog.locations ?? [])),
    statuses: sortSuggestionValues(uniqueMetadataValues(catalog.statuses ?? []))
  }
}

function uniqueMetadataValues(values: string[]): Set<string> {
  const normalized = new Map<string, string>()
  for (const value of values) {
    const cleanValue = value.trim()
    if (cleanValue) normalized.set(normalizeMetadataValue(cleanValue), cleanValue)
  }
  return new Set(normalized.values())
}

function normalizeMetadataValue(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function addCatalogValue(catalog: MetadataSuggestions, category: MetadataCategory, value: string): MetadataSuggestions {
  const cleanValue = value.trim()
  if (!cleanValue) return catalog
  return cleanCatalog({
    ...catalog,
    [category]: [...catalog[category], cleanValue]
  })
}

function removeCatalogValue(catalog: MetadataSuggestions, category: MetadataCategory, value: string): MetadataSuggestions {
  const target = normalizeMetadataValue(value)
  return cleanCatalog({
    ...catalog,
    [category]: catalog[category].filter((item) => normalizeMetadataValue(item) !== target)
  })
}

async function getCustomMetadata(rootPath: string | null, filePath: string): Promise<CustomMetadata> {
  if (!rootPath || !isInside(filePath, rootPath)) {
    return {}
  }

  const store = await readMetadataStore(rootPath)
  return store[toStoreKey(rootPath, filePath)] ?? {}
}

async function saveCustomMetadata(rootPath: string, filePath: string, metadata: CustomMetadata): Promise<void> {
  const store = await readMetadataStore(rootPath)
  const cleanedMetadata = cleanMetadata(metadata)
  store[toStoreKey(rootPath, filePath)] = cleanedMetadata
  await writeMetadataStore(rootPath, store)
  await addMetadataValuesToCatalog(rootPath, cleanedMetadata)
}

async function addMetadataValuesToCatalog(rootPath: string, metadata: CustomMetadata): Promise<void> {
  const catalog = await readMetadataCatalog(rootPath)
  await writeMetadataCatalog(rootPath, {
    tags: [...catalog.tags, ...(metadata.tags ?? [])],
    people: [...catalog.people, ...(metadata.people ?? [])],
    locations: [...catalog.locations, ...getMetadataLocations(metadata)],
    statuses: [...catalog.statuses, ...(metadata.status ? [metadata.status] : [])]
  })
}

async function getMetadataSuggestions(rootPath: string): Promise<MetadataSuggestions> {
  const [store, catalog] = await Promise.all([readMetadataStore(rootPath), readMetadataCatalog(rootPath)])
  return mergeMetadataSuggestions(catalog, collectMetadataSuggestions(store))
}

function collectMetadataSuggestions(store: MetadataStore): MetadataSuggestions {
  const tags = new Set<string>()
  const people = new Set<string>()
  const locations = new Set<string>()
  const statuses = new Set<string>()

  for (const metadata of Object.values(store)) {
    for (const tag of metadata.tags ?? []) tags.add(tag)
    for (const person of metadata.people ?? []) people.add(person)
    for (const location of getMetadataLocations(metadata)) locations.add(location)
    if (metadata.status) statuses.add(metadata.status)
  }

  return {
    tags: sortSuggestionValues(tags),
    people: sortSuggestionValues(people),
    locations: sortSuggestionValues(locations),
    statuses: sortSuggestionValues(statuses)
  }
}

function collectMetadataUsageCounts(store: MetadataStore): MetadataUsageCounts {
  const counts = emptyUsageCounts()

  for (const metadata of Object.values(store)) {
    for (const tag of metadata.tags ?? []) incrementUsage(counts.tags, tag)
    for (const person of metadata.people ?? []) incrementUsage(counts.people, person)
    for (const location of getMetadataLocations(metadata)) incrementUsage(counts.locations, location)
    if (metadata.status) incrementUsage(counts.statuses, metadata.status)
  }

  return counts
}

function incrementUsage(counts: Record<string, number>, value: string): void {
  const cleanValue = value.trim()
  if (!cleanValue) return
  counts[cleanValue] = (counts[cleanValue] ?? 0) + 1
}

function mergeMetadataSuggestions(...sources: MetadataSuggestions[]): MetadataSuggestions {
  return {
    tags: sortSuggestionValues(new Set(sources.flatMap((source) => source.tags))),
    people: sortSuggestionValues(new Set(sources.flatMap((source) => source.people))),
    locations: sortSuggestionValues(new Set(sources.flatMap((source) => source.locations))),
    statuses: sortSuggestionValues(new Set(sources.flatMap((source) => source.statuses)))
  }
}

async function getMetadataCatalogData(rootPath: string): Promise<MetadataCatalogData> {
  const [store, catalog] = await Promise.all([readMetadataStore(rootPath), readMetadataCatalog(rootPath)])
  const used = collectMetadataSuggestions(store)

  return {
    catalog,
    used,
    suggestions: mergeMetadataSuggestions(catalog, used),
    counts: collectMetadataUsageCounts(store)
  }
}

async function addMetadataCatalogValue(
  rootPath: string,
  category: MetadataCategory,
  value: string
): Promise<MetadataCatalogData> {
  const catalog = await readMetadataCatalog(rootPath)
  await writeMetadataCatalog(rootPath, addCatalogValue(catalog, category, value))
  return getMetadataCatalogData(rootPath)
}

async function renameMetadataCatalogValue(
  rootPath: string,
  category: MetadataCategory,
  from: string,
  to: string,
  updateFiles: boolean
): Promise<MetadataCatalogData> {
  const cleanTo = to.trim()
  if (!cleanTo) throw new Error('La nouvelle valeur ne peut pas etre vide.')

  const catalog = removeCatalogValue(await readMetadataCatalog(rootPath), category, from)
  await writeMetadataCatalog(rootPath, addCatalogValue(catalog, category, cleanTo))

  if (updateFiles) {
    const store = await readMetadataStore(rootPath)
    const changed = updateMetadataStoreValues(store, category, from, cleanTo)
    if (changed) await writeMetadataStore(rootPath, store)
    if (changed) broadcastLibraryRefresh()
  }

  return getMetadataCatalogData(rootPath)
}

async function deleteMetadataCatalogValue(
  rootPath: string,
  category: MetadataCategory,
  value: string,
  removeFromFiles: boolean
): Promise<MetadataCatalogData> {
  await writeMetadataCatalog(rootPath, removeCatalogValue(await readMetadataCatalog(rootPath), category, value))

  if (removeFromFiles) {
    const store = await readMetadataStore(rootPath)
    const changed = removeMetadataStoreValues(store, category, value)
    if (changed) await writeMetadataStore(rootPath, store)
    if (changed) broadcastLibraryRefresh()
  }

  return getMetadataCatalogData(rootPath)
}

async function addMetadataToFiles(payload: BulkMetadataAddPayload) {
  return updateMetadataForFiles({
    rootPath: payload.rootPath,
    paths: payload.paths,
    category: payload.category,
    addValues: payload.values,
    removeValues: []
  })
}

async function updateMetadataForFiles(payload: BulkMetadataUpdatePayload) {
  const addValues = Array.from(uniqueMetadataValues(payload.addValues))
  const addValueKeys = new Set(addValues.map((value) => normalizeMetadataValue(value)))
  const removeValues = Array.from(uniqueMetadataValues(payload.removeValues)).filter(
    (value) => !addValueKeys.has(normalizeMetadataValue(value))
  )
  if (!addValues.length && !removeValues.length) throw new Error('Aucune modification a appliquer.')

  const store = await readMetadataStore(payload.rootPath)
  let updatedCount = 0
  let skippedCount = 0

  for (const filePath of payload.paths) {
    if (!isInside(filePath, payload.rootPath)) {
      skippedCount += 1
      continue
    }

    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat || stat.isDirectory()) {
      skippedCount += 1
      continue
    }

    const kind = getKind(filePath, false)
    if (kind !== 'image' && kind !== 'video') {
      skippedCount += 1
      continue
    }

    const key = toStoreKey(payload.rootPath, filePath)
    const metadata = store[key] ?? {}
    let changed = false
    for (const value of removeValues) {
      changed = removeMetadataValue(metadata, payload.category, value) || changed
    }
    if (addValues.length) {
      changed = addMetadataValues(metadata, payload.category, addValues) || changed
    }
    const cleanedMetadata = cleanMetadata(metadata)
    if (Object.keys(cleanedMetadata).length) {
      store[key] = cleanedMetadata
    } else {
      delete store[key]
    }
    if (changed) updatedCount += 1
  }

  if (updatedCount) {
    await writeMetadataStore(payload.rootPath, store)
    if (addValues.length) {
      const catalog = await readMetadataCatalog(payload.rootPath)
      await writeMetadataCatalog(payload.rootPath, {
        ...catalog,
        [payload.category]: [...catalog[payload.category], ...addValues]
      })
    }
    broadcastLibraryRefresh()
  }

  return {
    updatedCount,
    skippedCount
  }
}

function addMetadataValues(metadata: CustomMetadata, category: BulkMetadataCategory, values: string[]): boolean {
  if (category === 'tags' || category === 'people') {
    const previous = metadata[category] ?? []
    const nextValues = Array.from(uniqueMetadataValues([...previous, ...values]))
    metadata[category] = nextValues
    return JSON.stringify(previous) !== JSON.stringify(nextValues)
  }

  const previous = getMetadataLocations(metadata)
  const nextValues = Array.from(uniqueMetadataValues([...previous, ...values]))
  metadata.locations = nextValues
  metadata.locationName = nextValues[0]
  return JSON.stringify(previous) !== JSON.stringify(nextValues)
}

function updateMetadataStoreValues(
  store: MetadataStore,
  category: MetadataCategory,
  from: string,
  to: string
): boolean {
  let changed = false
  for (const metadata of Object.values(store)) {
    changed = updateMetadataValue(metadata, category, from, to) || changed
  }
  return changed
}

function removeMetadataStoreValues(store: MetadataStore, category: MetadataCategory, value: string): boolean {
  let changed = false
  for (const metadata of Object.values(store)) {
    changed = removeMetadataValue(metadata, category, value) || changed
  }
  return changed
}

function updateMetadataValue(metadata: CustomMetadata, category: MetadataCategory, from: string, to: string): boolean {
  const target = normalizeMetadataValue(from)
  if (category === 'tags' || category === 'people') {
    const key = category
    const values = metadata[key] ?? []
    const nextValues = values.map((value) => (normalizeMetadataValue(value) === target ? to : value))
    const uniqueValues = Array.from(uniqueMetadataValues(nextValues))
    if (JSON.stringify(values) !== JSON.stringify(uniqueValues)) {
      metadata[key] = uniqueValues
      return true
    }
    return false
  }

  if (category === 'locations' && metadata.locationName && normalizeMetadataValue(metadata.locationName) === target) {
    const values = getMetadataLocations(metadata)
    const nextValues = Array.from(uniqueMetadataValues(values.map((value) => (normalizeMetadataValue(value) === target ? to : value))))
    metadata.locations = nextValues
    metadata.locationName = nextValues[0]
    return true
  }

  if (category === 'locations' && metadata.locations?.some((value) => normalizeMetadataValue(value) === target)) {
    const values = getMetadataLocations(metadata)
    const nextValues = Array.from(uniqueMetadataValues(values.map((value) => (normalizeMetadataValue(value) === target ? to : value))))
    metadata.locations = nextValues
    metadata.locationName = nextValues[0]
    return true
  }

  if (category === 'statuses' && metadata.status && normalizeMetadataValue(metadata.status) === target) {
    metadata.status = to
    return true
  }

  return false
}

function removeMetadataValue(metadata: CustomMetadata, category: MetadataCategory, value: string): boolean {
  const target = normalizeMetadataValue(value)
  if (category === 'tags' || category === 'people') {
    const key = category
    const values = metadata[key] ?? []
    const nextValues = values.filter((item) => normalizeMetadataValue(item) !== target)
    if (nextValues.length !== values.length) {
      metadata[key] = nextValues.length ? nextValues : undefined
      return true
    }
    return false
  }

  if (category === 'locations' && metadata.locationName && normalizeMetadataValue(metadata.locationName) === target) {
    const nextValues = getMetadataLocations(metadata).filter((item) => normalizeMetadataValue(item) !== target)
    metadata.locations = nextValues.length ? nextValues : undefined
    metadata.locationName = nextValues[0]
    return true
  }

  if (category === 'locations' && metadata.locations?.some((item) => normalizeMetadataValue(item) === target)) {
    const nextValues = getMetadataLocations(metadata).filter((item) => normalizeMetadataValue(item) !== target)
    metadata.locations = nextValues.length ? nextValues : undefined
    metadata.locationName = nextValues[0]
    return true
  }

  if (category === 'statuses' && metadata.status && normalizeMetadataValue(metadata.status) === target) {
    metadata.status = undefined
    return true
  }

  return false
}

function sortSuggestionValues(values: Set<string>): string[] {
  return Array.from(values).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base', numeric: true }))
}

function getMetadataLocations(metadata: CustomMetadata): string[] {
  return Array.from(uniqueMetadataValues([...(metadata.locations ?? []), ...(metadata.locationName ? [metadata.locationName] : [])]))
}

function cleanMetadata(metadata: CustomMetadata): CustomMetadata {
  const cleanList = (value?: string[]): string[] | undefined => {
    const items = (value ?? []).map((item) => item.trim()).filter(Boolean)
    return items.length ? Array.from(new Set(items)) : undefined
  }
  const locations = cleanList([...(metadata.locations ?? []), ...(metadata.locationName ? [metadata.locationName] : [])])

  const cleaned: CustomMetadata = {
    title: metadata.title?.trim() || undefined,
    description: metadata.description?.trim() || undefined,
    tags: cleanList(metadata.tags),
    people: cleanList(metadata.people),
    locations,
    rating: Number.isFinite(metadata.rating) ? Math.max(0, Math.min(5, Number(metadata.rating))) : undefined,
    favorite: metadata.favorite || undefined,
    status: metadata.status?.trim() || undefined,
    dateTaken: metadata.dateTaken || undefined,
    locationName: locations?.[0],
    latitude:
      metadata.latitude === null || metadata.latitude === undefined || Number.isNaN(Number(metadata.latitude))
        ? undefined
        : Number(metadata.latitude),
    longitude:
      metadata.longitude === null || metadata.longitude === undefined || Number.isNaN(Number(metadata.longitude))
        ? undefined
        : Number(metadata.longitude),
    notes: metadata.notes?.trim() || undefined
  }

  return Object.fromEntries(Object.entries(cleaned).filter(([, value]) => value !== undefined)) as CustomMetadata
}

async function buildTree(rootPath: string): Promise<FileNode> {
  const stat = await fs.stat(rootPath)
  const metadataStore = await readMetadataStore(rootPath)
  return {
    id: rootPath,
    path: rootPath,
    parentPath: null,
    name: path.basename(rootPath) || rootPath,
    extension: '',
    kind: 'folder',
    size: stat.size,
    createdAt: stat.birthtime.toISOString(),
    modifiedAt: stat.mtime.toISOString(),
    children: await scanChildren(rootPath, rootPath, metadataStore)
  }
}

async function scanChildren(directoryPath: string, rootPath: string, metadataStore: MetadataStore): Promise<FileNode[]> {
  let entries = await fs.readdir(directoryPath, { withFileTypes: true })
  entries = entries.filter((entry) => entry.name !== metadataDirName)

  const nodes = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name)
      const stat = await fs.stat(entryPath)
      const kind = getKind(entryPath, entry.isDirectory())
      const customMetadata = metadataStore[toStoreKey(rootPath, entryPath)]
      const node: FileNode = {
        id: entryPath,
        path: entryPath,
        parentPath: directoryPath,
        name: entry.name,
        extension: entry.isDirectory() ? '' : path.extname(entry.name).slice(1).toUpperCase(),
        kind,
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
        modifiedAt: stat.mtime.toISOString(),
        customMetadata
      }

      if (entry.isDirectory()) {
        node.children = await scanChildren(entryPath, rootPath, metadataStore)
      }

      return node
    })
  )

  return nodes.sort((a, b) => {
    if (a.kind === 'folder' && b.kind !== 'folder') return -1
    if (a.kind !== 'folder' && b.kind === 'folder') return 1
    if ((a.kind === 'image' || a.kind === 'video') && b.kind === 'other') return -1
    if (a.kind === 'other' && (b.kind === 'image' || b.kind === 'video')) return 1
    return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base', numeric: true })
  })
}

async function getImageInfo(filePath: string): Promise<Record<string, unknown>> {
  const info: Record<string, unknown> = {}

  try {
    const metadata = await sharp(filePath, { failOn: 'none' }).metadata()
    info.width = metadata.width
    info.height = metadata.height
    info.format = metadata.format
    info.orientation = metadata.orientation
    info.colorSpace = metadata.space
  } catch {
    // Unsupported formats are still displayed through their file information.
  }

  try {
    const exif = await exifr.parse(filePath, {
      tiff: true,
      exif: true,
      gps: true,
      xmp: true,
      mergeOutput: true,
      reviveValues: true
    })

    if (exif) {
      info.exif = {
        make: exif.Make,
        model: exif.Model,
        lensModel: exif.LensModel,
        dateTimeOriginal: exif.DateTimeOriginal?.toISOString?.() ?? exif.DateTimeOriginal,
        exposureTime: exif.ExposureTime,
        fNumber: exif.FNumber,
        iso: exif.ISO,
        focalLength: exif.FocalLength,
        latitude: exif.latitude,
        longitude: exif.longitude
      }
    }
  } catch {
    // EXIF parsing is best-effort.
  }

  return info
}

async function getVideoInfo(filePath: string): Promise<Record<string, unknown>> {
  if (!ffprobeStatic.path) {
    return {}
  }

  return new Promise((resolve) => {
    const child = spawn(ffprobeStatic.path as string, [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath
    ])

    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.on('error', () => resolve({}))
    child.on('close', () => {
      try {
        const parsed = JSON.parse(stdout)
        const videoStream = parsed.streams?.find((stream: Record<string, unknown>) => stream.codec_type === 'video')
        resolve({
          width: videoStream?.width,
          height: videoStream?.height,
          codec: videoStream?.codec_name,
          duration: Number(parsed.format?.duration ?? videoStream?.duration) || undefined,
          bitRate: Number(parsed.format?.bit_rate) || undefined,
          formatName: parsed.format?.format_long_name ?? parsed.format?.format_name,
          creationTime: parsed.format?.tags?.creation_time ?? videoStream?.tags?.creation_time
        })
      } catch {
        resolve({})
      }
    })
  })
}

async function getItemDetails(filePath: string) {
  const stat = await fs.stat(filePath)
  const kind = getKind(filePath, stat.isDirectory())
  const rootPath = activeRootPath && isInside(filePath, activeRootPath) ? activeRootPath : null
  const media = kind === 'image' ? await getImageInfo(filePath) : kind === 'video' ? await getVideoInfo(filePath) : {}

  return {
    id: filePath,
    path: filePath,
    parentPath: path.dirname(filePath),
    name: path.basename(filePath),
    extension: stat.isDirectory() ? '' : path.extname(filePath).slice(1).toUpperCase(),
    kind,
    size: stat.size,
    createdAt: stat.birthtime.toISOString(),
    modifiedAt: stat.mtime.toISOString(),
    accessedAt: stat.atime.toISOString(),
    mediaUrl: kind === 'image' || kind === 'video' ? pathToFileURL(filePath).href : null,
    customMetadata: await getCustomMetadata(rootPath, filePath),
    media,
    canRotate: kind === 'image' && rotatableImageExtensions.has(path.extname(filePath).toLowerCase())
  }
}

async function getThumbnail(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath)
    const kind = getKind(filePath, stat.isDirectory())

    if (kind === 'image') {
      const image = await nativeImage.createThumbnailFromPath(filePath, {
        width: 640,
        height: 420
      })
      if (!image.isEmpty()) return image.toDataURL()
    }

    const icon = await app.getFileIcon(filePath, { size: 'large' })
    return icon.toDataURL()
  } catch {
    return null
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim()
}

function normalizeRenamedFileName(originalPath: string, requestedName: string): string {
  const cleanName = sanitizeFileName(requestedName)
  const originalExtension = path.extname(originalPath)
  if (!cleanName) return path.basename(originalPath)
  if (!path.extname(cleanName) && originalExtension) return `${cleanName}${originalExtension}`
  return cleanName
}

async function uniqueTargetPath(targetDir: string, baseName: string): Promise<string> {
  const extension = path.extname(baseName)
  const stem = extension ? baseName.slice(0, -extension.length) : baseName
  let candidate = path.join(targetDir, baseName)
  let index = 2

  while (await pathExists(candidate)) {
    candidate = path.join(targetDir, `${stem} (${index})${extension}`)
    index += 1
  }

  return candidate
}

async function copyPath(sourcePath: string, destinationPath: string): Promise<void> {
  const stat = await fs.stat(sourcePath)
  await fs.cp(sourcePath, destinationPath, {
    recursive: stat.isDirectory(),
    force: false,
    errorOnExist: true
  })
}

async function movePath(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    await fs.rename(sourcePath, destinationPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EXDEV') throw error
    await copyPath(sourcePath, destinationPath)
    await fs.rm(sourcePath, { recursive: true, force: true })
  }
}

async function transferMetadata(rootPath: string | null, sourcePath: string, destinationPath: string, operation: 'copy' | 'cut') {
  if (!rootPath || !isInside(sourcePath, rootPath) || !isInside(destinationPath, rootPath)) {
    return
  }

  const store = await readMetadataStore(rootPath)
  const sourceKey = toStoreKey(rootPath, sourcePath)
  const destinationKey = toStoreKey(rootPath, destinationPath)
  let changed = false

  for (const key of Object.keys(store)) {
    if (key === sourceKey || key.startsWith(`${sourceKey}/`)) {
      const nextKey = `${destinationKey}${key.slice(sourceKey.length)}`
      store[nextKey] = store[key]
      if (operation === 'cut') {
        delete store[key]
      }
      changed = true
    }
  }

  if (changed) {
    await writeMetadataStore(rootPath, store)
  }
}

async function removeMetadata(rootPath: string | null, removedPath: string): Promise<void> {
  if (!rootPath || !isInside(removedPath, rootPath)) {
    return
  }

  const store = await readMetadataStore(rootPath)
  const removedKey = toStoreKey(rootPath, removedPath)
  let changed = false

  for (const key of Object.keys(store)) {
    if (key === removedKey || key.startsWith(`${removedKey}/`)) {
      delete store[key]
      changed = true
    }
  }

  if (changed) {
    await writeMetadataStore(rootPath, store)
  }
}

async function rotateImageFile(filePath: string, degrees: number): Promise<void> {
  const normalized = ((degrees % 360) + 360) % 360
  if (normalized === 0) return

  const extension = path.extname(filePath).toLowerCase()
  if (!rotatableImageExtensions.has(extension)) {
    throw new Error("Ce format d'image ne prend pas en charge la rotation directe.")
  }

  const dir = path.dirname(filePath)
  const tempPath = path.join(dir, `.${path.basename(filePath)}.photodesk-${Date.now()}${extension}`)
  const buffer = await sharp(filePath, { failOn: 'none' }).rotate(normalized).withMetadata({ orientation: 1 }).toBuffer()
  await fs.writeFile(tempPath, buffer)
  await fs.rename(tempPath, filePath)
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

async function runPowerShell(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true
    })

    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(stderr || `PowerShell a renvoye le code ${code}`))
      }
    })
  })
}

async function setFileTimes(filePath: string, createdAt?: string, modifiedAt?: string): Promise<void> {
  if (!createdAt && !modifiedAt) {
    return
  }

  if (process.platform === 'win32') {
    const item = `$item = Get-Item -LiteralPath ${psQuote(filePath)}`
    const creation = createdAt ? `$item.CreationTime = [datetime]::Parse(${psQuote(createdAt)})` : ''
    const modification = modifiedAt ? `$item.LastWriteTime = [datetime]::Parse(${psQuote(modifiedAt)})` : ''
    await runPowerShell([item, creation, modification].filter(Boolean).join('; '))
    return
  }

  if (modifiedAt) {
    const stat = await fs.stat(filePath)
    await fs.utimes(filePath, stat.atime, new Date(modifiedAt))
  }
}

async function saveMediaEdits(payload: SaveEditsPayload) {
  const rootPath = payload.rootPath
  let currentPath = payload.originalPath

  if (!isInside(currentPath, rootPath)) {
    throw new Error("Le fichier n'appartient pas au dossier actuellement ouvert.")
  }

  const nextName = normalizeRenamedFileName(currentPath, payload.fileName)
  const nextPath = path.join(path.dirname(currentPath), nextName)

  if (nextPath !== currentPath) {
    if (await pathExists(nextPath)) {
      throw new Error('Un fichier porte deja ce nom dans ce dossier.')
    }
    await movePath(currentPath, nextPath)
    await transferMetadata(rootPath, currentPath, nextPath, 'cut')
    currentPath = nextPath
  }

  if (payload.rotationDegrees) {
    await rotateImageFile(currentPath, payload.rotationDegrees)
  }

  await setFileTimes(currentPath, payload.createdAt, payload.modifiedAt)
  await saveCustomMetadata(rootPath, currentPath, payload.metadata)
  broadcastLibraryRefresh()

  return {
    path: currentPath,
    details: await getItemDetails(currentPath)
  }
}

function broadcastLibraryRefresh(): void {
  mainWindow?.webContents.send('library:refresh')
}

async function chooseReferenceFolder(): Promise<FolderSelectionResult | null> {
  const result = await showOpenDialog({
    title: 'Choisir le dossier de reference',
    properties: ['openDirectory']
  })

  if (result.canceled || !result.filePaths[0]) {
    return null
  }

  activeRootPath = result.filePaths[0]
  await saveLastReferenceFolder(activeRootPath)
  return {
    rootPath: activeRootPath,
    tree: await buildTree(activeRootPath)
  }
}

async function getLastReferenceFolder(): Promise<FolderSelectionResult | null> {
  const settings = await readAppSettings()
  if (!settings.lastRootPath || !(await pathExists(settings.lastRootPath))) {
    return null
  }

  try {
    activeRootPath = settings.lastRootPath
    return {
      rootPath: activeRootPath,
      tree: await buildTree(activeRootPath)
    }
  } catch {
    return null
  }
}

ipcMain.handle('folder:choose', async () => {
  return chooseReferenceFolder()
})

ipcMain.handle('folder:last', async () => {
  return getLastReferenceFolder()
})

ipcMain.handle('folder:scan', async (_event, rootPath: string) => {
  activeRootPath = rootPath
  await saveLastReferenceFolder(rootPath)
  return buildTree(rootPath)
})

ipcMain.handle('metadata:suggestions', async (_event, rootPath: string) => getMetadataSuggestions(rootPath))
ipcMain.handle('metadata:catalog', async (_event, rootPath: string) => getMetadataCatalogData(rootPath))
ipcMain.handle(
  'metadata:confirm-bulk-add',
  async (event, payload: { category: BulkMetadataCategory; values: string[]; count: number }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const categoryLabel =
      payload.category === 'tags' ? 'tag(s)' : payload.category === 'people' ? 'personne(s)' : 'lieu(x)'
    const result = await (win ? dialog.showMessageBox(win, {
      type: 'question',
      title: 'Confirmer l ajout',
      message: `Ajouter ${payload.values.length} ${categoryLabel} a ${payload.count} element(s) ?`,
      detail: payload.values.join(', '),
      buttons: ['Ajouter', 'Annuler'],
      defaultId: 0,
      cancelId: 1
    }) : dialog.showMessageBox({
      type: 'question',
      title: 'Confirmer l ajout',
      message: `Ajouter ${payload.values.length} ${categoryLabel} a ${payload.count} element(s) ?`,
      detail: payload.values.join(', '),
      buttons: ['Ajouter', 'Annuler'],
      defaultId: 0,
      cancelId: 1
    }))

    return result.response === 0
  }
)
ipcMain.handle(
  'metadata:confirm-bulk-update',
  async (
    event,
    payload: { category: BulkMetadataCategory; addValues: string[]; removeValues: string[]; count: number }
  ) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const categoryLabel =
      payload.category === 'tags' ? 'tag(s)' : payload.category === 'people' ? 'personne(s)' : 'lieu(x)'
    const addValues = Array.from(uniqueMetadataValues(payload.addValues))
    const removeValues = Array.from(uniqueMetadataValues(payload.removeValues))
    const detail = [
      addValues.length ? `Ajouter: ${addValues.join(', ')}` : '',
      removeValues.length ? `Retirer: ${removeValues.join(', ')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    const options: MessageBoxOptions = {
      type: 'question',
      title: 'Confirmer les modifications',
      message: `Modifier les ${categoryLabel} de ${payload.count} element(s) ?`,
      detail,
      buttons: ['Appliquer', 'Annuler'],
      defaultId: 0,
      cancelId: 1
    }
    const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)

    return result.response === 0
  }
)
ipcMain.handle('metadata:bulk-add', async (_event, payload: BulkMetadataAddPayload) => addMetadataToFiles(payload))
ipcMain.handle('metadata:bulk-update', async (_event, payload: BulkMetadataUpdatePayload) => updateMetadataForFiles(payload))
ipcMain.handle(
  'metadata:catalog-add',
  async (_event, payload: { rootPath: string; category: MetadataCategory; value: string }) =>
    addMetadataCatalogValue(payload.rootPath, payload.category, payload.value)
)
ipcMain.handle(
  'metadata:catalog-rename',
  async (_event, payload: { rootPath: string; category: MetadataCategory; from: string; to: string; updateFiles: boolean }) =>
    renameMetadataCatalogValue(payload.rootPath, payload.category, payload.from, payload.to, payload.updateFiles)
)
ipcMain.handle(
  'metadata:catalog-delete',
  async (_event, payload: { rootPath: string; category: MetadataCategory; value: string; removeFromFiles: boolean }) =>
    deleteMetadataCatalogValue(payload.rootPath, payload.category, payload.value, payload.removeFromFiles)
)

ipcMain.handle('folder:create', async (_event, payload: { targetDir: string; name: string }) => {
  const name = sanitizeFileName(payload.name) || 'Nouveau dossier'
  const targetPath = await uniqueTargetPath(payload.targetDir, name)
  await fs.mkdir(targetPath)
  broadcastLibraryRefresh()
  return targetPath
})

ipcMain.handle('item:details', async (_event, filePath: string) => getItemDetails(filePath))
ipcMain.handle('item:thumbnail', async (_event, filePath: string) => getThumbnail(filePath))

ipcMain.handle('item:open-external', async (_event, filePath: string) => {
  return shell.openPath(filePath)
})

ipcMain.handle('item:reveal', async (_event, filePath: string) => {
  shell.showItemInFolder(filePath)
})

ipcMain.handle('item:rename', async (_event, payload: { filePath: string; name: string }) => {
  const nextName = normalizeRenamedFileName(payload.filePath, payload.name)
  const nextPath = path.join(path.dirname(payload.filePath), nextName)
  if (nextPath === payload.filePath) {
    return nextPath
  }

  if (await pathExists(nextPath)) {
    throw new Error('Un element porte deja ce nom dans ce dossier.')
  }

  await movePath(payload.filePath, nextPath)
  await transferMetadata(activeRootPath, payload.filePath, nextPath, 'cut')
  broadcastLibraryRefresh()
  return nextPath
})

ipcMain.handle('items:paste', async (_event, payload: PastePayload) => {
  for (const sourcePath of payload.paths) {
    if (payload.operation === 'cut' && isInside(payload.targetDir, sourcePath)) {
      throw new Error('Impossible de deplacer un dossier dans lui-meme.')
    }

    const destinationPath = await uniqueTargetPath(payload.targetDir, path.basename(sourcePath))
    if (payload.operation === 'copy') {
      await copyPath(sourcePath, destinationPath)
    } else {
      await movePath(sourcePath, destinationPath)
    }
    await transferMetadata(activeRootPath, sourcePath, destinationPath, payload.operation)
  }

  broadcastLibraryRefresh()
  return true
})

ipcMain.handle('items:move-to', async (_event, payload: { paths: string[]; targetDir: string }) => {
  for (const sourcePath of payload.paths) {
    if (isInside(payload.targetDir, sourcePath)) {
      throw new Error('Impossible de deplacer un dossier dans lui-meme.')
    }

    const destinationPath = await uniqueTargetPath(payload.targetDir, path.basename(sourcePath))
    await movePath(sourcePath, destinationPath)
    await transferMetadata(activeRootPath, sourcePath, destinationPath, 'cut')
  }

  broadcastLibraryRefresh()
  return true
})

ipcMain.handle('items:delete', async (_event, pathsToDelete: string[]) => {
  for (const filePath of pathsToDelete) {
    await shell.trashItem(filePath)
    await removeMetadata(activeRootPath, filePath)
  }

  broadcastLibraryRefresh()
  return true
})

ipcMain.handle('dialog:confirm-delete', async (_event, pathsToDelete: string[]) => {
  const result = await showMessageBox({
    type: 'warning',
    title: 'Supprimer',
    message: pathsToDelete.length > 1 ? 'Envoyer ces elements a la corbeille ?' : 'Envoyer cet element a la corbeille ?',
    detail: pathsToDelete.map((item) => path.basename(item)).join('\n'),
    buttons: ['Supprimer', 'Annuler'],
    defaultId: 0,
    cancelId: 1
  })

  return result.response === 0
})

ipcMain.handle('dialog:select-destination', async () => {
  const result = await showOpenDialog({
    title: 'Choisir le dossier de destination',
    properties: ['openDirectory']
  })

  if (result.canceled || !result.filePaths[0]) {
    return null
  }

  return result.filePaths[0]
})

ipcMain.handle('dialog:confirm-save', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const options: MessageBoxOptions = {
    type: 'question',
    title: 'Modifications non enregistrees',
    message: 'Enregistrer les modifications avant de continuer ?',
    buttons: ['Enregistrer', 'Ignorer', 'Annuler'],
    defaultId: 0,
    cancelId: 2
  }
  const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)

  if (result.response === 0) return 'save'
  if (result.response === 1) return 'discard'
  return 'cancel'
})

ipcMain.handle('viewer:open', async (_event, payload: ViewerState) => {
  createViewerWindow(payload)
  return true
})

ipcMain.handle('viewer:get-state', async (event) => {
  return viewerStates.get(event.sender.id) ?? null
})

ipcMain.handle('viewer:close', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    viewerCloseAllowed.add(win.id)
    viewerClosePrompting.delete(win.id)
    win.close()
  }
})

ipcMain.handle('viewer:close-cancelled', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    viewerClosePrompting.delete(win.id)
  }
})

ipcMain.handle('media:save-edits', async (_event, payload: SaveEditsPayload) => saveMediaEdits(payload))

app.whenReady().then(() => {
  buildApplicationMenu()
  mainWindow = createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
