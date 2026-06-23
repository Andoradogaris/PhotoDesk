import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent, MutableRefObject, ReactElement, ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  File,
  Filter,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  Heart,
  Image,
  Moon,
  MapPin,
  Maximize2,
  Move,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  Search,
  Star,
  Sun,
  Tag,
  Trash2,
  Users,
  X
} from 'lucide-react'
import type {
  BulkMetadataCategory,
  CustomMetadata,
  FileNode,
  MediaDetails,
  MetadataCatalogData,
  MetadataCategory,
  MetadataSuggestions,
  NodeKind,
  SaveEditsPayload,
  ViewerState
} from './types'

type ClipboardState = {
  operation: 'copy' | 'cut'
  paths: string[]
} | null

type PromptState = {
  title: string
  label: string
  value: string
  confirmLabel: string
  onConfirm: (value: string) => Promise<void>
} | null

type ContextMenuState = {
  x: number
  y: number
  node: FileNode | null
} | null

interface MetadataCategoryConfig {
  label: string
  singular: string
  empty: string
  icon: ReactNode
}

interface BulkMetadataCategoryConfig {
  label: string
  singular: string
  empty: string
  icon: ReactNode
}

interface BulkMetadataChangeSet {
  addValues: string[]
  removeValues: string[]
}

interface BulkMetadataValueCount {
  value: string
  count: number
}

type BulkMetadataCategoryValues = Record<BulkMetadataCategory, string[]>
type BulkMetadataValueCountsByCategory = Record<BulkMetadataCategory, BulkMetadataValueCount[]>

interface EditForm {
  fileName: string
  createdAt: string
  modifiedAt: string
  title: string
  description: string
  tagsText: string
  peopleText: string
  rating: number
  favorite: boolean
  status: string
  dateTaken: string
  locationName: string
  latitude: string
  longitude: string
  notes: string
  rotation: number
}

interface FilterState {
  search: string
  kind: 'all' | 'image' | 'video'
  tagsText: string
  peopleText: string
  locationsText: string
  status: string
  minRating: number
  favoritesOnly: boolean
  withoutTags: boolean
  withoutPeople: boolean
  withoutLocations: boolean
}

type ThemeMode = 'light' | 'dark'
type ExplorerViewMode = 'tree' | 'mosaic'
type SortField = 'name' | 'modifiedAt' | 'kind' | 'size'
type SortDirection = 'asc' | 'desc'

interface SortState {
  field: SortField
  direction: SortDirection
}

const statusOptions = ['A trier', 'A garder', 'A retoucher', 'Archive', 'Rejete']
const emptySuggestions: MetadataSuggestions = { tags: [], people: [], locations: [], statuses: [] }
const emptyCatalogData: MetadataCatalogData = {
  catalog: emptySuggestions,
  used: emptySuggestions,
  suggestions: emptySuggestions,
  counts: { tags: {}, people: {}, locations: {}, statuses: {} }
}
const defaultFilters: FilterState = {
  search: '',
  kind: 'all',
  tagsText: '',
  peopleText: '',
  locationsText: '',
  status: '',
  minRating: 0,
  favoritesOnly: false,
  withoutTags: false,
  withoutPeople: false,
  withoutLocations: false
}
const defaultSort: SortState = { field: 'name', direction: 'asc' }

const categoryConfigs: Record<MetadataCategory, MetadataCategoryConfig> = {
  tags: { label: 'Tags', singular: 'tag', empty: 'Aucun tag', icon: <Tag size={16} /> },
  people: { label: 'Personnes', singular: 'personne', empty: 'Aucune personne', icon: <Users size={16} /> },
  locations: { label: 'Lieux', singular: 'lieu', empty: 'Aucun lieu', icon: <MapPin size={16} /> },
  statuses: { label: 'Statuts', singular: 'statut', empty: 'Aucun statut', icon: <Check size={16} /> }
}

const bulkCategoryConfigs: Record<BulkMetadataCategory, BulkMetadataCategoryConfig> = {
  tags: { label: 'Tags', singular: 'tag', empty: 'Aucun tag disponible', icon: <Tag size={16} /> },
  people: { label: 'Personnes', singular: 'personne', empty: 'Aucune personne disponible', icon: <Users size={16} /> },
  locations: { label: 'Lieux', singular: 'lieu', empty: 'Aucun lieu disponible', icon: <MapPin size={16} /> }
}
const bulkMetadataCategories: BulkMetadataCategory[] = ['tags', 'people', 'locations']

function useAppTheme(): [ThemeMode, () => void] {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return window.localStorage.getItem('photoDesk.theme') === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem('photoDesk.theme', theme)
    } catch {
      // The theme still applies for the current window if persistence is unavailable.
    }
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  return [theme, toggleTheme]
}

export function App(): ReactElement {
  const [theme, toggleTheme] = useAppTheme()
  const isViewer = window.location.hash.startsWith('#/viewer')
  return isViewer ? <ViewerApp /> : <LibraryApp theme={theme} onToggleTheme={toggleTheme} />
}

function LibraryApp({ theme, onToggleTheme }: { theme: ThemeMode; onToggleTheme: () => void }): ReactElement {
  const [rootPath, setRootPath] = useState<string | null>(null)
  const [tree, setTree] = useState<FileNode | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string | null>(null)
  const [details, setDetails] = useState<MediaDetails | null>(null)
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [clipboard, setClipboard] = useState<ClipboardState>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [prompt, setPrompt] = useState<PromptState>(null)
  const [status, setStatus] = useState('Pret')
  const [error, setError] = useState<string | null>(null)
  const [explorerWidth, setExplorerWidth] = useState(760)
  const [rowHeight, setRowHeight] = useState(34)
  const [isScanning, setIsScanning] = useState(false)
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const [sort, setSort] = useState<SortState>(defaultSort)
  const [viewMode, setViewMode] = useState<ExplorerViewMode>('tree')
  const [catalogSuggestions, setCatalogSuggestions] = useState<MetadataSuggestions>(emptySuggestions)
  const [metadataManagerOpen, setMetadataManagerOpen] = useState(false)
  const splitRef = useRef<HTMLDivElement | null>(null)
  const restoredLastFolderRef = useRef(false)
  const detailsRequestRef = useRef(0)
  const refreshPromiseRef = useRef<Promise<void> | null>(null)
  const refreshPendingRef = useRef(false)
  const pendingSelectPathRef = useRef<string | null>(null)

  const selectedNode = useMemo(() => (tree && selectedPath ? findNode(tree, selectedPath) : null), [tree, selectedPath])
  const treeSuggestions = useMemo(() => (tree ? buildMetadataSuggestionsFromTree(tree) : emptySuggestions), [tree])
  const metadataSuggestions = useMemo(
    () => mergeMetadataSuggestionSets(treeSuggestions, catalogSuggestions),
    [treeSuggestions, catalogSuggestions]
  )
  const filteredTree = useMemo(() => (tree ? filterTree(tree, filters) : null), [tree, filters])
  const sortedTree = useMemo(() => (filteredTree ? sortTree(filteredTree, sort) : null), [filteredTree, sort])
  const visibleNodes = useMemo(() => (sortedTree ? flattenVisibleNodes(sortedTree, expanded) : []), [sortedTree, expanded])
  const mediaFiles = useMemo(() => (sortedTree ? flattenMediaFiles(sortedTree) : []), [sortedTree])
  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters])
  const selectedNodes = useMemo(
    () => (tree ? Array.from(selectedPaths).map((filePath) => findNode(tree, filePath)).filter((node): node is FileNode => Boolean(node)) : []),
    [tree, selectedPaths]
  )

  const refreshTree = useCallback((): Promise<void> => {
    if (!rootPath) return Promise.resolve()
    refreshPendingRef.current = true
    if (refreshPromiseRef.current) return refreshPromiseRef.current

    const refreshPromise = (async (): Promise<void> => {
      setIsScanning(true)
      try {
        while (refreshPendingRef.current) {
          refreshPendingRef.current = false
          const [nextTree, nextSuggestions] = await Promise.all([
            window.photoDesk.scanFolder(rootPath),
            window.photoDesk.getMetadataSuggestions(rootPath)
          ])
          setTree(nextTree)
          setCatalogSuggestions(nextSuggestions)
          setExpanded((previous) => {
            const next = new Set(previous)
            next.add(nextTree.path)
            return next
          })
        }
        setStatus('Dossier actualise')
      } catch (refreshError) {
        refreshPendingRef.current = false
        setError(messageFromError(refreshError))
      } finally {
        refreshPromiseRef.current = null
        setIsScanning(false)
      }
    })()

    refreshPromiseRef.current = refreshPromise
    return refreshPromise
  }, [rootPath])

  useEffect(() => {
    return window.photoDesk.onLibraryRefresh(() => {
      void refreshTree()
    })
  }, [refreshTree])

  const loadDetails = useCallback(async (node: FileNode) => {
    const requestId = ++detailsRequestRef.current
    setError(null)
    try {
      const [nextDetails, nextThumbnail] = await Promise.all([
        window.photoDesk.getItemDetails(node.path),
        window.photoDesk.getThumbnail(node.path)
      ])
      if (requestId !== detailsRequestRef.current) return
      setDetails(nextDetails)
      setThumbnail(nextThumbnail)
    } catch (detailsError) {
      if (requestId !== detailsRequestRef.current) return
      setDetails(null)
      setThumbnail(null)
      setError(messageFromError(detailsError))
    }
  }, [])

  const selectPathInTree = useCallback(
    (filePath: string): boolean => {
      if (!tree) return false
      const chain = findNodeChain(tree, filePath)
      if (!chain) return false
      const node = chain[chain.length - 1]

      setExpanded((previous) => {
        const next = new Set(previous)
        for (const item of chain) {
          if (item.kind === 'folder') next.add(item.path)
        }
        return next
      })
      setSelectedPath(node.path)
      setSelectedPaths(new Set([node.path]))
      setSelectionAnchorPath(node.path)
      void loadDetails(node)
      scrollNodeIntoView(node.path)
      return true
    },
    [tree, loadDetails]
  )

  useEffect(() => {
    return window.photoDesk.onLibrarySelectPath((filePath) => {
      pendingSelectPathRef.current = filePath
      if (selectPathInTree(filePath)) {
        pendingSelectPathRef.current = null
      }
    })
  }, [selectPathInTree])

  useEffect(() => {
    const filePath = pendingSelectPathRef.current
    if (filePath && selectPathInTree(filePath)) {
      pendingSelectPathRef.current = null
    }
  }, [selectPathInTree, tree])

  const handleMetadataManagerChanged = useCallback(
    (suggestions: MetadataSuggestions) => {
      setCatalogSuggestions(suggestions)
      void refreshTree()
    },
    [refreshTree]
  )

  const applyFolderSelection = useCallback(async (result: { rootPath: string; tree: FileNode } | null): Promise<void> => {
    if (!result) return
    detailsRequestRef.current += 1
    const nextSuggestions = await window.photoDesk.getMetadataSuggestions(result.rootPath)
    setRootPath(result.rootPath)
    setTree(result.tree)
    setCatalogSuggestions(nextSuggestions)
    setExpanded(new Set([result.tree.path]))
    setSelectedPath(result.tree.path)
    setSelectedPaths(new Set([result.tree.path]))
    setSelectionAnchorPath(result.tree.path)
    setDetails(await window.photoDesk.getItemDetails(result.tree.path))
    setThumbnail(await window.photoDesk.getThumbnail(result.tree.path))
    setStatus('Dossier ouvert')
  }, [])

  useEffect(() => {
    if (restoredLastFolderRef.current) return
    restoredLastFolderRef.current = true
    setIsScanning(true)
    void window.photoDesk
      .getLastFolder()
      .then((result) => applyFolderSelection(result))
      .catch((restoreError) => setError(messageFromError(restoreError)))
      .finally(() => setIsScanning(false))
  }, [applyFolderSelection])

  const chooseFolder = useCallback(async (): Promise<void> => {
    setError(null)
    setIsScanning(true)
    try {
      const result = await window.photoDesk.chooseFolder()
      await applyFolderSelection(result)
    } catch (chooseError) {
      setError(messageFromError(chooseError))
    } finally {
      setIsScanning(false)
    }
  }, [applyFolderSelection])

  useEffect(() => {
    return window.photoDesk.onChooseReferenceFolder(() => {
      void chooseFolder()
    })
  }, [chooseFolder])

  useEffect(() => {
    return window.photoDesk.onReferenceFolderSelected((result) => {
      setError(null)
      setIsScanning(true)
      void applyFolderSelection(result)
        .catch((selectionError) => setError(messageFromError(selectionError)))
        .finally(() => setIsScanning(false))
    })
  }, [applyFolderSelection])

  useEffect(() => {
    return window.photoDesk.onOpenMetadataManager(() => {
      if (!rootPath) {
        setError("Choisis d'abord un dossier de reference.")
        return
      }
      setMetadataManagerOpen(true)
    })
  }, [rootPath])

  function toggleFolder(node: FileNode): void {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(node.path)) {
        next.delete(node.path)
      } else {
        next.add(node.path)
      }
      return next
    })
  }

  async function openNode(node: FileNode): Promise<void> {
    if (node.kind === 'folder') {
      toggleFolder(node)
      return
    }

    if ((node.kind === 'image' || node.kind === 'video') && rootPath) {
      await window.photoDesk.openViewer({
        rootPath,
        files: mediaFiles,
        currentPath: node.path
      })
      return
    }

    await window.photoDesk.openExternal(node.path)
  }

  function targetDirectoryFor(node: FileNode | null): string | null {
    if (!rootPath) return null
    if (!node) return rootPath
    return node.kind === 'folder' ? node.path : node.parentPath ?? rootPath
  }

  function pathsFor(node: FileNode | null): string[] {
    if (node?.path) {
      return selectedPaths.has(node.path) ? Array.from(selectedPaths) : [node.path]
    }
    if (selectedPaths.size) return Array.from(selectedPaths)
    return selectedPath ? [selectedPath] : []
  }

  function requireMutablePaths(node: FileNode | null): string[] {
    const paths = pathsFor(node)
    if (rootPath && paths.some((filePath) => filePath === rootPath)) {
      throw new Error("Le dossier de reference lui-meme ne peut pas etre modifie.")
    }
    return paths
  }

  function mediaPathsFor(node: FileNode | null): string[] {
    return mediaNodesFor(node).map((mediaNode) => mediaNode.path)
  }

  function mediaNodesFor(node: FileNode | null): FileNode[] {
    if (!tree) return []
    return pathsFor(node).reduce<FileNode[]>((nodes, filePath) => {
      const target = findNode(tree, filePath)
      if (target?.kind === 'image' || target?.kind === 'video') {
        nodes.push(target)
      }
      return nodes
    }, [])
  }

  function selectSingleNode(node: FileNode): void {
    setSelectedPath(node.path)
    setSelectedPaths(new Set([node.path]))
    setSelectionAnchorPath(node.path)
    void loadDetails(node)
    scrollNodeIntoView(node.path)
  }

  function selectNode(node: FileNode, event: MouseEvent): void {
    setSelectedPath(node.path)
    void loadDetails(node)

    if (event.shiftKey && selectionAnchorPath) {
      const visiblePaths = visibleNodes.map((row) => row.node.path)
      const anchorIndex = visiblePaths.indexOf(selectionAnchorPath)
      const targetIndex = visiblePaths.indexOf(node.path)

      if (anchorIndex !== -1 && targetIndex !== -1) {
        const start = Math.min(anchorIndex, targetIndex)
        const end = Math.max(anchorIndex, targetIndex)
        setSelectedPaths(new Set(visiblePaths.slice(start, end + 1)))
        scrollNodeIntoView(node.path)
        return
      }
    }

    if (event.ctrlKey || event.metaKey) {
      setSelectionAnchorPath(node.path)
      setSelectedPaths((previous) => {
        const next = new Set(previous)
        if (next.has(node.path)) {
          next.delete(node.path)
        } else {
          next.add(node.path)
        }
        return next
      })
      scrollNodeIntoView(node.path)
      return
    }

    setSelectionAnchorPath(node.path)
    setSelectedPaths(new Set([node.path]))
    scrollNodeIntoView(node.path)
  }

  function selectNodeFromKeyboard(direction: 1 | -1, extendSelection: boolean): void {
    if (!visibleNodes.length) return

    const visiblePaths = visibleNodes.map((row) => row.node.path)
    const currentIndex = selectedPath ? visiblePaths.indexOf(selectedPath) : -1
    const fallbackIndex = direction > 0 ? -1 : visibleNodes.length
    const nextIndex = Math.max(0, Math.min(visibleNodes.length - 1, (currentIndex === -1 ? fallbackIndex : currentIndex) + direction))
    const nextNode = visibleNodes[nextIndex].node

    setContextMenu(null)
    setSelectedPath(nextNode.path)
    void loadDetails(nextNode)

    if (extendSelection) {
      const anchorPath = selectionAnchorPath ?? selectedPath ?? nextNode.path
      const anchorIndex = visiblePaths.indexOf(anchorPath)
      if (anchorIndex !== -1) {
        const start = Math.min(anchorIndex, nextIndex)
        const end = Math.max(anchorIndex, nextIndex)
        setSelectionAnchorPath(anchorPath)
        setSelectedPaths(new Set(visiblePaths.slice(start, end + 1)))
      } else {
        setSelectionAnchorPath(nextNode.path)
        setSelectedPaths(new Set([nextNode.path]))
      }
    } else {
      setSelectionAnchorPath(nextNode.path)
      setSelectedPaths(new Set([nextNode.path]))
    }

    scrollNodeIntoView(nextNode.path)
  }

  function openContextMenu(event: MouseEvent, node: FileNode | null): void {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      node
    })
    if (node) {
      if (selectedPaths.has(node.path)) {
        setSelectedPath(node.path)
        void loadDetails(node)
      } else {
        selectSingleNode(node)
      }
    }
  }

  function changeSort(field: SortField): void {
    setSort((current) => ({
      field,
      direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc'
    }))
  }

  async function copy(node: FileNode | null): Promise<void> {
    const selectedPaths = requireMutablePaths(node)
    if (!selectedPaths.length) return
    setClipboard({ operation: 'copy', paths: selectedPaths })
    setStatus('Element copie')
  }

  async function cut(node: FileNode | null): Promise<void> {
    const selectedPaths = requireMutablePaths(node)
    if (!selectedPaths.length) return
    setClipboard({ operation: 'cut', paths: selectedPaths })
    setStatus('Element coupe')
  }

  async function paste(node: FileNode | null): Promise<void> {
    if (!clipboard) return
    const targetDir = targetDirectoryFor(node)
    if (!targetDir) return
    await window.photoDesk.pasteItems({ ...clipboard, targetDir })
    if (clipboard.operation === 'cut') setClipboard(null)
  }

  async function moveTo(node: FileNode | null): Promise<void> {
    const selectedPaths = requireMutablePaths(node)
    if (!selectedPaths.length) return
    const targetDir = await window.photoDesk.selectMoveDestination()
    if (!targetDir) return
    await window.photoDesk.moveItemsTo({ paths: selectedPaths, targetDir })
  }

  async function deleteItems(node: FileNode | null): Promise<void> {
    const selectedPaths = requireMutablePaths(node)
    if (!selectedPaths.length) return
    const confirmed = await window.photoDesk.confirmDelete(selectedPaths)
    if (!confirmed) return
    await window.photoDesk.deleteItems(selectedPaths)
    detailsRequestRef.current += 1
    setSelectedPath(null)
    setSelectedPaths(new Set())
    setSelectionAnchorPath(null)
    setDetails(null)
    setThumbnail(null)
  }

  async function reveal(node: FileNode | null): Promise<void> {
    const selectedPaths = pathsFor(node)
    if (!selectedPaths.length) return
    await window.photoDesk.revealInExplorer(selectedPaths[0])
  }

  async function updateMetadataForSelection(
    node: FileNode | null,
    category: BulkMetadataCategory,
    changes: BulkMetadataChangeSet
  ): Promise<void> {
    if (!rootPath) return
    const addValues = uniqueList(changes.addValues)
    const addValueKeys = new Set(addValues.map((value) => normalizeForSearch(value)))
    const removeValues = uniqueList(changes.removeValues).filter((value) => !addValueKeys.has(normalizeForSearch(value)))
    const mediaPaths = mediaPathsFor(node)
    if ((!addValues.length && !removeValues.length) || !mediaPaths.length) return

    const confirmed = await window.photoDesk.confirmBulkMetadataUpdate({
      category,
      addValues,
      removeValues,
      count: mediaPaths.length
    })
    if (!confirmed) return

    const result = await window.photoDesk.bulkUpdateMetadata({
      rootPath,
      paths: mediaPaths,
      category,
      addValues,
      removeValues
    })
    setContextMenu(null)
    setStatus(`Metadonnees mises a jour sur ${result.updatedCount} element(s)`)
    if (selectedPath) {
      try {
        const [nextDetails, nextThumbnail] = await Promise.all([
          window.photoDesk.getItemDetails(selectedPath),
          window.photoDesk.getThumbnail(selectedPath)
        ])
        setDetails(nextDetails)
        setThumbnail(nextThumbnail)
      } catch {
        setDetails(null)
        setThumbnail(null)
      }
    }
  }

  function promptNewFolder(node: FileNode | null): void {
    const targetDir = targetDirectoryFor(node)
    if (!targetDir) return
    setPrompt({
      title: 'Nouveau dossier',
      label: 'Nom',
      value: 'Nouveau dossier',
      confirmLabel: 'Creer',
      onConfirm: async (value) => {
        await window.photoDesk.createFolder({ targetDir, name: value })
      }
    })
  }

  function promptRename(node: FileNode | null): void {
    const target = node ?? selectedNode
    if (!target) return
    if (target.path === rootPath) {
      setError("Le dossier de reference lui-meme ne peut pas etre renomme.")
      return
    }
    setPrompt({
      title: 'Renommer',
      label: 'Nom',
      value: target.name,
      confirmLabel: 'Renommer',
      onConfirm: async (value) => {
        const nextPath = await window.photoDesk.renameItem({ filePath: target.path, name: value })
        setSelectedPath(nextPath)
        setSelectedPaths(new Set([nextPath]))
        setSelectionAnchorPath(nextPath)
      }
    })
  }

  async function runAction(action: () => Promise<void>): Promise<void> {
    setContextMenu(null)
    setError(null)
    try {
      await action()
      setStatus('Action terminee')
    } catch (actionError) {
      setError(messageFromError(actionError))
    }
  }

  useEffect(() => {
    function closeMenu(): void {
      setContextMenu(null)
    }
    window.addEventListener('click', closeMenu)
    return () => window.removeEventListener('click', closeMenu)
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (isTypingTarget(event.target)) return

      const key = event.key.toLowerCase()
      if (event.ctrlKey && key === 'c') {
        event.preventDefault()
        void runAction(() => copy(null))
      } else if (event.ctrlKey && key === 'x') {
        event.preventDefault()
        void runAction(() => cut(null))
      } else if (event.ctrlKey && key === 'v') {
        event.preventDefault()
        void runAction(() => paste(selectedNode))
      } else if (event.key === 'Delete') {
        event.preventDefault()
        void runAction(() => deleteItems(null))
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        selectNodeFromKeyboard(1, event.shiftKey)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        selectNodeFromKeyboard(-1, event.shiftKey)
      } else if (event.key === 'F2') {
        event.preventDefault()
        promptRename(selectedNode)
      } else if (event.key === 'Enter' && selectedNode) {
        event.preventDefault()
        void openNode(selectedNode)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedNode, selectedPath, selectedPaths, selectionAnchorPath, visibleNodes, clipboard, rootPath, refreshTree])

  useEffect(() => {
    const splitElement = splitRef.current
    if (!splitElement) return

    let dragging = false
    const onPointerDown = (event: PointerEvent): void => {
      dragging = true
      splitElement.setPointerCapture(event.pointerId)
      document.body.classList.add('is-resizing')
    }
    const onPointerMove = (event: PointerEvent): void => {
      if (!dragging) return
      const nextWidth = Math.max(420, Math.min(window.innerWidth - 360, event.clientX))
      setExplorerWidth(nextWidth)
    }
    const onPointerUp = (event: PointerEvent): void => {
      dragging = false
      splitElement.releasePointerCapture(event.pointerId)
      document.body.classList.remove('is-resizing')
    }

    splitElement.addEventListener('pointerdown', onPointerDown)
    splitElement.addEventListener('pointermove', onPointerMove)
    splitElement.addEventListener('pointerup', onPointerUp)
    return () => {
      splitElement.removeEventListener('pointerdown', onPointerDown)
      splitElement.removeEventListener('pointermove', onPointerMove)
      splitElement.removeEventListener('pointerup', onPointerUp)
      document.body.classList.remove('is-resizing')
    }
  }, [])

  const contextMediaNodes = contextMenu ? mediaNodesFor(contextMenu.node) : []
  const contextTargetNode = contextMenu?.node ?? selectedNode
  const contextPaths = contextMenu ? pathsFor(contextMenu.node) : []
  const contextSelectionMutable = Boolean(
    contextPaths.length && (!rootPath || contextPaths.every((filePath) => filePath !== rootPath))
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Image size={19} />
          </div>
          <div>
            <h1>Photo Desk</h1>
            <span>{rootPath ?? 'Aucun dossier ouvert'}</span>
          </div>
        </div>
        <div className="toolbar">
          <IconButton title="Choisir un dossier" onClick={chooseFolder}>
            <FolderOpen size={18} />
            <span>Ouvrir</span>
          </IconButton>
          <IconButton title="Actualiser" onClick={() => void refreshTree()} disabled={!rootPath || isScanning}>
            <RefreshCw size={18} className={isScanning ? 'spin' : ''} />
          </IconButton>
          <IconButton title="Gerer les tags, personnes et lieux" onClick={() => setMetadataManagerOpen(true)} disabled={!rootPath}>
            <Tag size={18} />
            <span>Referentiels</span>
          </IconButton>
          <IconButton title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'} onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </IconButton>
          <label className="density-control" title="Taille des lignes">
            <Maximize2 size={16} />
            <input
              type="range"
              min="28"
              max="52"
              value={rowHeight}
              onChange={(event) => setRowHeight(Number(event.target.value))}
            />
          </label>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <main className="workspace">
        <section className="explorer-pane" style={{ width: explorerWidth }}>
          <div className="explorer-header">
            <div className="path-chip">
              <Search size={15} />
              <span>{tree ? tree.name : 'Bibliotheque'}</span>
            </div>
            <span className="muted">
              {visibleNodes.length} elements{activeFilterCount ? `, ${activeFilterCount} filtre(s)` : ''}
            </span>
          </div>

          {tree ? (
            <FilterBar
              filters={filters}
              suggestions={metadataSuggestions}
              onChange={setFilters}
              onReset={() => setFilters(defaultFilters)}
            />
          ) : null}

          <div className="file-grid" style={{ ['--row-height' as string]: `${rowHeight}px` }}>
            <div className="file-grid-head">
              <SortHeaderButton field="name" label="Nom" sort={sort} onClick={changeSort} />
              <SortHeaderButton field="modifiedAt" label="Modification" sort={sort} onClick={changeSort} />
              <SortHeaderButton field="kind" label="Type" sort={sort} onClick={changeSort} />
              <SortHeaderButton field="size" label="Taille" sort={sort} onClick={changeSort} />
            </div>
            <div
              className={`file-grid-body ${viewMode === 'mosaic' ? 'mosaic-body' : ''}`}
              onContextMenu={(event) => openContextMenu(event, null)}
            >
              {visibleNodes.length ? (
                viewMode === 'tree' ? (
                  visibleNodes.map(({ node, depth }) => (
                    <ExplorerRow
                      key={node.path}
                      node={node}
                      depth={depth}
                      expanded={expanded.has(node.path)}
                      selected={selectedPaths.has(node.path)}
                      clipboardMode={clipboard?.paths.includes(node.path) ? clipboard.operation : null}
                      onSelect={(event) => selectNode(node, event)}
                      onOpen={() => void openNode(node)}
                      onToggle={() => toggleFolder(node)}
                      onContextMenu={(event) => openContextMenu(event, node)}
                    />
                  ))
                ) : (
                  <div className="mosaic-grid">
                    {visibleNodes.map(({ node }) => (
                      <ExplorerTile
                        key={node.path}
                        node={node}
                        expanded={expanded.has(node.path)}
                        selected={selectedPaths.has(node.path)}
                        clipboardMode={clipboard?.paths.includes(node.path) ? clipboard.operation : null}
                        onSelect={(event) => selectNode(node, event)}
                        onOpen={() => void openNode(node)}
                        onToggle={() => toggleFolder(node)}
                        onContextMenu={(event) => openContextMenu(event, node)}
                      />
                    ))}
                  </div>
                )
              ) : (
                <div className="empty-state">
                  <FolderOpen size={42} />
                  <p>Choisis un dossier pour commencer.</p>
                  <button className="primary-action" onClick={chooseFolder}>
                    <FolderOpen size={18} />
                    Ouvrir un dossier
                  </button>
                </div>
              )}
            </div>
          </div>

          <button
            className="view-toggle-button"
            type="button"
            title={viewMode === 'tree' ? 'Passer en mosaique' : "Revenir a l'arborescence"}
            onClick={() => setViewMode((current) => (current === 'tree' ? 'mosaic' : 'tree'))}
          >
            {viewMode === 'tree' ? 'Mosaique' : 'Liste'}
          </button>

          <footer className="statusbar">
            <span>{status}</span>
            <span className="statusbar-meta">
              {selectedNodes.length ? <span>{selectedNodes.length} selectionne(s)</span> : null}
              {clipboard ? (
                <span>
                  {clipboard.operation === 'copy' ? 'Copie' : 'Coupe'}: {clipboard.paths.length}
                </span>
              ) : null}
            </span>
          </footer>
        </section>

        <div ref={splitRef} className="splitter" title="Redimensionner" />

        <PreviewPanel
          details={details}
          thumbnail={thumbnail}
          onOpen={() => selectedNode && void openNode(selectedNode)}
          onReveal={() => void reveal(selectedNode)}
        />
      </main>

      {contextMenu ? (
        <ContextMenu x={contextMenu.x} y={contextMenu.y}>
          <MenuButton
            icon={<Eye size={16} />}
            label="Ouvrir"
            disabled={!contextTargetNode}
            onClick={() => (contextTargetNode ? runAction(() => openNode(contextTargetNode)) : undefined)}
          />
          <MenuButton
            icon={<Copy size={16} />}
            label="Copier"
            disabled={!contextSelectionMutable}
            onClick={() => runAction(() => copy(contextMenu.node))}
          />
          <MenuButton
            icon={<Scissors size={16} />}
            label="Couper"
            disabled={!contextSelectionMutable}
            onClick={() => runAction(() => cut(contextMenu.node))}
          />
          <MenuButton
            icon={<Clipboard size={16} />}
            label="Coller"
            disabled={!clipboard}
            onClick={() => runAction(() => paste(contextMenu.node))}
          />
          <BulkMetadataMenuItem
            disabled={!contextMediaNodes.length}
            suggestions={metadataSuggestions}
            nodes={contextMediaNodes}
            onApply={async (category, changes) => {
              setError(null)
              try {
                await updateMetadataForSelection(contextMenu.node, category, changes)
              } catch (bulkAddError) {
                setError(messageFromError(bulkAddError))
                throw bulkAddError
              }
            }}
          />
          <MenuDivider />
          <MenuButton
            icon={<Move size={16} />}
            label="Deplacer vers..."
            disabled={!contextSelectionMutable}
            onClick={() => runAction(() => moveTo(contextMenu.node))}
          />
          <MenuButton
            icon={<Edit3 size={16} />}
            label="Renommer"
            disabled={!contextSelectionMutable || contextPaths.length !== 1}
            onClick={() => promptRename(contextMenu.node)}
          />
          <MenuButton
            icon={<Trash2 size={16} />}
            label="Supprimer"
            disabled={!contextSelectionMutable}
            onClick={() => runAction(() => deleteItems(contextMenu.node))}
          />
          <MenuDivider />
          <MenuButton icon={<FolderPlus size={16} />} label="Nouveau dossier" onClick={() => promptNewFolder(contextMenu.node)} />
          <MenuButton icon={<ExternalLink size={16} />} label="Afficher dans l'explorateur" onClick={() => runAction(() => reveal(contextMenu.node))} />
        </ContextMenu>
      ) : null}

      {prompt ? <InputDialog prompt={prompt} onClose={() => setPrompt(null)} setError={setError} /> : null}
      {metadataManagerOpen && rootPath ? (
        <MetadataManagerDialog
          rootPath={rootPath}
          onClose={() => setMetadataManagerOpen(false)}
          onChanged={handleMetadataManagerChanged}
          setError={setError}
        />
      ) : null}
    </div>
  )
}

function ViewerApp(): ReactElement {
  const [viewerState, setViewerState] = useState<ViewerState | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [details, setDetails] = useState<MediaDetails | null>(null)
  const [form, setForm] = useState<EditForm | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const [history, setHistory] = useState<EditForm[]>([])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('Pret')
  const [mediaVersion, setMediaVersion] = useState(0)
  const [metadataSuggestions, setMetadataSuggestions] = useState<MetadataSuggestions>(emptySuggestions)
  const [loading, setLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const savePromiseRef = useRef<Promise<boolean> | null>(null)
  const closeFlowRef = useRef(false)
  const fileRequestRef = useRef(0)

  const dirty = Boolean(form && savedSnapshot && snapshotForm(form) !== savedSnapshot)

  const loadFile = useCallback(async (filePath: string) => {
    const requestId = ++fileRequestRef.current
    setLoading(true)
    setError(null)
    try {
      const nextDetails = await window.photoDesk.getItemDetails(filePath)
      if (requestId !== fileRequestRef.current) return
      const nextForm = formFromDetails(nextDetails)
      setDetails(nextDetails)
      setForm(nextForm)
      setSavedSnapshot(snapshotForm(nextForm))
      setHistory([nextForm])
      setHistoryIndex(0)
      setStatus('Fichier charge')
    } catch (loadError) {
      if (requestId !== fileRequestRef.current) return
      setDetails(null)
      setForm(null)
      setError(messageFromError(loadError))
    } finally {
      if (requestId === fileRequestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void window.photoDesk.getViewerState().then((state) => {
      if (!state) {
        setError('Aucun fichier a afficher.')
        setLoading(false)
        return
      }

      const nextIndex = Math.max(0, state.files.findIndex((filePath) => filePath === state.currentPath))
      setViewerState(state)
      setFiles(state.files)
      setIndex(nextIndex)
      setCurrentPath(state.currentPath)
      void window.photoDesk.getMetadataSuggestions(state.rootPath).then(setMetadataSuggestions).catch(() => setMetadataSuggestions(emptySuggestions))
      void loadFile(state.currentPath)
    })
  }, [loadFile])

  const save = useCallback(async (): Promise<boolean> => {
    if (savePromiseRef.current) return savePromiseRef.current
    if (!viewerState || !currentPath || !form) return true

    const savePromise = (async (): Promise<boolean> => {
      setError(null)
      setIsSaving(true)
      const payload: SaveEditsPayload = {
        rootPath: viewerState.rootPath,
        originalPath: currentPath,
        fileName: form.fileName,
        createdAt: fromDateTimeLocal(form.createdAt),
        modifiedAt: fromDateTimeLocal(form.modifiedAt),
        metadata: metadataFromForm(form),
        rotationDegrees: form.rotation
      }

      const result = await window.photoDesk.saveMediaEdits(payload)
      setCurrentPath(result.path)
      setFiles((previous) => previous.map((filePath) => (filePath === currentPath ? result.path : filePath)))
      const nextForm = formFromDetails(result.details)
      setDetails(result.details)
      setForm(nextForm)
      setSavedSnapshot(snapshotForm(nextForm))
      setHistory([nextForm])
      setHistoryIndex(0)
      setMediaVersion((value) => value + 1)
      setMetadataSuggestions(await window.photoDesk.getMetadataSuggestions(viewerState.rootPath))
      setStatus('Modifications enregistrees')
      return true
    })()

    savePromiseRef.current = savePromise
    try {
      return await savePromise
    } catch (saveError) {
      setError(messageFromError(saveError))
      return false
    } finally {
      savePromiseRef.current = null
      setIsSaving(false)
    }
  }, [viewerState, currentPath, form])

  const guardUnsaved = useCallback(async (): Promise<boolean> => {
    try {
      if (!dirty) return true
      const choice = await window.photoDesk.confirmSave()
      if (choice === 'cancel') return false
      if (choice === 'save') return save()
      return true
    } catch (guardError) {
      setError(messageFromError(guardError))
      return false
    }
  }, [dirty, save])

  const requestClose = useCallback(async (): Promise<void> => {
    if (closeFlowRef.current) return
    closeFlowRef.current = true
    try {
      const canClose = await guardUnsaved()
      if (canClose) {
        await window.photoDesk.closeViewer(currentPath ?? undefined)
      } else {
        await window.photoDesk.cancelViewerClose()
      }
    } catch (closeError) {
      setError(messageFromError(closeError))
      await window.photoDesk.cancelViewerClose()
    } finally {
      closeFlowRef.current = false
    }
  }, [guardUnsaved, currentPath])

  async function go(delta: number): Promise<void> {
    if (!files.length) return
    if (!(await guardUnsaved())) return
    const nextIndex = (index + delta + files.length) % files.length
    setIndex(nextIndex)
    setCurrentPath(files[nextIndex])
    await loadFile(files[nextIndex])
  }

  function updateForm(next: EditForm): void {
    setForm(next)
    const nextHistory = history.slice(0, historyIndex + 1).concat(next)
    setHistory(nextHistory)
    setHistoryIndex(nextHistory.length - 1)
  }

  function updateField<K extends keyof EditForm>(field: K, value: EditForm[K]): void {
    if (!form) return
    updateForm({ ...form, [field]: value })
  }

  function undo(): void {
    if (historyIndex <= 0) return
    const nextIndex = historyIndex - 1
    setHistoryIndex(nextIndex)
    setForm(history[nextIndex])
  }

  function redo(): void {
    if (historyIndex >= history.length - 1) return
    const nextIndex = historyIndex + 1
    setHistoryIndex(nextIndex)
    setForm(history[nextIndex])
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const key = event.key.toLowerCase()
      if (event.ctrlKey && key === 's') {
        event.preventDefault()
        void save()
      } else if (event.ctrlKey && event.shiftKey && key === 'z') {
        event.preventDefault()
        redo()
      } else if (event.ctrlKey && key === 'z') {
        event.preventDefault()
        undo()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save, history, historyIndex])

  useEffect(() => {
    return window.photoDesk.onViewerAttemptClose(() => {
      void requestClose()
    })
  }, [requestClose])

  const mediaUrl = details?.mediaUrl ? withVersion(details.mediaUrl, mediaVersion) : null

  return (
    <div className="viewer-shell">
      <header className="viewer-topbar">
        <div className="viewer-nav">
          <IconButton title="Precedent" onClick={() => void go(-1)} disabled={loading || files.length < 2}>
            <ArrowLeft size={18} />
          </IconButton>
          <span className="viewer-count">
            {files.length ? index + 1 : 0} / {files.length}
          </span>
          <IconButton title="Suivant" onClick={() => void go(1)} disabled={loading || files.length < 2}>
            <ArrowRight size={18} />
          </IconButton>
        </div>
        <div className="viewer-title">
          <strong>{details?.name ?? 'Visionneuse'}</strong>
          <span>{dirty ? 'Modifie' : status}</span>
        </div>
        <div className="viewer-actions">
          <IconButton title="Annuler" onClick={undo} disabled={historyIndex <= 0}>
            <RotateCcw size={18} />
          </IconButton>
          <IconButton title="Retablir" onClick={redo} disabled={historyIndex >= history.length - 1}>
            <RotateCw size={18} />
          </IconButton>
          <IconButton title="Enregistrer" onClick={() => void save()} disabled={!dirty || isSaving}>
            <Save size={18} />
            <span>{isSaving ? 'Enregistrement' : 'Enregistrer'}</span>
          </IconButton>
          <IconButton
            title="Fermer"
            onClick={() => void requestClose()}
          >
            <X size={18} />
          </IconButton>
        </div>
      </header>

      {error ? <div className="error-banner viewer-error">{error}</div> : null}

      <main className="viewer-content">
        <section className="media-stage">
          {loading ? (
            <div className="loading">Chargement</div>
          ) : details?.kind === 'image' && mediaUrl ? (
            <img className="stage-media" src={mediaUrl} style={{ transform: `rotate(${form?.rotation ?? 0}deg)` }} />
          ) : details?.kind === 'video' && mediaUrl ? (
            <video className="stage-media" src={mediaUrl} controls />
          ) : (
            <div className="loading">Aucun apercu</div>
          )}
        </section>

        <aside className="editor-panel">
          {form && details ? (
            <>
              <div className="editor-actions-row">
                <IconButton
                  title="Rotation gauche"
                  onClick={() => updateField('rotation', normalizeRotation(form.rotation - 90))}
                  disabled={!details.canRotate}
                >
                  <RotateCcw size={18} />
                </IconButton>
                <IconButton
                  title="Rotation droite"
                  onClick={() => updateField('rotation', normalizeRotation(form.rotation + 90))}
                  disabled={!details.canRotate}
                >
                  <RotateCw size={18} />
                </IconButton>
                <span className="muted">{details.canRotate ? `${form.rotation} deg` : 'Rotation image non disponible'}</span>
              </div>

              <EditorSection title="Fichier">
                <TextField label="Nom" value={form.fileName} onChange={(value) => updateField('fileName', value)} />
                <TextField
                  label="Creation"
                  type="datetime-local"
                  value={form.createdAt}
                  onChange={(value) => updateField('createdAt', value)}
                />
                <TextField
                  label="Modification"
                  type="datetime-local"
                  value={form.modifiedAt}
                  onChange={(value) => updateField('modifiedAt', value)}
                />
              </EditorSection>

              <EditorSection title="Classement">
                <TextField label="Titre" value={form.title} onChange={(value) => updateField('title', value)} />
                <TextArea label="Description" value={form.description} onChange={(value) => updateField('description', value)} />
                <TokenListField
                  label="Tags"
                  value={form.tagsText}
                  suggestions={metadataSuggestions.tags}
                  icon={<Tag size={15} />}
                  placeholder="tag1; tag2;"
                  onChange={(value) => updateField('tagsText', value)}
                />
                <TokenListField
                  label="Personnes"
                  value={form.peopleText}
                  suggestions={metadataSuggestions.people}
                  icon={<Users size={15} />}
                  placeholder="prenom; groupe;"
                  onChange={(value) => updateField('peopleText', value)}
                />
                <div className="field-row rating-field">
                  <span>Note</span>
                  <StarRating
                    value={form.rating}
                    label="Note"
                    onChange={(value) => updateField('rating', value)}
                  />
                  <strong>{form.rating ? `${form.rating}/5` : 'Aucune note'}</strong>
                </div>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={form.favorite}
                    onChange={(event) => updateField('favorite', event.target.checked)}
                  />
                  <Heart size={16} />
                  Favori
                </label>
                <label className="field-row">
                  <span>Statut</span>
                  <select value={form.status} onChange={(event) => updateField('status', event.target.value)}>
                    <option value="">Aucun</option>
                    {mergeSuggestions(statusOptions, metadataSuggestions.statuses).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </EditorSection>

              <EditorSection title="Lieu et date">
                <TextField
                  label="Prise de vue"
                  type="datetime-local"
                  value={form.dateTaken}
                  onChange={(value) => updateField('dateTaken', value)}
                />
                <TokenListField
                  label="Lieu"
                  value={form.locationName}
                  suggestions={metadataSuggestions.locations}
                  icon={<MapPin size={15} />}
                  placeholder="ville; pays; evenement;"
                  onChange={(value) => updateField('locationName', value)}
                />
                <TextField label="Latitude" value={form.latitude} onChange={(value) => updateField('latitude', value)} />
                <TextField label="Longitude" value={form.longitude} onChange={(value) => updateField('longitude', value)} />
                <TextArea label="Notes" value={form.notes} onChange={(value) => updateField('notes', value)} />
              </EditorSection>
            </>
          ) : (
            <div className="loading">Selection vide</div>
          )}
        </aside>
      </main>
    </div>
  )
}

function SortHeaderButton({
  field,
  label,
  sort,
  onClick
}: {
  field: SortField
  label: string
  sort: SortState
  onClick: (field: SortField) => void
}): ReactElement {
  const active = sort.field === field
  const direction = active ? (sort.direction === 'asc' ? 'Asc' : 'Desc') : ''

  return (
    <button
      className={`sort-header-button ${active ? 'active' : ''}`}
      type="button"
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => onClick(field)}
    >
      <span>{label}</span>
      <small>{direction}</small>
    </button>
  )
}

function ExplorerRow(props: {
  node: FileNode
  depth: number
  expanded: boolean
  selected: boolean
  clipboardMode: 'copy' | 'cut' | null
  onSelect: (event: MouseEvent) => void
  onOpen: () => void
  onToggle: () => void
  onContextMenu: (event: MouseEvent) => void
}): ReactElement {
  const { node, depth, expanded, selected, clipboardMode, onSelect, onOpen, onToggle, onContextMenu } = props
  const hasChildren = node.kind === 'folder' && Boolean(node.children?.length)

  return (
    <div
      className={`file-row ${selected ? 'selected' : ''} ${clipboardMode === 'cut' ? 'cut' : ''}`}
      data-node-path={node.path}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
    >
      <div className="file-name-cell" style={{ paddingLeft: `${depth * 18 + 8}px` }}>
        <button
          className="tree-toggle"
          onClick={(event) => {
            event.stopPropagation()
            if (node.kind === 'folder') onToggle()
          }}
          disabled={!hasChildren}
          title={expanded ? 'Replier' : 'Deplier'}
        >
          {node.kind === 'folder' && hasChildren ? expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : null}
        </button>
        <KindIcon kind={node.kind} expanded={expanded} />
        <span className="file-name" title={node.path}>
          {node.name}
        </span>
      </div>
      <span>{formatDateShort(node.modifiedAt)}</span>
      <span>{kindLabel(node.kind, node.extension)}</span>
      <span>{formatBytes(node.size)}</span>
    </div>
  )
}

function ExplorerTile(props: {
  node: FileNode
  expanded: boolean
  selected: boolean
  clipboardMode: 'copy' | 'cut' | null
  onSelect: (event: MouseEvent) => void
  onOpen: () => void
  onToggle: () => void
  onContextMenu: (event: MouseEvent) => void
}): ReactElement {
  const { node, expanded, selected, clipboardMode, onSelect, onOpen, onToggle, onContextMenu } = props
  const hasChildren = node.kind === 'folder' && Boolean(node.children?.length)
  const shouldLoadThumbnail = node.kind !== 'folder'
  const { ref, thumbnail } = useLazyThumbnail(node.path, node.modifiedAt, shouldLoadThumbnail)

  return (
    <div
      ref={ref}
      className={`mosaic-tile ${selected ? 'selected' : ''} ${clipboardMode === 'cut' ? 'cut' : ''}`}
      data-node-path={node.path}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
    >
      <div className="mosaic-preview">
        {thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : <KindIcon kind={node.kind} expanded={expanded} />}
        {hasChildren ? (
          <button
            className="mosaic-folder-toggle"
            type="button"
            title={expanded ? 'Replier' : 'Deplier'}
            onClick={(event) => {
              event.stopPropagation()
              onToggle()
            }}
          >
            {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        ) : null}
      </div>
      <div className="mosaic-meta">
        <strong title={node.path}>{node.name}</strong>
        <span>{kindLabel(node.kind, node.extension)}</span>
        <small>
          {formatBytes(node.size)} - {formatDateShort(node.modifiedAt)}
        </small>
      </div>
    </div>
  )
}

function useLazyThumbnail(
  filePath: string,
  thumbnailKey: string,
  enabled: boolean
): { ref: MutableRefObject<HTMLDivElement | null>; thumbnail: string | null } {
  const ref = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(!enabled)
  const [thumbnail, setThumbnail] = useState<string | null>(null)

  useEffect(() => {
    setThumbnail(null)
    setVisible(!enabled)
  }, [enabled, filePath, thumbnailKey])

  useEffect(() => {
    if (!enabled || visible) return
    const element = ref.current
    if (!element || !('IntersectionObserver' in window)) {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { root: element.closest('.file-grid-body'), rootMargin: '220px' }
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [enabled, visible, filePath, thumbnailKey])

  useEffect(() => {
    if (!enabled || !visible) return
    let cancelled = false
    void window.photoDesk
      .getThumbnail(filePath)
      .then((result) => {
        if (!cancelled) setThumbnail(result)
      })
      .catch(() => {
        if (!cancelled) setThumbnail(null)
      })

    return () => {
      cancelled = true
    }
  }, [enabled, visible, filePath, thumbnailKey])

  return { ref, thumbnail }
}

function BulkMetadataMenuItem({
  disabled,
  suggestions,
  nodes,
  onApply
}: {
  disabled: boolean
  suggestions: MetadataSuggestions
  nodes: FileNode[]
  onApply: (category: BulkMetadataCategory, changes: BulkMetadataChangeSet) => Promise<void> | void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<BulkMetadataCategory>('tags')
  const [checkedByCategory, setCheckedByCategory] = useState<BulkMetadataCategoryValues>(createEmptyBulkCategoryValues())
  const [touchedByCategory, setTouchedByCategory] = useState<BulkMetadataCategoryValues>(createEmptyBulkCategoryValues())
  const [draftValue, setDraftValue] = useState('')
  const [busy, setBusy] = useState(false)

  const valueCountsByCategory = useMemo(() => buildBulkMetadataValueCounts(nodes), [nodes])
  const initialCheckedByCategory = useMemo(() => {
    const nextValues = createEmptyBulkCategoryValues()
    for (const item of bulkMetadataCategories) {
      nextValues[item] = valueCountsByCategory[item].map(({ value }) => value)
    }
    return nextValues
  }, [valueCountsByCategory])
  const selectionSignature = useMemo(() => JSON.stringify(valueCountsByCategory), [valueCountsByCategory])

  useEffect(() => {
    setCheckedByCategory(initialCheckedByCategory)
    setTouchedByCategory(createEmptyBulkCategoryValues())
    setDraftValue('')
  }, [initialCheckedByCategory, selectionSignature])

  const config = bulkCategoryConfigs[category]
  const checkedValues = checkedByCategory[category]
  const touchedValues = touchedByCategory[category]
  const valueCounts = valueCountsByCategory[category]
  const countByValue = useMemo(() => {
    const counts = new Map<string, BulkMetadataValueCount>()
    for (const item of valueCounts) counts.set(normalizeForSearch(item.value), item)
    return counts
  }, [valueCounts])
  const values = useMemo(() => {
    const baseValues = mergeSuggestions(suggestions[category], valueCounts.map(({ value }) => value), checkedValues)
    const search = normalizeForSearch(draftValue)
    if (!search) return baseValues
    return baseValues.filter((value) => normalizeForSearch(value).includes(search))
  }, [category, checkedValues, draftValue, suggestions, valueCounts])
  const changes = useMemo(
    () => getBulkMetadataChanges(checkedValues, touchedValues, valueCounts, nodes.length),
    [checkedValues, nodes.length, touchedValues, valueCounts]
  )
  const canApply = (changes.addValues.length > 0 || changes.removeValues.length > 0) && !busy && !disabled

  function activateCategory(nextCategory: BulkMetadataCategory): void {
    setCategory(nextCategory)
    setDraftValue('')
  }

  function toggleValue(value: string): void {
    setCheckedByCategory((previous) => ({
      ...previous,
      [category]: toggleBulkValue(previous[category], value)
    }))
    setTouchedByCategory((previous) => ({
      ...previous,
      [category]: uniqueList([...previous[category], value])
    }))
  }

  function addDraftValues(rawValues: string[]): void {
    const nextValues = uniqueList(rawValues)
    if (!nextValues.length) return
    setCheckedByCategory((previous) => ({
      ...previous,
      [category]: uniqueList([...previous[category], ...nextValues])
    }))
    setTouchedByCategory((previous) => ({
      ...previous,
      [category]: uniqueList([...previous[category], ...nextValues])
    }))
  }

  function onDraftChange(value: string): void {
    if (value.includes(';')) {
      const parts = value.split(';')
      addDraftValues(parts.slice(0, -1))
      setDraftValue(parts[parts.length - 1].trimStart())
      return
    }

    setDraftValue(value)
  }

  function onDraftKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      addDraftValues([draftValue])
      setDraftValue('')
    }
  }

  async function apply(): Promise<void> {
    if (!canApply) return
    setBusy(true)
    try {
      await onApply(category, changes)
      setTouchedByCategory(createEmptyBulkCategoryValues())
      setDraftValue('')
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="context-submenu-host" onMouseEnter={() => !disabled && setOpen(true)}>
      <button
        className="context-item context-item-submenu"
        disabled={disabled}
        title={disabled ? 'Selectionne au moins une photo ou video' : 'Ajouter des metadonnees a la selection'}
        onClick={() => !disabled && setOpen((previous) => !previous)}
      >
        <Plus size={16} />
        <span>Ajouter</span>
        <ChevronRight size={15} className="submenu-arrow" />
      </button>
      {open && !disabled ? (
        <div className="context-submenu bulk-add-menu">
          <div className="bulk-add-category-menu">
            {(Object.keys(bulkCategoryConfigs) as BulkMetadataCategory[]).map((item) => (
              <button
                key={item}
                type="button"
                className={`context-item bulk-category-item ${category === item ? 'selected' : ''}`}
                onMouseEnter={() => activateCategory(item)}
                onClick={() => activateCategory(item)}
              >
                {bulkCategoryConfigs[item].icon}
                <span>{bulkCategoryConfigs[item].label}</span>
                <ChevronRight size={15} className="submenu-arrow" />
              </button>
            ))}
          </div>

          <div className="bulk-values-submenu">
            <div className="bulk-values-header">
              <strong>{config.label}</strong>
              <span>{nodes.length} element(s)</span>
            </div>

            <div className="bulk-value-input">
              {config.icon}
              <input
                value={draftValue}
                placeholder={`${config.singular};`}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={onDraftKeyDown}
              />
            </div>

            <div className="bulk-values-list">
              {values.length ? (
                values.map((value) => {
                  const count = countByValue.get(normalizeForSearch(value))?.count ?? 0
                  const checked = checkedValues.some((item) => valueMatches(item, value))
                  const touched = touchedValues.some((item) => valueMatches(item, value))
                  const partial = checked && !touched && count > 0 && count < nodes.length
                  return (
                    <label key={value} className={`bulk-value-option ${checked ? 'selected' : ''} ${partial ? 'partial' : ''}`}>
                      <BulkValueCheckbox checked={checked} indeterminate={partial} onChange={() => toggleValue(value)} />
                      <span>{value}</span>
                      {count > 0 ? <em>{count === nodes.length ? 'present' : `${count}/${nodes.length}`}</em> : null}
                    </label>
                  )
                })
              ) : (
                <div className="bulk-values-empty">{config.empty}</div>
              )}
            </div>

            {checkedValues.length ? (
              <div className="bulk-selected-values">
                {checkedValues.map((value) => (
                  <button key={value} type="button" onClick={() => toggleValue(value)}>
                    {value}
                    <X size={12} />
                  </button>
                ))}
              </div>
            ) : null}

            <button className="bulk-apply-button" type="button" disabled={!canApply} onClick={() => void apply()}>
              <Check size={15} />
              Appliquer les modifications
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function BulkValueCheckbox({
  checked,
  indeterminate,
  onChange
}: {
  checked: boolean
  indeterminate: boolean
  onChange: () => void
}): ReactElement {
  const ref = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate
    }
  }, [indeterminate])

  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} />
}

function PreviewPanel(props: {
  details: MediaDetails | null
  thumbnail: string | null
  onOpen: () => void
  onReveal: () => void
}): ReactElement {
  const { details, thumbnail, onOpen, onReveal } = props

  if (!details) {
    return (
      <aside className="preview-pane">
        <div className="preview-empty">
          <Image size={48} />
          <p>Aucun element selectionne</p>
        </div>
      </aside>
    )
  }

  const custom = details.customMetadata
  const exif = details.media.exif
  const latitude = custom.latitude ?? exif?.latitude
  const longitude = custom.longitude ?? exif?.longitude
  const locations = getMetadataLocations(custom)

  return (
    <aside className="preview-pane">
      <div className="preview-hero">
        {details.kind === 'image' && details.mediaUrl ? (
          <img src={details.mediaUrl} />
        ) : details.kind === 'video' && details.mediaUrl ? (
          <video src={details.mediaUrl} controls />
        ) : thumbnail ? (
          <img src={thumbnail} />
        ) : (
          <KindIcon kind={details.kind} expanded />
        )}
      </div>

      <div className="preview-title-row">
        <div>
          <h2>{details.name}</h2>
          <span>{details.path}</span>
        </div>
      </div>

      <div className="preview-actions">
        <IconButton title="Ouvrir" onClick={onOpen} disabled={details.kind !== 'image' && details.kind !== 'video'}>
          <Eye size={17} />
          <span>Ouvrir</span>
        </IconButton>
        <IconButton title="Afficher dans l'explorateur" onClick={onReveal}>
          <ExternalLink size={17} />
        </IconButton>
      </div>

      <InfoSection title="Fichier">
        <InfoRow label="Type" value={kindLabel(details.kind, details.extension)} />
        <InfoRow label="Taille" value={formatBytes(details.size)} />
        <InfoRow label="Creation" value={formatDate(details.createdAt)} />
        <InfoRow label="Modification" value={formatDate(details.modifiedAt)} />
        <InfoRow label="Acces" value={formatDate(details.accessedAt)} />
      </InfoSection>

      <InfoSection title="Media">
        <InfoRow label="Dimensions" value={formatDimensions(details.media.width, details.media.height)} />
        <InfoRow label="Duree" value={formatDuration(details.media.duration)} />
        <InfoRow label="Codec" value={details.media.codec} />
        <InfoRow label="Debit" value={formatBitRate(details.media.bitRate)} />
        <InfoRow label="Appareil" value={[exif?.make, exif?.model].filter(Boolean).join(' ')} />
        <InfoRow label="Objectif" value={exif?.lensModel} />
        <InfoRow label="ISO" value={exif?.iso?.toString()} />
        <InfoRow label="Ouverture" value={exif?.fNumber ? `f/${exif.fNumber}` : undefined} />
      </InfoSection>

      <InfoSection title="Classement">
        <InfoRow label="Titre" value={custom.title} />
        <InfoRow label="Description" value={custom.description} />
        <InfoRow label="Tags" value={custom.tags?.join(', ')} />
        <InfoRow label="Personnes" value={custom.people?.join(', ')} />
        <InfoRow label="Note" value={custom.rating !== undefined ? `${custom.rating}/5` : undefined} />
        <InfoRow label="Favori" value={custom.favorite ? 'Oui' : undefined} />
        <InfoRow label="Statut" value={custom.status} />
      </InfoSection>

      <InfoSection title="Lieu">
        <InfoRow label="Date prise" value={custom.dateTaken ? formatDate(custom.dateTaken) : formatDate(exif?.dateTimeOriginal)} />
        <InfoRow label="Lieux" value={locations.join(', ')} />
        <InfoRow label="Latitude" value={latitude?.toString()} />
        <InfoRow label="Longitude" value={longitude?.toString()} />
        <InfoRow label="Notes" value={custom.notes} />
      </InfoSection>
    </aside>
  )
}

function FilterBar({
  filters,
  suggestions,
  onChange,
  onReset
}: {
  filters: FilterState
  suggestions: MetadataSuggestions
  onChange: (filters: FilterState) => void
  onReset: () => void
}): ReactElement {
  const statusSuggestions = mergeSuggestions(statusOptions, suggestions.statuses)
  const update = <K extends keyof FilterState>(field: K, value: FilterState[K]): void => {
    onChange({ ...filters, [field]: value })
  }
  const toggleEmptyFilter = (field: 'withoutTags' | 'withoutPeople' | 'withoutLocations', value: boolean): void => {
    const clearedFields: Partial<FilterState> =
      field === 'withoutTags'
        ? { tagsText: '' }
        : field === 'withoutPeople'
          ? { peopleText: '' }
          : { locationsText: '' }
    onChange({ ...filters, ...clearedFields, [field]: value })
  }

  return (
    <section className="filter-panel">
      <div className="filter-title-row">
        <div>
          <Filter size={16} />
          <span>Filtres</span>
        </div>
        <button className="text-button" onClick={onReset} disabled={countActiveFilters(filters) === 0}>
          Effacer
        </button>
      </div>

      <div className="filter-grid">
        <label className="filter-field search-filter">
          <span>Recherche</span>
          <div className="input-with-icon">
            <Search size={15} />
            <input
              value={filters.search}
              onChange={(event) => update('search', event.target.value)}
              placeholder="Nom, titre, note..."
            />
          </div>
        </label>

        <label className="filter-field">
          <span>Type</span>
          <select value={filters.kind} onChange={(event) => update('kind', event.target.value as FilterState['kind'])}>
            <option value="all">Photos et videos</option>
            <option value="image">Photos</option>
            <option value="video">Videos</option>
          </select>
        </label>

        <AutocompleteTextField
          label="Tag(s)"
          value={filters.tagsText}
          suggestions={suggestions.tags}
          icon={<Tag size={15} />}
          placeholder="voyage, famille..."
          multi
          onChange={(value) => onChange({ ...filters, tagsText: value, withoutTags: false })}
        />

        <AutocompleteTextField
          label="Lieu(x)"
          value={filters.locationsText}
          suggestions={suggestions.locations}
          icon={<MapPin size={15} />}
          placeholder="Paris, Lyon..."
          multi
          onChange={(value) => onChange({ ...filters, locationsText: value, withoutLocations: false })}
        />

        <AutocompleteTextField
          label="Personne(s)"
          value={filters.peopleText}
          suggestions={suggestions.people}
          icon={<Users size={15} />}
          placeholder="prenom, groupe..."
          multi
          onChange={(value) => onChange({ ...filters, peopleText: value, withoutPeople: false })}
        />

        <label className="filter-field">
          <span>Statut</span>
          <select value={filters.status} onChange={(event) => update('status', event.target.value)}>
            <option value="">Tous</option>
            {statusSuggestions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>

        <div className="filter-field rating-filter">
          <span>Note min.</span>
          <StarRating
            value={filters.minRating}
            label="Note minimum"
            compact
            onChange={(value) => update('minRating', value)}
          />
        </div>

        <label className="filter-check">
          <input
            type="checkbox"
            checked={filters.favoritesOnly}
            onChange={(event) => update('favoritesOnly', event.target.checked)}
          />
          <Heart size={15} />
          Favoris
        </label>

        <label className="filter-check">
          <input
            type="checkbox"
            checked={filters.withoutTags}
            onChange={(event) => toggleEmptyFilter('withoutTags', event.target.checked)}
          />
          <Tag size={15} />
          Pas de tag
        </label>

        <label className="filter-check">
          <input
            type="checkbox"
            checked={filters.withoutLocations}
            onChange={(event) => toggleEmptyFilter('withoutLocations', event.target.checked)}
          />
          <MapPin size={15} />
          Pas de lieu
        </label>

        <label className="filter-check">
          <input
            type="checkbox"
            checked={filters.withoutPeople}
            onChange={(event) => toggleEmptyFilter('withoutPeople', event.target.checked)}
          />
          <Users size={15} />
          Pas de personne
        </label>
      </div>
    </section>
  )
}

function AutocompleteTextField({
  label,
  value,
  suggestions,
  icon,
  placeholder,
  type = 'text',
  multi = false,
  className = 'filter-field',
  onChange
}: {
  label: string
  value: string
  suggestions: string[]
  icon?: ReactNode
  placeholder?: string
  type?: string
  multi?: boolean
  className?: string
  onChange: (value: string) => void
}): ReactElement {
  const [focused, setFocused] = useState(false)
  const matches = useMemo(() => getAutocompleteMatches(value, suggestions, multi), [value, suggestions, multi])

  function selectSuggestion(suggestion: string): void {
    onChange(applyAutocompleteSuggestion(value, suggestion, multi))
    setFocused(false)
  }

  return (
    <label className={`${className} autocomplete-field`}>
      <span>{label}</span>
      <div className="input-with-icon">
        {icon}
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {focused && matches.length ? (
        <div className="autocomplete-menu">
          {matches.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectSuggestion(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </label>
  )
}

function TokenListField({
  label,
  value,
  suggestions,
  icon,
  placeholder,
  onChange
}: {
  label: string
  value: string
  suggestions: string[]
  icon: ReactNode
  placeholder: string
  onChange: (value: string) => void
}): ReactElement {
  const [inputValue, setInputValue] = useState('')
  const [focused, setFocused] = useState(false)
  const fieldRef = useRef<HTMLLabelElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const values = useMemo(() => splitList(value), [value])
  const matches = useMemo(() => getTokenAutocompleteMatches(inputValue, suggestions), [inputValue, suggestions])

  function emitValues(nextValues: string[]): void {
    onChange(joinList(uniqueList(nextValues)))
  }

  function commitValue(rawValue: string): void {
    const nextValue = rawValue.trim()
    if (!nextValue) {
      setInputValue('')
      return
    }

    emitValues([...values, nextValue])
    setInputValue('')
    focusInput()
  }

  function removeValue(valueToRemove: string): void {
    emitValues(values.filter((item) => !valueMatches(item, valueToRemove)))
  }

  function onInputChange(nextValue: string): void {
    setFocused(true)
    if (nextValue.includes(';')) {
      const parts = nextValue.split(';')
      const completed = parts.slice(0, -1).map((part) => part.trim()).filter(Boolean)
      if (completed.length) {
        emitValues([...values, ...completed])
      }
      setInputValue(parts[parts.length - 1].trimStart())
      focusInput()
      return
    }

    setInputValue(nextValue)
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitValue(inputValue)
      return
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && !inputValue && values.length) {
      event.preventDefault()
      emitValues(values.slice(0, -1))
    }
  }

  function selectSuggestion(suggestion: string): void {
    commitValue(suggestion)
    focusInput()
  }

  function focusInput(): void {
    setFocused(true)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  return (
    <label ref={fieldRef} className="field-row token-field">
      <span>{label}</span>
      <div
        className={`token-box ${focused ? 'focused' : ''}`}
        onMouseDown={(event) => {
          const target = event.target as HTMLElement
          if (target.closest('.tag-token') || target.tagName === 'INPUT') return
          event.preventDefault()
          focusInput()
        }}
        onClick={(event) => {
          const target = event.target as HTMLElement
          if (target.closest('.tag-token')) return
          focusInput()
        }}
      >
        {icon}
        <div className="token-list">
          {values.map((item) => (
            <button
              key={item}
              type="button"
              className="tag-token"
              title="Suppr pour retirer"
              onClick={(event) => event.currentTarget.focus()}
              onKeyDown={(event) => {
                if (event.key === 'Delete' || event.key === 'Backspace') {
                  event.preventDefault()
                  removeValue(item)
                }
              }}
            >
              {item}
            </button>
          ))}
          <input
            ref={inputRef}
            value={inputValue}
            placeholder={values.length ? '' : placeholder}
            onFocus={() => setFocused(true)}
            onBlur={() =>
              window.setTimeout(() => {
                if (!fieldRef.current?.contains(document.activeElement)) {
                  setFocused(false)
                }
              }, 120)
            }
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={onInputKeyDown}
          />
        </div>
      </div>
      {focused && matches.length ? (
        <div className="autocomplete-menu token-autocomplete">
          {matches.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectSuggestion(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </label>
  )
}

function ContextMenu({ x, y, children }: { x: number; y: number; children: ReactNode }): ReactElement {
  return (
    <div className="context-menu" style={{ left: x, top: y }} onClick={(event) => event.stopPropagation()}>
      {children}
    </div>
  )
}

function MenuButton(props: {
  icon: ReactNode
  label: string
  disabled?: boolean
  onClick: () => void | Promise<void>
}): ReactElement {
  return (
    <button className="context-item" disabled={props.disabled} onClick={() => void props.onClick()}>
      {props.icon}
      <span>{props.label}</span>
    </button>
  )
}

function MenuDivider(): ReactElement {
  return <div className="context-divider" />
}

function InputDialog({
  prompt,
  onClose,
  setError
}: {
  prompt: Exclude<PromptState, null>
  onClose: () => void
  setError: (message: string | null) => void
}): ReactElement {
  const [value, setValue] = useState(prompt.value)
  const [busy, setBusy] = useState(false)

  async function submit(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await prompt.onConfirm(value)
      onClose()
    } catch (submitError) {
      setError(messageFromError(submitError))
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <form
        className="dialog"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <h2>{prompt.title}</h2>
        <label>
          <span>{prompt.label}</span>
          <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="primary-action" disabled={busy}>
            <Check size={16} />
            {prompt.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

function MetadataManagerDialog({
  rootPath,
  onClose,
  onChanged,
  setError
}: {
  rootPath: string
  onClose: () => void
  onChanged: (suggestions: MetadataSuggestions) => void
  setError: (message: string | null) => void
}): ReactElement {
  const [data, setData] = useState<MetadataCatalogData>(emptyCatalogData)
  const [activeCategory, setActiveCategory] = useState<MetadataCategory>('tags')
  const [selectedValue, setSelectedValue] = useState('')
  const [newValue, setNewValue] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [updateFiles, setUpdateFiles] = useState(true)
  const [removeFromFiles, setRemoveFromFiles] = useState(false)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const values = useMemo(() => {
    const base = activeCategory === 'statuses' ? statusOptions : []
    return mergeSuggestions(base, mergeSuggestions(data.catalog[activeCategory], data.used[activeCategory]))
  }, [activeCategory, data])

  const selectedUsageCount = selectedValue ? getUsageCount(data.counts[activeCategory], selectedValue) : 0
  const selectedIsInCatalog = selectedValue ? valueExists(data.catalog[activeCategory], selectedValue) : false

  useEffect(() => {
    setBusy(true)
    void window.photoDesk
      .getMetadataCatalog(rootPath)
      .then((result) => {
        setData(result)
        onChanged(result.suggestions)
      })
      .catch((error) => {
        const message = messageFromError(error)
        setLocalError(message)
        setError(message)
      })
      .finally(() => setBusy(false))
  }, [rootPath, onChanged, setError])

  useEffect(() => {
    if (!values.length) {
      setSelectedValue('')
      setRenameValue('')
      return
    }

    if (!valueExists(values, selectedValue)) {
      setSelectedValue(values[0])
      setRenameValue(values[0])
    }
  }, [values, selectedValue])

  useEffect(() => {
    setRenameValue(selectedValue)
    setRemoveFromFiles(false)
  }, [selectedValue])

  async function runCatalogAction(action: () => Promise<MetadataCatalogData>): Promise<void> {
    setBusy(true)
    setLocalError(null)
    setError(null)
    try {
      const result = await action()
      setData(result)
      onChanged(result.suggestions)
    } catch (error) {
      const message = messageFromError(error)
      setLocalError(message)
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  async function addValue(): Promise<void> {
    const value = newValue.trim()
    if (!value) return
    await runCatalogAction(() => window.photoDesk.addMetadataCatalogValue({ rootPath, category: activeCategory, value }))
    setSelectedValue(value)
    setRenameValue(value)
    setNewValue('')
  }

  async function renameSelected(): Promise<void> {
    const nextValue = renameValue.trim()
    if (!selectedValue || !nextValue) return
    await runCatalogAction(() =>
      window.photoDesk.renameMetadataCatalogValue({
        rootPath,
        category: activeCategory,
        from: selectedValue,
        to: nextValue,
        updateFiles
      })
    )
    setSelectedValue(nextValue)
  }

  async function deleteSelected(): Promise<void> {
    if (!selectedValue) return
    await runCatalogAction(() =>
      window.photoDesk.deleteMetadataCatalogValue({
        rootPath,
        category: activeCategory,
        value: selectedValue,
        removeFromFiles
      })
    )
    setSelectedValue('')
    setRenameValue('')
  }

  return (
    <div className="modal-backdrop">
      <section className="manager-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="manager-header">
          <div>
            <h2>Referentiels</h2>
            <p>Tags, personnes, lieux et statuts reutilisables dans les filtres et l'autocompletion.</p>
          </div>
          <IconButton title="Fermer" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>

        {localError ? <div className="manager-error">{localError}</div> : null}

        <div className="manager-body">
          <nav className="manager-tabs">
            {(Object.keys(categoryConfigs) as MetadataCategory[]).map((category) => (
              <button
                key={category}
                className={activeCategory === category ? 'active' : ''}
                onClick={() => setActiveCategory(category)}
              >
                {categoryConfigs[category].icon}
                <span>{categoryConfigs[category].label}</span>
              </button>
            ))}
          </nav>

          <div className="manager-content">
            <section className="manager-list">
              <div className="manager-list-head">
                <strong>{categoryConfigs[activeCategory].label}</strong>
                <span>{values.length}</span>
              </div>
              <div className="manager-items">
                {values.length ? (
                  values.map((value) => {
                    const usage = getUsageCount(data.counts[activeCategory], value)
                    const inCatalog = valueExists(data.catalog[activeCategory], value)
                    return (
                      <button
                        key={value}
                        className={`manager-item ${valueMatches(value, selectedValue) ? 'selected' : ''}`}
                        onClick={() => setSelectedValue(value)}
                      >
                        <span>{value}</span>
                        <small>
                          {inCatalog ? 'catalogue' : 'utilise'}
                          {usage ? ` - ${usage}` : ''}
                        </small>
                      </button>
                    )
                  })
                ) : (
                  <div className="manager-empty">{categoryConfigs[activeCategory].empty}</div>
                )}
              </div>
            </section>

            <section className="manager-actions-panel">
              <div className="manager-action-block">
                <h3>Ajouter un {categoryConfigs[activeCategory].singular}</h3>
                <div className="manager-inline-form">
                  <input
                    value={newValue}
                    placeholder={`Nouveau ${categoryConfigs[activeCategory].singular}`}
                    onChange={(event) => setNewValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void addValue()
                      }
                    }}
                  />
                  <button className="primary-action" disabled={busy || !newValue.trim()} onClick={() => void addValue()}>
                    <Check size={16} />
                    Ajouter
                  </button>
                </div>
              </div>

              <div className="manager-action-block">
                <h3>Modifier la selection</h3>
                <input
                  value={renameValue}
                  disabled={!selectedValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                />
                <label className="check-row">
                  <input checked={updateFiles} onChange={(event) => setUpdateFiles(event.target.checked)} type="checkbox" />
                  Mettre a jour les photos qui l'utilisent
                </label>
                <button
                  className="icon-button wide-button"
                  disabled={busy || !selectedValue || !renameValue.trim() || valueMatches(selectedValue, renameValue)}
                  onClick={() => void renameSelected()}
                >
                  <Edit3 size={16} />
                  Renommer
                </button>
              </div>

              <div className="manager-action-block danger-block">
                <h3>Supprimer la selection</h3>
                <p>
                  {selectedValue
                    ? `${selectedUsageCount} utilisation(s). ${selectedIsInCatalog ? 'Presente dans le catalogue.' : 'Valeur detectee sur les photos.'}`
                    : 'Aucune valeur selectionnee.'}
                </p>
                <label className="check-row">
                  <input
                    checked={removeFromFiles}
                    onChange={(event) => setRemoveFromFiles(event.target.checked)}
                    type="checkbox"
                  />
                  Retirer aussi des photos
                </label>
                <button className="icon-button wide-button danger-button" disabled={busy || !selectedValue} onClick={() => void deleteSelected()}>
                  <Trash2 size={16} />
                  Supprimer
                </button>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  )
}

function InfoSection({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="info-section">
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  )
}

function InfoRow({ label, value }: { label: string; value?: string | null }): ReactElement {
  if (!value) return <></>
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function EditorSection({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="editor-section">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function TextField({
  label,
  value,
  type = 'text',
  onChange
}: {
  label: string
  value: string
  type?: string
  onChange: (value: string) => void
}): ReactElement {
  return (
    <label className="field-row">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function TextArea({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (value: string) => void
}): ReactElement {
  return (
    <label className="field-row textarea-row">
      <span>{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function StarRating({
  value,
  label,
  compact = false,
  onChange
}: {
  value: number
  label: string
  compact?: boolean
  onChange: (value: number) => void
}): ReactElement {
  return (
    <div className={`star-rating ${compact ? 'compact' : ''}`} role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((rating) => {
        const active = rating <= value
        return (
          <button
            key={rating}
            type="button"
            className={active ? 'active' : ''}
            role="radio"
            aria-checked={value === rating}
            title={rating === value ? 'Retirer la note' : `${rating}/5`}
            onClick={() => onChange(rating === value ? 0 : rating)}
          >
            <Star size={compact ? 16 : 20} />
          </button>
        )
      })}
      <span>{value ? `${value}/5` : 'Aucune'}</span>
    </div>
  )
}

function IconButton({
  title,
  children,
  disabled,
  onClick
}: {
  title: string
  children: ReactNode
  disabled?: boolean
  onClick: () => void | Promise<void>
}): ReactElement {
  return (
    <button className="icon-button" title={title} disabled={disabled} onClick={() => void onClick()}>
      {children}
    </button>
  )
}

function KindIcon({ kind, expanded }: { kind: NodeKind; expanded?: boolean }): ReactElement {
  if (kind === 'folder') return expanded ? <FolderOpen className="kind-icon folder" size={18} /> : <Folder className="kind-icon folder" size={18} />
  if (kind === 'image') return <Image className="kind-icon image" size={18} />
  if (kind === 'video') return <Film className="kind-icon video" size={18} />
  return <File className="kind-icon file" size={18} />
}

function filterTree(root: FileNode, filters: FilterState): FileNode {
  if (countActiveFilters(filters) === 0) {
    return root
  }

  const visit = (node: FileNode, isRoot = false): FileNode | null => {
    const children = (node.children ?? []).map((child) => visit(child)).filter((child): child is FileNode => Boolean(child))
    const matches = nodeMatchesFilters(node, filters)

    if (node.kind === 'folder') {
      if (isRoot || matches || children.length) {
        return { ...node, children }
      }
      return null
    }

    return matches ? node : null
  }

  return visit(root, true) ?? { ...root, children: [] }
}

function nodeMatchesFilters(node: FileNode, filters: FilterState): boolean {
  const metadata = node.customMetadata ?? {}
  const searchable = [
    node.name,
    node.extension,
    metadata.title,
    metadata.description,
    ...getMetadataLocations(metadata),
    metadata.status,
    metadata.notes,
    ...(metadata.tags ?? []),
    ...(metadata.people ?? [])
  ]

  if (filters.search && !searchable.some((value) => normalizedIncludes(value, filters.search))) {
    return false
  }

  if (filters.kind !== 'all' && node.kind !== filters.kind) {
    return false
  }

  if ((filters.kind !== 'all' || hasMetadataFilters(filters)) && node.kind !== 'image' && node.kind !== 'video') {
    return false
  }

  if (!matchesEveryToken(metadata.tags ?? [], splitList(filters.tagsText))) {
    return false
  }

  if (filters.withoutTags && (metadata.tags ?? []).length > 0) {
    return false
  }

  if (!matchesEveryToken(metadata.people ?? [], splitList(filters.peopleText))) {
    return false
  }

  if (filters.withoutPeople && (metadata.people ?? []).length > 0) {
    return false
  }

  if (!matchesEveryToken(getMetadataLocations(metadata), splitList(filters.locationsText))) {
    return false
  }

  if (filters.withoutLocations && getMetadataLocations(metadata).length > 0) {
    return false
  }

  if (filters.status && metadata.status !== filters.status) {
    return false
  }

  if (filters.minRating > 0 && (metadata.rating ?? 0) < filters.minRating) {
    return false
  }

  if (filters.favoritesOnly && !metadata.favorite) {
    return false
  }

  return true
}

function hasMetadataFilters(filters: FilterState): boolean {
  return Boolean(
    filters.tagsText.trim() ||
      filters.peopleText.trim() ||
      filters.locationsText.trim() ||
      filters.status ||
      filters.minRating > 0 ||
      filters.favoritesOnly ||
      filters.withoutTags ||
      filters.withoutPeople ||
      filters.withoutLocations
  )
}

function countActiveFilters(filters: FilterState): number {
  let count = 0
  if (filters.search.trim()) count += 1
  if (filters.kind !== 'all') count += 1
  if (filters.tagsText.trim()) count += splitList(filters.tagsText).length || 1
  if (filters.peopleText.trim()) count += splitList(filters.peopleText).length || 1
  if (filters.locationsText.trim()) count += splitList(filters.locationsText).length || 1
  if (filters.status) count += 1
  if (filters.minRating > 0) count += 1
  if (filters.favoritesOnly) count += 1
  if (filters.withoutTags) count += 1
  if (filters.withoutPeople) count += 1
  if (filters.withoutLocations) count += 1
  return count
}

function buildMetadataSuggestionsFromTree(root: FileNode): MetadataSuggestions {
  const tags = new Set<string>()
  const people = new Set<string>()
  const locations = new Set<string>()
  const statuses = new Set<string>()

  const visit = (node: FileNode): void => {
    const metadata = node.customMetadata
    if (metadata) {
      for (const tag of metadata.tags ?? []) tags.add(tag)
      for (const person of metadata.people ?? []) people.add(person)
      for (const location of getMetadataLocations(metadata)) locations.add(location)
      if (metadata.status) statuses.add(metadata.status)
    }
    for (const child of node.children ?? []) visit(child)
  }

  visit(root)
  return {
    tags: sortValues(tags),
    people: sortValues(people),
    locations: sortValues(locations),
    statuses: sortValues(statuses)
  }
}

function mergeMetadataSuggestionSets(...sources: MetadataSuggestions[]): MetadataSuggestions {
  return {
    tags: mergeSuggestions(...sources.map((source) => source.tags)),
    people: mergeSuggestions(...sources.map((source) => source.people)),
    locations: mergeSuggestions(...sources.map((source) => source.locations)),
    statuses: mergeSuggestions(...sources.map((source) => source.statuses))
  }
}

function valueMatches(first: string, second: string): boolean {
  return normalizeForSearch(first) === normalizeForSearch(second)
}

function valueExists(values: string[], value: string): boolean {
  return values.some((item) => valueMatches(item, value))
}

function getUsageCount(counts: Record<string, number>, value: string): number {
  return Object.entries(counts).reduce((total, [item, count]) => (valueMatches(item, value) ? total + count : total), 0)
}

function getMetadataLocations(metadata: CustomMetadata): string[] {
  return uniqueList([...(metadata.locations ?? []), ...(metadata.locationName ? [metadata.locationName] : [])])
}

function matchesEveryToken(values: string[], tokens: string[]): boolean {
  return tokens.every((token) => values.some((value) => normalizedIncludes(value, token)))
}

function normalizedIncludes(value: string | undefined | null, search: string): boolean {
  if (!value) return false
  return normalizeForSearch(value).includes(normalizeForSearch(search))
}

function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function sortValues(values: Set<string>): string[] {
  return Array.from(values).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base', numeric: true }))
}

function mergeSuggestions(...sources: string[][]): string[] {
  return sortValues(new Set(sources.flat().filter(Boolean)))
}

function getAutocompleteMatches(value: string, suggestions: string[], multi: boolean): string[] {
  const token = getAutocompleteToken(value, multi)
  const normalizedToken = normalizeForSearch(token)
  if (!normalizedToken) {
    return suggestions
  }

  return suggestions
    .filter((suggestion) => normalizeForSearch(suggestion).includes(normalizedToken))
    .filter((suggestion) => !splitList(value).some((item) => normalizeForSearch(item) === normalizeForSearch(suggestion)))
}

function getTokenAutocompleteMatches(value: string, suggestions: string[]): string[] {
  const normalizedToken = normalizeForSearch(value)
  return suggestions
    .filter((suggestion) => !normalizedToken || normalizeForSearch(suggestion).includes(normalizedToken))
}

function getAutocompleteToken(value: string, multi: boolean): string {
  if (!multi) return value
  const parts = value.split(/[;,]/)
  return parts[parts.length - 1].trim()
}

function applyAutocompleteSuggestion(value: string, suggestion: string, multi: boolean): string {
  if (!multi) return suggestion
  const parts = value.split(/[;,]/)
  parts[parts.length - 1] = ` ${suggestion}`
  return joinList(parts.map((part) => part.trim()).filter(Boolean))
}

function sortTree(root: FileNode, sort: SortState): FileNode {
  const children = (root.children ?? []).map((child) => sortTree(child, sort)).sort((first, second) => compareNodes(first, second, sort))
  return { ...root, children }
}

function compareNodes(first: FileNode, second: FileNode, sort: SortState): number {
  const direction = sort.direction === 'asc' ? 1 : -1
  const primary = compareByField(first, second, sort.field)
  if (primary !== 0) return primary * direction
  return first.name.localeCompare(second.name, 'fr', { sensitivity: 'base', numeric: true })
}

function compareByField(first: FileNode, second: FileNode, field: SortField): number {
  if (field === 'modifiedAt') {
    return new Date(first.modifiedAt).getTime() - new Date(second.modifiedAt).getTime()
  }

  if (field === 'kind') {
    return kindLabel(first.kind, first.extension).localeCompare(kindLabel(second.kind, second.extension), 'fr', {
      sensitivity: 'base',
      numeric: true
    })
  }

  if (field === 'size') {
    return first.size - second.size
  }

  return first.name.localeCompare(second.name, 'fr', { sensitivity: 'base', numeric: true })
}

function flattenVisibleNodes(root: FileNode, expanded: Set<string>, depth = 0): Array<{ node: FileNode; depth: number }> {
  const rows = [{ node: root, depth }]
  if (root.kind === 'folder' && expanded.has(root.path)) {
    for (const child of root.children ?? []) {
      rows.push(...flattenVisibleNodes(child, expanded, depth + 1))
    }
  }
  return rows
}

function flattenMediaFiles(root: FileNode): string[] {
  const files: string[] = []
  const visit = (node: FileNode): void => {
    if (node.kind === 'image' || node.kind === 'video') files.push(node.path)
    for (const child of node.children ?? []) visit(child)
  }
  visit(root)
  return files
}

function findNode(root: FileNode, targetPath: string): FileNode | null {
  if (root.path === targetPath) return root
  for (const child of root.children ?? []) {
    const found = findNode(child, targetPath)
    if (found) return found
  }
  return null
}

function findNodeChain(root: FileNode, targetPath: string): FileNode[] | null {
  if (root.path === targetPath) return [root]
  for (const child of root.children ?? []) {
    const found = findNodeChain(child, targetPath)
    if (found) return [root, ...found]
  }
  return null
}

function createEmptyBulkCategoryValues(): BulkMetadataCategoryValues {
  return { tags: [], people: [], locations: [] }
}

function buildBulkMetadataValueCounts(nodes: FileNode[]): BulkMetadataValueCountsByCategory {
  const result: BulkMetadataValueCountsByCategory = {
    tags: [],
    people: [],
    locations: []
  }

  for (const category of bulkMetadataCategories) {
    const counts = new Map<string, BulkMetadataValueCount>()
    for (const node of nodes) {
      for (const value of uniqueList(getNodeBulkMetadataValues(node, category))) {
        const key = normalizeForSearch(value)
        const current = counts.get(key)
        counts.set(key, current ? { ...current, count: current.count + 1 } : { value, count: 1 })
      }
    }
    result[category] = Array.from(counts.values()).sort((first, second) =>
      first.value.localeCompare(second.value, 'fr', { sensitivity: 'base', numeric: true })
    )
  }

  return result
}

function getNodeBulkMetadataValues(node: FileNode, category: BulkMetadataCategory): string[] {
  const metadata = node.customMetadata ?? {}
  if (category === 'tags' || category === 'people') {
    return metadata[category] ?? []
  }

  return getMetadataLocations(metadata)
}

function toggleBulkValue(values: string[], value: string): string[] {
  if (values.some((item) => valueMatches(item, value))) {
    return values.filter((item) => !valueMatches(item, value))
  }

  return uniqueList([...values, value])
}

function getBulkMetadataChanges(
  checkedValues: string[],
  touchedValues: string[],
  valueCounts: BulkMetadataValueCount[],
  targetCount: number
): BulkMetadataChangeSet {
  const countByValue = new Map(valueCounts.map((item) => [normalizeForSearch(item.value), item]))
  const addValues: string[] = []
  const removeValues: string[] = []

  for (const touchedValue of uniqueList(touchedValues)) {
    const key = normalizeForSearch(touchedValue)
    const count = countByValue.get(key)?.count ?? 0
    const checkedValue = checkedValues.find((value) => valueMatches(value, touchedValue))

    if (checkedValue) {
      if (count < targetCount) addValues.push(checkedValue)
    } else if (count > 0) {
      removeValues.push(countByValue.get(key)?.value ?? touchedValue)
    }
  }

  return {
    addValues: uniqueList(addValues),
    removeValues: uniqueList(removeValues)
  }
}

function scrollNodeIntoView(filePath: string): void {
  window.requestAnimationFrame(() => {
    const row = Array.from(document.querySelectorAll<HTMLElement>('.file-row, .mosaic-tile')).find(
      (element) => element.dataset.nodePath === filePath
    )
    row?.scrollIntoView({ block: 'nearest' })
  })
}

function formFromDetails(details: MediaDetails): EditForm {
  const metadata = details.customMetadata
  const exif = details.media.exif
  const locations = getMetadataLocations(metadata)
  return {
    fileName: details.name,
    createdAt: toDateTimeLocal(details.createdAt),
    modifiedAt: toDateTimeLocal(details.modifiedAt),
    title: metadata.title ?? '',
    description: metadata.description ?? '',
    tagsText: joinList(metadata.tags ?? []),
    peopleText: joinList(metadata.people ?? []),
    rating: metadata.rating ?? 0,
    favorite: Boolean(metadata.favorite),
    status: metadata.status ?? '',
    dateTaken: toDateTimeLocal(metadata.dateTaken ?? exif?.dateTimeOriginal ?? details.media.creationTime),
    locationName: joinList(locations),
    latitude: numberToText(metadata.latitude ?? exif?.latitude),
    longitude: numberToText(metadata.longitude ?? exif?.longitude),
    notes: metadata.notes ?? '',
    rotation: 0
  }
}

function metadataFromForm(form: EditForm): CustomMetadata {
  const locations = splitList(form.locationName)
  return {
    title: form.title,
    description: form.description,
    tags: splitList(form.tagsText),
    people: splitList(form.peopleText),
    rating: form.rating,
    favorite: form.favorite,
    status: form.status,
    dateTaken: fromDateTimeLocal(form.dateTaken),
    locations,
    locationName: locations[0],
    latitude: parseOptionalNumber(form.latitude),
    longitude: parseOptionalNumber(form.longitude),
    notes: form.notes
  }
}

function snapshotForm(form: EditForm): string {
  return JSON.stringify(form)
}

function splitList(value: string): string[] {
  return uniqueList(
    value
      .split(/[;,]/)
      .map((item) => item.trim())
      .filter(Boolean)
  )
}

function uniqueList(values: string[]): string[] {
  const items = new Map<string, string>()
  for (const value of values) {
    const cleanValue = value.trim()
    if (cleanValue) items.set(normalizeForSearch(cleanValue), cleanValue)
  }
  return Array.from(items.values())
}

function joinList(values: string[]): string {
  return values
    .map((item) => item.trim())
    .filter(Boolean)
    .join('; ')
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function numberToText(value?: number | null): string {
  return value === undefined || value === null ? '' : String(value)
}

function toDateTimeLocal(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function fromDateTimeLocal(value?: string | null): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function formatDate(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

function formatDateShort(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function formatBytes(value: number): string {
  if (!value) return '0 o'
  const units = ['o', 'Ko', 'Mo', 'Go', 'To']
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const number = value / 1024 ** exponent
  return `${number.toFixed(number >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function formatDimensions(width?: number, height?: number): string | undefined {
  return width && height ? `${width} x ${height}` : undefined
}

function formatDuration(value?: number): string | undefined {
  if (!value) return undefined
  const totalSeconds = Math.round(value)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours ? `${hours} h ${minutes} min ${seconds} s` : `${minutes} min ${seconds} s`
}

function formatBitRate(value?: number): string | undefined {
  return value ? `${Math.round(value / 1000)} kb/s` : undefined
}

function kindLabel(kind: NodeKind, extension?: string): string {
  if (kind === 'folder') return 'Dossier'
  if (kind === 'image') return extension ? `Image ${extension}` : 'Image'
  if (kind === 'video') return extension ? `Video ${extension}` : 'Video'
  return extension ? `Fichier ${extension}` : 'Fichier'
}

function normalizeRotation(value: number): number {
  return ((value % 360) + 360) % 360
}

function withVersion(url: string, version: number): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}v=${version}`
}

function messageFromError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}
