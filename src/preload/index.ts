import { contextBridge, ipcRenderer } from 'electron'

type Unsubscribe = () => void

function on(channel: string, callback: () => void): Unsubscribe {
  const listener = (): void => callback()
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

function onPayload<T>(channel: string, callback: (payload: T) => void): Unsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('photoDesk', {
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  getLastFolder: () => ipcRenderer.invoke('folder:last'),
  scanFolder: (rootPath: string) => ipcRenderer.invoke('folder:scan', rootPath),
  getMetadataSuggestions: (rootPath: string) => ipcRenderer.invoke('metadata:suggestions', rootPath),
  getMetadataCatalog: (rootPath: string) => ipcRenderer.invoke('metadata:catalog', rootPath),
  confirmBulkMetadataAdd: (payload: unknown) => ipcRenderer.invoke('metadata:confirm-bulk-add', payload),
  confirmBulkMetadataUpdate: (payload: unknown) => ipcRenderer.invoke('metadata:confirm-bulk-update', payload),
  bulkAddMetadata: (payload: unknown) => ipcRenderer.invoke('metadata:bulk-add', payload),
  bulkUpdateMetadata: (payload: unknown) => ipcRenderer.invoke('metadata:bulk-update', payload),
  addMetadataCatalogValue: (payload: unknown) => ipcRenderer.invoke('metadata:catalog-add', payload),
  renameMetadataCatalogValue: (payload: unknown) => ipcRenderer.invoke('metadata:catalog-rename', payload),
  deleteMetadataCatalogValue: (payload: unknown) => ipcRenderer.invoke('metadata:catalog-delete', payload),
  createFolder: (payload: { targetDir: string; name: string }) => ipcRenderer.invoke('folder:create', payload),
  getItemDetails: (filePath: string) => ipcRenderer.invoke('item:details', filePath),
  getThumbnail: (filePath: string) => ipcRenderer.invoke('item:thumbnail', filePath),
  openExternal: (filePath: string) => ipcRenderer.invoke('item:open-external', filePath),
  revealInExplorer: (filePath: string) => ipcRenderer.invoke('item:reveal', filePath),
  renameItem: (payload: { filePath: string; name: string }) => ipcRenderer.invoke('item:rename', payload),
  pasteItems: (payload: { paths: string[]; targetDir: string; operation: 'copy' | 'cut' }) =>
    ipcRenderer.invoke('items:paste', payload),
  moveItemsTo: (payload: { paths: string[]; targetDir: string }) => ipcRenderer.invoke('items:move-to', payload),
  deleteItems: (paths: string[]) => ipcRenderer.invoke('items:delete', paths),
  confirmDelete: (paths: string[]) => ipcRenderer.invoke('dialog:confirm-delete', paths),
  selectMoveDestination: () => ipcRenderer.invoke('dialog:select-destination'),
  confirmSave: () => ipcRenderer.invoke('dialog:confirm-save'),
  openViewer: (payload: { rootPath: string; files: string[]; currentPath: string }) =>
    ipcRenderer.invoke('viewer:open', payload),
  getViewerState: () => ipcRenderer.invoke('viewer:get-state'),
  closeViewer: () => ipcRenderer.invoke('viewer:close'),
  cancelViewerClose: () => ipcRenderer.invoke('viewer:close-cancelled'),
  saveMediaEdits: (payload: unknown) => ipcRenderer.invoke('media:save-edits', payload),
  onChooseReferenceFolder: (callback: () => void) => on('app:choose-reference-folder', callback),
  onOpenMetadataManager: (callback: () => void) => on('app:open-metadata-manager', callback),
  onReferenceFolderSelected: (callback: (payload: { rootPath: string; tree: unknown }) => void) =>
    onPayload('app:reference-folder-selected', callback),
  onLibraryRefresh: (callback: () => void) => on('library:refresh', callback),
  onViewerAttemptClose: (callback: () => void) => on('viewer:attempt-close', callback)
})
