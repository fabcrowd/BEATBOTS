import React, { useEffect, useCallback } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useStore } from './store'
import { bridge } from './bridge'
import { playCheckoutChime, playErrorBeep } from './utils/sound'
import Sidebar from './components/Sidebar'
import TitleBar from './components/TitleBar'
import ToastContainer from './components/ToastContainer'
import Dashboard from './pages/Dashboard'
import Tasks from './pages/Tasks'
import Profiles from './pages/Profiles'
import Accounts from './pages/Accounts'
import Proxies from './pages/Proxies'
import Products from './pages/Products'
import Harvesters from './pages/Harvesters'
import Settings from './pages/Settings'

const IPC_CHANNELS = {
  PROFILES_GET_ALL:   'profiles:getAll',
  ACCOUNTS_GET_ALL:   'accounts:getAll',
  PROXIES_GET_ALL:    'proxies:getAll',
  GROUPS_GET_ALL:     'groups:getAll',
  TASKS_GET_ALL:      'tasks:getAll',
  HARVESTERS_GET_ALL: 'harvesters:getAll',
  SETTINGS_GET:       'settings:get',
  POOL_STATUS:        'pool:status',
  PUSH_TASK_UPDATE:   'push:taskUpdate',
  PUSH_POOL_UPDATE:   'push:poolUpdate',
  PUSH_HARVESTER_UPDATE: 'push:harvesterUpdate',
  PUSH_TOAST:         'push:toast',
}

export default function App() {
  const { setProfiles, setAccounts, setProxies, setGroups, setTasks, setHarvesters, setSettings, setPoolStatus, addToast, patchTask, patchHarvester } = useStore()

  const loadAll = useCallback(async () => {
    const [profiles, accounts, proxies, groups, tasks, harvesters, settings, pool] = await Promise.all([
      bridge.invoke(IPC_CHANNELS.PROFILES_GET_ALL),
      bridge.invoke(IPC_CHANNELS.ACCOUNTS_GET_ALL),
      bridge.invoke(IPC_CHANNELS.PROXIES_GET_ALL),
      bridge.invoke(IPC_CHANNELS.GROUPS_GET_ALL),
      bridge.invoke(IPC_CHANNELS.TASKS_GET_ALL),
      bridge.invoke(IPC_CHANNELS.HARVESTERS_GET_ALL),
      bridge.invoke(IPC_CHANNELS.SETTINGS_GET),
      bridge.invoke(IPC_CHANNELS.POOL_STATUS),
    ])
    setProfiles(profiles ?? [])
    setAccounts(accounts ?? [])
    setProxies(proxies ?? [])
    setGroups(groups ?? [])
    setTasks(tasks ?? [])
    setHarvesters(harvesters ?? [])
    if (settings) setSettings(settings)
    if (pool) setPoolStatus(pool)
  }, [])

  useEffect(() => {
    loadAll()

    // Subscribe to push events
    const offTask = bridge.on(IPC_CHANNELS.PUSH_TASK_UPDATE, (ev: any) => {
      if (ev?.event === 'taskStatus' && ev?.id) {
        patchTask(ev.id, { status: ev.status, statusText: ev.statusText })
        // Reload full task list on terminal states so counts update
        if (['success', 'error', 'stopped'].includes(ev.status)) {
          bridge.invoke(IPC_CHANNELS.TASKS_GET_ALL).then((tasks: any) => {
            if (tasks) useStore.getState().setTasks(tasks)
          })
        }
      }
    })
    const offPool = bridge.on(IPC_CHANNELS.PUSH_POOL_UPDATE, () => {
      bridge.invoke(IPC_CHANNELS.POOL_STATUS).then(setPoolStatus)
    })
    const offHarvester = bridge.on(IPC_CHANNELS.PUSH_HARVESTER_UPDATE, (ev: any) => {
      if (ev?.id) patchHarvester(ev.id, ev)
      bridge.invoke(IPC_CHANNELS.POOL_STATUS).then(setPoolStatus)
    })
    const offToast = bridge.on(IPC_CHANNELS.PUSH_TOAST, (ev: any) => {
      if (ev.message === '__play_sound__') {
        if (ev.sound === 'checkout') playCheckoutChime()
        return
      }
      addToast(ev.message, ev.kind ?? 'info')
      if (ev.playSound) playCheckoutChime()
    })

    // Refresh pool every 5s
    const pollHandle = setInterval(() => {
      bridge.invoke(IPC_CHANNELS.POOL_STATUS).then(setPoolStatus)
    }, 5000)

    return () => {
      offTask()
      offPool()
      offHarvester()
      offToast()
      clearInterval(pollHandle)
    }
  }, [])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface text-zinc-100">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/"           element={<Dashboard />} />
            <Route path="/tasks"      element={<Tasks />} />
            <Route path="/profiles"   element={<Profiles />} />
            <Route path="/accounts"   element={<Accounts />} />
            <Route path="/proxies"    element={<Proxies />} />
            <Route path="/products"   element={<Products />} />
            <Route path="/harvesters" element={<Harvesters />} />
            <Route path="/settings"   element={<Settings />} />
          </Routes>
        </main>
      </div>
      <ToastContainer />
    </div>
  )
}
