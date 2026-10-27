/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

type PushPayload = { title: string; body?: string; tag?: string; url?: string }

self.addEventListener('push', (event) => {
  let data: PushPayload = { title: 'הבית שלנו' }
  try { data = { ...data, ...event.data?.json() } } catch { data.body = event.data?.text() }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      lang: 'he',
      dir: 'rtl',
      data: { url: data.url ?? self.registration.scope },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url: string = event.notification.data?.url ?? self.registration.scope
  const taskId = new URL(url, self.registration.scope).searchParams.get('task')
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = all.find((c) => c.url.startsWith(self.registration.scope))
    if (existing) {
      // The app is already open in the background: focus it and open the task there.
      await existing.focus()
      if (taskId) existing.postMessage({ type: 'open-task', taskId })
      return
    }
    await self.clients.openWindow(url)
  })())
})
