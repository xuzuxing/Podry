import { resources } from './data'
import type { DesiredResourceManifest } from '@/types/resourceManifest'

/** Capture fixture intent once, before live Mock edits. This is not a Helm release or Git snapshot. */
const snapshots = new Map<string, DesiredResourceManifest>(resources
  .filter(resource => resource.appId && !resource.ownerRefs.length)
  .map(resource => [resource.ref.uid, Object.freeze({ manifest: resource.manifest, resourceUid: resource.ref.uid, source: 'mock-fixture' as const })]))

export function desiredResourceSnapshot(uid: string): DesiredResourceManifest | null {
  const snapshot = snapshots.get(uid)
  return snapshot ? { ...snapshot } : null
}
