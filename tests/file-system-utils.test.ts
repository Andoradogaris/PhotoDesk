import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  isInside,
  minimizePathSelection,
  readJsonFile,
  runSerialized,
  samePath,
  writeJsonFileAtomic
} from '../src/main/file-system-utils.js'

test('les comparaisons de chemins distinguent un enfant d un voisin', () => {
  const root = path.resolve('C:\\photos')
  assert.equal(isInside(path.join(root, 'vacances', 'image.jpg'), root), true)
  assert.equal(isInside(path.resolve('C:\\photos-archive', 'image.jpg'), root), false)
  assert.equal(samePath(path.join(root, '.'), root), true)
})

test('une selection imbriquee ne conserve que ses racines', () => {
  const root = path.resolve('C:\\photos')
  const folder = path.join(root, 'vacances')
  const nestedFile = path.join(folder, 'image.jpg')
  const otherFile = path.join(root, 'portrait.jpg')

  assert.deepEqual(minimizePathSelection([nestedFile, folder, otherFile, folder]), [folder, otherFile])
})

test('les fichiers JSON sont remplaces proprement et les corruptions sont signalees', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'photo-desk-test-'))
  const filePath = path.join(directory, 'metadata.json')

  try {
    assert.deepEqual(await readJsonFile(filePath, { absent: true }), { absent: true })
    await writeJsonFileAtomic(filePath, { title: 'Photo', tags: ['famille'] })
    assert.deepEqual(await readJsonFile(filePath, {}), { title: 'Photo', tags: ['famille'] })

    await fs.writeFile(filePath, '{invalide', 'utf-8')
    await assert.rejects(readJsonFile(filePath, {}), /JSON est invalide/)

    const remainingFiles = await fs.readdir(directory)
    assert.deepEqual(remainingFiles, ['metadata.json'])
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('les mutations d une meme bibliotheque sont executees dans l ordre', async () => {
  const events: string[] = []
  const key = path.resolve('C:\\photos', 'metadata')
  const first = runSerialized(key, async () => {
    events.push('premiere-debut')
    await new Promise((resolve) => setTimeout(resolve, 20))
    events.push('premiere-fin')
  })
  const second = runSerialized(key, async () => {
    events.push('seconde')
  })

  await Promise.all([first, second])
  assert.deepEqual(events, ['premiere-debut', 'premiere-fin', 'seconde'])

  await assert.rejects(runSerialized(key, async () => Promise.reject(new Error('echec'))), /echec/)
  await runSerialized(key, async () => events.push('apres-echec'))
  assert.equal(events.at(-1), 'apres-echec')
})
