export type NodeKind = 'folder' | 'image' | 'video' | 'other'

export interface FileNode {
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

export interface CustomMetadata {
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

export interface MediaDetails {
  id: string
  path: string
  parentPath: string
  name: string
  extension: string
  kind: NodeKind
  size: number
  createdAt: string
  modifiedAt: string
  accessedAt: string
  mediaUrl: string | null
  customMetadata: CustomMetadata
  media: {
    width?: number
    height?: number
    format?: string
    orientation?: number
    colorSpace?: string
    codec?: string
    duration?: number
    bitRate?: number
    formatName?: string
    creationTime?: string
    exif?: {
      make?: string
      model?: string
      lensModel?: string
      dateTimeOriginal?: string
      exposureTime?: number
      fNumber?: number
      iso?: number
      focalLength?: number
      latitude?: number
      longitude?: number
    }
  }
  canRotate: boolean
}

export interface ViewerState {
  rootPath: string
  files: string[]
  currentPath: string
}

export interface MetadataSuggestions {
  tags: string[]
  people: string[]
  locations: string[]
  statuses: string[]
}

export type MetadataCategory = 'tags' | 'people' | 'locations' | 'statuses'
export type BulkMetadataCategory = 'tags' | 'people' | 'locations'

export interface MetadataUsageCounts {
  tags: Record<string, number>
  people: Record<string, number>
  locations: Record<string, number>
  statuses: Record<string, number>
}

export interface MetadataCatalogData {
  catalog: MetadataSuggestions
  used: MetadataSuggestions
  suggestions: MetadataSuggestions
  counts: MetadataUsageCounts
}

export interface SaveEditsPayload {
  rootPath: string
  originalPath: string
  fileName: string
  createdAt?: string
  modifiedAt?: string
  metadata: CustomMetadata
  rotationDegrees?: number
}

export type SaveChoice = 'save' | 'discard' | 'cancel'

export interface PhotoDeskApi {
  chooseFolder(): Promise<{ rootPath: string; tree: FileNode } | null>
  getLastFolder(): Promise<{ rootPath: string; tree: FileNode } | null>
  scanFolder(rootPath: string): Promise<FileNode>
  getMetadataSuggestions(rootPath: string): Promise<MetadataSuggestions>
  getMetadataCatalog(rootPath: string): Promise<MetadataCatalogData>
  confirmBulkMetadataAdd(payload: { category: BulkMetadataCategory; values: string[]; count: number }): Promise<boolean>
  confirmBulkMetadataUpdate(payload: {
    category: BulkMetadataCategory
    addValues: string[]
    removeValues: string[]
    count: number
  }): Promise<boolean>
  bulkAddMetadata(payload: {
    rootPath: string
    paths: string[]
    category: BulkMetadataCategory
    values: string[]
  }): Promise<{ updatedCount: number; skippedCount: number }>
  bulkUpdateMetadata(payload: {
    rootPath: string
    paths: string[]
    category: BulkMetadataCategory
    addValues: string[]
    removeValues: string[]
  }): Promise<{ updatedCount: number; skippedCount: number }>
  addMetadataCatalogValue(payload: { rootPath: string; category: MetadataCategory; value: string }): Promise<MetadataCatalogData>
  renameMetadataCatalogValue(payload: {
    rootPath: string
    category: MetadataCategory
    from: string
    to: string
    updateFiles: boolean
  }): Promise<MetadataCatalogData>
  deleteMetadataCatalogValue(payload: {
    rootPath: string
    category: MetadataCategory
    value: string
    removeFromFiles: boolean
  }): Promise<MetadataCatalogData>
  createFolder(payload: { targetDir: string; name: string }): Promise<string>
  getItemDetails(filePath: string): Promise<MediaDetails>
  getThumbnail(filePath: string): Promise<string | null>
  openExternal(filePath: string): Promise<string>
  revealInExplorer(filePath: string): Promise<void>
  renameItem(payload: { filePath: string; name: string }): Promise<string>
  pasteItems(payload: { paths: string[]; targetDir: string; operation: 'copy' | 'cut' }): Promise<boolean>
  moveItemsTo(payload: { paths: string[]; targetDir: string }): Promise<boolean>
  deleteItems(paths: string[]): Promise<boolean>
  confirmDelete(paths: string[]): Promise<boolean>
  selectMoveDestination(): Promise<string | null>
  confirmSave(): Promise<SaveChoice>
  openViewer(payload: ViewerState): Promise<boolean>
  getViewerState(): Promise<ViewerState | null>
  closeViewer(): Promise<void>
  cancelViewerClose(): Promise<void>
  saveMediaEdits(payload: SaveEditsPayload): Promise<{ path: string; details: MediaDetails }>
  onChooseReferenceFolder(callback: () => void): () => void
  onOpenMetadataManager(callback: () => void): () => void
  onReferenceFolderSelected(callback: (payload: { rootPath: string; tree: FileNode }) => void): () => void
  onLibraryRefresh(callback: () => void): () => void
  onViewerAttemptClose(callback: () => void): () => void
}
