import { create } from 'zustand'
import type {
  Profile, Account, ProxyList, ProductGroup, Task,
  HarvesterConfig, AppSettings, CookiePoolStatus,
} from '../shared/types'

interface Toast {
  id: string
  message: string
  kind: 'success' | 'error' | 'info' | 'warning'
}

interface AppStore {
  // Nav
  activePage: string
  setActivePage: (page: string) => void

  // Data
  profiles:   Profile[]
  accounts:   Account[]
  proxies:    ProxyList[]
  groups:     ProductGroup[]
  tasks:      Task[]
  harvesters: HarvesterConfig[]
  settings:   AppSettings | null
  poolStatus: CookiePoolStatus | null

  // Setters
  setProfiles:   (v: Profile[]) => void
  setAccounts:   (v: Account[]) => void
  setProxies:    (v: ProxyList[]) => void
  setGroups:     (v: ProductGroup[]) => void
  setTasks:      (v: Task[]) => void
  setHarvesters: (v: HarvesterConfig[]) => void
  setSettings:   (v: AppSettings) => void
  setPoolStatus: (v: CookiePoolStatus) => void

  // Task status patches
  patchTask: (id: number, patch: Partial<Task>) => void
  patchHarvester: (id: string, patch: Partial<HarvesterConfig>) => void

  // Toasts
  toasts: Toast[]
  addToast: (message: string, kind: Toast['kind']) => void
  removeToast: (id: string) => void
}

let toastSeq = 0

export const useStore = create<AppStore>((set) => ({
  activePage: 'dashboard',
  setActivePage: (page) => set({ activePage: page }),

  profiles:   [],
  accounts:   [],
  proxies:    [],
  groups:     [],
  tasks:      [],
  harvesters: [],
  settings:   null,
  poolStatus: null,

  setProfiles:   (profiles)   => set({ profiles }),
  setAccounts:   (accounts)   => set({ accounts }),
  setProxies:    (proxies)    => set({ proxies }),
  setGroups:     (groups)     => set({ groups }),
  setTasks:      (tasks)      => set({ tasks }),
  setHarvesters: (harvesters) => set({ harvesters }),
  setSettings:   (settings)   => set({ settings }),
  setPoolStatus: (poolStatus) => set({ poolStatus }),

  patchTask: (id, patch) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),

  patchHarvester: (id, patch) =>
    set((s) => ({
      harvesters: s.harvesters.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    })),

  toasts: [],
  addToast: (message, kind) => {
    const id = String(++toastSeq)
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 4000)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
