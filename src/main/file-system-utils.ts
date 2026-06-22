import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const operationQueues = new Map<string, Promise<void>>()

function pathKey(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function samePath(first: string, second: string): boolean {
  return pathKey(first) === pathKey(second)
}

export function isInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

export function minimizePathSelection(paths: string[]): string[] {
  const uniquePaths = new Map<string, string>()
  for (const filePath of paths) {
    if (typeof filePath !== 'string' || !filePath.trim()) continue
    const resolved = path.resolve(filePath)
    uniquePaths.set(pathKey(resolved), resolved)
  }

  const sortedPaths = Array.from(uniquePaths.values()).sort((first, second) => first.length - second.length)
  return sortedPaths.filter((candidate, index) => {
    return !sortedPaths.slice(0, index).some((parent) => isInside(candidate, parent))
  })
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw error
  }

  try {
    return JSON.parse(raw) as T
  } catch (error) {
    throw new Error(`Le fichier JSON est invalide : ${filePath}`, { cause: error })
  }
}

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath)
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}-${randomUUID()}.tmp`)
  await fs.mkdir(directory, { recursive: true })

  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf-8', flag: 'wx' })
    await fs.rename(temporaryPath, filePath)
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

export async function runSerialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const queueKey = pathKey(key)
  const previous = operationQueues.get(queueKey) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  const tail = result.then(
    () => undefined,
    () => undefined
  )
  operationQueues.set(queueKey, tail)

  try {
    return await result
  } finally {
    if (operationQueues.get(queueKey) === tail) operationQueues.delete(queueKey)
  }
}
