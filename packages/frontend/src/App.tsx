import { Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'

const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Markets = lazy(() => import('@/pages/Markets'))
const Trading = lazy(() => import('@/pages/Trading'))
const Intelligence = lazy(() => import('@/pages/Intelligence'))
const Risk = lazy(() => import('@/pages/Risk'))
const ActivityLog = lazy(() => import('@/pages/ActivityLog'))
const Settings = lazy(() => import('@/pages/Settings'))
const BtcBot = lazy(() => import('@/pages/BtcBot'))

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
      Loading…
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route
          index
          element={
            <Suspense fallback={<PageFallback />}>
              <Dashboard />
            </Suspense>
          }
        />
        <Route
          path="markets"
          element={
            <Suspense fallback={<PageFallback />}>
              <Markets />
            </Suspense>
          }
        />
        <Route
          path="trading"
          element={
            <Suspense fallback={<PageFallback />}>
              <Trading />
            </Suspense>
          }
        />
        <Route
          path="btc-bot"
          element={
            <Suspense fallback={<PageFallback />}>
              <BtcBot />
            </Suspense>
          }
        />
        <Route
          path="intelligence"
          element={
            <Suspense fallback={<PageFallback />}>
              <Intelligence />
            </Suspense>
          }
        />
        <Route
          path="risk"
          element={
            <Suspense fallback={<PageFallback />}>
              <Risk />
            </Suspense>
          }
        />
        <Route
          path="activity"
          element={
            <Suspense fallback={<PageFallback />}>
              <ActivityLog />
            </Suspense>
          }
        />
        <Route
          path="settings"
          element={
            <Suspense fallback={<PageFallback />}>
              <Settings />
            </Suspense>
          }
        />

        {/* Redirects for old routes */}
        <Route path="orders" element={<Navigate to="/trading?tab=orders" replace />} />
        <Route path="positions" element={<Navigate to="/trading?tab=positions" replace />} />
        <Route path="decisions" element={<Navigate to="/intelligence?tab=decisions" replace />} />
        <Route path="scorers" element={<Navigate to="/intelligence?tab=scorers" replace />} />
        <Route path="analytics" element={<Navigate to="/intelligence?tab=analytics" replace />} />
        <Route path="health" element={<Navigate to="/settings?tab=health" replace />} />
      </Route>
    </Routes>
  )
}
