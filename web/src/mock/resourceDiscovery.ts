import { stringify } from 'yaml'
import type { K8sResource, ResourceType } from '@/types'

/** 两种同名 plural/Kind，用于离线验证 API group 身份与动态表格列。 */
export const customResourceTypes: ResourceType[] = [
  { group: 'argoproj.io', version: 'v1alpha1', resource: 'rollouts', kind: 'Rollout', namespaced: true, verbs: ['get', 'list', 'patch', 'delete'], shortNames: ['ro'], category: 'Custom Resource', printerColumns: [{ name: 'Phase', type: 'string', jsonPath: '.status.phase' }, { name: 'Replicas', type: 'integer', jsonPath: '.spec.replicas' }] },
  { group: 'delivery.podry.io', version: 'v1', resource: 'rollouts', kind: 'Rollout', namespaced: true, verbs: ['get', 'list', 'patch', 'delete'], shortNames: ['pro'], category: 'Custom Resource', printerColumns: [{ name: 'Strategy', type: 'string', jsonPath: '.spec.strategy' }, { name: 'Weight', type: 'integer', jsonPath: '.status.weight' }, { name: 'Paused', type: 'boolean', jsonPath: '.spec.paused' }] },
]

function resource(group: string, version: string, plural: string, kind: string, namespace: string, name: string, body: Record<string, unknown>, status: string, appId: string | null): K8sResource {
  return {
    ref: { group, version, resource: plural, namespace, name, uid: `uid-discovery-${group}-${namespace}-${name}` }, kind, status, summary: '', ownerRefs: [], appId,
    manifest: stringify({ apiVersion: `${group}/${version}`, kind, metadata: { name, ...(namespace === '_cluster' ? {} : { namespace }), creationTimestamp: '2026-11-20T06:00:00Z' }, ...body }),
  }
}

export const customResources: K8sResource[] = customResourceTypes.flatMap(type => [
  resource('apiextensions.k8s.io', 'v1', 'customresourcedefinitions', 'CustomResourceDefinition', '_cluster', `${type.resource}.${type.group}`, {
    spec: { group: type.group, scope: 'Namespaced', names: { plural: type.resource, singular: 'rollout', kind: type.kind, shortNames: type.shortNames }, versions: [{ name: type.version, served: true, storage: true, additionalPrinterColumns: type.printerColumns, schema: { openAPIV3Schema: { type: 'object', properties: { spec: { type: 'object', 'x-kubernetes-preserve-unknown-fields': true }, status: { type: 'object', 'x-kubernetes-preserve-unknown-fields': true } } } } }] },
    status: { conditions: [{ type: 'Established', status: 'True' }, { type: 'NamesAccepted', status: 'True' }] },
  }, 'Established', null),
  resource(type.group, type.version, type.resource, type.kind, 'shop-dev', 'checkout-canary', type.group === 'argoproj.io' ? { spec: { replicas: 3 }, status: { phase: 'Healthy' } } : { spec: { strategy: 'Canary', paused: false }, status: { weight: 25 } }, 'Healthy', 'a-checkout'),
])

export const resourceShortNames: Record<string, string[]> = {
  pods: ['po'], events: ['ev'], services: ['svc'], deployments: ['deploy'], statefulsets: ['sts'], daemonsets: ['ds'], replicasets: ['rs'],
  cronjobs: ['cj'], configmaps: ['cm'], namespaces: ['ns'], nodes: ['no'], persistentvolumes: ['pv'], persistentvolumeclaims: ['pvc'],
  customresourcedefinitions: ['crd', 'crds'], horizontalpodautoscalers: ['hpa'], ingresses: ['ing'], serviceaccounts: ['sa'], storageclasses: ['sc'],
}
